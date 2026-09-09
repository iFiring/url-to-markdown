# 步骤 2 边界 chrome 清除与折叠 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在步骤 2（clean_snapshot）落地五条站点无关的 chrome 清除/折叠规则（D1 脊柱占优删除、H1-C 链限制 computed-hidden 折叠、H2 dialog 折叠、H3' 链上浮层折叠、注释剥离），微信样本清洗版净瘦 ≈26%、OpenAI ≈27%，六样本零正文误伤。

**Architecture:** 全部改动集中在共享页面脚本 `page-clean-snapshot.js`（两趟共享段 + clean 趟 K5 扩展）与两个收集脚本的 skip 条件；`clean_snapshot.mjs` 只接 emit/debug。折叠标志在共享段（`<style>` 仍活）用 getComputedStyle 预计算挂 expando，clean 趟 K5x 消费折叠、styled 趟收集 skip 同源消费——保证两版 k 对齐与孪生不变量。带样式版对折叠集**保活**（还原链零改动），仅 D1 删除与注释剥离两版同步生效。

**Tech Stack:** node ≥20、playwright（chromium）、node --test、既有 runScript/夹具子进程测试模式。无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md`（含用户裁定 R1-R11 与 §14 修订记录——执行前必读）

## Global Constraints

- **stdout 恰好一行 JSON**（失败路径也不例外）；日志走 stderr；退出码 0/1/2；`emit()` 延迟退出陷阱——emit/usage 之后不得有继续执行的代码（本计划不新增 CLI 参数路径，仅扩展现有 emit 字段）
- `script/lib/page-*.js` 是**普通非模块文件**、单具名函数、被 `readSharedScript` 当文本注入 evaluate——代码风格保持 ES5（`var`/`function`；`Map` 可用，先例 `runDisplayCache`）；严禁把分类逻辑分叉进 `.mjs` 编排层
- **孪生不变量**：clean 版 data-idx 集 ⊆ styled 版；clean LT 后缀 ⊆ styled LT；TABLE/CODE 的 k 编号两版对齐——折叠集内的 table/pre 必须被 styled 收集与 clean K6/K7 **同源 skip**（`__u2mChromeFold`/`__u2mInChromeFold`）
- **golden 逐字节钉住**：`test/fixtures/golden/article-1.{styled.html,longtext.json}` 与 `clean-simplify.{styled.html,longtext.json}`——已模拟验证：D1/折叠对两 golden 零漂移（article-1 的 `div#immersive-translate-browser-popup` 被 D1 杀但现行为本就被空元素级联删，最终字节不变）；**注释剥离使 article-1.styled.html 漂移**（head 第 7 行注释），Task 2 内重建
- 测试一律 `U2M_WORKING_ROOT` 指向 mktemp 临时目录；**严禁写 working/ 现有产物**（auto-memory 告诫）
- 候选与文本计量**排除 `script/style/template/noscript`** 标签（spec §14 修订 1：UA 样式使 script display:none，夹具直入会误折）
- 弹窗词汇表**不含 `overlay`**（裁定 R7）
- 测试命令：单文件 `node --test test/unit/<file>`；全量 `pnpm test`；含集成 `pnpm test:all`（需 chromium 已装）

---

### Task 1: D1 脊柱占优比较删除（共享段步骤 7.5）

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（规则 7 控件删除循环之后、`// 8. 删除空元素` 注释之前插入；约 105-107 行之间）
- Modify: `script/lib/page-clean-snapshot.js:970-973`（clean 趟 return stats 扩展）
- Test: `test/unit/chrome-d1.test.mjs`（新建）

**Interfaces:**
- Consumes: 既有共享段（规则 1-7 已删 link/meta/base/nav/footer/form/video/audio/input 等）；`document.body`
- Produces: 变量 `chromeRemovedCount`(number)、`chromeKills`(array of `{at,ratio,sig,tag,idx,txt}`，上限 60 条)——Task 6 接 emit/debug；clean 趟 return `stats.chromeRemoved`/`stats.chromeKills`；helper `chromeGuardOk(el)`——Task 3/4/5 的标志预计算复用同一守卫函数

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-d1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** 与 clean-snapshot.test.mjs 同款基座：手写快照 → 真 CLI → 读回两版产物 */
async function runClean(snapshot, urlPath = 'chrome-d1', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-d1-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    stderr: r.stderr,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40); // 160 字符

test('D1: body 级 fixed 小文本子元素两版删除，static 无信号小兄弟保留', async () => {
  const r = await runClean(wrap(`
<div id="app" data-idx="1"><h1 data-idx="2">标题</h1><p data-idx="3">${BIG}</p></div>
<div id="bar" data-idx="4" style="position:fixed;bottom:0">关注</div>`));
  try {
    assert.ok(!r.cleaned.includes('data-idx="4"'), '清洗版删除浮层');
    assert.ok(!r.styled.includes('data-idx="4"'), '带样式版同步删除');
    assert.ok(r.cleaned.includes('data-idx="1"') && r.cleaned.includes('data-idx="3"'), '内容根保留');
    assert.ok(r.cleaned.includes('data-idx="2"'), 'static 无词汇的 h1 小兄弟保留');
  } finally { r.cleanup(); }
});

test('D1: 文本量排名第 1 恒不入候选（即使 fixed）；static+词汇命中删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1" style="position:fixed">${BIG}${BIG}</div>
<div data-idx="2" class="weui-toast">提示</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="1"'), 'rank1 fixed 豁免');
    assert.ok(!r.cleaned.includes('data-idx="2"'), 'static + toast 词汇删除');
  } finally { r.cleanup(); }
});

test('D1: ratio 5% 边界——6% 存活、4% 删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">${'正'.repeat(200)}</div>
<div data-idx="2" style="position:fixed">${'浮'.repeat(12)}</div>
<div data-idx="3" style="position:fixed">${'层'.repeat(8)}</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="2"'), '12/200=6% > 5% 存活');
    assert.ok(!r.cleaned.includes('data-idx="3"'), '8/200=4% ≤ 5% 删除');
  } finally { r.cleanup(); }
});

test('D1: 占优子元素 p≥5 停止下探；p=4 正常下探', async () => {
  const mk = (ps) => wrap(`
<div data-idx="1">
  <div data-idx="2">${BIG}${ps}</div>
  <div data-idx="3" style="position:fixed">浮层</div>
</div>`);
  const r5 = await runClean(mk('<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p>'), 'stop5');
  try {
    assert.ok(r5.cleaned.includes('data-idx="3"'), 'p=5：不进入该层，浮层存活');
  } finally { r5.cleanup(); }
  const r4 = await runClean(mk('<p>1</p><p>2</p><p>3</p><p>4</p>'), 'stop4');
  try {
    assert.ok(!r4.cleaned.includes('data-idx="3"'), 'p=4：下探扫描，浮层删除');
  } finally { r4.cleanup(); }
});

test('D1: 占优子元素匹配 main 后不进入其内部', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">
  <main data-idx="2">
    <div data-idx="3">${BIG}</div>
    <div data-idx="4" style="position:fixed">文内吸顶</div>
  </main>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), 'main 内部层级不扫描');
  } finally { r.cleanup(); }
});

test('D1: 内容守卫三条件各自拦截；守卫通过者删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">${BIG}</div>
<div data-idx="2" style="position:fixed"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="3" style="position:fixed"><pre>code</pre></div>
<div data-idx="4" style="position:fixed"><article data-idx="5">广告</article></div>
<div data-idx="6" style="position:fixed" class="site-modal"><button data-idx="7">确定</button></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="2"'), 'p>2 阻断');
    assert.ok(r.cleaned.includes('data-idx="3"'), 'pre 阻断');
    assert.ok(r.cleaned.includes('data-idx="4"'), 'article 后代阻断');
    assert.ok(!r.cleaned.includes('data-idx="6"'), '守卫通过 → 删除');
  } finally { r.cleanup(); }
});

