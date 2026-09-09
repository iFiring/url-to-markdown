# 文章视图分块 + 并行子代理 + 分片合并 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `6_article.html` 超过 80KB 时物理分割为多个完整 html 分块，步骤 7 并行派发子代理各产骨架分片，步骤 8 入口检测并合并分片后走现有还原逻辑。

**Architecture:** 分割器是 Node 侧纯函数模块 `script/lib/chunk-article.mjs`（贪心装箱 + 尾块合并 + 三侧上下文窗口 + 超限削减，输入为已收集的字符串数组，零 DOM 依赖）；`extract_article.mjs` 在 slim pass 后多收集一次 body 逐子元素 outerHTML 并调用分割器；`screenshot_trans.mjs` 入口优先读 `7_skeleton.json`、否则 glob 校验合并分片。SKILL.md 由步骤 6 emit 的 `chunks` 字段驱动并行派发。

**Tech Stack:** Node ≥20（node:test）、Playwright（仅既有流程使用，分割器纯 Node）、UTF-8 字节计量（`Buffer.byteLength`）。

**Spec:** `docs/superpowers/specs/2026-09-09-article-chunk-split-design.md`（本计划从 spec 立论；执行者须同时读 spec）

## Global Constraints

- stdout 有且仅有一行 JSON（失败路径也不例外），日志走 stderr，退出码 0/1/2（usage_error=2）——见 `script/lib/contract.mjs`
- **emit 延迟退出陷阱**：`emit()` 同步返回、在写回调里 `process.exit`——所有 `usage()`/`emitError()`/`emit()` 之后必须提前 return，不留可执行路径
- 分割是**Node 侧纯字符串字节操作**（非 DOM 分类逻辑），按 spec §3.2 放 `.mjs` 纯函数模块——不进 `page-*.js` 共享页面脚本体系
- 默认阈值：`U2M_ARTICLE_SPLIT_THRESHOLD` = 81920（80KB）、`U2M_ARTICLE_CHUNK_MAX` = 51200（50KB），均为**字节**单位、正整数 env 覆盖（测试调低触发）；上下文每侧字节帽 = `chunkMax/5`；尾块合并守护 = `splitThreshold`
- 命名：`6_article_chunk_X_of_N.html` / `7_skeleton_chunk_X_of_N.json`（X 从 1 起，正则 `^6_article_chunk_(\d+)_of_(\d+)\.html$` / `^7_skeleton_chunk_(\d+)_of_(\d+)\.json$`）
- 测试以子进程跑真实 CLI（`test/helpers/run-script.mjs` 的 `runScript`），`U2M_WORKING_ROOT` 隔离工作目录；纯函数测试不起浏览器
- 每任务结束跑相关测试并 commit；commit 信息中文、`类型(范围): 摘要` 风格

---

### Task 1: 分割器纯函数模块 `lib/chunk-article.mjs`

**Files:**
- Create: `script/lib/chunk-article.mjs`
- Test: `test/unit/chunk-article.test.mjs`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `chunkArticle(slimHtml: string, children: string[], opts: {splitThreshold: number, chunkMax: number}) → {split: boolean, chunks: Array<{x: number, n: number, html: string}>}`——`split=false` 时 `chunks` 为空数组；每个 `html` 是完整独立文档（`<!DOCTYPE html>\n<html …><head>…</head><body …>…</body></html>`）。Task 2 调用此签名。

- [ ] **Step 1: 写失败的单测**

创建 `test/unit/chunk-article.test.mjs`（纯函数测试，不起浏览器；`blk(id, size)` 构造**精确字节**的段落块；测试构造的字节数已在计划期验算——含标记注释字节占比）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkArticle } from '../../script/lib/chunk-article.mjs';

// 头部与 page-slim 产物同构：'<!DOCTYPE html>\n' + documentElement.outerHTML
const HEAD = '<html lang="zh-CN"><head><title>t</title></head><body style="max-width: 768px; margin: 4rem auto">';
const doc = (children) => `<!DOCTYPE html>\n${HEAD}${children.join('')}</body></html>`;
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// 精确 size 字节的段落块（open 长度随 id 位数变化，filler 补齐）
const blk = (id, size) => {
  const open = `<p data-idx="${id}">`;
  return `${open}${'x'.repeat(size - open.length - 4)}</p>`;
};
assert.equal(bytes(blk(3, 800)), 800, 'blk 辅助函数应精确控制字节');

// 从 html 提取 data-idx 序列（断言块身份与顺序）
const ids = (html) => [...html.matchAll(/data-idx="(\d+)"/g)].map((m) => Number(m[1]));

test('T1 未达阈值不分割：split=false、chunks 空', () => {
  const children = [blk(1, 300), blk(2, 300), blk(3, 300)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 1024 * 1024, chunkMax: 51200 });
  assert.equal(r.split, false);
  assert.deepEqual(r.chunks, []);
});