test('D1: 沿占优脊柱下探深层删除；非占优分支不扫描', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">
  <div data-idx="2">
    <div data-idx="3">${BIG}</div>
    <div data-idx="4" style="position:fixed">深层浮层</div>
  </div>
</div>
<div data-idx="5">
  <div data-idx="6" style="position:fixed">支外浮层</div>
  <div data-idx="7">次要内容${'x'.repeat(20)}</div>
</div>`));
  try {
    assert.ok(!r.cleaned.includes('data-idx="4"'), '脊柱深层删除');
    assert.ok(r.cleaned.includes('data-idx="6"'), '非占优分支不扫描');
    assert.ok(r.cleaned.includes('data-idx="5"'), '非占优兄弟 ratio>5% 存活');
  } finally { r.cleanup(); }
});

test('D1: 脊柱下探深度硬上限（20 层）', async () => {
  let body = `<div data-idx="900">${BIG}</div><div data-idx="901" style="position:fixed">深层浮层</div>`;
  for (let i = 0; i < 22; i++) body = `<div data-idx="${899 - i}">${body}</div>`;
  const r = await runClean(wrap(body), 'depthcap');
  try {
    assert.ok(r.cleaned.includes('data-idx="901"'), '22 层独子链：深度上限后层级不扫描，浮层存活');
  } finally { r.cleanup(); }
});

test('D1: 全零文本层退化保护；script 不入候选；style 文本不计量', async () => {
  const r0 = await runClean(wrap(`
<div data-idx="1" style="position:fixed"><img data-idx="2" src="a.png" alt="a"></div>
<div data-idx="3" style="position:fixed"><img data-idx="4" src="b.png" alt="b"></div>
<script data-idx="5">console.log(${'x'.repeat(50)}')</script>`), 'zero');
  try {
    assert.ok(r0.cleaned.includes('data-idx="1"') && r0.cleaned.includes('data-idx="3"'),
      'max=0 无占优信号，全存活（img 属 KEEP_EMPTY 不被级联删）');
    assert.ok(r0.cleaned.includes('data-idx="5"'), 'script 不入 D1 候选');
  } finally { r0.cleanup(); }
  const r1 = await runClean(wrap(`
<div data-idx="1">${'正'.repeat(100)}</div>
<div data-idx="2" style="position:fixed"><style>${'x'.repeat(300)}</style>浮层</div>`), 'styletext');
  try {
    assert.ok(!r1.cleaned.includes('data-idx="2"'), 'style 文本不计量 → 可视文本 2 字 → 删除');
    assert.ok(r1.cleaned.includes('data-idx="1"'), '内容根不被 style 文本反超');
  } finally { r1.cleanup(); }
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-d1.test.mjs`
Expected: FAIL——删除类断言失败（`data-idx="4"` 等仍存在）；存活类断言此时即通过（现状不删任何东西）

- [x] **Step 3: 实现 D1（共享段步骤 7.5）**

在 `script/lib/page-clean-snapshot.js` 规则 7 的 controls 删除循环结束之后、`// 8. 删除空元素` 注释块之前插入：

```js
  // 7.5 D1 脊柱占优比较删除（两趟共享，spec 2026-09-09 §4）：沿 body 向下的
  //     「脊柱」逐层比较兄弟文本量——非占优子元素 ratio ≤5% ∧ (fixed/absolute/
  //     sticky ∨ 弹窗词汇) ∧ 内容守卫通过 → 判为 chrome（弹窗/浮层/工具条），
  //     整树删除。文本量排名第 1（含并列）永不入候选（裁定 R9，堵全零文本
  //     退化）；下探进入占优子元素，其匹配 main/article/[role=main] 或子树
  //     p≥5 → 不进入（裁定 R6，内容内部永不扫描）；硬上限 20 层。文本计量与
  //     候选均排除 script/style/template/noscript（spec §14 修订 1：UA 样式
  //     使 script display:none、CSS 源非文本量；真实管线步骤 1 已剥，防御
  //     夹具直入）。置于控件删除后、空元素级联前——删除腾出的空壳由级联收尾。
  var CHROME_VOCAB_RE = /modal|dialog|popup|pop-?up|popover|drawer|lightbox|toast|snackbar/i;
  var CHROME_POS = { fixed: 1, absolute: 1, sticky: 1 };
  var CHROME_TAG_SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  var chromeRemovedCount = 0;
  var chromeKills = [];
  function chromeTextOf(el) {
    var parts = [];
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) parts.push(c.textContent);
        else if (c.nodeType === 1 && !CHROME_TAG_SKIP[c.tagName]) walk(c);
      }
    })(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  function chromeGuardOk(el) {
    if (el.querySelectorAll('p').length > 2) return false;
    if (el.matches('main, article, [role="main"]')) return false;
    if (el.querySelector('main, article, [role="main"]')) return false;
    if (el.querySelectorAll('pre, table').length > 0) return false;
    return true;
  }
  function chromeVocabHit(el) {
    var cls = typeof el.className === 'string' ? el.className : '';
    if (CHROME_VOCAB_RE.test(cls + ' ' + (el.id || ''))) return true;
    return !!(el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      || el.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
  }
  function spineScan(root, depth, label) {
    var kids = [];
    for (var i = 0; i < root.children.length; i++) {
      if (!CHROME_TAG_SKIP[root.children[i].tagName]) kids.push(root.children[i]);
    }
    if (!kids.length) return;
    var texts = [], lens = [], max = 0;
    for (var i = 0; i < kids.length; i++) {
      texts[i] = chromeTextOf(kids[i]);
      lens[i] = texts[i].length;
      if (lens[i] > max) max = lens[i];
    }
    if (max === 0) return;                    // 全零文本：无占优信号（裁定 R9）
    for (var i = 0; i < kids.length; i++) {
      if (lens[i] === max) continue;          // rank1（含并列）恒排除
      if (lens[i] / max > 0.05) continue;     // ratio 阈值（裁定 R5：相差 ≥95%）
      var pos = getComputedStyle(kids[i]).position;
      var sig = CHROME_POS[pos] ? 'pos:' + pos : (chromeVocabHit(kids[i]) ? 'vocab' : '');
      if (!sig) continue;
      if (!chromeGuardOk(kids[i])) continue;  // 内容守卫（裁定 R10）
      if (chromeKills.length < 60) {
        chromeKills.push({
          at: label, ratio: +(lens[i] / max).toFixed(4), sig: sig,
          tag: kids[i].tagName.toLowerCase(),
          idx: kids[i].getAttribute('data-idx') || '', txt: texts[i].slice(0, 30),
        });
      }
      kids[i].parentNode.removeChild(kids[i]);
      chromeRemovedCount++;
    }
    if (depth >= 20) return;                  // 硬上限，防病态链
    var dom = null;
    for (var i = 0; i < kids.length; i++) {
      if (lens[i] === max && kids[i].parentNode) { dom = kids[i]; break; }
    }
    if (!dom || !dom.children.length) return;
    if (dom.matches('main, article, [role="main"]')) return;       // 裁定 R6
    if (dom.querySelectorAll('p').length >= 5) return;             // 裁定 R6
    spineScan(dom, depth + 1, label + '>' + dom.tagName.toLowerCase()
      + (dom.getAttribute('data-idx') ? '#' + dom.getAttribute('data-idx') : ''));
  }
  if (document.body) spineScan(document.body, 0, 'body');
```

并修改 clean 趟末尾 return（现约 970-973 行）：

```js
  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    stats: {
      hiddenCount: hiddenCount, viewTextCount: viewTextCount,
      chromeRemoved: chromeRemovedCount, chromeKills: chromeKills,
    }
  };
```

- [x] **Step 4: 跑测试确认通过 + golden 无漂移 + 全量单测**

Run: `node --test test/unit/chrome-d1.test.mjs`
Expected: PASS（9 个测试全绿）

Run: `node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: PASS（模拟已验证零漂移——immersive popup 现行为本就被空元素级联删除）

Run: `pnpm test`
Expected: 全绿。若红：逐个核对——被折叠/删除的是夹具 chrome 形态 → 更新该测试断言并在 commit message 记录理由；是正文 → 实现 bug，修复实现而不是改断言

- [x] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/chrome-d1.test.mjs
git commit -m "feat(step2): D1 脊柱占优比较删除——body 层级文本量占优比较 + 定位/词汇信号 + 内容守卫

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §4
微信样本 24 节点 16.4K(24.5%)、OpenAI 3.1K、知乎 2.0K；rank1 恒豁免、
p≥5/main 停止下探、script/style/template/noscript 排除。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 注释剥离（共享段）+ article-1 golden 重建

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（astro 解包循环之后、`// ---- 折叠统计预计算` 注释之前插入，约 189-191 行之间）
- Modify: `script/lib/page-clean-snapshot.js`（clean 趟 return stats，Task 1 已扩展处）
- Modify: `test/fixtures/golden/article-1.styled.html`（重建）
- Test: `test/unit/chrome-comments.test.mjs`（新建）

**Interfaces:**
- Consumes: 无（独立规则）
- Produces: 变量 `commentsRemovedCount`(number)；clean 趟 return `stats.commentsRemoved`——Task 6 接 emit

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-comments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-cmt', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-cmt-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const BIG = '正文内容'.repeat(40);

test('注释剥离: head/body 注释两版删除', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title><!-- head-marker --></head>
<body>
<!-- body-marker -->
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p><!-- inner-marker -->
</div>
</body></html>`);
  try {
    assert.ok(!r.cleaned.includes('head-marker') && !r.styled.includes('head-marker'), 'head 注释删除');
    assert.ok(!r.cleaned.includes('body-marker') && !r.styled.includes('body-marker'), 'body 注释删除');
    assert.ok(!r.cleaned.includes('inner-marker') && !r.styled.includes('inner-marker'), '元素间注释删除');
    assert.ok(!r.cleaned.includes('<!--'), '清洗版零注释');
    assert.ok(!r.styled.includes('<!--'), '带样式版零注释');
  } finally { r.cleanup(); }
});

test('注释剥离: pre 子树内注释保留（styled 失败 live 代码块可观察）', async () => {
  // pre 含 img → code2md non_textual 必败 → styled 保 live（data-u2m-code="fail"），
  // 注释可观察；clean 侧 pre 恒折叠为 CODE 占位，注释随折消失
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body>
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p>
<pre data-idx="4">x<img data-idx="5" src="a.png" alt=""><!-- keep-me --></pre>
</div>
</body></html>`);
  try {
    assert.ok(r.styled.includes('keep-me'), 'styled live pre 内注释保留');
    assert.ok(!r.cleaned.includes('keep-me'), 'clean 折叠后注释不可见');
    assert.ok(r.cleaned.includes('{{CODE_1|'), 'clean pre 照常折叠');
  } finally { r.cleanup(); }
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-comments.test.mjs`
Expected: FAIL——第一个测试的注释删除断言失败（现状注释保留）；第二个测试的 styled 断言此时即通过

- [x] **Step 3: 实现注释剥离**

在 astro 解包循环（`for (var i = astroWraps.length - 1; ...)` 结束）之后、`// ---- 折叠统计预计算` 注释之前插入：

```js
  // 注释节点剥离（两趟共享，spec 2026-09-09 §9.1-2）：框架 SSR 残留（<!---->
  //     Vue/React 占位注释）与模板注释零信息量；顺带消除原生注释与步骤 6 分块
  //     上下文标记（HTML 注释形态）的潜在混淆。pre/code 子树除外——代码样本
  //     可能含 HTML 注释作为内容（styled 失败 live 代码块由步骤 7 LLM 阅读）。
  //     先收集后删——避免 TreeWalker 活遍历中删节点的迭代陷阱。
  var commentsRemovedCount = 0;
  var commentWalker = document.createTreeWalker(document.documentElement, 128, null);
  var commentHits = [];
  while (commentWalker.nextNode()) commentHits.push(commentWalker.currentNode);
  for (var i = 0; i < commentHits.length; i++) {
    var cmt = commentHits[i];
    var cpar = cmt.parentElement;
    if (cpar && cpar.closest('pre, code')) continue;
    if (cmt.parentNode) { cmt.parentNode.removeChild(cmt); commentsRemovedCount++; }
  }
```

clean 趟 return stats 追加一行：

```js
      chromeRemoved: chromeRemovedCount, chromeKills: chromeKills,
      commentsRemoved: commentsRemovedCount,
```

- [x] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/chrome-comments.test.mjs`
Expected: PASS

Run: `node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: **article-1 FAIL**（head 注释被剥）、clean-simplify PASS（无注释，模拟已验证）

- [x] **Step 5: 重建 article-1 golden 并人工核对 diff**

```bash
TMP=$(mktemp -d) && D="$TMP/example.com_article-1" && mkdir -p "$D" \
  && cp test/fixtures/article-1.html "$D/1_snapshot.html" \
  && U2M_WORKING_ROOT=$TMP node script/clean_snapshot.mjs --url https://example.com/article-1 \
  && cp "$D/2_clean_style_snapshot.html" test/fixtures/golden/article-1.styled.html \
  && cp "$D/2_long_text.json" test/fixtures/golden/article-1.longtext.json \
  && rm -rf "$TMP" && git diff --stat test/fixtures/golden/ && git diff test/fixtures/golden/ | head -40
```

Expected: diff **只含** head 注释行 `<!-- Theme fonts. tufte falls back to Georgia; press falls back to Newsreader. -->` 的删除（styled.html 一处）；`article-1.longtext.json` 零 diff（注释非文本节点、不进恢复清单）。**若 diff 出现任何其他变化 → 停止，视为实现 bug 排查**（不要提交漂移的 golden）。

Run: `node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: PASS（两夹具）

- [x] **Step 6: 全量单测 + Commit**

Run: `pnpm test`
Expected: 全绿

```bash
git add script/lib/page-clean-snapshot.js test/unit/chrome-comments.test.mjs test/fixtures/golden/article-1.styled.html
git commit -m "feat(step2): 共享段注释剥离（pre/code 子树除外）+ article-1 golden 重建

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §9.1-2
golden diff 仅 head 主题字体注释一行；longtext.json 零漂移。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: chrome 标志预计算 + H1-C 链限制 computed-hidden 折叠 + 收集 skip 同源

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（共享段 `__u2mPreLines` 预计算循环之后插入标志预计算，约 230 行后；clean 趟 K5 循环之后、K6 注释之前插入 K5x，约 731-733 行之间；K6 skip 行约 746；K7 skip 行约 766；clean 趟 return stats）
- Modify: `script/lib/page-collect-tables.js:13`（skip 条件）
- Modify: `script/lib/page-collect-code.js:108`（skip 条件）
- Modify: `script/clean_snapshot.mjs:9-10`（头注「零样式计算」表述修正）
- Test: `test/unit/chrome-hidden-fold.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `chromeGuardOk`/`CHROME_TAG_SKIP`/`CHROME_POS`（同函数作用域直接使用）；既有 `sizeSuffix`（共享段已定义）；既有 `topTags`（K5 段函数声明，hoisting 可用）
- Produces: `chromeFolds`(array of `{el, kind}`，kind ∈ 'hidden'（本任务）/'dialog'(Task 4)/'overlay'(Task 5))；expando `__u2mChromeFold`(string kind，折叠集最外层节点)、`__u2mInChromeFold`(true，折叠集后代)——收集脚本与 K6/K7 skip 消费；`CHROME_TOKEN`(map)；`cssHiddenCount`(number)；clean 趟 return `stats.cssHiddenFolded`

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-hidden-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-hid', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-hid-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const res = {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    tablesJson: JSON.parse(fs.readFileSync(out.tablesJson, 'utf8')),
    codesJson: JSON.parse(fs.readFileSync(out.codeJson, 'utf8')),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
  return res;
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}.vh{visibility:hidden}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40);

test('H1-C: body 直下 css-hidden（有兄弟）折叠为 HIDDEN_TAG，styled 保活', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p></div>
<div data-idx="4" class="hid"><div data-idx="5">弹窗内部</div></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), '壳保留（data-idx 可引用）');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|4_chars'), 'token 带占位前原文规模');
    assert.ok(!r.cleaned.includes('data-idx="5"') && !r.cleaned.includes('弹窗内部'), '子树清空');
    assert.ok(r.styled.includes('data-idx="5"') && r.styled.includes('弹窗内部'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H1-C: 独子链下探折叠（body>div>section[hidden]>div+header 检测到 section 为止）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3"><section data-idx="4" class="hid"><div data-idx="5">菜单</div><header data-idx="6">页头</header></section></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"') && r.cleaned.includes('{{HIDDEN_TAG|'), 'section 壳折叠');
    assert.ok(!r.cleaned.includes('data-idx="5"') && !r.cleaned.includes('data-idx="6"'), 'section 内部随折吞没');
    assert.ok(r.styled.includes('data-idx="6"'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H1-C 红线: 分叉后深处 hidden 不折（非激活 tab/FAQ 收起内容保活）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><div data-idx="2"><p data-idx="3">${BIG}</p></div><div data-idx="4" class="hid"><p data-idx="5">非激活 tab 面板</p></div></div>`));
  try {
    assert.ok(r.cleaned.includes('非激活 tab 面板'), 'off-chain hidden 全额存活（裁定 R2/R3）');
    assert.ok(r.cleaned.includes('data-idx="5"'), '内部 id 可见（步骤 3 可挑选）');
    assert.ok(!r.cleaned.includes('{{HIDDEN_TAG'), '无任何 css-hidden 折叠');
  } finally { r.cleanup(); }
});

test('H1-C: 守卫拦截（p>2）；visibility:hidden 计入；嵌套只折最外层；裸 [hidden] 仍归 K5', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" class="hid"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="4" class="vh">不可见</div>
<div data-idx="5" class="hid"><div data-idx="6" class="hid">内层</div></div>
<div data-idx="7" hidden="true">属性隐藏</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="3"') && r.cleaned.includes('<p'), 'p=3 守卫阻断折叠');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|3_chars'), 'visibility:hidden 折叠（不可见=3 字）');
    assert.ok(!r.cleaned.includes('data-idx="6"'), '嵌套 hidden 随最外层吞并');
    assert.ok((r.cleaned.match(/HIDDEN_TAG/g) || []).length === 3, '共 3 个折叠壳：vh/嵌套外层/裸属性');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|4_chars'), '裸 [hidden] K5 照常（属性隐藏=4 字）');
    assert.ok(r.styled.includes('data-idx="7"') && r.styled.includes('属性隐藏'), 'styled 全部保活');
  } finally { r.cleanup(); }
});

test('k 对齐: css-hidden 表/代码块由 K5x 独占，两版 skip 同源、编号不错位', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<table data-idx="3" class="hid"><tr><td>隐藏表</td></tr></table>
<table data-idx="4"><thead><tr><th>A</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>
<pre data-idx="5" class="hid">hidden code line one
line two
line three</pre>
<pre data-idx="6" data-language="js">const a = 1;
const b = 2;
console.log(a, b);</pre>`));
  try {
    assert.equal(r.out.tables.total, 1, '隐藏表不入收集（styled skip 同源）');
    assert.equal(r.out.codes.total, 1, '隐藏 pre 不入收集');
    assert.deepEqual(Object.keys(r.tablesJson), ['1'], 'tables.json 仅 k=1');
    assert.equal(r.tablesJson['1'].dataIdx, '4', 'k=1 归属可见表');
    assert.deepEqual(Object.keys(r.codesJson), ['1'], 'code.json 仅 k=1');
    assert.ok(r.cleaned.includes('{{TABLE_1|2×1}}'), '可见表 k=1 不错位');
    assert.ok(!r.cleaned.includes('TABLE_2'), '无幽灵 k=2');
    assert.ok(r.cleaned.includes('{{CODE_1|3_lines}}'), '可见 pre k=1');
    assert.ok(!r.cleaned.includes('CODE_2'), '无幽灵 CODE_2');
    assert.ok(r.styled.includes('隐藏表') && r.styled.includes('hidden code line one'),
      'styled 隐藏表/代码块保 live（不入恢复清单政策）');
  } finally { r.cleanup(); }
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-hidden-fold.test.mjs`
Expected: FAIL——折叠断言失败（css-hidden 现状全额存活）；红线测试与 styled 保活断言此时即通过；k 对齐测试的 `tables.total` 为 2（现状收集隐藏表）

- [x] **Step 3: 实现标志预计算（共享段）**

在 `__u2mPreLines` 预计算循环之后插入：

```js
  // chrome 折叠集预计算（两趟共享，spec 2026-09-09 §5/§9.1-3）：候选区 =
  //     body 直接子孙（豁免兄弟检查，裁定 R4）∪ 独子链节点（自 body 下每步
  //     皆独元素子，遇分叉出链，裁定 R3）。本任务只判 hidden 种：computed
  //     display:none ∨ visibility:hidden 含祖先累积（display:none 后代的
  //     computed 值不回传 none，必须文档序自顶向下累积）。裸 [hidden] 及其
  //     后代除外——K5 独占（既定政策不变）。统一内容守卫 chromeGuardOk
  //     （裁定 R10）。最外层优先：文档序单趟，祖先已入折叠集则后代不再独立
  //     判定。script/style/template/noscript 排除（spec §14 修订 1）。
  //     折叠集节点挂 __u2mChromeFold（种类）、后代挂 __u2mInChromeFold——
  //     styled 侧收集与 clean 侧 K6/K7 同源 skip（k 对齐，spec §9.3）；规模
  //     复用 __u2mHiddenSize 占位前预计算。必须在此计算：clean 趟随后删
  //     <style>/style 属性，computed display 退化为 UA 默认。
  var chromeFolds = [];
  (function () {
    var all = document.querySelectorAll('body *');
    var hidAcc = new Map(), attrAcc = new Map();
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (CHROME_TAG_SKIP[el.tagName]) { hidAcc.set(el, true); attrAcc.set(el, true); continue; }
      var cs = getComputedStyle(el);
      var par = el.parentElement;
      hidAcc.set(el, cs.display === 'none' || cs.visibility === 'hidden' || !!(par && hidAcc.get(par)));
      attrAcc.set(el, el.hasAttribute('hidden') || !!(par && attrAcc.get(par)));
    }
    function onChain(el) {
      var n = el;
      while (n && n.tagName !== 'BODY') {
        var p = n.parentElement;
        if (!p) return false;
        if (p.tagName !== 'BODY' && p.children.length !== 1) return false;   // 非 body 层须独子
        n = p;
      }
      return !!n && n.tagName === 'BODY';
    }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (CHROME_TAG_SKIP[el.tagName]) continue;
      if (el.__u2mInChromeFold || el.__u2mChromeFold) continue;   // 已随外层入集
      if (attrAcc.get(el)) continue;                              // K5 独占领地
      if (!onChain(el)) continue;                                 // 候选区限制（裁定 R2/R3）
      if (!hidAcc.get(el)) continue;                              // 本任务：仅 hidden 种
      if (!chromeGuardOk(el)) continue;                           // 内容守卫
      el.__u2mChromeFold = 'hidden';
      if (!el.__u2mHiddenSize) el.__u2mHiddenSize = sizeSuffix(el.textContent);
      chromeFolds.push({ el: el, kind: 'hidden' });
      var desc = el.querySelectorAll('*');
      for (var j = 0; j < desc.length; j++) desc[j].__u2mInChromeFold = true;
    }
  })();
```

- [x] **Step 4: 实现 K5x 折叠消费（clean 趟）+ K6/K7 skip + 收集 skip 同源**

在既有 K5 循环（`hiddenCount++;` 结束的 for 循环）之后、K6 注释块之前插入：

```js
  // K5x. chrome 折叠集消费（仅清洗版，spec 2026-09-09 §5-7）：共享段
  //      chromeFolds 判定，壳机制逐字复用 K5——K2 白名单属性（含 data-idx）
  //      已就位、子树清空、token 带占位前预计算规模 + topTags 构成。
  //      hidden 种复用 HIDDEN_TAG（语义同裸 [hidden]：可能是收起正文，壳可
  //      标进 paragraphIds，还原走带样式版）。带样式版不折叠（步骤 5 隐藏
  //      剥离照旧展开、步骤 4 按壳 id 保整枝）。
  var CHROME_TOKEN = { hidden: 'HIDDEN_TAG' };
  var cssHiddenCount = 0;
  for (var i = 0; i < chromeFolds.length; i++) {
    var cfEl = chromeFolds[i].el, cfKind = chromeFolds[i].kind;
    if (!cfEl.parentNode || !document.body.contains(cfEl)) continue;   // 已被前序删除
    var cfTags = {};
    var cfDesc = cfEl.querySelectorAll('*');
    for (var j = 0; j < cfDesc.length; j++) {
      var cft = cfDesc[j].tagName.toLowerCase();
      cfTags[cft] = (cfTags[cft] || 0) + 1;
    }
    var cfSz = cfEl.__u2mHiddenSize || sizeSuffix(cfEl.textContent);
    var cfComp = topTags(cfTags);
    var cfToken = '{{' + CHROME_TOKEN[cfKind] + '|' + cfSz.n + '_' + cfSz.unit
      + (cfComp ? ';' + cfComp : '') + '}}';
    while (cfEl.firstChild) cfEl.removeChild(cfEl.firstChild);
    cfEl.appendChild(document.createTextNode(cfToken));
    if (cfKind === 'hidden') cssHiddenCount++;
  }
```

K6 skip 行（`if (tb.hasAttribute('hidden')) continue;`）改为：

```js
    if (tb.hasAttribute('hidden') || tb.__u2mChromeFold || tb.__u2mInChromeFold) continue;   // K5/K5x 独占（折叠集同源 skip，两版 k 对齐）
```

K7 skip 行（`if (pre.hasAttribute('hidden')) continue;`）改为：

```js
    if (pre.hasAttribute('hidden') || pre.__u2mChromeFold || pre.__u2mInChromeFold) continue;   // K5/K5x 独占（同源 skip）
```

`script/lib/page-collect-tables.js` 第 13 行改为：

```js
    if (tb.hasAttribute('hidden') || tb.__u2mChromeFold || tb.__u2mInChromeFold) continue; // K5/K5x 独占（chrome 折叠集同源 skip，两版 k 对齐，spec 2026-09-09 §9.3）
```

`script/lib/page-collect-code.js` 第 108 行改为：

```js
    if (pre.hasAttribute('hidden') || pre.__u2mChromeFold || pre.__u2mInChromeFold) continue; // K5/K5x 独占（同源 skip）
```

clean 趟 return stats 追加：

```js
      commentsRemoved: commentsRemovedCount,
      cssHiddenFolded: cssHiddenCount,
```

`script/clean_snapshot.mjs` 头注第 9-10 行：

```js
 * 零样式计算：不做 juice 内联、不做 CSS 隐藏检测——CSS 隐藏子树按可见
 * 保留，清洗版的隐藏折叠只认 HTML 裸 hidden 属性（K5）。
```

改为：

```js
 * 样式计算仅限共享段标志预计算（spec 2026-09-09）：不做 juice 内联；
 * CSS 隐藏检测限 body 边界脚手架区（body 直接子孙 ∪ 独子链）——链外深处
 * 的 CSS 隐藏子树（FAQ/非激活 tab）按可见保留，清洗版折叠为 HIDDEN_TAG
 * 壳（K5x）；裸 hidden 属性折叠（K5）全文档不变。
```

- [x] **Step 5: 跑测试确认通过 + golden + 全量**

Run: `node --test test/unit/chrome-hidden-fold.test.mjs`
Expected: PASS（5 个测试全绿）

Run: `node --test test/unit/clean-snapshot-golden.test.mjs && node --test test/unit/page-collect-tables.test.mjs && node --test test/unit/page-collect-code.test.mjs`
Expected: PASS（模拟已验证 article-1/clean-simplify folds=0；收集脚本 expando 在其测试环境为 undefined → falsy → 行为不变）

Run: `pnpm test`
Expected: 全绿。重点关注 clean-snapshot.test.mjs 内联夹具——模拟显示零扰动；若红按 Task 1 Step 4 的裁决原则处理

- [x] **Step 6: Commit**

```bash
git add script/lib/page-clean-snapshot.js script/lib/page-collect-tables.js script/lib/page-collect-code.js script/clean_snapshot.mjs test/unit/chrome-hidden-fold.test.mjs
git commit -m "feat(step2): H1-C 链限制 computed-hidden 折叠（K5x）+ 收集 skip 同源保 k 对齐

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §5/§9
候选区 = body 直接子孙 ∪ 独子链（分叉即停）——OpenAI 非激活 tab 正文实证
红线：链外深处 CSS 隐藏全额保活。折叠集 table/pre 两版同源 skip（K6 本地
计数错位防护）；script/style/template/noscript 排除（夹具模拟发现 UA
display:none 误折）。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: H2 dialog 语义折叠（DIALOG_TAG）

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（标志预计算的 kind 判定 + CHROME_TOKEN + K5x 计数分支 + return stats）
- Test: `test/unit/chrome-dialog-fold.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 3 的标志预计算循环与 K5x 消费框架
- Produces: kind `'dialog'`；`CHROME_TOKEN.dialog = 'DIALOG_TAG'`；`dialogCount`(number)；`stats.dialogFolded`

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-dialog-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-dlg', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-dlg-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40);

test('H2: 偏离脊柱的深处 role=dialog 折叠为 DIALOG_TAG，styled 保活', async () => {
  // div4 文本 >5% → D1 不删；dialog 在 off-chain 深处 → H2 任意深度接住
  const r = await runClean(wrap(`
<div data-idx="1">
  <div data-idx="2"><p data-idx="3">${BIG}</p></div>
  <div data-idx="4">评论区操作<div data-idx="5" role="dialog"><button data-idx="6">关闭</button>赞赏作者</div></div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="5"') && r.cleaned.includes('{{DIALOG_TAG|6_chars'),
      'dialog 壳折叠（关闭赞赏作者=6 字）');
    assert.ok(!r.cleaned.includes('data-idx="6"'), 'dialog 内部随折吞没');
    assert.ok(r.styled.includes('赞赏作者'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H2: 优先级 dialog > hidden；aria-modal 等价命中', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" class="hid" role="dialog">营销提示信息请确认是否继续访问</div>
<div data-idx="4" aria-modal="true">另一弹窗文本足够长超过比例阈值</div>`));
  try {
    assert.ok(r.cleaned.includes('{{DIALOG_TAG|') && !r.cleaned.includes('{{HIDDEN_TAG|'),
      'hidden+dialog → DIALOG_TAG（语义声明最强）');
    assert.ok((r.cleaned.match(/DIALOG_TAG/g) || []).length === 2, 'aria-modal 同折');
  } finally { r.cleanup(); }
});

test('H2: 守卫拦截——dialog 含 3 个 p 或含 table 不折（table 照常收集）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" role="dialog"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="4" role="dialog"><table data-idx="5"><thead><tr><th>A</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table></div>`));
  try {
    assert.ok(!r.cleaned.includes('DIALOG_TAG'), '守卫阻断两类 dialog 折叠');
    assert.ok(r.cleaned.includes('{{TABLE_1|2×1}}'), 'dialog 内表照常收集折叠、k 对齐');
    assert.equal(r.out.tables.total, 1);
  } finally { r.cleanup(); }
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-dialog-fold.test.mjs`
Expected: FAIL——DIALOG_TAG 断言失败（现状 dialog div 全额存活）；守卫测试此时即通过（本就不折）

- [x] **Step 3: 实现 dialog 种**

标志预计算循环内，`if (!onChain(el)) continue;` **之前**插入 dialog 判定（任意深度，优先级最高——spec §7.1），并把原 hidden 判定改为 else 分支：

```js
      var kind = null;
      if (el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        kind = 'dialog';                                  // H2：语义自我声明，任意深度
      } else if (onChain(el) && hidAcc.get(el)) {
        kind = 'hidden';                                  // H1-C：候选区限制
      }
      if (!kind) continue;
```

（替换 Task 3 中的 `if (!onChain(el)) continue;` 与 `if (!hidAcc.get(el)) continue;` 两行；`chromeGuardOk` 守卫与入集逻辑不变。）

`CHROME_TOKEN` 扩展：

```js
  var CHROME_TOKEN = { hidden: 'HIDDEN_TAG', dialog: 'DIALOG_TAG' };
```

K5x 计数分支扩展（`var cssHiddenCount = 0;` 处加 `var dialogCount = 0;`；循环末尾）：

```js
    if (cfKind === 'hidden') cssHiddenCount++;
    else if (cfKind === 'dialog') dialogCount++;
```

clean 趟 return stats 追加：

```js
      cssHiddenFolded: cssHiddenCount,
      dialogFolded: dialogCount,
```

- [x] **Step 4: 跑测试确认通过 + 回归**

Run: `node --test test/unit/chrome-dialog-fold.test.mjs`
Expected: PASS（3 个测试全绿）

Run: `node --test test/unit/chrome-hidden-fold.test.mjs && node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: PASS（Task 3 测试不回归；golden 模拟 folds=0 不变）

- [x] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/chrome-dialog-fold.test.mjs
git commit -m "feat(step2): H2 dialog 语义折叠——role=dialog/aria-modal 任意深度折为 DIALOG_TAG

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §6
优先级 dialog > hidden（语义声明最强）；统一守卫拦截含正文/table 的 dialog；
接住 D1 射界外（偏离脊柱、ratio 超标）的弹窗。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: H3' 链上可见浮层折叠（OVERLAY_TAG）

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（标志预计算 kind 判定 + CHROME_TOKEN + 计数 + return stats）
- Test: `test/unit/chrome-overlay-fold.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 3/4 的标志预计算与 K5x 框架；`CHROME_POS`（Task 1）
- Produces: kind `'overlay'`；`CHROME_TOKEN.overlay = 'OVERLAY_TAG'`；`overlayCount`(number)；`stats.overlayFolded`

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-overlay-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-ovl', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-ovl-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40); // 160 字符

test("H3': 非占优分支独子链上的可见 fixed 浮层折叠为 OVERLAY_TAG（知乎登录横幅形态）", async () => {
  // div3 文本 24/320=7.5% > 5% → D1 不删；div3 非脊柱 → 其层级不扫描；
  // div4 在独子链上（div3 是 body 直下、div4 是 div3 独子）→ H3' 接住
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}${BIG}</p></div>
<div data-idx="3">
  <div data-idx="4" style="position:fixed">登录知乎，问答干货一键收藏打开知乎App扫码下载</div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"') && r.cleaned.includes('{{OVERLAY_TAG|'),
      '链上可见 fixed 折叠');
    assert.ok(!r.cleaned.includes('登录知乎'), 'clean 子树清空');
    assert.ok(r.styled.includes('登录知乎'), 'styled 保活');
  } finally { r.cleanup(); }
});

test("H3': 优先级 hidden > overlay；sticky 计入；off-chain 深处 fixed 不折", async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${'正'.repeat(100)}</p></div>
<div data-idx="3" class="hid" style="position:fixed">这是一个足够长的隐藏固定浮层文本超过百分之五</div>
<div data-idx="4" style="position:sticky;top:0">吸顶工具条文本足够长超过比例阈值百分之五</div>
<div data-idx="5">
  <div data-idx="6"><p data-idx="7">${BIG}</p></div>
  <div data-idx="8" style="position:fixed"><p data-idx="9">深处吸顶浮层文本超过比例阈值</p></div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|22_chars') && !r.cleaned.includes('隐藏固定浮层'),
      'hidden fixed（22 字/100=22% 逃 D1）→ HIDDEN_TAG（状态优先于位置）');
    assert.ok(r.cleaned.includes('{{OVERLAY_TAG|20_chars') && !r.cleaned.includes('吸顶工具条文本'),
      'body 直下 sticky 可见（20 字/100=20% 逃 D1）→ OVERLAY_TAG（H3 无 ratio 条件）');
    assert.ok(r.cleaned.includes('深处吸顶浮层'), 'off-chain 深处 fixed 不折（R2 红线）');
  } finally { r.cleanup(); }
});

test("H3': 守卫拦截——fixed 含 pre 不折", async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">代码演示浮层文本较长超过阈值<pre data-idx="4">x=1</pre></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), 'pre 守卫阻断');
    assert.ok(!r.cleaned.includes('OVERLAY_TAG'));
  } finally { r.cleanup(); }
});
```

（第二个测试的文本量刻意设计为 ratio >5%——22 字与 20 字对 max=100——让 D1 不先删，
从而单独验证 H3' 无 ratio 条件、以及 hidden > overlay 的优先级。）

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-overlay-fold.test.mjs`
Expected: FAIL——OVERLAY_TAG 断言失败；off-chain 红线断言此时即通过

- [x] **Step 3: 实现 overlay 种**

标志预计算 kind 判定改为完整形态（spec §7.1 终态）：

```js
      var kind = null;
      if (el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        kind = 'dialog';                                  // H2：任意深度
      } else if (onChain(el)) {
        kind = hidAcc.get(el) ? 'hidden'                  // H1-C：状态优先
          : (CHROME_POS[getComputedStyle(el).position] ? 'overlay' : null);   // H3'：可见浮层
      }
      if (!kind) continue;
```

`CHROME_TOKEN` 终态：

```js
  var CHROME_TOKEN = { hidden: 'HIDDEN_TAG', dialog: 'DIALOG_TAG', overlay: 'OVERLAY_TAG' };
```

计数（`var dialogCount = 0;` 处加 `var overlayCount = 0;`；K5x 循环末尾）：

```js
    if (cfKind === 'hidden') cssHiddenCount++;
    else if (cfKind === 'dialog') dialogCount++;
    else overlayCount++;
```

clean 趟 return stats 追加：

```js
      dialogFolded: dialogCount,
      overlayFolded: overlayCount,
```

- [x] **Step 4: 跑测试确认通过 + 回归**

Run: `node --test test/unit/chrome-overlay-fold.test.mjs`
Expected: PASS

Run: `node --test test/unit/chrome-d1.test.mjs && node --test test/unit/chrome-hidden-fold.test.mjs && node --test test/unit/chrome-dialog-fold.test.mjs && node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: PASS（Task 1 fixed-kill 测试不受影响——D1 在共享段先删，H3' 只见 D1 幸存者）

- [x] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/chrome-overlay-fold.test.mjs
git commit -m "feat(step2): H3' 链上可见浮层折叠——OVERLAY_TAG 补 D1 射界（非占优分支独子链）

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §7
优先级终态 dialog > hidden > overlay；知乎登录横幅形态（d=4 独子链 fixed
可见、ratio 超标逃 D1）实证接住；off-chain 深处 fixed 红线不折。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: emit `chrome` 对象 + U2M_DEBUG 明细

**Files:**
- Modify: `script/clean_snapshot.mjs:208`（debug 行）、`:216-227`（emit 块）
- Test: `test/unit/chrome-emit.test.mjs`（新建）

**Interfaces:**
- Consumes: clean 趟 return `stats.{chromeRemoved, chromeKills, commentsRemoved, cssHiddenFolded, dialogFolded, overlayFolded}`（Task 1-5 逐步就位）
- Produces: emit 顶层 `chrome` 对象（恒定形状 `{removed, cssHiddenFolded, dialogFolded, overlayFolded, commentsRemoved}`）——SKILL.md 决策表与下游 agent 可见

- [x] **Step 1: 写失败测试（完整文件）**

```js
// test/unit/chrome-emit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-emit', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-emit-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  return { out: JSON.parse(r.stdout), stderr: r.stderr,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }) };
}

const BIG = '正文内容'.repeat(40);

test('emit: chrome 对象恒定形状（干净页全零）', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body><div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p></div></body></html>`, 'zero');
  try {
    assert.deepEqual(r.out.chrome, {
      removed: 0, cssHiddenFolded: 0, dialogFolded: 0, overlayFolded: 0, commentsRemoved: 0,
    });
  } finally { r.cleanup(); }
});