test('T2 贪心装箱 + 尾块合并 + 下文豁免：合并块允许溢出 chunkMax', () => {
  // 14 个 1000B 块，chunkMax=6500 → 贪心 [6,6,2]；尾块 2 块 <5，
  // 6000+2000=8000 ≤ splitThreshold(12000) → 并入 → 2 块
  const children = Array.from({ length: 14 }, (_, i) => blk(i + 1, 1000));
  const r = chunkArticle(doc(children), children, { splitThreshold: 12000, chunkMax: 6500 });
  assert.equal(r.split, true);
  assert.equal(r.chunks.length, 2);
  const [c1, c2] = r.chunks;
  // 块 1：own=6000，下文 [b7] 1000B ≤cap(1300)——下文豁免不计入预算
  // （计入则 own+b7 恒 >chunkMax 永被削减）；无开头/上文 → 无 ✅
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束'), '下文豁免后 ❌ 应存活');
  assert.ok(c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');
  // 块 2（末块、尾块合并产物 own 8000 > chunkMax）：全部上下文削减
  assert.deepEqual(ids(c2.html), [7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(!c2.html.includes('📌') && !c2.html.includes('✅') && !c2.html.includes('❌'));
  // 合并块 own 8000 > chunkMax 6500——尾块合并溢出是合法例外（≤ splitThreshold）
  assert.ok(bytes(c2.html) > 6500 && bytes(c2.html) <= 12000);
});

test('T3 上下文窗口：开头/上文就位、下文被字节帽压制、末块全削减、分片守护不过保留小块', () => {
  // chunkMax=10000、cap=2000、splitThreshold=12000。
  // 贪心：[ids1-7]=7800（id5=3000 封边）、[ids8-11]=5400（id12=8000 封边）、
  // [ids12-14]=9600（3 块 <5 但 5400+9600=15000 >12000 守护不过 → 保留）
  const children = [
    blk(1, 800), blk(2, 800), blk(3, 800), blk(4, 800), blk(5, 3000), blk(6, 800), blk(7, 800),
    blk(8, 3000), blk(9, 800), blk(10, 800), blk(11, 800),
    blk(12, 8000), blk(13, 800), blk(14, 800),
  ];
  const r = chunkArticle(doc(children), children, { splitThreshold: 12000, chunkMax: 10000 });
  assert.equal(r.split, true);
  assert.equal(r.chunks.length, 3);
  const [c1, c2, c3] = r.chunks;

  // 块 1：own=[1-7]；next 候选 id8(3000) > cap → 下文压制 → 裸 own
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!c1.html.includes('✅') && !c1.html.includes('❌'), '首块无上下文标记');

  // 块 2：📌开头=[1,2]（第 3 块 2400>cap 截停）、⚠️上文=[6,7]（向前取 2 块、
  // id5 3000 截停）、✅；next 候选 id12(8000)>cap → 无 ❌。
  // file=1600+1600+5400+注释 ≈ 9.1KB ≤ chunkMax → 削减不触发
  assert.deepEqual(ids(c2.html), [1, 2, 6, 7, 8, 9, 10, 11]);
  assert.ok(c2.html.includes('📌 开头上下文'), '应有开头上下文标记');
  assert.ok(c2.html.includes('⚠️ 上文上下文'), '应有上文上下文标记');
  assert.ok(c2.html.includes('✅ 待转换内容自此开始'), '应有开始标记');
  assert.ok(!c2.html.includes('❌'), '下文被字节帽压制 → 无结束标记');
  assert.ok(bytes(c2.html) <= 10000);
  // 开头块不重复出现（去重语义：上文跳过已在开头集内的块）
  assert.equal((c2.html.match(/data-idx="1"/g) || []).length, 1);

  // 块 3（末块）：own 9600 + 任何侧都超 chunkMax → 全削减 → 裸 own
  assert.deepEqual(ids(c3.html), [12, 13, 14]);
  assert.ok(!c3.html.includes('📌') && !c3.html.includes('✅'));

  // 每块都是完整独立文档（与 6_article.html 同头）
  for (const c of r.chunks) {
    assert.ok(c.html.startsWith('<!DOCTYPE html>\n'));
    assert.ok(c.html.includes('<title>t</title>'));
    assert.ok(c.html.includes('max-width: 768px'));
    assert.ok(c.html.endsWith('</body></html>'));
    assert.equal(c.n, 3);
  }
});

test('T4 尾块守护不过：巨块尾部保留为独立小块', () => {
  // 3 个 45KB 块：贪心各自成块；尾块 1 块 <5 但 45000+45000=90000 > 80000 守护不过
  const children = [blk(1, 45000), blk(2, 45000), blk(3, 45000)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 80000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 3);
  assert.deepEqual(r.chunks.map((c) => ids(c.html)), [[1], [2], [3]]);
});

test('T5 巨段落块独立成块（允许溢出）+ 首块下文削减', () => {
  // id1=60KB > chunkMax(50KB) → 独立成块；剩余 8×500B 一块
  const children = [blk(1, 60000), ...Array.from({ length: 8 }, (_, i) => blk(i + 2, 500))];
  const r = chunkArticle(doc(children), children, { splitThreshold: 60000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 2);
  // 首块 own 60KB + 下文 1000B > chunkMax → 削减删下文 → 裸 own、字节溢出合法
  assert.deepEqual(ids(r.chunks[0].html), [1]);
  assert.ok(bytes(r.chunks[0].html) > 50000, '巨块溢出是合法例外');
  assert.ok(!r.chunks[0].html.includes('❌'));
  // 末块：opening 候选 60KB > cap、prev 候选 60KB > cap → 裸 own
  assert.deepEqual(ids(r.chunks[1].html), [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('T6 N=1 回退：装箱后仅 1 块 → 视为未分割', () => {
  // splitThreshold(100) < 总字节(~1KB) 触发分割，但 chunkMax 巨大 → 单包装箱 → 回退
  const children = [blk(1, 300), blk(2, 300)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 100, chunkMax: 102400 });
  assert.equal(r.split, false);
  assert.deepEqual(r.chunks, []);
});

test('T7 下文豁免存活 + 末块三标记：❌/⚠️下文 与 📌/⚠️上文/✅ 各就各位', () => {
  // chunkMax=10000、cap=2000、splitThreshold=20000。贪心验算（计划期已逐块核算）：
  // pack0=[ids1-4]=8900（id5 1700B 封边）；pack1=[ids5-13]=8600（id14 1500B 封边）；
  // pack2=[ids14-19]=5500（6 块 ≥5 不合并）。总 23000 > 20000 触发分割。
  const children = [
    blk(1, 800), blk(2, 800), blk(3, 6500), blk(4, 800),
    blk(5, 1700), ...Array.from({ length: 7 }, (_, i) => blk(i + 6, 800)), blk(13, 1300),
    blk(14, 1500), ...Array.from({ length: 5 }, (_, i) => blk(i + 15, 800)),
  ];
  const r = chunkArticle(doc(children), children, { splitThreshold: 20000, chunkMax: 10000 });
  assert.equal(r.chunks.length, 3);
  const [c1, c2, c3] = r.chunks;

  // 块 1：own 8900 + 下文 [id5]（1700 ≤cap；id6 会 2500>cap 截停）——
  // 豁免后 (own+头) ≤chunkMax 不触发削减 → ❌/⚠️下文 存活
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束') && c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');

  // 块 2：own 8600 + 开头/上文 超预算（触发 ≈11676>10000）→ 📌/⚠️上文/✅ 全削减；
  // 下文 [id14]（1500 ≤cap）豁免存活 → own + ❌/⚠️下文
  assert.deepEqual(ids(c2.html), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(c2.html.includes('❌ 待转换内容自此结束'), '下文豁免应在削减后存活');
  assert.ok(!c2.html.includes('📌') && !c2.html.includes('✅'), 'own 超预算 → 开头/上文削光');

  // 块 3（末块）：📌=[1,2]（1600 ≤cap，id3 6500 截停）+ ⚠️上文=[13]（1300 ≤cap，
  // id12 会 2100>cap 截停）+ ✅ + own，无 ❌（末块无下文侧）
  assert.deepEqual(ids(c3.html), [1, 2, 13, 14, 15, 16, 17, 18, 19]);
  assert.ok(c3.html.includes('📌 开头上下文') && c3.html.includes('⚠️ 上文上下文'));
  assert.ok(c3.html.includes('✅ 待转换内容自此开始'));
  assert.ok(!c3.html.includes('❌'), '末块无下文侧');
});
```

**注意**：T2/T3/T7 的字节构造已在计划期逐块验算（含标记注释字节）；实现后若个别断言因 ±几十字节边界不符，先打印算法输出重算再修断言——算法行为以 spec 为准，**不得删除测试**。

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/unit/chunk-article.test.mjs
```

预期：FAIL——`Cannot find module '.../script/lib/chunk-article.mjs'`。

- [ ] **Step 3: 实现模块**

创建 `script/lib/chunk-article.mjs`：

```js
// script/lib/chunk-article.mjs
/**
 * 文章视图分块器（spec docs/superpowers/specs/2026-09-09-article-chunk-split-design.md）。
 * 纯函数：不碰文件系统与浏览器；由 extract_article.mjs 在 slim pass 后调用。
 *
 * 输入：page-slim 产物全文 slimHtml 与 body 逐子元素 outerHTML（同一 DOM、
 * 同一序列化器——每块 markup 与 6_article.html 逐字节一致）。输出完整独立
 * html 分块 6_article_chunk_X_of_N.html 的内容。
 *
 * 算法（spec §3.3-§3.5）：
 *   1. 触发：slimHtml 字节 > splitThreshold 才分割
 *   2. 贪心装箱：按文档序累加，加入下一块会超 chunkMax 即封块；单个段落块
 *      自身 > chunkMax 时独立成块（允许溢出——段落块是步骤 7 的原子契约单位）
 *   3. 尾块合并（循环每轮重查）：最后一块段落块数 <5 且（前块+尾块 own）≤
 *      splitThreshold → 并入前块。守护必须用 splitThreshold：贪心封边处恒有
 *      前块+尾块首块 > chunkMax，而尾块 own ≥ 尾块首块，chunkMax 守护下条件
 *      永假（死代码）。合并后仅剩 1 块 → 视为未分割（防御分支）
 *   4. 上下文窗口：第 2 块起 📌开头（第 1 块前 min(3,·) 个的前缀）+ ⚠️上文
 *      （上一块尾部向前 ≤2，跳过已在开头集内的块）；每块 ⚠️下文（下一块
 *      开头向后 ≤2，末块无）。每侧独立字节帽 chunkMax/5：(已取+候选) ≤ 帽
 *      才取、否则停
 *   5. 超限削减（下文豁免，spec §3.4）：触发条件 =（文件字节 − 下文侧字节）
 *      > chunkMax——下文不计入预算（贪心封边处恒有 own+b₀ > chunkMax，计入
 *      则下文恒被清空）；按 上文→开头→下文 整侧清空直到触发条件不成立或
 *      上下文全空（own 自身超限的巨块/合并块自然删光上下文）
 *
 * 标记注释（一句话中英双语，spec §3.5 文案）划出转换边界：子代理只转换
 * ✅ 与 ❌ 之间（或无标记时的全部）段落块。
 */
const OPENING_MARK = (k) => `<!-- 📌 开头上下文（勿转换）/ OPENING CONTEXT (do NOT convert): 以下 ${k} 个段落块是文章开头的标题/导语，仅供建立标题层级与字号基准。勿为它们产出条目；其中出现的 LONG_TEXT/TABLE/CODE 编号一律勿引用（由第 1 块负责）。 -->`;
const PREV_MARK = (k) => `<!-- ⚠️ 上文上下文（勿转换）/ PRECEDING CONTEXT (do NOT convert): 以下 ${k} 个段落块紧邻本块待转换内容之前，仅供衔接语境（标题层级/列表延续/字号基准）。勿为它们产出条目；其中的编号一律勿引用（由上一块负责）。 -->`;
const START_MARK = '<!-- ✅ 待转换内容自此开始 / Convert ONLY the content below this marker -->';
const END_MARK = '<!-- ❌ 待转换内容自此结束 / Convertible content ENDS here（下方为下文上下文，勿转换） -->';
const NEXT_MARK = (k) => `<!-- ⚠️ 下文上下文（勿转换）/ FOLLOWING CONTEXT (do NOT convert): 以上 ${k} 个段落块紧邻本块待转换内容之后，仅供衔接语境。勿为它们产出条目；其中的编号一律勿引用（由下一块负责）。 -->`;

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// page-slim 产物形态：'<!DOCTYPE html>\n' + documentElement.outerHTML，
// head 与 body 之间无空白文本节点（序列化保证）——不匹配则放弃分割（防御）
const DOC_RE = /^<!DOCTYPE html>\n?(<html[\s\S]*?<\/head><body[^>]*>)[\s\S]*<\/body><\/html>\s*$/;

export function chunkArticle(slimHtml, children, { splitThreshold, chunkMax }) {
  const m = DOC_RE.exec(slimHtml);
  if (!m || !Array.isArray(children) || children.length === 0) return { split: false, chunks: [] };
  if (bytes(slimHtml) <= splitThreshold) return { split: false, chunks: [] };
  const header = m[1];
  const sizes = children.map(bytes);

  // ── 1. 贪心装箱（children 下标即块身份）──
  const packs = []; // number[][]：每包的 children 下标（文档序）
  let cur = [];
  let curBytes = 0;
  for (let i = 0; i < children.length; i++) {
    if (cur.length > 0 && curBytes + sizes[i] > chunkMax) {
      packs.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(i);
    curBytes += sizes[i];
  }
  if (cur.length > 0) packs.push(cur);

  // ── 2. 尾块合并（循环；N=1 回退）──
  const packBytes = (p) => p.reduce((s, i) => s + sizes[i], 0);
  while (
    packs.length >= 2
    && packs[packs.length - 1].length < 5
    && packBytes(packs[packs.length - 2]) + packBytes(packs[packs.length - 1]) <= splitThreshold
  ) {
    const last = packs.pop();
    packs[packs.length - 1].push(...last);
  }
  if (packs.length <= 1) return { split: false, chunks: [] };

  // ── 3. 上下文窗口（每侧字节帽 = chunkMax/5，候选放不进即停）──
  const cap = Math.floor(chunkMax / 5);
  const opening = (() => {
    const cand = packs[0].slice(0, Math.min(3, packs[0].length));
    const out = [];
    let acc = 0;
    for (const i of cand) {
      if (acc + sizes[i] > cap) break;
      out.push(i);
      acc += sizes[i];
    }
    return out;
  })();
  const openingSet = new Set(opening);
  const pickPrev = (i) => {
    // 从上一块末尾向前取 ≤2 个，跳过已在开头集内的块（去重）
    const out = [];
    let acc = 0;
    for (let j = packs[i - 1].length - 1; j >= 0 && out.length < 2; j--) {
      const idx = packs[i - 1][j];
      if (openingSet.has(idx)) continue;
      if (acc + sizes[idx] > cap) break;
      out.push(idx);
      acc += sizes[idx];
    }
    return out.reverse(); // 还原文档序
  };
  const pickNext = (i) => {
    const out = [];
    let acc = 0;
    for (let j = 0; j < packs[i + 1].length && out.length < 2; j++) {
      const idx = packs[i + 1][j];
      if (acc + sizes[idx] > cap) break;
      out.push(idx);
      acc += sizes[idx];
    }
    return out;
  };

  // ── 4. 组装 + 超限削减（下文→上文→开头 整侧清空）──
  const n = packs.length;
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const own = packs[i];
    let openingIdxs = i > 0 ? opening : [];
    let prevIdxs = i > 0 ? pickPrev(i) : [];
    let nextIdxs = i < n - 1 ? pickNext(i) : [];
    const build = () => {
      const parts = [header];
      if (openingIdxs.length > 0) {
        parts.push(`\n${OPENING_MARK(openingIdxs.length)}`);
        parts.push(...openingIdxs.map((t) => children[t]));
      }
      if (prevIdxs.length > 0) {
        parts.push(`\n${PREV_MARK(prevIdxs.length)}`);
        parts.push(...prevIdxs.map((t) => children[t]));
      }
      if (openingIdxs.length > 0 || prevIdxs.length > 0) parts.push(`\n${START_MARK}\n`);
      parts.push(...own.map((t) => children[t]));
      if (nextIdxs.length > 0) {
        parts.push(`\n${END_MARK}`);
        parts.push(`\n${NEXT_MARK(nextIdxs.length)}`);
        parts.push(...nextIdxs.map((t) => children[t]));
      }
      parts.push('</body></html>');
      return parts.join('');
    };
    // 超限削减（下文豁免，spec §3.4）：触发条件不含下文侧——贪心封边处恒有
    // own + b₀ > chunkMax（b₀ = 下一块首块 = 下文侧首候选），计入预算则下文
    // 恒被清空（结构性死代码）。削减顺序：上文 → 开头 → 下文（最后兜底）
    const nextExtra = () => (nextIdxs.length > 0
      ? bytes(`\n${END_MARK}`) + bytes(`\n${NEXT_MARK(nextIdxs.length)}`)
        + nextIdxs.reduce((s, t) => s + sizes[t], 0)
      : 0);
    let html = build();
    for (const clear of [
      () => { prevIdxs = []; },
      () => { openingIdxs = []; },
      () => { nextIdxs = []; },
    ]) {
      if (bytes(html) - nextExtra() <= chunkMax) break;
      clear();
      html = build();
    }
    chunks.push({ x: i + 1, n, html });
  }
  return { split: true, chunks };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/unit/chunk-article.test.mjs
```

预期：全部 PASS。若 T2/T3/T7 的字节验算有出入，先核对算法输出（`console.log` 打 `r.chunks.map(c=>ids(c.html))`）再修断言——**算法行为以 spec 为准，测试构造围绕它修正**。

- [ ] **Step 5: Commit**

```bash
git add script/lib/chunk-article.mjs test/unit/chunk-article.test.mjs
git commit -m "feat(chunk): 文章视图分块纯函数——贪心装箱/尾块合并/三侧上下文窗口/超限削减"
```

---

### Task 2: `extract_article.mjs` 接入分割 + stale 清理 + emit `chunks`

**Files:**
- Modify: `script/extract_article.mjs`（slim pass 后收集 children；写产物后清理 stale、写分块、emit）
- Test: `test/unit/extract-article.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `chunkArticle(slimHtml, children, {splitThreshold, chunkMax})`
- Produces: emit 增 `chunks: {split: boolean, count: number, files: string[]}`（恒定形状；`split=false` 时 `count:1, files:[article]`）；分块文件 `6_article_chunk_X_of_N.html`；stale 清理副作用（删 `7_skeleton.json`、`7_skeleton_chunk_*.json`、另一模式旧 chunk html）

- [ ] **Step 1: 写失败的 CLI 测试**

在 `test/unit/extract-article.test.mjs` 末尾追加（沿用文件内既有 `setupTmp`/`runArticle` 模式；`runArticle` 不传 env 覆盖，新用例直接用 `runScript`）：

```js
// ── 大产物分块（spec 2026-09-09）──

// 40 个 ~1.85KB 段落块 + h1 ≈ 74KB；阈值调 60KB 触发分割
const BIG_PARAS = Array.from({ length: 40 }, (_, i) =>
  `<p style="font-size: 16px" data-idx="${100 + i}">${'段'.repeat(600)}</p>`);
const BIG_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>大文章</title></head><body><h1 style="font-size: 32px" data-idx="1">标题</h1>${BIG_PARAS.join('')}</body></html>`;
const BIG_KEY_IDS = {
  titleId: 1,
  descriptionIds: [],
  paragraphIds: Array.from({ length: 40 }, (_, i) => 100 + i),
  dumpIds: [],
};

async function runArticleEnv(tmpRoot, env) {
  const script = path.resolve('script/extract_article.mjs');
  return runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot, ...env },
    timeoutMs: 30000,
  });
}

test('extract_article.mjs: 超阈值分割——分块文件落盘 + emit chunks 契约', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-split', BIG_KEY_IDS);
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), BIG_JUICED);
  const r = await runArticleEnv(tmpRoot, { U2M_ARTICLE_SPLIT_THRESHOLD: '60000' });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.chunks.split, true);
  assert.ok(out.chunks.count >= 2, `应至少分 2 块: ${out.chunks.count}`);
  assert.equal(out.chunks.files.length, out.chunks.count);
  assert.ok(out.chunks.files[0].endsWith('_1_of_'), 'files 应按块序');
  // 6_article.html 照写（调试对照）；每块是完整独立文档
  assert.ok(fs.existsSync(path.join(urlDir, '6_article.html')));
  for (const f of out.chunks.files) {
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(html.startsWith('<!DOCTYPE html>'), `${f} 应为完整文档`);
    assert.ok(html.includes('<title>大文章</title>'));
    assert.ok(html.includes('<html lang="zh-CN">'));
    assert.ok(html.endsWith('</body></html>'));
  }
  // 全部段落块 id 恰出现一次于 own 区（各分块 own 并集 = 全集、互不重叠：
  // 以「每个 id 在所有文件中出现总次数 ≥1」宽松校验 + ✅/❌ 标记存在性）
  const all = out.chunks.files.map((f) => fs.readFileSync(f, 'utf8')).join('');
  for (const id of [1, 100, 139]) {
    assert.ok(all.includes(`data-idx="${id}"`), `id ${id} 应在某分块中`);
  }
  // 均质块场景：own ≈ chunkMax − 1 块 → 开头/上文恒被削减、✅ 不稳定出现；
  // 稳定出现的是下文豁免产物 ❌/⚠️下文（非末块）——断言这个
  assert.ok(all.includes('❌ 待转换内容自此结束'), '非末块应保留下文侧（豁免）');
  assert.ok(all.includes('⚠️ 下文上下文'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 未分割——emit chunks 恒定形状 + 清另一模式旧分块', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-nosplit', {
    titleId: 1, descriptionIds: [], paragraphIds: [5, 6], dumpIds: [],
  });
  // 预置另一模式残留
  fs.writeFileSync(path.join(urlDir, '6_article_chunk_9_of_9.html'), '<html></html>');
  fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), '[]');
  fs.writeFileSync(path.join(urlDir, '7_skeleton_chunk_1_of_2.json'), '[]');
  const r = await runArticleEnv(tmpRoot, {});
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.chunks, { split: false, count: 1, files: [out.article] });
  // stale 清理：旧骨架（两种形态）与旧分块 html 全清
  assert.ok(!fs.existsSync(path.join(urlDir, '7_skeleton.json')), '应清 stale 7_skeleton.json');
  assert.ok(!fs.existsSync(path.join(urlDir, '7_skeleton_chunk_1_of_2.json')), '应清 stale 分片骨架');
  assert.ok(!fs.existsSync(path.join(urlDir, '6_article_chunk_9_of_9.html')), '未分割应清旧分块 html');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 分割时清 stale 骨架与越界旧分块（X>N）', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-stale', BIG_KEY_IDS);
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), BIG_JUICED);
  fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), '[]');
  fs.writeFileSync(path.join(urlDir, '6_article_chunk_9_of_9.html'), '<html></html>');
  const r = await runArticleEnv(tmpRoot, { U2M_ARTICLE_SPLIT_THRESHOLD: '60000' });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.chunks.split);
  assert.ok(!fs.existsSync(path.join(urlDir, '7_skeleton.json')), '分割也应清 stale 单文件骨架');
  assert.ok(!fs.existsSync(path.join(urlDir, '6_article_chunk_9_of_9.html')), 'X>N 旧分块应清');
  for (const f of out.chunks.files) assert.ok(fs.existsSync(f));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/unit/extract-article.test.mjs
```

预期：3 个新用例 FAIL（`out.chunks` 为 `undefined` / stale 文件未清）。

- [ ] **Step 3: 实现**

修改 `script/extract_article.mjs`：

(1) 头注「产出 6_article.html」段落后补一行分块说明，并在 import 区加：

```js
import { chunkArticle } from './lib/chunk-article.mjs';
```

(2) `parseArgs` 函数后加辅助：

```js
function posIntEnv(name, dflt) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
```

(3) slim pass 之后（`const { html: slimHtml, ...slimStats } = await page.evaluate(...)` 之后、写 articlePath 之前）插入分块收集——**必须在关浏览器之前**：

```js
    // 分块收集：与 slimHtml 同一 DOM 同一序列化器——每块 markup 与
    // 6_article.html 逐字节一致（spec 2026-09-09 §3.2）
    const children = await page.evaluate(
      '(() => [...document.body.children].map((el) => el.outerHTML))()'
    );
```

(4) 写 `6_article.html` 之后、`emit` 之前（浏览器已关）插入清理与分块，并改 `emit`：

```js
    // ── stale 清理（spec §3.6）：重跑步骤 6 后任何已存在的步骤 7 骨架必然
    //    失效；另一模式的旧分块 html 一并清理 ──
    for (const f of fs.readdirSync(dir)) {
      if (f === '7_skeleton.json' || /^7_skeleton_chunk_\d+_of_\d+\.json$/.test(f)) {
        fs.rmSync(path.join(dir, f));
      }
    }
    const splitThreshold = posIntEnv('U2M_ARTICLE_SPLIT_THRESHOLD', 80 * 1024);
    const chunkMax = posIntEnv('U2M_ARTICLE_CHUNK_MAX', 50 * 1024);
    const { split, chunks: chunkFiles } = chunkArticle(slimHtml, children, { splitThreshold, chunkMax });
    const CHUNK_HTML_RE = /^6_article_chunk_(\d+)_of_(\d+)\.html$/;
    for (const f of fs.readdirSync(dir)) {
      const cm = CHUNK_HTML_RE.exec(f);
      if (cm && (!split || Number(cm[1]) > chunkFiles.length)) fs.rmSync(path.join(dir, f));
    }
    const chunkPaths = [];
    if (split) {
      for (const c of chunkFiles) {
        const p = path.join(dir, `6_article_chunk_${c.x}_of_${c.n}.html`);
        await fsPromises.writeFile(p, c.html, 'utf8');
        chunkPaths.push(p);
      }
      log(`文章分块: ${chunkPaths.length} 块（阈值 ${splitThreshold}B / 上限 ${chunkMax}B）`);
    }

    emit({
      status: 'ok',
      article: articlePath,
      elementCount: result.count,
      slim: slimStats,
      chunks: split
        ? { split: true, count: chunkPaths.length, files: chunkPaths }
        : { split: false, count: 1, files: [articlePath] },
    });
```

注意保持「先关浏览器再 emit」的既有顺序；`fs.readdirSync`/`fs.rmSync` 用已 import 的 `fs`。

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/unit/extract-article.test.mjs
```

预期：全部 PASS（含既有用例——它们不设 env、产物小、走不分割路径）。

- [ ] **Step 5: Commit**

```bash
git add script/extract_article.mjs test/unit/extract-article.test.mjs
git commit -m "feat(chunk): 步骤 6 接入文章分块——emit chunks 契约 + stale 骨架清理"
```

---

### Task 3: `screenshot_trans.mjs` 分片骨架合并入口

**Files:**
- Modify: `script/screenshot_trans.mjs`（骨架读取处替换为检测/校验/合并；三处 ok emit 增 `chunksMerged`）
- Test: `test/unit/screenshot-trans.test.mjs`（追加用例）

**Interfaces:**
- Consumes: 分片骨架文件 `7_skeleton_chunk_X_of_N.json`（步骤 7 子代理产出）
- Produces: 内存合并的 `skeleton` 数组（下游零改动）；ok emit 增 `chunksMerged: number`（仅分片路径）；错误路径 `emitError` 文案（缺片列缺失号 / N 不一致列冲突文件 / 坏 JSON 指明文件）

- [ ] **Step 1: 写失败的测试**

在 `test/unit/screenshot-trans.test.mjs` 追加（骨架均无 img/trans 条目 → 走 `skipped: no_trans2img` 纯 Node 快速路径，不起浏览器；复用文件内既有 `setupTmp` 与 `LIVE_URL`）：

```js
// ── 分片骨架合并（spec 2026-09-09 §5）──

function setupChunksTmp(name, chunkMap, { skeleton = null } = {}) {
  const t = setupTmp(name, { skeleton, longText: { texts: {}, runs: {} } });
  for (const [file, content] of Object.entries(chunkMap)) {
    fs.writeFileSync(path.join(t.urlDir, file),
      typeof content === 'string' ? content : JSON.stringify(content));
  }
  return t;
}

async function runTrans(tmpRoot) {
  const script = path.resolve('script/screenshot_trans.mjs');
  return runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
}

test('screenshot_trans.mjs: 分片按 X 序合并 + chunksMerged 通报', async () => {
  const { tmpRoot, urlDir } = setupChunksTmp('merge-ok', {
    '7_skeleton_chunk_1_of_3.json': [{ p: '一' }, { p: '二' }],
    '7_skeleton_chunk_2_of_3.json': [{ h1: '# 标题' }],
    '7_skeleton_chunk_3_of_3.json': [{ p: '三' }],
  });
  const r = await runTrans(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.skipped, 'no_trans2img');
  assert.equal(out.chunksMerged, 3);
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ p: '一' }, { p: '二' }, { h1: '# 标题' }, { p: '三' }]);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 缺片报 error 列缺失号', async () => {
  const { tmpRoot } = setupChunksTmp('merge-missing', {
    '7_skeleton_chunk_1_of_3.json': [{ p: '一' }],
    '7_skeleton_chunk_3_of_3.json': [{ p: '三' }],
  });
  const r = await runTrans(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('2'), `reason 应列出缺失号 2: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: N 不一致报 error 列冲突文件', async () => {
  const { tmpRoot } = setupChunksTmp('merge-nmismatch', {
    '7_skeleton_chunk_1_of_2.json': [{ p: '一' }],
    '7_skeleton_chunk_2_of_3.json': [{ p: '二' }],
  });
  const r = await runTrans(tmpRoot);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.stdout).reason.includes('N 不一致'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 坏 JSON / 非数组报 error 指明文件', async () => {
  const a = setupChunksTmp('merge-badjson', {
    '7_skeleton_chunk_1_of_2.json': '{oops',
    '7_skeleton_chunk_2_of_2.json': [{ p: '二' }],
  });
  const ra = await runTrans(a.tmpRoot);
  assert.equal(ra.code, 1);
  assert.ok(JSON.parse(ra.stdout).reason.includes('1_of_2'), 'reason 应指明坏文件');
  fs.rmSync(a.tmpRoot, { recursive: true, force: true });

  const b = setupChunksTmp('merge-notarray', {
    '7_skeleton_chunk_1_of_2.json': { nope: 1 },
    '7_skeleton_chunk_2_of_2.json': [{ p: '二' }],
  });
  const rb = await runTrans(b.tmpRoot);
  assert.equal(rb.code, 1);
  assert.ok(JSON.parse(rb.stdout).reason.includes('数组'));
  fs.rmSync(b.tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 7_skeleton.json 存在时优先（忽略分片、无 chunksMerged）', async () => {
  const { tmpRoot } = setupChunksTmp('merge-priority', {
    '7_skeleton_chunk_1_of_2.json': [{ p: '分片内容' }],
    '7_skeleton_chunk_2_of_2.json': [{ p: '分片内容2' }],
  }, { skeleton: [{ p: '单文件内容' }] });
  const r = await runTrans(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.chunksMerged, undefined, '单文件路径不应有 chunksMerged');
  assert.ok(!fs.readFileSync(path.join(tmpRoot, urlToDirName(LIVE_URL), '8_resolved_skeleton.json'), 'utf8').includes('分片内容'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 无骨架无分片报 error 提示步骤 7', async () => {
  const { tmpRoot } = setupChunksTmp('merge-none', {}, { skeleton: null });
  const r = await runTrans(tmpRoot);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.stdout).reason.includes('步骤 7'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test test/unit/screenshot-trans.test.mjs
```

预期：新用例 FAIL（缺片场景当前直接读不存在的 `7_skeleton.json` 报「找不到…步骤 7」而非缺片清单；合并场景报 error）。

- [ ] **Step 3: 实现**

修改 `script/screenshot_trans.mjs`：

(1) 头注「读 7_skeleton.json」处补一句「分割时读分片 `7_skeleton_chunk_X_of_N.json` 并按 X 序合并（spec 2026-09-09 §5）」。

(2) 把既有存在性检查（`if (!fs.existsSync(skeletonPath)) { return emitError('找不到 ${skeletonPath}，请先运行步骤 7'); }`）替换为检测块（保持错误先于 keyIds 校验的既有顺序）：

```js
  // ── 骨架读取：未分割直读 7_skeleton.json；分割则 glob 分片、校验、按 X 序
  //    合并（spec 2026-09-09 §5）。7_skeleton.json 存在时优先——升级前跑了一
  //    半的目录防御；步骤 6 的 stale 清理已保证两者不并存 ──
  const CHUNK_SKELETON_RE = /^7_skeleton_chunk_(\d+)_of_(\d+)\.json$/;
  let skeleton = null;
  let chunksMerged; // 分片合并路径才有值
  if (fs.existsSync(skeletonPath)) {
    skeleton = JSON.parse(await fsPromises.readFile(skeletonPath, 'utf8'));
  } else {
    const found = fs.readdirSync(dir)
      .map((f) => CHUNK_SKELETON_RE.exec(f))
      .filter(Boolean)
      .map((mm) => ({ file: mm[0], x: Number(mm[1]), n: Number(mm[2]) }));
    if (found.length === 0) {
      return emitError(`找不到 ${skeletonPath}，请先运行步骤 7`);
    }
    const ns = new Set(found.map((f) => f.n));
    if (ns.size !== 1) {
      return emitError(`骨架分片 N 不一致: ${found.map((f) => f.file).join(', ')}——请重跑步骤 7`);
    }
    const n = found[0].n;
    const xs = new Set(found.map((f) => f.x));
    const missing = [];
    for (let i = 1; i <= n; i++) if (!xs.has(i)) missing.push(i);
    if (missing.length > 0) {
      return emitError(`骨架分片缺失（应共 ${n} 片，缺 ${missing.join(', ')}）——请补跑对应分块的步骤 7 后重试`);
    }
    if (found.some((f) => f.x > n)) {
      return emitError(`骨架分片编号越界（>N=${n}）: ${found.filter((f) => f.x > n).map((f) => f.file).join(', ')}`);
    }
    skeleton = [];
    for (const f of found.sort((a, b) => a.x - b.x)) {
      let part;
      try {
        part = JSON.parse(await fsPromises.readFile(path.join(dir, f.file), 'utf8'));
      } catch (e) {
        return emitError(`骨架分片 ${f.file} 不是合法 JSON: ${e.message}`);
      }
      if (!Array.isArray(part)) {
        return emitError(`骨架分片 ${f.file} 应为 JSON 数组`);
      }
      skeleton.push(...part);
    }
    chunksMerged = n;
    log(`分片骨架合并: ${found.length} 片 → ${skeleton.length} 条`);
  }
```

并删除原 `const skeleton = JSON.parse(await fsPromises.readFile(skeletonPath, 'utf8'));` 行（骨架已在上面取得）。

(3) 三处 ok emit 各加一个字段（用展开保持加法式）：

- `skipped: 'no_trans2img'` 早退处（无 img/trans）：`...(chunksMerged !== undefined && { chunksMerged }),`
- 图片下载后无 trans2img 早退处：同上
- 最终 emit：同上

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test test/unit/screenshot-trans.test.mjs
```

预期：全部 PASS（既有用例走单文件路径，`chunksMerged` 为 undefined 不出现在 emit）。

- [ ] **Step 5: Commit**

```bash
git add script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs
git commit -m "feat(chunk): 步骤 8 分片骨架合并入口——glob 校验 + 按 X 序 concat + chunksMerged 通报"
```

---

### Task 4: SKILL.md 步骤 6/7 + 指南改动

**Files:**
- Modify: `SKILL.md`（步骤 6 产物/决策表/stdout 示例；步骤 7 双模式派发）
- Modify: `references/markdown_skeleton_guide.md`（路径参数化、上下文区域规则、全局唯一表述）

**Interfaces:**
- Consumes: Task 2 的 emit `chunks` 字段形状；Task 1 的标记注释文案（指南须与其一致：📌 开头上下文 / ⚠️ 上文·下文上下文 / ✅ 待转换内容自此开始 / ❌ 待转换内容自此结束）
- Produces: 主代理可执行的分派决策规则（步骤 7 双模式）

- [ ] **Step 1: 改 SKILL.md 步骤 6**

步骤 6 小节（`### 步骤 6 · 用脚本提取视图`）改为：

```markdown
### 步骤 6 · 用脚本提取视图

```bash
node <skill-root>/script/extract_article.mjs --url <url>
```

产物：`<url-working-path>/6_article.html`（始终产出）；超过 80KB 时另产出分块 `6_article_chunk_X_of_N.html`（每块 ≤50KB，第 2 块起带只读上下文与 ✅/❌ 转换边界标记）（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 7——`chunks.split=true` 时步骤 7 按 `chunks.files` 并行派发子代理；`false` 时单子代理照旧 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "article": "/path/6_article.html",
  "elementCount": 509,
  "slim": {},
  "chunks": { "split": true, "count": 8, "files": ["/path/6_article_chunk_1_of_8.html"] }
}
```
```

- [ ] **Step 2: 改 SKILL.md 步骤 7**

步骤 7 小节改为：

```markdown
### 步骤 7 · 你负责 markdown 骨架生成

> **可调用子智能体时，优先把任务交给子智能体**

#### 未分割（步骤 6 stdout `chunks.split=false`）

单个子代理，任务提示词：

- 必须严格按照手册 `<skill-root>/references/markdown_skeleton_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write/Edit" 工具（**完整读取** `6_article.html`，一次性写入 `7_skeleton.json`），其他文件和你完全无关
- 当前工作路径: `/path/to/xxx`（取步骤 1 stdout 的 `url-working-path`）
- 不要总结报告，只需产出 `7_skeleton.json` 即可

#### 已分割（步骤 6 stdout `chunks.split=true`）

**单条消息并行派发 `chunks.count` 个子代理**，每个子代理的任务提示词按各自分块文件定制（X 为分块号、N 为总块数）：

- 必须严格按照手册 `<skill-root>/references/markdown_skeleton_guide.md` 的要求完成任务
- 当前任务期间你只能使用 "Read/Write/Edit" 工具（**完整读取** `6_article_chunk_X_of_N.html`，一次性写入 `7_skeleton_chunk_X_of_N.json`），其他文件和你完全无关
- 当前工作路径: `/path/to/xxx`（取步骤 1 stdout 的 `url-working-path`）
- 不要总结报告，只需产出 `7_skeleton_chunk_X_of_N.json` 即可

#### 后续

- 未分割：产物 `<url-working-path>/7_skeleton.json` 完成后进入步骤 8
- 已分割：**全部 `chunks.count` 个分片文件都存在**后进入步骤 8（步骤 8 会自动检测并合并分片）；个别分片失败/缺失时重新派发该分片一次，仍失败则把缺失清单反馈用户并终止
```

- [ ] **Step 3: 改指南**

`references/markdown_skeleton_guide.md` 三处：

(1) 首行任务描述——把「读取 HTML `<url-working-path>/6_article.html` 的 DOM 结构」改为：

```markdown
读取 HTML 文章视图（任务指定的文件：未分割 = `<url-working-path>/6_article.html`；分割 = `<url-working-path>/6_article_chunk_X_of_N.html`）的 DOM 结构，把**待转换内容**转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。占位符（`{{LONG_TEXT_k|…}} / {{CODE_k|…}} / {{TABLE_k|…}}`）只引用占位编号，去除所有后缀（包括 `|`）。
```

(2) 「## 专有名词」小节末尾（`**「块元素样式」**` 定义之后、`## 词汇表` 之前）插入新小节：

```markdown
## 分块上下文（仅分块输入出现）

分块输入的 body 内可能带标记注释（📌 开头上下文 / ⚠️ 上文·下文上下文 / ✅ 待转换内容自此开始 / ❌ 待转换内容自此结束）。标记注明的上下文段落块**仅供理解**——建立标题层级、字号基准与衔接语境：

- **不产条目**：上下文段落块不算「不重不漏」的漏，与 chrome 豁免同款定位
- **不引用编号**：上下文段落块中出现的 `{{LONG_TEXT/TABLE/CODE}}` 编号一律不引用（由对应分块负责）
- 只转换 **✅ 与 ❌ 两个标记之间**的段落块；无任何标记注释时转换全部
```

(3) 词汇表下方长文本要点里「**每个编号在整个骨架中恰引用一次**」改为「**每个编号全局唯一，恰引用一次**」（括注「`trans2img` 子树内的编号除外——原文随截图保留，不引用、不出条目」保持不变）。

(4) 「## 输出要求」的输出路径行改为：

```markdown
输出路径：以任务指定为准——未分割 = `<url-working-path>/7_skeleton.json`；分割 = `<url-working-path>/7_skeleton_chunk_X_of_N.json`（与输入分块同号）
```

- [ ] **Step 4: 验证**

```bash
grep -n "6_article\|7_skeleton" SKILL.md references/markdown_skeleton_guide.md | head -30
pnpm test
```

预期：grep 输出中步骤 7 提示词不再有未分叉的硬编码读写路径（未分割小节的 `6_article.html`/`7_skeleton.json` 属于分叉的一支，允许保留）；`pnpm test` 全绿（文档改动不影响）。

- [ ] **Step 5: Commit**

```bash
git add SKILL.md references/markdown_skeleton_guide.md
git commit -m "docs(skill): 步骤 6/7 分块契约——chunks 驱动并行派发 + 指南上下文区域规则"
```

---

### Task 5: 6→8→9 分块链路集成测试

**Files:**
- Create: `test/integration/chunk-pipeline.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 emit `chunks`（取 count 与 N）；Task 3 的分片合并；`render_skeleton.mjs` 既有契约（p 条透传）
- Produces: 无（测试产物）

- [ ] **Step 1: 写集成测试**

创建 `test/integration/chunk-pipeline.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

// 40 个 ~1.85KB 段落块 + h1 ≈ 74KB；阈值 60KB → 分 2 块。
// 链路：步骤 6（真实 chromium）→ 合成步骤 7 分片 → 步骤 8（无 img/trans
// 纯 Node 路径，死端口 URL）→ 步骤 9 渲染。
const PARAS = Array.from({ length: 40 }, (_, i) =>
  `<p style="font-size: 16px" data-idx="${100 + i}">${'段'.repeat(600)}</p>`);
const JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>分块链路</title></head><body><h1 style="font-size: 32px" data-idx="1">标题</h1>${PARAS.join('')}</body></html>`;
const KEY_IDS = {
  titleId: 1,
  descriptionIds: [],
  paragraphIds: Array.from({ length: 40 }, (_, i) => 100 + i),
  dumpIds: [],
};
const URL = 'http://127.0.0.1:9/chunk-chain'; // 死端口：步骤 8 无 img/trans 不触网

test('分块链路：步骤 6 分割 → 分片骨架 → 步骤 8 合并 → 步骤 9 渲染', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chunk-chain-'));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), JUICED);
  fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(KEY_IDS));
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), JUICED);
  fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify({ texts: {}, runs: {} }));
  const env = { U2M_WORKING_ROOT: tmpRoot, U2M_ARTICLE_SPLIT_THRESHOLD: '60000' };

  // 步骤 6：分割
  const r6 = await runScript(process.execPath, [path.resolve('script/extract_article.mjs'), '--url', URL], { env, timeoutMs: 60000 });
  assert.equal(r6.code, 0, `stderr: ${r6.stderr}`);
  const out6 = JSON.parse(r6.stdout);
  assert.equal(out6.chunks.split, true);
  const N = out6.chunks.count;
  assert.ok(N >= 2, `应至少 2 块: ${N}`);

  // 合成步骤 7：每分片一个骨架分片（无占位符、无 img/trans）
  for (let x = 1; x <= N; x++) {
    fs.writeFileSync(path.join(urlDir, `7_skeleton_chunk_${x}_of_${N}.json`),
      JSON.stringify([{ p: `分片${x}专属内容` }]));
  }

  // 步骤 8：合并 + 还原
  const r8 = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', URL], { env, timeoutMs: 60000 });
  assert.equal(r8.code, 0, `stderr: ${r8.stderr}`);
  const out8 = JSON.parse(r8.stdout);
  assert.equal(out8.status, 'ok');
  assert.equal(out8.chunksMerged, N);
  assert.equal(out8.skipped, 'no_trans2img');

  // 步骤 9：渲染
  const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', URL], { env, timeoutMs: 30000 });
  assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
  const md = fs.readFileSync(path.join(urlDir, '9_markdown.md'), 'utf8');
  const order = Array.from({ length: N }, (_, i) => md.indexOf(`分片${i + 1}专属内容`));
  for (const pos of order) assert.ok(pos >= 0, '9_markdown 应含全部分片内容');
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `分片内容应按块序排列: ${order}`);
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认通过**

```bash
node --test test/integration/chunk-pipeline.test.mjs
```

预期：PASS（依赖 Task 1-3 已完成；若 FAIL 按错误回溯对应任务修复）。

- [ ] **Step 3: Commit**

```bash
git add test/integration/chunk-pipeline.test.mjs
git commit -m "test(chunk): 6→8→9 分块链路集成测试——分割/合并/渲染全链"
```

---

### Task 6: 文档同步（CLAUDE.md/README/SMOKE）+ 全量回归

**Files:**
- Modify: `CLAUDE.md`（步骤 6/7/8 描述、产物清单、环境变量）
- Modify: `README.md`（环境变量表、核心流程、开发进度）
- Modify: `test/smoke/SMOKE.md`（新增场景 10）

**Interfaces:**
- Consumes: Task 1-5 的最终行为
- Produces: 无（文档）

- [ ] **Step 1: 改 CLAUDE.md**

(1) 管线顺序列表中「步骤 6 `extract_article.mjs` —— 文章视图」条目末尾追加子弹点：

```markdown
  - **大产物分块（2026-09-09）**：`6_article.html` 总字节 > `U2M_ARTICLE_SPLIT_THRESHOLD`（默认 80KB）时按段落块贪心分割为 `6_article_chunk_X_of_N.html`（`lib/chunk-article.mjs` 纯函数：每块 ≤ `U2M_ARTICLE_CHUNK_MAX`（默认 50KB）；单个巨段落块独立成块；尾块 <5 个段落块循环并入前块——splitThreshold 守护，贪心封边处 50KB 守护恒为死代码；第 2 块起带 📌开头（body 前 ≤3 块）/⚠️上文（上一块尾部 ≤2）/⚠️下文（下一块开头 ≤2）只读上下文 + ✅/❌ 转换边界标记，每侧 ≤chunkMax/5 字节帽、超限按 下文→上文→开头 整侧削减）；emit 增 `chunks:{split,count,files}` 恒定形状；成功后清 stale 骨架（`7_skeleton.json` + `7_skeleton_chunk_*.json`——重跑 6 后旧骨架必然失效）与另一模式旧分块 html。步骤 7 由 chunks.split 驱动：true → 单条消息并行派发 count 个子代理各读各的分块、各写 `7_skeleton_chunk_X_of_N.json`；false → 单子代理照旧。步骤 8 入口：`7_skeleton.json` 优先，否则 glob 分片校验（N 一致/X 恰 1..N/均为 JSON 数组）按 X 序合并，emit 增 `chunksMerged`，下游零改动
```

(2) 「工作目录」段落产物清单（`3_key_ids.json`、`4_styled_extract.html`…`9_markdown.md` 那段）在 `6_article.html` 后插入 `6_article_chunk_X_of_N.html`（>80KB 时）、`7_skeleton.json` 后插入 `7_skeleton_chunk_X_of_N.json`（分割时）。

(3) 「常用命令」代码块中 `U2M_DEBUG=1` 注释段后补一行：

```bash
# 大产物分块阈值（字节）：U2M_ARTICLE_SPLIT_THRESHOLD（默认 81920）触发分割、
# U2M_ARTICLE_CHUNK_MAX（默认 51200）每块上限——测试调低触发用
```

- [ ] **Step 2: 改 README.md**

(1) `### 环境变量` 表追加两行：

```markdown
| `U2M_ARTICLE_SPLIT_THRESHOLD` | 文章视图超过该字节数（默认 81920）时物理分块，步骤 7 并行派发子代理 |
| `U2M_ARTICLE_CHUNK_MAX` | 分块单块字节上限（默认 51200；巨段落块独立成块、尾块 <5 块合并为例外） |
```

(2) `## 核心流程（步骤 0-9）` 中步骤 6/7/8 的描述行各补一句分块语义（6：>80KB 分块产出 `6_article_chunk_X_of_N.html`；7：分割时并行派发、各写 `7_skeleton_chunk_X_of_N.json`；8：入口检测分片并合并）。

(3) `## 开发进度` 表追加一行本特性（对照既有行的日期/状态格式）。

- [ ] **Step 3: 改 SMOKE.md**

文件末尾追加：

```markdown
## 10. 大产物分块（2026-09-09 新增）

URL：微信长文（复用 `working/mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw/`，6_article.html 372KB / 509 段落块）

- [ ] 重跑步骤 6 → 预期 emit `chunks.split=true`、约 8 块、每块 ≤50KB、分块含 📌/⚠️/✅/❌ 标记
- [ ] 步骤 7 并行派发子代理 → 全部分片落盘
- [ ] 步骤 8 → `chunksMerged` 与块数一致；步骤 9 的 9_markdown.md 与不分块基线对比内容一致（标题层级、列表延续无跨块断裂）
```

- [ ] **Step 4: 全量回归**

```bash
pnpm test:all
```

预期：全部 PASS。任何失败先修复再提交（不允许带红提交）。

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md test/smoke/SMOKE.md
git commit -m "docs: 分块特性同步 CLAUDE/README/SMOKE——机制、环境变量、冒烟场景"
```

---

## 计划自审记录

- **Spec 覆盖**：§3.1 触发/env → Task 2；§3.2 收集/序列化 → Task 1（DOC_RE）+ Task 2（evaluate）；§3.3 装箱/尾块循环/巨块/N=1 → Task 1（T2/T4/T5/T6）；§3.4 窗口/帽/去重/削减 → Task 1（T3/T5/T7）；§3.5 标记 → Task 1（常量）+ Task 4（指南）；§3.6 stale → Task 2；§3.7 emit → Task 2；§4.1 SKILL.md → Task 4；§4.2 指南 → Task 4；§5 步骤 8 → Task 3；§6 错误处理 → Task 3（校验）+ Task 4（SKILL 重派指引）；§7 测试 → Task 1/2/3/5 + Task 6 SMOKE；§8 文档 → Task 6。无缺口。
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码；T7 预留了构造偏差的处置说明（以算法输出重算断言，不得删测试）。
- **类型一致性**：`chunkArticle(slimHtml, children, {splitThreshold, chunkMax}) → {split, chunks:[{x,n,html}]}` 在 Task 1 定义、Task 2 按此调用；文件名正则在 Task 1（无）/Task 2（`6_article_chunk_…html`）/Task 3（`7_skeleton_chunk_…json`）一致；emit 字段 `chunks`（Task 2 产、Task 4 SKILL 消费）与 `chunksMerged`（Task 3 产、Task 5 消费）拼写一致。