test('emit: chrome 计数反映各规则命中', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title><style>.hid{display:none}</style></head>
<body>
<!-- c1 -->
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">广告</div>
<div data-idx="4" class="hid">隐藏浮层文本</div>
<div data-idx="5" role="dialog">弹窗足够长文本超过比例阈值</div>
</body></html>`, 'counts');
  try {
    assert.equal(r.out.chrome.removed, 1, 'idx3：fixed + ratio 2/160 → D1 删除');
    assert.equal(r.out.chrome.cssHiddenFolded, 1, 'idx4：body 直下 css-hidden（ratio 3.75% 但 static 无词汇，D1 不删）');
    assert.equal(r.out.chrome.dialogFolded, 1, 'idx5：dialog ratio 8% 逃 D1 → H2 折叠');
    assert.equal(r.out.chrome.overlayFolded, 0);
    assert.equal(r.out.chrome.commentsRemoved, 1);
  } finally { r.cleanup(); }
});

test('U2M_DEBUG=1: D1 kill 明细走 stderr，stdout 单行 JSON 契约不破', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body>
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">广告</div>
</body></html>`, 'dbg', { U2M_DEBUG: '1' });
  try {
    assert.ok(r.stderr.includes('[chrome-d1]'), 'kill 明细前缀');
    assert.ok(r.stderr.includes('pos:fixed'), '信号形态可见');
    assert.equal(r.stdout === undefined || true, true);
    assert.equal(r.out.chrome.removed, 1);
  } finally { r.cleanup(); }
});
```

（注：`runClean` 已断言 stdout 恰为一行可解析 JSON——契约由基座保证；第三个测试的 `r.stdout` 行可删，基座 `JSON.parse(r.stdout)` 失败即契约破坏。）

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/chrome-emit.test.mjs`
Expected: FAIL——`out.chrome` undefined；stderr 无 `[chrome-d1]`

- [x] **Step 3: 实现 emit 与 debug**

`script/clean_snapshot.mjs` debug 行（现 208 行）之后追加：

```js
    for (const kill of clean.stats.chromeKills || []) {
      debug(`[chrome-d1] ${kill.at} <${kill.tag}${kill.idx ? ' idx=' + kill.idx : ''}> ratio=${kill.ratio} ${kill.sig} "${kill.txt}"`);
    }
    debug(`[clean] chrome: 删除 ${clean.stats.chromeRemoved || 0} · css-hidden 折 ${clean.stats.cssHiddenFolded || 0} · dialog 折 ${clean.stats.dialogFolded || 0} · overlay 折 ${clean.stats.overlayFolded || 0} · 注释剥 ${clean.stats.commentsRemoved || 0}`);
```

emit 块 `viewText` 字段之后追加：

```js
      viewText: { count: clean.stats.viewTextCount },
      chrome: {
        removed: clean.stats.chromeRemoved || 0,
        cssHiddenFolded: clean.stats.cssHiddenFolded || 0,
        dialogFolded: clean.stats.dialogFolded || 0,
        overlayFolded: clean.stats.overlayFolded || 0,
        commentsRemoved: clean.stats.commentsRemoved || 0,
      },
```

同步更新文件头注的 stdout 契约示例（67-73 行），在 `"viewText":{"count":N}` 后追加：

```
 *    "chrome":{"removed":N,"cssHiddenFolded":N,"dialogFolded":N,"overlayFolded":N,"commentsRemoved":N}
```

- [x] **Step 4: 跑测试确认通过 + 契约回归**

Run: `node --test test/unit/chrome-emit.test.mjs && node --test test/unit/contract.test.mjs`
Expected: PASS

Run: `pnpm test`
Expected: 全绿（现有测试对 emit 的断言都是字段级，不因新增顶层字段破坏）

- [x] **Step 5: Commit**

```bash
git add script/clean_snapshot.mjs test/unit/chrome-emit.test.mjs
git commit -m "feat(step2): emit 增 chrome 恒定形状对象 + U2M_DEBUG D1 kill 明细

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §9.5
{removed,cssHiddenFolded,dialogFolded,overlayFolded,commentsRemoved}；
单行 JSON 契约不变、stdout 无明细泄漏。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 文档同步（SKILL 指南 / CLAUDE.md / README / 设计文档）

**Files:**
- Modify: `references/analyze_html_guide.md`（219 行 HIDDEN_TAG 条目扩展 + 其后新增两条 token 条目）
- Modify: `CLAUDE.md`（步骤 2 段：共享段清单、K5/K5x、收集 skip、emit）
- Modify: `README.md:94`（清洗版瘦身 bullet 扩展）
- Modify: `docs/design/url-to-markdown-design.md`（§6 步骤 2 小节追加规则摘要）
- Modify: `script/lib/page-clean-snapshot.js:1-40`（文件头注补 D1/注释剥离/折叠集段落）

**Interfaces:**
- Consumes: Task 1-6 全部落地行为
- Produces: 步骤 3 agent 的 token 判读指引（DIALOG_TAG/OVERLAY_TAG = chrome 不选）

- [x] **Step 1: 更新 references/analyze_html_guide.md**

在第 219 行 HIDDEN_TAG 条目末尾追加一句，并在其后新增两个条目：

```markdown
- `{{HIDDEN_TAG|…}}` 自 2026-09-09 起也覆盖 **body 边界脚手架区的 CSS 隐藏**（body 直接子孙与独子链上的 display:none/visibility:hidden）——判读方式不变；正文流深处的 CSS 隐藏内容（非激活 tab、FAQ 收起答案）不折叠、原文可见
- `{{DIALOG_TAG|n_chars;构成}}` 为 `role="dialog"`/`aria-modal` 弹窗折叠壳（任意深度）——**chrome，不要选入任何键**；壳 data-idx 也不需要标 dumpIds（步骤 4 对键外分支整枝删除）
- `{{OVERLAY_TAG|n_chars;构成}}` 为 body 边界独子链上的可见 fixed/absolute/sticky 浮层折叠壳（登录横幅/吸顶工具条等）——**chrome，不要选入任何键**
```

- [x] **Step 2: 更新 CLAUDE.md 步骤 2 段**

共享段描述（「**共享段（两趟一致执行）** = 结构删除 + astro 解包 + …」行）改为：

```markdown
    - **共享段（两趟一致执行）** = 结构删除 + **D1 脊柱占优比较删除（步骤 7.5，spec 2026-09-09）** + astro 解包 + **注释剥离（pre/code 子树除外）** + 长文本占位 + aria-label 截断 + 折叠统计预计算 + **chrome 折叠集预计算**：
      - **D1**——沿 body 脊柱逐层比较兄弟文本量：非占优（rank1 含并列恒豁免）子元素 ratio ≤5% ∧（fixed/absolute/sticky ∨ 弹窗词汇 modal|dialog|popup|popover|drawer|lightbox|toast|snackbar，**不含 overlay**）∧ 内容守卫（p≤2 ∧ 无 main/article ∧ 无 pre/table）→ **两版整树删除**；下探遇占优子元素 p≥5 或 main/article 即停（内容内部永不扫描）、深度上限 20；文本计量与候选排除 script/style/template/noscript
      - **chrome 折叠集**——候选区 = body 直接子孙 ∪ 独子链（分叉出链）；三种：dialog（role=dialog/aria-modal，**任意深度**）> hidden（computed display:none/visibility:hidden 含祖先累积）> overlay（可见 ∧ fixed/absolute/sticky）；统一内容守卫；裸 [hidden] 及后代归 K5 独占；节点挂 `__u2mChromeFold`、后代挂 `__u2mInChromeFold`——**styled 收集与 clean K6/K7 同源 skip（k 对齐）**
```

趟 2 clean 清单中 K5 行后追加：

```markdown
    - K5x chrome 折叠集消费（仅 clean 趟）——hidden→`{{HIDDEN_TAG}}`（语义同裸 [hidden]，壳可标 paragraphIds）、dialog→`{{DIALOG_TAG}}`、overlay→`{{OVERLAY_TAG}}`（后两者 chrome、步骤 3 不选）；壳机制逐字复用 K5；**带样式版折叠集保活**（还原链零改动）；链外深处 CSS 隐藏（FAQ/非激活 tab）不折——全 DOM hidden 检测被 OpenAI 非激活 tab 正文实证否决
```

emit 描述行同步加 `chrome:{removed,cssHiddenFolded,dialogFolded,overlayFolded,commentsRemoved}` 恒定形状。

- [x] **Step 3: 更新 README.md 与 docs/design**

README.md 第 94 行「清洗版瘦身」bullet 中追加：

```markdown
、**边界 chrome 清除（2026-09-09）**——D1 脊柱占优比较删除（文本量 rank1 恒豁免、p≥5/main 停止下探、内容守卫）+ 链限制 CSS 隐藏/dialog/浮层折叠（`{{HIDDEN_TAG}}`/`{{DIALOG_TAG}}`/`{{OVERLAY_TAG}}`，正文流深处隐藏内容保活），微信样本净瘦 ≈26%
```

docs/design/url-to-markdown-design.md §6 步骤 2 小节末尾追加一段（摘要 + 指向 spec）：

```markdown
边界 chrome 清除与折叠（2026-09-09，spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md）：共享段 D1 脊柱占优删除（两版）+ chrome 折叠集预计算；clean 趟 K5x 消费折叠（HIDDEN/DIALOG/OVERLAY_TAG 壳）；styled 收集与 K6/K7 同源 skip 保 k 对齐。清洗版唯一消费者步骤 3 的 token 判读见 references/analyze_html_guide.md。
```

- [x] **Step 4: 更新 page-clean-snapshot.js 文件头注**

头注「两趟共享同一套结构清洗（步骤 1-9：…）」句中补 `D1 脊柱占优删除 7.5、注释剥离`；「清洗版瘦身规则 K1-K7/K9-K11」清单在 K5 之后补 `K5x chrome 折叠集消费（HIDDEN/DIALOG/OVERLAY_TAG）`；「零样式计算」相关表述与 Task 3 对 clean_snapshot.mjs 头注的修正对齐（共享段 getComputedStyle 标志预计算，clean 趟折叠消费）。

- [x] **Step 5: 全量验证 + Commit**

Run: `pnpm test:all`
Expected: 全绿（单测 + 集成；集成需 chromium——环境已具备）

```bash
git add references/analyze_html_guide.md CLAUDE.md README.md docs/design/url-to-markdown-design.md script/lib/page-clean-snapshot.js
git commit -m "docs(step2): 边界 chrome 清除与折叠文档同步——token 判读/CLAUDE 管线/README/设计文档

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §12

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 冒烟回归（隔离协议，五真实样本）

**Files:**
- Modify: `test/smoke/SMOKE.md`（追加场景记录）
- 读取: `working/` 五样本的 `1_snapshot.html`（**只读复制，严禁写回**——auto-memory 告诫）

**Interfaces:**
- Consumes: Task 1-7 全部落地
- Produces: 冒烟记录（实测数字 vs spec §13 预期）

- [x] **Step 1: 隔离复制五样本快照**

```bash
SMOKE=$(mktemp -d /tmp/u2m-smoke-XXXXXX) && echo "$SMOKE" > /tmp/u2m-smoke-dir.txt
for d in mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw developers.openai.com_api_docs_guides_prompt-caching time.geekbang.org_column_article_983111 www.zhihu.com_question_2071375581464343126_answer_2072161669128655948 redirected_mmh1.top_article__ai-article_skill; do
  mkdir -p "$SMOKE/$d" && cp "working/$d/1_snapshot.html" "$SMOKE/$d/"
done
ls "$SMOKE"
```

Expected: 5 个目录各含 1_snapshot.html

- [x] **Step 2: 重跑步骤 2 并记录 chrome 统计与字节**

```bash
SMOKE=$(cat /tmp/u2m-smoke-dir.txt)
run() { U2M_WORKING_ROOT=$SMOKE node script/clean_snapshot.mjs --url "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({chrome:j.chrome,tables:j.tables.total,codes:j.codes.total,longText:j.longTextCount.total}))});'; }
run https://mp.weixin.qq.com/s/lspwTyzxUnpbw1eHIoqluw
run https://developers.openai.com/api/docs/guides/prompt-caching
run https://time.geekbang.org/column/article/983111
run https://www.zhihu.com/question/2071375581464343126_answer/2072161669128655948
for d in mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw developers.openai.com_api_docs_guides_prompt-caching time.geekbang.org_column_article_983111 www.zhihu.com_question_2071375581464343126_answer_2072161669128655948 redirected_mmh1.top_article__ai-article_skill; do
  wc -c "$SMOKE/$d/2_clean_snapshot.html" 2>/dev/null
done
```

Expected（对照 spec §13，允许 ±20% 实现差异；**数量级或方向偏离 → 停下审查**）：
- 微信：`removed≈24`、folds 合计 ≈8-14、clean ≈47-53K（原 66954）
- OpenAI：`removed≈7`、`cssHiddenFolded≥1`（26% 文本量侧栏）、clean ≈28-33K（原 41261）
- 知乎：`removed≈2`、`overlayFolded≈1`（登录横幅）、clean ≈41-44K（原 45467）
- 极客：`removed≈0-6`（多数已被规则 5/7 删）、clean ≈29-30K（原 29975）
- mmh1 重定向版：**全零**（负控制——`removed:0` 且三折叠计数全 0），clean ≈17.1K（原 17195，仅注释差）
  - 注：redirected 目录由 `--url` 原 URL 派生 + redirect_to.yaml marker 定位——隔离目录需把 `redirect_to.yaml` 一并复制并放 `redirected_` 前缀目录（Step 1 的 for 循环已按原目录名复制；若 urlDir 派生不中，直接跳过 mmh1 重跑、改用探针数据对照，并在记录注明）。原 URL 无法从目录名反推时向用户询问

- [x] **Step 3: 微信样本人工核查清洗版**

```bash
SMOKE=$(cat /tmp/u2m-smoke-dir.txt)
grep -c "DIALOG_TAG\|HIDDEN_TAG\|OVERLAY_TAG" "$SMOKE/mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw/2_clean_snapshot.html"
grep -o 'data-idx="4[0-9]\{3\}"' "$SMOKE/mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw/2_clean_snapshot.html" | sort -u | wc -l
```

Expected: 折叠 token ≥5 个；4xxx 段 chrome id 残留数显著低于改动前基线（基线：先对 `working/` 现产物跑同条 grep 记录数字再对比）。正文区（js_content 内 h3/p/pre 序列）与 `working/` 现产物一致——`diff <(grep -o '{{CODE_[0-9]*' 旧) <(grep -o '{{CODE_[0-9]*' 新)` 编号集合一致（k 对齐实证）

- [x] **Step 4: 步骤 3 选择质量对比（agent 判断）**

对微信新旧两版清洗版分别按 SKILL.md 步骤 3 产出 key_ids（新：`$SMOKE` 版；旧：`working/` 现产物 + 现 `3_key_ids.json`），对比：
- titleId/正文 paragraphIds 基本一致（个别边界块差异可接受）
- 新 key_ids 不含任何 chrome 区 id（4378+ 段、弹窗壳）
- **若正文块缺失 → 阻断，回到实现排查**（折叠误伤正文）

- [x] **Step 5: 记录 SMOKE.md + Commit**

在 `test/smoke/SMOKE.md` 追加场景条目：日期、五样本 chrome 统计实测表、字节对照、步骤 3 对比结论、k 对齐核对结果。

```bash
git add test/smoke/SMOKE.md
git commit -m "test(smoke): 边界 chrome 清除五样本回归记录——微信 -26%/OpenAI -25%/负控制全零

spec: docs/superpowers/specs/2026-09-09-body-spine-chrome-removal-design.md §11

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 自查记录（writing-plans self-review）

- **Spec 覆盖**：§4 D1→Task 1；§9.1-2 注释→Task 2；§5 H1-C + §9.1-3 标志 + §9.3 skip 同源→Task 3；§6 H2→Task 4；§7 H3' + §7.1 优先级→Task 5；§9.5 emit/debug→Task 6；§12 文档→Task 7；§11 冒烟→Task 8。§8 守卫内嵌于 Task 1（chromeGuardOk 单一实现，Task 3-5 复用）。§9.4 LT 交互零代码改动（既有「walk 不可达自然跳过」机制），由 Task 3 k 对齐测试与全量回归覆盖。§9.6 下游核对——步骤 4-8 零改动，Task 8 Step 3-4 实证
- **占位符扫描**：无 TBD/TODO；Task 5 断言已直接写为正确形态（文本量 ratio>5% 的设计意图内联注明——D1 不先删、单独验证 H3' 与优先级）；spec §11 的深度上限测试已补入 Task 1
- **类型一致性**：`chromeGuardOk`/`CHROME_TAG_SKIP`/`CHROME_POS`（Task 1 定义，Task 3 复用）；`chromeFolds`/`__u2mChromeFold`/`__u2mInChromeFold`（Task 3 定义，Task 4/5 扩展 kind、收集脚本消费）；`CHROME_TOKEN` 逐任务增长至终态 `{hidden,dialog,overlay}`；stats 字段名 `chromeRemoved/chromeKills/commentsRemoved/cssHiddenFolded/dialogFolded/overlayFolded` 与 emit 映射在 Task 6 对齐
