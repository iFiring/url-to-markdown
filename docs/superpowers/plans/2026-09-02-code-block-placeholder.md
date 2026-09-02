# 代码块占位符实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 步骤 2 把 `<pre>` 代码块确定性提取为预计算 Markdown 侧车（`2_code.json`），成功折叠为 `{{CODE_k|n_lines}}` 占位符、步骤 8 机械还原；失败保 live 由步骤 7 LLM 语义还原。

**Architecture:** 镜像表格占位符管线——浏览器侧 `walkLines` 结构化行重建（computed display + user-select 槽排除）→ Node 侧七类 fail-closed 校验 + 行首序号剥离 → 条件折叠（styled ok 折/failed 标记，clean 全折）→ 步骤 8 精确匹配还原 → 步骤 9 自适应围栏。

**Tech Stack:** Node ≥20 ESM、Playwright 1.62（chromium evaluate 注入共享页面脚本）、jsdom（单测 DOM）、node --test。

**Spec:** `docs/superpowers/specs/2026-09-02-code-block-placeholder-design.md`（本计划据其论证，执行者须同时读 spec）

## Global Constraints

- 每个 CLI 的 stdout **恰好一行 JSON**（失败路径也不例外），日志走 stderr，退出码 0/1/2（usage_error=2）——见 CLAUDE.md「输出契约即产品」。
- `emit()` 先写行、再在写回调里 `process.exit`，本身同步返回——`usage()`/`emit()` 之后不得继续执行可能输出第二行的代码。
- 共享页面脚本（`script/lib/page-*.js`）是普通非模块文件、各含一个具名 `function __u2mXxx(...)`；逻辑严禁分叉进 `.mjs` 编排层。
- Playwright 1.62 evaluate 语义：字符串必须是完整表达式——`page.evaluate(`(${fnSrc})(args)`)`。
- 测试命令：`pnpm test`（单测）、`pnpm run test:integration`（集成）。单测基座 `runClean` 会启动真 chromium 子进程（需要 chromium 已安装）。
- 提交信息用中文、conventional commits 前缀（feat/test/docs），结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- `{{PRE_CODE_TAG|N_lines}}` 在本计划完成后全面退役，不得残留任何生产者/消费者。

---

### Task 1: `expandLongText` 导出 + `lib/code2md.mjs` 核心管线

**Files:**
- Modify: `script/lib/table2md.js:7-12`（`expandLongText` 加 export）
- Create: `script/lib/code2md.mjs`
- Test: `test/unit/code2md.test.mjs`

**Interfaces:**
- Consumes: `expandLongText(html, longTextMap)`（本任务导出）；`guessCodeLang(text)`（`script/lib/placeholder.mjs:14` 已存在已导出）。
- Produces: `convertCodes(codeList, { longTextMap = {}, logsDir }) → Promise<{ codes, counts }>`。`codeList` 元素 = spec §5.1 收集载荷（本任务消费其中 `k/dataIdx/lang/text/renderedLines/hasNonText/textContentNoGutter/blockContainers/gutterStripped/outerHTML`）；`codes` 为 `{ [String(k)]: { dataIdx, lang, content, status, reason?, lines, gutterStripped, numberStripped? } }`；`counts = { total, ok, failed }`。失败项 `content: null`、带 `reason`；成功项不带 `reason` 键、`numberStripped` 仅真时携带。Task 2/5/8 消费此形状。

- [ ] **Step 1: 写失败测试**

创建 `test/unit/code2md.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { convertCodes } from '../../script/lib/code2md.mjs';

// 收集载荷工厂——字段含义见 spec §5.1；jsdom 无关（纯 Node 数据变换）
function payload(over = {}) {
  return {
    k: 1, dataIdx: '10', lang: '', text: '', lines: 1,
    renderedLines: null, hasNonText: false, textContentNoGutter: '',
    blockContainers: 0, gutterStripped: false, outerHTML: '<pre></pre>',
    ...over,
  };
}

test('ok：纯文本代码——\r\n 归一、首尾空行修剪、n_lines 重算、lang 兜底链', async () => {
  const text = '\r\nconst a = 1;\n\nconst b = 2;\r\n\n';
  const { codes, counts } = await convertCodes(
    [payload({ text, textContentNoGutter: text, lines: 7 })], {});
  assert.equal(counts.total, 1); assert.equal(counts.ok, 1); assert.equal(counts.failed, 0);
  const c = codes['1'];
  assert.equal(c.status, 'ok');
  assert.equal(c.content, 'const a = 1;\n\nconst b = 2;');  // 首尾空行修剪、内部空行保留
  assert.equal(c.lines, 3);
  assert.equal(c.lang, 'python');                            // guessCodeLang("const a = 1;...") → python
  assert.equal('reason' in c, false);
});

test('ok：data-language 收集值优先于 guessCodeLang', async () => {
  const text = 'const a = 1;';
  const { codes } = await convertCodes([payload({ lang: 'tsx', text, textContentNoGutter: text })], {});
  assert.equal(codes['1'].lang, 'tsx');
});

test('failed：non_textual——pre 内含 img', async () => {
  const { codes } = await convertCodes([payload({ hasNonText: true, text: 'x', textContentNoGutter: 'x' })], {});
  assert.equal(codes['1'].status, 'failed');
  assert.equal(codes['1'].reason, 'non_textual');
  assert.equal(codes['1'].content, null);
});

test('failed：content_loss——提取文本与 DOM 文本（减槽）空白不敏感不等', async () => {
  const { codes } = await convertCodes([payload({ text: 'const a = 1;', textContentNoGutter: 'const a = 1; const b = 2;' })], {});
  assert.equal(codes['1'].reason, 'content_loss');
});

test('ok：content_loss 对 <br>/空白差异免疫（空白不敏感比较）', async () => {
  const { codes } = await convertCodes([payload({ text: 'a\nb', textContentNoGutter: 'ab' })], {});
  assert.equal(codes['1'].status, 'ok');
});

test('ok：LONG_TEXT 预展开——占位符替换为恢复清单原文', async () => {
  const text = '{{LONG_TEXT_5|12_words}}\nconst b = 2;';
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text })], { longTextMap: { 5: '// 这是一条很长的注释行' } });
  assert.equal(codes['1'].content, '// 这是一条很长的注释行\nconst b = 2;');
});

test('failed：unresolved_long_text——预展开后仍残留占位符', async () => {
  const text = '{{LONG_TEXT_9|12_words}} code';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text })], { longTextMap: {} });
  assert.equal(codes['1'].reason, 'unresolved_long_text');
});

test('failed：empty——修剪后为空', async () => {
  const { codes } = await convertCodes([payload({ text: '\n\n  \n', textContentNoGutter: '\n\n  \n' })], {});
  assert.equal(codes['1'].reason, 'empty');
});

test('failed：single_line_suspect——单行但渲染多行（renderedLines=3）', async () => {
  const text = 'very long single line';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 3 })], {});
  assert.equal(codes['1'].reason, 'single_line_suspect');
});

test('ok：单行 + renderedLines=1 不误判；单行 + renderedLines=null 跳过', async () => {
  const text = 'single';
  const a = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 1 })], {});
  assert.equal(a.codes['1'].status, 'ok');
  const b = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: null })], {});
  assert.equal(b.codes['1'].status, 'ok');
});

test('failed：rendered_mismatch——提取行数扣空行豁免后超渲染行数', async () => {
  const text = 'a\n\n\nb';   // trimmed 4 行、interiorBlanks 2 → 4-2=2 > renderedLines 1
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 1 })], {});
  assert.equal(codes['1'].reason, 'rendered_mismatch');
});

test('ok：rendered_mismatch 空行豁免——空行无矩形合法（4-2=2 ≤ rendered 2）', async () => {
  const text = 'a\n\n\nb';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 2 })], {});
  assert.equal(codes['1'].status, 'ok');
});

test('failed：mixed_signal_mismatch——\\n 与块容器双信号矛盾', async () => {
  const text = 'a\nb\nc\nd\ne';                          // newlineCount 4 → 5 行
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text, blockContainers: 9 })], {});  // |5-9|=4 > 1
  assert.equal(codes['1'].reason, 'mixed_signal_mismatch');
});

test('ok：mixed_signal ±1 容差——shiki 块容器 + 尾随 \\n', async () => {
  const text = 'a\nb\nc\n';                              // newlineCount 3 → 4
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text, blockContainers: 3 })], {});  // |4-3|=1
  assert.equal(codes['1'].status, 'ok');
});

test('ok：单信号跳过 mixed_signal（\\n=0 或容器=0）', async () => {
  const a = await convertCodes([payload({ text: 'x\ny', textContentNoGutter: 'x\ny', blockContainers: 0 })], {});
  assert.equal(a.codes['1'].status, 'ok');
  const b = await convertCodes([payload({ text: 'x', textContentNoGutter: 'x', blockContainers: 5 })], {});
  assert.equal(b.codes['1'].status, 'ok');
});

test('counts 与失败诊断日志落盘', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-code2md-'));
  try {
    const { counts } = await convertCodes(
      [payload({ k: 1, dataIdx: '10', hasNonText: true, text: 'x', textContentNoGutter: 'x' }),
       payload({ k: 2, dataIdx: '20', text: 'ok code', textContentNoGutter: 'ok code' })],
      { logsDir });
    assert.deepEqual(counts, { total: 2, ok: 1, failed: 1 });
    const logPath = path.join(logsDir, '1_10.log');
    assert.ok(fs.existsSync(logPath));
    const log = fs.readFileSync(logPath, 'utf8');
    assert.ok(log.includes('reason: non_textual'));
    assert.ok(log.includes('--- outerHTML ---'));
  } finally { fs.rmSync(logsDir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/code2md.test.mjs`
Expected: FAIL——`Cannot find module .../script/lib/code2md.mjs`（模块不存在）。

- [ ] **Step 3: 导出 expandLongText + 实现 code2md.mjs**

`script/lib/table2md.js` 第 9 行 `function expandLongText(` 改为：

```js
export function expandLongText(html, longTextMap) {
```

（`LONG_TEXT_RE` 保持私有——code2md 用自己的非 global 变体，避开 `/g` 状态量 `.test` 陷阱。）

创建 `script/lib/code2md.mjs`：

```js
// script/lib/code2md.mjs
// 步骤 2 代码块转换（表格占位符设计的 code 镜像）：接收浏览器侧
// __u2mCollectCode 的收集载荷，Node 层做七类 fail-closed 校验 + 层 2 行首
// 序号剥离 + 序列化 → 2_code.json 条目 + 失败诊断日志。
// fail-closed 原则（spec §6）：宁可失败走步骤 7 LLM 兜底，不可静默失真。
// 提取在浏览器侧完成（walkLines 需要 computed display），本模块不解析 HTML——
// 与表格 self/turndown 可插拔有意不同（YAGNI）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { expandLongText } from './table2md.js';
import { guessCodeLang } from './placeholder.mjs';

const STRIP_WS_RE = /\s+/g;
const UNRESOLVED_RE = /\{\{LONG_TEXT_\d/; // 非 global：.test 无 lastIndex 状态
const GUTTERISH_RE = /^[\d\s.,;:)|·•\-–—]*$/;

const stripWs = (s) => String(s || '').replace(STRIP_WS_RE, '');

// 修剪首尾空行（内部空行保留——代码保真）
function trimBlankEnds(lines) {
  let a = 0, b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

function validateAndSerialize(c, longTextMap) {
  // 1. non_textual：围栏无法表达图示/嵌套表
  if (c.hasNonText) return { reason: 'non_textual' };
  // 2. content_loss：空白不敏感往返——提取文本与 DOM 文本（减槽）逐字符相等；
  //    <br> 在两侧均零贡献、块间空白被 stripWs 抹平，只捕获真丢文本
  if (stripWs(c.text) !== stripWs(c.textContentNoGutter)) return { reason: 'content_loss' };
  // 3. LONG_TEXT 预展开（\r 归一随行，切分前）
  const expanded = expandLongText(String(c.text || ''), longTextMap).replace(/\r\n?/g, '\n');
  if (UNRESOLVED_RE.test(expanded)) return { reason: 'unresolved_long_text' };
  // 4. 层 2 序号剥离（Task 2 注入；本任务先返回原样）
  const stripped = stripLeadingNumbers(expanded.split('\n'));
  // 5. empty：修剪首尾空行后为空/纯空白
  const trimmed = trimBlankEnds(stripped.lines);
  if (trimmed.join('').trim() === '') return { reason: 'empty' };
  // 6. 渲染交叉校验（renderedLines 非 null 才判——隐藏祖先下 rects 为空）
  if (c.renderedLines != null) {
    const interiorBlanks = trimmed.slice(1, -1).filter((l) => l.trim() === '').length;
    if (trimmed.length === 1 && c.renderedLines > 1) return { reason: 'single_line_suspect' };
    if (trimmed.length - interiorBlanks > c.renderedLines) return { reason: 'rendered_mismatch' };
  }
  // 7. mixed_signal：\n 与块容器双信号并存但行数矛盾（±1 容差吸收尾随 \n）
  const newlineCount = (String(c.textContentNoGutter || '').match(/\n/g) || []).length;
  if (newlineCount > 0 && c.blockContainers > 0 &&
      Math.abs(newlineCount + 1 - c.blockContainers) > 1) {
    return { reason: 'mixed_signal_mismatch' };
  }
  const content = trimmed.join('\n');
  return {
    content,
    lines: trimmed.length,
    lang: c.lang || guessCodeLang(content) || '',
    numberStripped: stripped.stripped,
  };
}

export async function convertCodes(codeList, { longTextMap = {}, logsDir } = {}) {
  const codes = {};
  let ok = 0, failed = 0;
  for (const c of codeList) {
    const r = validateAndSerialize(c, longTextMap);
    const isOk = !r.reason;
    if (isOk) ok++; else failed++;
    codes[String(c.k)] = {
      dataIdx: c.dataIdx,
      lang: isOk ? r.lang : (c.lang || ''),
      content: isOk ? r.content : null,
      status: isOk ? 'ok' : 'failed',
      ...(isOk ? {} : { reason: r.reason }),
      lines: isOk ? r.lines : c.lines,
      gutterStripped: !!c.gutterStripped,
      ...(isOk && r.numberStripped ? { numberStripped: true } : {}),
    };
    if (!isOk && logsDir) {
      const snippet = (c.outerHTML || '').length > 2000
        ? (c.outerHTML.slice(0, 2000) + '\n…[truncated]') : (c.outerHTML || '');
      const logText = `dataIdx: ${c.dataIdx}\nk: ${c.k}\nlines: ${c.lines}` +
        `\nrenderedLines: ${c.renderedLines}\nblockContainers: ${c.blockContainers}` +
        `\nreason: ${r.reason}\n\n--- outerHTML ---\n${snippet}\n`;
      await fs.mkdir(logsDir, { recursive: true });
      await fs.writeFile(path.join(logsDir, `${c.k}_${c.dataIdx}.log`), logText, 'utf8');
    }
  }
  return { codes, counts: { total: codeList.length, ok, failed } };
}
```

同文件先加占位实现（Task 2 替换为真实现；本任务让管线可跑）：

```js
// 层 2 行首序号剥离——Task 2 实现，先返回原样
function stripLeadingNumbers(lines) {
  return { lines, stripped: false };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/code2md.test.mjs`
Expected: 全部 PASS（18 个用例）。

- [ ] **Step 5: 跑表格单测确认 export 改动无回归**

Run: `node --test test/unit/expand-table-spans.test.mjs test/unit/screenshot-trans.test.mjs`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add script/lib/table2md.js script/lib/code2md.mjs test/unit/code2md.test.mjs
git commit -m "feat(code2md): 步骤 2 代码块 Node 层转换——七类 fail-closed 校验 + 序列化"
```

---

### Task 2: 层 2 行首算术序号剥离

**Files:**
- Modify: `script/lib/code2md.mjs`（替换占位 `stripLeadingNumbers`）
- Test: `test/unit/code2md.test.mjs`（追加用例）

**Interfaces:**
- Produces: `stripLeadingNumbers(lines: string[]) → { lines: string[], stripped: boolean }`（模块内函数，经 convertCodes 间接触发；单测直接 import——需在实现时加 `export`）。

- [ ] **Step 1: 追加失败测试**

在 `test/unit/code2md.test.mjs` 顶部 import 行后加：

```js
import { stripLeadingNumbers } from '../../script/lib/code2md.mjs';
```

文件末尾追加：

```js
test('层 2：行首序号剥离——bare / 点 / 管道分隔三形态', () => {
  const bare = stripLeadingNumbers(['1 import x', '2 const a = 1', '3 export default a']);
  assert.equal(bare.stripped, true);
  assert.deepEqual(bare.lines, ['import x', 'const a = 1', 'export default a']);

  const dotted = stripLeadingNumbers(['1. alpha', '2. beta', '3. gamma']);
  assert.deepEqual(dotted.lines, ['alpha', 'beta', 'gamma']);

  const piped = stripLeadingNumbers(['1 | code one', '2 | code two', '3 | code three']);
  assert.deepEqual(piped.lines, ['code one', 'code two', 'code three']);
});

test('层 2：起始任意（摘录槽从 26 起）', () => {
  const r = stripLeadingNumbers(['26 "model": "x"', '27 "input": []', '28 }']);
  assert.equal(r.stripped, true);
  assert.deepEqual(r.lines, ['"model": "x"', '"input": []', '}']);
});

test('层 2：多空格槽对齐——数字后水平空白全剥', () => {
  const r = stripLeadingNumbers(['1    import', '2    export']);
  // 仅 2 行 < 3 不剥——换 3 行
  const r3 = stripLeadingNumbers(['1    import', '2    export', '3    const']);
  assert.equal(r3.stripped, true);
  assert.deepEqual(r3.lines, ['import', 'export', 'const']);
  assert.equal(r.stripped, false);
});

test('层 2不剥：序列中断（yaml 数字键后有普通行）', () => {
  const r = stripLeadingNumbers(['1: a', '2: b', 'foo: bar']);
  assert.equal(r.stripped, false);
  assert.equal(r.lines[0], '1: a');
});

test('层 2不剥：非公差 1', () => {
  const r = stripLeadingNumbers(['1 a', '3 b', '5 c']);
  assert.equal(r.stripped, false);
});

test('层 2不剥：某行无行首整数', () => {
  const r = stripLeadingNumbers(['1 a', 'no number', '3 c']);
  assert.equal(r.stripped, false);
});

test('层 2不剥：长数字不是序号（10 位数前缀 lookahead 失败）', () => {
  const r = stripLeadingNumbers(['1234567890 abc', '1234567891 def', '1234567892 ghi']);
  assert.equal(r.stripped, false);
});

test('层 2不剥：剥后退化（剩余全数字+分隔符）', () => {
  const r = stripLeadingNumbers(['1 2', '2 3', '3 4']);
  assert.equal(r.stripped, false);
});

test('convertCodes 集成：内联序号形态产出 numberStripped 元数据', async () => {
  const text = '1. alpha\n2. beta\n3. gamma';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text })], {});
  assert.equal(codes['1'].status, 'ok');
  assert.equal(codes['1'].content, 'alpha\nbeta\ngamma');
  assert.equal(codes['1'].numberStripped, true);
  assert.equal(codes['1'].lines, 3);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/code2md.test.mjs`
Expected: 新增用例 FAIL——`stripped` 恒为 false（占位实现）。

- [ ] **Step 3: 实现真 stripLeadingNumbers**

替换 `script/lib/code2md.mjs` 中的占位实现为（同时加 export）：

```js
// 层 2：行首算术序号剥离（spec §6.2）——保守条件全满足才剥，防误剥 yaml
// 数字键等真实代码：≥3 个非空行全部带行首整数 token、构成公差 1 连续序列
// （起始任意——OpenAI 摘录槽有从 26 起形态）、剥后内容非退化。
// 剥离量 = 行首水平空白 + 数字 + 至多一个分隔符 + 紧随水平空白（不吞更深缩进）。
// 长数字（>3 位）不是序号：lookahead 要求数字后是分隔符/空白/行尾。
const LEADING_NUM_RE = /^[ \t]*(\d{1,3})(?=[ \t.:;)|·•\-–—]|$)/;
const NUM_PREFIX_RE = /^[ \t]*\d{1,3}[ \t.:;)|·•\-–—]?[ \t]*/;

export function stripLeadingNumbers(lines) {
  const idxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') idxs.push(i);
  }
  if (idxs.length < 3) return { lines, stripped: false };
  const firsts = idxs.map((i) => {
    const m = LEADING_NUM_RE.exec(lines[i]);
    return m ? Number(m[1]) : null;
  });
  if (firsts.some((n) => n === null)) return { lines, stripped: false };
  for (let j = 1; j < firsts.length; j++) {
    if (firsts[j] !== firsts[0] + j) return { lines, stripped: false };
  }
  const out = lines.slice();
  for (const i of idxs) out[i] = out[i].replace(NUM_PREFIX_RE, '');
  if (out.every((l) => GUTTERISH_RE.test(l))) return { lines, stripped: false };
  return { lines: out, stripped: true };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/code2md.test.mjs`
Expected: 全部 PASS（含 Task 1 用例——`const a = 1;` 等行不以序号开头，`firsts` 含 null 或序列不连续 → 不剥，原用例不受影响）。

- [ ] **Step 5: Commit**

```bash
git add script/lib/code2md.mjs test/unit/code2md.test.mjs
git commit -m "feat(code2md): 层 2 行首算术序号剥离——保守条件防误剥"
```

---

### Task 3: `page-collect-code.js` 收集脚本

**Files:**
- Create: `script/lib/page-collect-code.js`
- Test: `test/unit/page-collect-code.test.mjs`

**Interfaces:**
- Produces: `__u2mCollectCode()`（浏览器/jsdom evaluate 作用域内调用，无参数）→ 数组，元素按文档序：`{ k, dataIdx, lang, text, lines, renderedLines, hasNonText, textContentNoGutter, blockContainers, gutterStripped, outerHTML }`（语义见 spec §5.1）。Task 5 把源码拼在 `__u2mCleanSnapshot` 前注入 styled evaluate。
- 单测注入方式：`new Function('document', 'getComputedStyle', 'return (' + src + ')()')`——jsdom 的 `new Function` 作用域无 window 全局，需显式传 `getComputedStyle`。**display/user-select 关键用例用行内样式提供**（jsdom 对 `<style>` 规则级联支持有限；`<style>` 规则形态由 Task 8 集成覆盖）。

- [ ] **Step 1: 写失败测试**

创建 `test/unit/page-collect-code.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-collect-code.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mCollectCode', () => {
  assert.ok(src().includes('function __u2mCollectCode'));
});

function run(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const fn = new Function('document', 'getComputedStyle', 'return (' + src() + ')()');
  return fn(dom.window.document, dom.window.getComputedStyle.bind(dom.window));
}

const GUT = `style="user-select:none"`;

test('shiki 形态：inline 行 span + \\n 文本节点——行数按换行、lang 取 data-language', () => {
  const out = run(`
    <pre data-idx="10"><code data-language="javascript" data-idx="11">
      <span style="display:inline"><span style="display:inline">import</span> OpenAI;</span>
      <span style="display:inline"><span style="display:inline">const</span> a = 1;</span>
    </code></pre>`);
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.k, 1);
  assert.equal(c.dataIdx, '10');
  assert.equal(c.lang, 'javascript');
  assert.equal(c.lines, 2);
  assert.equal(c.text, 'import OpenAI;\nconst a = 1;');
  assert.equal(c.renderedLines, null, 'jsdom 无布局 → null');
  assert.equal(c.blockContainers, 0, 'inline span 不计容器');
  assert.equal(c.textContentNoGutter.replace(/\s+/g, ' ').trim(), 'import OpenAI; const a = 1;');
});

test('ra 形态：grid 行容器零 \\n——行数按容器边界、lang 取 language-* class', () => {
  const out = run(`
    <pre data-idx="20"><code class="ra-code language-tsx" data-idx="21">
      <span style="display:grid"><span style="display:inline">system:</span> \`...\`</span>
      <span style="display:grid"><span style="display:inline">const</span> t = Date();</span>
      <span style="display:grid"><span style="display:inline">const</span> u = 2;</span>
    </code></pre>`);
  const c = out[0];
  assert.equal(c.lang, 'tsx');
  assert.equal(c.lines, 3, 'grid 容器边界断行');
  assert.equal(c.text.split('\n').length, 3);
  assert.equal(c.blockContainers, 3);
});

test('br 分行形态', () => {
  const out = run(`<pre data-idx="30"><code data-idx="31">alpha<br>beta<br>gamma</code></pre>`);
  assert.equal(out[0].lines, 3);
  assert.equal(out[0].text, 'alpha\nbeta\ngamma');
});

test('块间空白文本节点吞掉、内部空行保留', () => {
  const out = run(`
    <pre data-idx="40"><code data-idx="41"><span style="display:block">a</span>
<span style="display:block"></span>
<span style="display:block">b</span></code></pre>`);
  // 块间 \n 文本节点在空行上不产生额外断行；空行容器产生 1 个空行
  assert.equal(out[0].text, 'a\n\nb');
});

test('层 1 槽排除：user-select:none 纯数字子树零贡献、gutterStripped 置位、textContentNoGutter 减槽', () => {
  const out = run(`
    <pre data-idx="50"><code data-idx="51">
      <span style="display:block;user-select:none"><span ${GUT}>1
</span><span ${GUT}>2
</span><span ${GUT}>3
</span></span>
      <span style="display:inline">{"model": "x"}</span>
    </code></pre>`);
  const c = out[0];
  assert.equal(c.gutterStripped, true);
  assert.equal(c.text, '{"model": "x"}', '序号槽零贡献');
  assert.ok(!c.textContentNoGutter.includes('1'), 'textContentNoGutter 减槽');
});

test('层 1 不误杀：user-select:none 但内容非纯数字（复制保护整块）', () => {
  const out = run(`
    <pre data-idx="60" style="user-select:none"><code data-idx="61">const a = 1;
const b = 2;</code></pre>`);
  assert.equal(out[0].gutterStripped, false);
  assert.equal(out[0].lines, 2);
  assert.equal(out[0].text, 'const a = 1;\nconst b = 2;');
});

test('hasNonText：pre 内嵌 img 置位', () => {
  const out = run(`<pre data-idx="70"><code data-idx="71">code <img src="x.png"> more</code></pre>`);
  assert.equal(out[0].hasNonText, true);
});

test('lang 链：data-language 缺省 → code class language-* → pre class → 空', () => {
  const a = run(`<pre data-idx="80"><code class="language-python" data-idx="81">x = 1</code></pre>`);
  assert.equal(a[0].lang, 'python');
  const b = run(`<pre class="language-bash" data-idx="82"><code data-idx="83">ls</code></pre>`);
  assert.equal(b[0].lang, 'bash');
  const c = run(`<pre data-idx="84"><code data-idx="85">ls</code></pre>`);
  assert.equal(c[0].lang, '');
});

test('hidden / detached pre 跳过，k 按文档序连续编号', () => {
  const out = run(`
    <pre data-idx="90"><code data-idx="91">a</code></pre>
    <div hidden><pre data-idx="92"><code data-idx="93">hidden code</code></pre></div>
    <pre data-idx="94"><code data-idx="95">b</code></pre>`);
  assert.equal(out.length, 2);
  assert.equal(out[0].k, 1); assert.equal(out[0].dataIdx, '90');
  assert.equal(out[1].k, 2); assert.equal(out[1].dataIdx, '94');
});

test('outerHTML 携带 pre 原始序列化', () => {
  const out = run(`<pre data-idx="96"><code data-idx="97">x</code></pre>`);
  assert.ok(out[0].outerHTML.startsWith('<pre data-idx="96"'));
  assert.ok(out[0].outerHTML.endsWith('</pre>'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/page-collect-code.test.mjs`
Expected: FAIL——文件不存在，读文件抛 ENOENT。

- [ ] **Step 3: 实现 page-collect-code.js**

创建 `script/lib/page-collect-code.js`：

```js
// script/lib/page-collect-code.js
// styled 趟收集 pass：在长文本折叠后、任何折叠前，按文档序收集每个 <pre>
// {k, dataIdx, lang, text, lines, renderedLines, hasNonText, textContentNoGutter,
//  blockContainers, gutterStripped, outerHTML}。跳过 [hidden] pre（K5 独占）。
// walkLines：文本节点 \n 切分 + <br> 断行 + 非行内元素边界软断行（行已空不
// 重复断——块间纯空白文本节点天然吞掉，与 CSS 渲染语义一致；内部空行保留）。
// 槽排除（层 1）：userSelect:none 且子树纯数字+分隔符文本 → 整棵跳过。
// 双条件缺一不可：只有 user-select 会误杀复制保护整块；只有数字条件会误杀
// 纯数字代码行。computed display 在 display:none 祖先下仍返回计算值——
// 隐藏子树（折叠展开器内）也能提取，innerText 做不到（退化为 textContent）。
function __u2mCollectCode() {
  var INLINE_DISPLAY_RE = /^(inline|contents|ruby)/;
  var GUTTER_TEXT_RE = /^[\d\s.,;:)|·•\-–—]*$/;

  function isGutter(el) {
    if (getComputedStyle(el).userSelect !== 'none') return false;
    return GUTTER_TEXT_RE.test(el.textContent || '');
  }
  function isInline(el) {
    return INLINE_DISPLAY_RE.test(getComputedStyle(el).display);
  }

  function walkLines(root) {
    var lines = [''];
    var gutter = false;
    function brk(force) {
      if (force || lines[lines.length - 1] !== '') lines.push('');
    }
    function visit(n) {
      if (n.nodeType === 3) {
        var parts = n.textContent.split('\n');
        for (var i = 0; i < parts.length; i++) {
          if (i > 0) brk(true);
          lines[lines.length - 1] += parts[i];
        }
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') { brk(true); return; }
      if (isGutter(n)) { gutter = true; return; }
      var inline = isInline(n);
      if (!inline) brk(false);
      for (var c = n.firstChild; c; c = c.nextSibling) visit(c);
      if (!inline) brk(false);
    }
    visit(root);
    return { lines: lines, gutter: gutter };
  }

  var pres = document.querySelectorAll('pre');
  var out = [];
  var k = 0;
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue; // K5 独占
    k++;
    var code = pre.querySelector('code') || pre;

    var w = walkLines(code);

    // lang 链：code[data-language] → pre[data-language] → language-* class → ''
    var lang = code.getAttribute('data-language') || pre.getAttribute('data-language') || '';
    if (!lang) {
      var cls = (code.getAttribute('class') || '') + ' ' + (pre.getAttribute('class') || '');
      var lm = /(?:^|\s)language-([A-Za-z0-9._+-]+)/.exec(cls);
      if (lm) lang = lm[1];
    }

    // textContentNoGutter：pre 子树文本减槽元素（content_loss 比较基准）
    var tc = '';
    (function acc(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) tc += c.textContent;
        else if (c.nodeType === 1 && !isGutter(c)) acc(c);
      }
    })(pre);

    // renderedLines：distinct rect top 按 lineHeight 分桶（token 微高差去重）。
    // rects 为空（隐藏祖先 / 无布局）→ null——交叉校验跳过、只信结构信号。
    var rendered = null;
    var range = document.createRange();
    range.selectNodeContents(code);
    var rects = range.getClientRects();
    if (rects.length > 0) {
      var lh = parseFloat(getComputedStyle(pre).lineHeight);
      var tops = {};
      for (var r = 0; r < rects.length; r++) {
        var bucket = lh ? Math.round(rects[r].top / lh) : Math.round(rects[r].top);
        tops[bucket] = 1;
      }
      rendered = Object.keys(tops).length;
    }

    // blockContainers：code 壳直接子元素中非行内且非 <br> 的个数（行容器计数）
    var blocks = 0;
    for (var ci = code.firstChild; ci; ci = ci.nextSibling) {
      if (ci.nodeType === 1 && ci.tagName !== 'BR' && !isInline(ci)) blocks++;
    }

    var hasNonText = !!pre.querySelector(
      'img,svg,math,iframe,canvas,object,embed,video,audio,table');

    out.push({
      k: k,
      dataIdx: pre.getAttribute('data-idx') || '',
      lang: lang,
      text: w.lines.join('\n'),
      lines: w.lines.length,
      renderedLines: rendered,
      hasNonText: hasNonText,
      textContentNoGutter: tc,
      blockContainers: blocks,
      gutterStripped: w.gutter,
      outerHTML: pre.outerHTML,
    });
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/page-collect-code.test.mjs`
Expected: 全部 PASS。若「块间空白」用例因 jsdom 序列化空白差异失败，调整夹具 HTML 为单行书写（`<span…>a</span>\n<span…></span>\n<span…>b</span>` 之间恰一个换行文本节点），断言不变。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-collect-code.js test/unit/page-collect-code.test.mjs
git commit -m "feat(collect-code): styled 趟收集——walkLines 行重建 + 层 1 槽排除"
```

---

### Task 4: `page-fold-code.js` 折叠脚本

**Files:**
- Create: `script/lib/page-fold-code.js`
- Test: `test/unit/page-fold-code.test.mjs`

**Interfaces:**
- Consumes: 无（纯 DOM 操作）。
- Produces: `__u2mFoldCode(resultByDataIdx)`——`resultByDataIdx: { [dataIdx]: { k: number, status: 'ok'|'failed', lines: number, lang: string } }`。ok → `data-language` 提升 + 子树清空 + `{{CODE_k|lines_lines}}` 文本节点；failed → `data-u2m-code="fail"` 保 live。Task 5 在 `__u2mFoldTables` 之后注入调用。

- [ ] **Step 1: 写失败测试**

创建 `test/unit/page-fold-code.test.mjs`（镜像 `page-fold-tables.test.mjs` 的 jsdom 模式）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-fold-code.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFoldCode', () => {
  assert.ok(src().includes('function __u2mFoldCode'));
});

function run(html, resultByDataIdx) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'resultByDataIdx', 'return (' + src() + ')(resultByDataIdx)');
  fn(dom.window.document, resultByDataIdx);
  return dom.window.document;
}

test('成功块折叠为 {{CODE_k|n_lines}}——data-language 提升、子树清空', () => {
  const doc = run(
    `<pre data-idx="10"><code data-language="tsx" data-idx="11"><span data-idx="12">system:</span> \`...\`</code></pre>`,
    { 10: { k: 1, status: 'ok', lines: 22, lang: 'tsx' } });
  const pre = doc.querySelector('pre[data-idx="10"]');
  assert.equal(pre.textContent, '{{CODE_1|22_lines}}');
  assert.equal(pre.children.length, 0, '子树清空');
  assert.equal(pre.getAttribute('data-language'), 'tsx', 'lang 提升到 pre');
});

test('lang 来自 class 推断（无 data-language）时也提升', () => {
  const doc = run(
    `<pre data-idx="20"><code class="language-python" data-idx="21">x = 1</code></pre>`,
    { 20: { k: 2, status: 'ok', lines: 1, lang: 'python' } });
  assert.equal(doc.querySelector('pre[data-idx="20"]').getAttribute('data-language'), 'python');
});

test('失败块保 live + data-u2m-code=fail', () => {
  const doc = run(
    `<pre data-idx="30"><code data-idx="31"><img src="x"></code></pre>`,
    { 30: { k: 3, status: 'failed', lines: 1, lang: '' } });
  const pre = doc.querySelector('pre[data-idx="30"]');
  assert.equal(pre.getAttribute('data-u2m-code'), 'fail');
  assert.ok(pre.querySelector('img'), '子树保留');
});

test('!parentNode / [hidden] / map 未命中均跳过折叠与标记', () => {
  const doc = run(
    `<div><pre data-idx="40"><code data-idx="41">kept</code></pre></div>
     <pre data-idx="50" hidden><code data-idx="51">hidden</code></pre>
     <pre data-idx="60"><code data-idx="61">unmapped</code></pre>`,
    {});
  doc.querySelector('div').removeChild(doc.querySelector('pre[data-idx="40"]')); // detach
  const p40 = doc.querySelector('pre[data-idx="40"]');
  const p50 = doc.querySelector('pre[data-idx="50"]');
  const p60 = doc.querySelector('pre[data-idx="60"]');
  assert.ok(!p40.textContent.includes('{{CODE'), 'detached 跳过');
  assert.ok(!p50.textContent.includes('{{CODE'), 'hidden 跳过（K5 独占）');
  assert.equal(p50.getAttribute('data-u2m-code'), null, 'hidden 不打标记');
  assert.equal(p60.textContent, 'unmapped', 'map 未命中不动');
  assert.equal(p60.getAttribute('data-u2m-code'), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/page-fold-code.test.mjs`
Expected: FAIL——ENOENT。

- [ ] **Step 3: 实现**

创建 `script/lib/page-fold-code.js`：

```js
// script/lib/page-fold-code.js
// styled 趟折叠 pass：在 __u2mFoldTables 之后执行（被成功表格吸收的 pre 已
// detach，!parentNode 守卫自然跳过；含 pre 的表本就因嵌套块级内容判 failed
// 保 live）。ok → data-language 提升 + 清空子树 + {{CODE_k|n_lines}} 文本
// 节点（n_lines 取 2_code.json 修剪后行数）；failed → 保 live、打
// data-u2m-code="fail"（诊断 + 步骤 7 信号；样式剥离由步骤 5 现有
// closest('pre') 分支覆盖）。与 clean 趟 K7 的 map 折叠同形、k 一致。
function __u2mFoldCode(resultByDataIdx) {
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue; // K5 独占
    var r = resultByDataIdx[pre.getAttribute('data-idx') || ''];
    if (r && r.status === 'ok') {
      if (r.lang && !pre.hasAttribute('data-language')) {
        pre.setAttribute('data-language', r.lang);
      }
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{CODE_' + r.k + '|' + r.lines + '_lines}}'));
    } else if (r) {
      pre.setAttribute('data-u2m-code', 'fail');
    }
    // map 未命中：不动（防御——编排层保证全部收集）
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/page-fold-code.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-fold-code.js test/unit/page-fold-code.test.mjs
git commit -m "feat(fold-code): styled 趟代码块折叠——ok 占位符 / failed 保 live 标记"
```

---

### Task 5: 步骤 2 编排接线 + K7 map 驱动折叠

**Files:**
- Modify: `script/lib/page-clean-snapshot.js:360-367`（styled 分支调用 `__u2mCollectCode`、return 增 `codes`）
- Modify: `script/lib/page-clean-snapshot.js:526-542`（K7 重写为 map 驱动）
- Modify: `script/clean_snapshot.mjs`（注入/转换/折叠/emit，见 Step 3）
- Test: `test/unit/clean-snapshot.test.mjs`（改 K7 系列断言 + 新增用例）

**Interfaces:**
- Consumes: Task 1 `convertCodes`、Task 3 `__u2mCollectCode`、Task 4 `__u2mFoldCode`。
- Produces: 步骤 2 emit 增 `codes: { total, ok, failed }` 与 `codeJson: <2_code.json 绝对路径>`；产物 `2_code.json`（schema 见 spec §4.2）与 `logs/codes/`。clean evaluate 的 cfg 增 `codeFold: { [dataIdx]: { k, lines, lang } }`。

- [ ] **Step 1: 写失败测试**

`test/unit/clean-snapshot.test.mjs` 末尾追加（复用文件顶部 `runClean` 基座）：

```js
test('CODE 占位符：shiki 形态两版折叠 + 2_code.json + emit 计数', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <pre data-idx="2"><code data-idx="3" data-language="javascript"><span data-idx="4">const</span> a = 1;
<span data-idx="5">const</span> b = <span data-idx="6">2</span>;</code></pre>
    <p data-idx="7">正文段落</p>
  </div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'code-ph-shiki');
  try {
    assert.equal(out.codes.total, 1);
    assert.equal(out.codes.ok, 1);
    assert.equal(out.codes.failed, 0);
    assert.ok(fs.existsSync(out.codeJson));
    const cj = JSON.parse(fs.readFileSync(out.codeJson, 'utf8'));
    assert.equal(cj['1'].status, 'ok');
    assert.equal(cj['1'].lang, 'javascript');
    assert.equal(cj['1'].content, 'const a = 1;\nconst b = 2;');
    assert.equal(cj['1'].lines, 2);
    // 两版同形折叠（clean 恒折、styled ok 折）、data-language 提升
    assert.ok(/<pre[^>]*data-idx="2"[^>]*data-language="javascript"[^>]*>\{\{CODE_1\|2_lines\}\}<\/pre>/.test(cleaned));
    assert.ok(/<pre[^>]*data-idx="2"[^>]*data-language="javascript"[^>]*>\{\{CODE_1\|2_lines\}\}<\/pre>/.test(styled));
    assert.ok(!cleaned.includes('data-idx="3"'), 'clean 版 pre 内 id 随折叠消失');
  } finally { cleanup(); }
});

test('CODE 占位符：ra 形态（grid 行容器零 \\n）行数修正——不再塌缩为 1', async () => {
  // 行内样式 display:grid——真 chromium 里 computed display 生效
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <pre data-idx="2"><code data-idx="3"><span style="display:grid">system: \`...\`</span><span style="display:grid">const t = 1;</span><span style="display:grid">const u = 2;</span></code></pre>
  </div>
</body></html>`;
  const { out, cleaned, cleanup } = await runClean(snapshot, 'code-ph-ra');
  try {
    assert.equal(out.codes.ok, 1);
    assert.ok(cleaned.includes('{{CODE_1|3_lines}}'), `grid 行容器行数=3（旧 countPreLines 得 1）: ${cleaned.match(/<pre[\s\S]*?<\/pre>/)?.[0]}`);
    const cj = JSON.parse(fs.readFileSync(out.codeJson, 'utf8'));
    assert.equal(cj['1'].content, 'system: `...`\nconst t = 1;\nconst u = 2;');
  } finally { cleanup(); }
});

test('CODE 占位符：失败块 styled 保 live + 标记、clean 恒折叠、日志落盘', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <pre data-idx="2"><code data-idx="3">code <img data-idx="4" src="x.png"> with img</code></pre>
  </div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'code-ph-fail');
  try {
    assert.equal(out.codes.ok, 0);
    assert.equal(out.codes.failed, 1);
    assert.match(styled, /data-u2m-code="fail"/, 'styled 失败块保 live + 标记');
    assert.ok(styled.includes('src="x.png"'), '失败块子树保留');
    assert.ok(cleaned.includes('{{CODE_1|'), 'clean 版恒折叠（含失败块）');
    const logs = fs.readdirSync(path.join(path.dirname(out.codeJson), 'logs', 'codes'));
    assert.equal(logs.length, 1);
    assert.ok(fs.readFileSync(path.join(path.dirname(out.codeJson), 'logs', 'codes', logs[0]), 'utf8').includes('reason: non_textual'));
  } finally { cleanup(); }
});
```

同时更新既有 K7 系列断言（`test/unit/clean-snapshot.test.mjs` 内 6 处，逐个改）：

1. `test('K7: pre 折叠为 {{PRE_CODE_TAG|N_lines}}——data-language 提升到 pre，行内 code 不动')`：
   - `\{\{PRE_CODE_TAG\|1_lines\}\}` → `\{\{CODE_1\|1_lines\}\}`；
   - 删除 `assert.ok(styled.includes('shiki-token') && styled.includes('import'), '带样式版完整保留代码')`，改为 `assert.ok(styled.includes('{{CODE_1|'), '带样式版 ok 块折叠为 CODE 占位符')`；
   - `assert.ok(!styled.includes('{{PRE_CODE_TAG')` → `assert.ok(!styled.includes('{{PRE_CODE_TAG')` 保留，另加 `assert.ok(styled.includes('data-u2m-code') === false || true)` 删除——直接删掉该行即可（ok 块无标记）。
2. `test('K7: 行数按换行切分——高亮 span 是语法 token 不是行')`：`{{PRE_CODE_TAG|2_lines}}` → `{{CODE_1|2_lines}}`。
3. div 行块兜底用例（编辑器式每行一 div）：`{{PRE_CODE_TAG|3_lines}}` → `{{CODE_1|3_lines}}`（两处：divPerLine 与 containerDiv）。
4. `{{PRE_CODE_TAG|0_lines}}`（空 pre）→ 该块现为 failed：clean 折叠为 `{{CODE_1|0_lines}}`（map lines=收集 lines=0）；styled 断言改为 `assert.match(styled, /data-u2m-code="fail"/)`。
5. `{{PRE_CODE_TAG|3_lines}}`（长文本占位前行数）→ `{{CODE_1|3_lines}}`。
6. `cleaned.includes('{{PRE_CODE_TAG|'` → `cleaned.includes('{{CODE_')`；hidden pre 用例（`不得被 K7 覆盖`）断言不变（hidden 仍由 K5 独占）。

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 新增 3 用例 FAIL（`out.codes` undefined / 占位符形态不符）；既有 K7 用例 FAIL（仍产 PRE_CODE_TAG）。

- [ ] **Step 3: 实现接线**

**3a. `script/lib/page-clean-snapshot.js`**——styled 分支（现 360-367 行）在 `tablesCollected` 之后加：

```js
    // 收集代码块元数据（折叠前、与表格同场——LONG_TEXT 占位已就位）。
    // __u2mCollectCode 由 clean_snapshot.mjs 把 page-collect-code.js 源码拼在
    // 本函数前注入 evaluate 作用域；单独跑本函数时（无注入）退化为空列表。
    var codesCollected = (typeof __u2mCollectCode === 'function') ? __u2mCollectCode() : [];

    return {
      html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
      longTextCount: k,
      longTexts: longTexts,
      tables: tablesCollected,
      codes: codesCollected,
    };
```

**3b. K7 重写**（替换 `page-clean-snapshot.js` 现 526-542 行整段）：

```js
  // K7. pre 折叠（仅清洗版，map 驱动）：codeFold 由 clean_snapshot.mjs 按收集
  //     结果构造（含 failed 条目——clean 无条件折叠全部非 hidden pre，镜像 K6
  //     对表的处理）。map 未命中（防御分支，编排层保证收集全覆盖，理论不可达）
  //     → 退回 {{PRE_CODE_TAG|n_lines}} 局部计数（__u2mPreLines 占位前预计算），
  //     不占 k 编号、不参与还原链。clean 趟 <style> 已删、computed display 退化
  //     为 UA 默认，无法本地重算 walkLines——行数必须来自 styled 趟收集结果
  //     （附带修正：grid 行容器形态不再塌缩为 1 行）。
  //     带 hidden 的 pre 由 K5 独占折叠（其折叠 token 已就位），跳过防二次覆盖
  var codeFold = cfg.codeFold || {};
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    if (pre.hasAttribute('hidden')) continue;
    var langShell = pre.querySelector('code[data-language]');
    if (langShell && !pre.hasAttribute('data-language')) {
      pre.setAttribute('data-language', langShell.getAttribute('data-language'));
    }
    var fr = codeFold[pre.getAttribute('data-idx') || ''];
    if (fr) {
      if (fr.lang && !pre.hasAttribute('data-language')) {
        pre.setAttribute('data-language', fr.lang);
      }
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{CODE_' + fr.k + '|' + fr.lines + '_lines}}'));
    } else {
      var lines = pre.__u2mPreLines;
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(document.createTextNode('{{PRE_CODE_TAG|' + lines + '_lines}}'));
    }
  }
```

**3c. `script/clean_snapshot.mjs`**：

import 区加：

```js
import { convertCodes } from './lib/code2md.js';
```

`readSharedScript` 区（现 108-110 行）加两行：

```js
  const collectCodeFn = await readSharedScript('page-collect-code.js');
  const foldCodeFn = await readSharedScript('page-fold-code.js');
```

styled evaluate（现 123 行）改为：

```js
    const styledEvalSrc = `${collectTablesFn}\n${collectCodeFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'styled' })})`;
```

表格转换之后（现 138 行 `resultByDataIdx` 构造后）插入：

```js
    // ── Node 层代码块转换：七类校验 + 序号剥离 + 序列化 → 2_code.json + 日志 ──
    const { codes: codesJson, counts: codeCounts } = await convertCodes(
      styled.codes || [], { longTextMap, logsDir: path.join(dir, 'logs', 'codes') });
    const codeJsonPath = path.join(dir, '2_code.json');
    await fsPromises.writeFile(codeJsonPath, JSON.stringify(codesJson, null, 2), 'utf8');

    // styled fold 映射 + clean 趟 codeFold 映射（clean 恒折叠含 failed——
    // 行数：ok 取 JSON 修剪后行数，failed 取收集原始行数）
    const codeResultByDataIdx = {};
    const codeFold = {};
    for (const c of styled.codes || []) {
      const r = codesJson[String(c.k)];
      codeResultByDataIdx[c.dataIdx] = {
        k: c.k, status: r.status, lines: r.lines, lang: r.lang,
      };
      codeFold[c.dataIdx] = {
        k: c.k,
        lines: r.status === 'ok' ? r.lines : c.lines,
        lang: r.status === 'ok' ? r.lang : c.lang,
      };
    }
```

fold 区（现 142 行 foldTables 之后）加：

```js
    await page.evaluate(`(${foldCodeFn})(${JSON.stringify(codeResultByDataIdx)})`);
```

clean evaluate（现 152 行）改为：

```js
    const clean = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ mode: 'clean', codeFold })})`);
```

debug/log 行（现 157-158 行）追加代码计数（在两行末尾各接一段）：

```js
    debug(`[clean] … · 代码块 ${codeCounts.ok}ok/${codeCounts.failed}fail`);
    log(`清洗完成: …, 代码块 ${codeCounts.total} 个: ${codeCounts.ok} 成功 ${codeCounts.failed} 失败)`);
```

（保持原表格文案不动，仅在同句追加；具体接法按现有字符串拼接。）

emit（现 163-171 行）对象内追加两项（`tablesJson` 之后）：

```js
      codes: codeCounts,
      codeJson: codeJsonPath,
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 全部 PASS（含改写的 K7 系列）。

- [ ] **Step 5: 跑全部单测确认无回归**

Run: `pnpm test`
Expected: 除 `clean-snapshot-golden.test.mjs`（golden 尚未重生，Task 9 处理）外全部 PASS。若 golden 失败是预期内，记录输出；其余失败必须修复。

- [ ] **Step 6: Commit**

```bash
git add script/clean_snapshot.mjs script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat(step2): 代码块收集/转换/折叠接线——K7 改 map 驱动，{{CODE_k|n_lines}} 取代 PRE_CODE_TAG"
```

---

### Task 6: 步骤 8 CODE 还原

**Files:**
- Modify: `script/screenshot_trans.mjs:215-236`（TABLE 还原之后插入 CODE 阶段）
- Test: `test/unit/screenshot-trans.test.mjs`（追加）

**Interfaces:**
- Consumes: `2_code.json` schema（spec §4.2）。
- Produces: emit 增 `codesResolved: number`、`failedCodes: string[]`（失败不阻断）；`8_resolved_skeleton.json` 中 code 条目 value 从 `"{{CODE_k}}"` 物化为 `{ lang, content }`。

- [ ] **Step 1: 写失败测试**

`test/unit/screenshot-trans.test.mjs` 末尾追加（该文件已有 `runScript`/`urlToDirName` import 与 SNAPSHOT 常量；复用文件内既有 setup 模式——若无通用 setup 函数则按文件内既有用例的目录准备方式手写）：

```js
// CODE 还原：准备最小工作目录（1_snapshot + 2_long_text + 2_code + 3_key_ids
// + 7_skeleton，无 trans2img/img 条目——浏览器阶段不触发）
import { setupCodeRestore } from './helpers/code-restore.mjs';

test('screenshot_trans: {{CODE_k}} 字符串引用整体物化为 {lang, content}（lang 取 JSON）', async () => {
  const { tmpRoot, url } = setupCodeRestore('strref', [
    { code: '{{CODE_1}}' },
    { p: '段落' },
    { code: { lang: 'wrong', content: '{{CODE_2}}' } },   // 对象形态兼容 + lang 覆写
    { code: { lang: 'python', content: 'print(1)' } },     // LLM 自转不动
    { code: '{{CODE_9}}' },                                 // 未定义 k → failedCodes
    { code: { lang: 'js', content: 'const x = "{{CODE_1}} inline"' } }, // 中段子串不替换
  ]);
  try {
    const r = await runScript(process.execPath,
      [path.resolve('script/screenshot_trans.mjs'), '--url', url],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.codesResolved, 2);
    assert.deepEqual(out.failedCodes, ['9']);
    const resolved = JSON.parse(fs.readFileSync(out.resolvedSkeleton, 'utf8'));
    assert.deepEqual(resolved[0].code, { lang: 'javascript', content: 'const a = 1;\nconst b = 2;' });
    assert.deepEqual(resolved[2].code, { lang: 'tsx', content: 'system: `...`' }, '对象形态替换 content 且 lang 覆写');
    assert.deepEqual(resolved[3].code, { lang: 'python', content: 'print(1)' }, '自转条目不动');
    assert.equal(resolved[4].code, '{{CODE_9}}', '未定义 k 保留字面');
    assert.equal(resolved[5].code.content, 'const x = "{{CODE_1}} inline"', '中段子串不替换（精确匹配语义）');
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});
```

同时创建 `test/helpers/code-restore.mjs`（测试专用基座）：

```js
// CODE 还原测试基座：准备最小工作目录（1_snapshot + 2_long_text + 2_code +
// 3_key_ids + 7_skeleton）。无 trans2img/img 条目——步骤 8 浏览器阶段不触发。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { urlToDirName } from '../../script/lib/env.mjs';

export function setupCodeRestore(name, skeleton) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-coderestore-${name}-`));
  const url = `https://example.com/code-restore-${name}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    '<!DOCTYPE html><html><head><title>t</title></head><body><h1 data-idx="1">t</h1></body></html>');
  fs.writeFileSync(path.join(dir, '2_long_text.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(dir, '2_code.json'), JSON.stringify({
    1: { dataIdx: '10', lang: 'javascript', content: 'const a = 1;\nconst b = 2;', status: 'ok', lines: 2, gutterStripped: false },
    2: { dataIdx: '20', lang: 'tsx', content: 'system: `...`', status: 'ok', lines: 1, gutterStripped: false },
    9: { dataIdx: '90', lang: '', content: null, status: 'failed', reason: 'non_textual', lines: 1, gutterStripped: false },
  }, null, 2));
  fs.writeFileSync(path.join(dir, '3_key_ids.json'),
    JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [], dumpIds: [] }));
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify(skeleton, null, 2));
  return { tmpRoot, url, dir };
}
```

（若 `screenshot-trans.test.mjs` 顶部缺 `runScript`/`path`/`fs` import 则补齐——该文件现有用例已全部具备。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 新用例 FAIL——`out.codesResolved` undefined（CLI 尚无 CODE 阶段），或 `resolved[0].code` 仍为字符串。

- [ ] **Step 3: 实现**

`script/screenshot_trans.mjs`——TABLE 还原块之后、`await fsPromises.writeFile(resolvedPath, …)`（现 236 行）之前插入：

```js
  // ── {{CODE_k}} 还原（TABLE 之后）——精确匹配：只处理 code 键整体引用形态，
  //    与 TABLE 的子串扫描有意分叉（代码内容字面含 {{CODE_n}} 是真实场景——
  //    介绍本管线的文档，子串替换会跨块错替）。两种形态：
  //    字符串 "{{CODE_k}}" → 整体物化为 {lang, content}；对象 {content: "{{CODE_k}}"}
  //    → 替换 content + lang 覆写。lang 一律取 2_code.json 值（data-language
  //    收集链结果，权重高于 LLM 猜测）。缺失/failed k 保留字面、记 failedCodes
  //    （不阻断；残留由步骤 9 守卫响亮报错）──
  const codesJsonPath = path.join(dir, '2_code.json');
  const codesJson = fs.existsSync(codesJsonPath)
    ? JSON.parse(await fsPromises.readFile(codesJsonPath, 'utf8'))
    : {};
  const CODE_REF_RE = /^\{\{CODE_(\d+)\}\}$/;
  const failedCodes = [];
  let codesResolved = 0;
  for (const entry of resolvedSkeleton) {
    const key = Object.keys(entry)[0];
    if (key !== 'code') continue;
    const val = entry[key];
    const ref = typeof val === 'string'
      ? CODE_REF_RE.exec(val)
      : (val && typeof val === 'object' && typeof val.content === 'string'
        ? CODE_REF_RE.exec(val.content) : null);
    if (!ref) continue;
    const c = codesJson[ref[1]];
    if (c && c.status === 'ok' && c.content != null) {
      codesResolved++;
      if (typeof val === 'string') entry[key] = { lang: c.lang || '', content: c.content };
      else { val.content = c.content; val.lang = c.lang || ''; }
    } else {
      failedCodes.push(ref[1]);
    }
  }
```

同文件 emit 调用对象内追加（`failedTables` 同级）：

```js
    codesResolved,
    failedCodes,
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs test/helpers/code-restore.mjs
git commit -m "feat(step8): {{CODE_k}} 精确匹配还原——字符串引用物化 + lang 以 JSON 覆写"
```

---

### Task 7: 步骤 9 残留守卫 + 自适应围栏

**Files:**
- Modify: `script/render_skeleton.mjs:72-77`（code case 重写）
- Test: `test/unit/render-skeleton.test.mjs`（追加）

**Interfaces:**
- Consumes: 步骤 8 物化后的 `code` 条目 `{ lang, content }`。
- Produces: code 条目 → 自适应围栏 markdown；value 仍为字符串（含 `{{CODE_`）时 error 退出（exit 1，reason 提示步骤 8）。

- [ ] **Step 1: 写失败测试**

`test/unit/render-skeleton.test.mjs` 末尾追加（复用文件内 `setup`/`URL`）：

```js
test('render_skeleton: 围栏 backtick 自适应——内容含 ``` 时用 4 重围栏', async () => {
  const { tmpRoot } = setup('fence3', { resolved: [
    { code: { lang: 'md', content: '外层\n```\ninner fence\n```\n结尾' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  assert.equal(md, '````md\n外层\n```\ninner fence\n```\n结尾\n````\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: 内容含 ```` 时用 5 重围栏；反引号结尾安全', async () => {
  const { tmpRoot } = setup('fence4', { resolved: [
    { code: { lang: '', content: 'a\n````\nb`' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  assert.equal(md, '`````\na\n````\nb`\n`````\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: lang 清洗——反引号/换行剥离（js`+换行+x → jsx）', async () => {
  const { tmpRoot } = setup('langsan', { resolved: [
    { code: { lang: 'js`\nx', content: 'y' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  // 'js`\nx' = j s 反引号 换行 x → 剥离非法字符后 'jsx'
  assert.equal(md, '```jsx\ny\n```\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: code value 仍为字符串（{{CODE_ 残留）报 error 提示步骤 8', async () => {
  const { tmpRoot } = setup('residual', { resolved: [
    { code: '{{CODE_9}}' },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 8'), `reason 应提示步骤 8: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md')), '不应产出 markdown');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

（lang 清洗用例中那行链式 replace 是演示笔误风险的坏味道——直接断言 `assert.equal(md, '```js\ny\n```\n')`：`'js`\nx'` 剥离非法字符后为 `jsx`？不——`js\`\nx` = `js` + 反引号 + 换行 + `x`，剥离 `` ` ``/换行后为 `jsx`，围栏行是 ` ```jsx `。写测试时用这个期望值。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/render-skeleton.test.mjs`
Expected: 围栏用例 FAIL（现产出 3 重围栏破坏内容/断言不等）；残留用例 FAIL（现 `return null` 静默跳过、exit 0）。

- [ ] **Step 3: 实现**

`script/render_skeleton.mjs`——替换 code case（现 72-77 行）：

```js
    case 'code': {
      // 残留守卫：步骤 8 已把 "{{CODE_k}}" 引用物化为对象；仍为字符串 =
      // 引用了未还原的代码占位符（failedCodes 或步骤 8 未跑）。残留流到最终
      // markdown 是静默损坏的代码块——宁可响亮失败（镜像 trans2img 守卫）。
      if (!value || typeof value !== 'object') {
        throw new Error(
          `code 条目 value 应为 {lang, content} 对象（占位符引用由步骤 8 物化），实际为: ${JSON.stringify(value)}——引用了未还原的代码占位符，请先运行步骤 8 / 按步骤 7 指南修正 7_skeleton.json`
        );
      }
      // lang 来自 data-language 属性链，可能携垃圾字符（反引号/换行会破坏围栏
      // 首行）——剥离非法字符，空则裸围栏
      const lang = String(value.lang || '').replace(/[^a-zA-Z0-9._+-]/g, '');
      const content = String(value.content || '');
      // GFM 围栏安全：围栏严格长于内容中任何反引号连续串即不可被内容闭合；
      // 内容以反引号结尾亦无碍（换行 + 更长围栏）。对 LLM 自转路径同样生效。
      const maxRun = (content.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
      const fence = '`'.repeat(Math.max(3, maxRun + 1));
      return `${fence}${lang}\n${content}\n${fence}`;
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/render-skeleton.test.mjs`
Expected: 全部 PASS（既有 `RESOLVED` 基座用例的 `blocks[9]/blocks[10]` 断言不受影响——无反引号内容仍产 3 重围栏）。

- [ ] **Step 5: Commit**

```bash
git add script/render_skeleton.mjs test/unit/render-skeleton.test.mjs
git commit -m "feat(step9): 残留 {{CODE_ 守卫 + 围栏 backtick 自适应 + lang 清洗"
```

---

### Task 8: 多形态夹具 + 全链路集成测试

**Files:**
- Create: `test/fixtures/code-blocks.html`（snapshot 形态——data-idx 已打）
- Create: `test/integration/code-pipeline.test.mjs`

**Interfaces:**
- Consumes: Task 1-7 全部（真 CLI 子进程链）。
- Produces: 无（验证性任务）。

- [ ] **Step 1: 写夹具**

创建 `test/fixtures/code-blocks.html`（12 块，data-idx 按文档序；k 编号跳过 hidden 块 b10）：

```html
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>代码块形态测试</title>
<style>
  .grid-line { display: grid; }
  .lns span, .ln { user-select: none; }
  .narrow { white-space: pre-wrap; width: 120px; }
</style></head>
<body>
  <h1 data-idx="1">代码块形态测试</h1>

  <!-- b1 (k=1) shiki 形态：inline 行 span + 真实 \n，data-language -->
  <pre data-idx="2"><code data-language="javascript" data-idx="3"><span data-idx="4">import</span> OpenAI;
<span data-idx="5">const</span> client = <span data-idx="6">1</span>;</code></pre>

  <!-- b2 (k=2) ra 形态：grid 行容器零 \n + 超阈值中文注释（触发 LONG_TEXT 预展开）+ language-* class -->
  <pre data-idx="10"><code class="ra-code language-tsx" data-idx="11"><span class="grid-line" data-idx="12"><span class="cjk-comment" data-idx="13">这是一条超过十六个汉字阈值的中文注释行内容</span></span><span class="grid-line" data-idx="14">system: <span data-idx="15">`...`</span></span><span class="grid-line" data-idx="16">const t = 1;</span></code></pre>

  <!-- b3 (k=3) OpenAI 槽形态：user-select:none 数字列 + <!-- --> 注释节点，data-language=json -->
  <pre data-idx="20"><code data-language="json" data-idx="21"><span class="lns" data-idx="22"><span class="ln" data-idx="23">1<!-- -->
</span><span class="ln" data-idx="24">2<!-- -->
</span></span><span data-idx="25">{</span>
<span data-idx="26">  "model": "gpt-5.6"</span>
<span data-idx="27">}</span></code></pre>

  <!-- b4 (k=4) 行首内联序号：层 2 剥离 -->
  <pre data-idx="30"><code data-idx="31">1. alpha
2. beta
3. gamma</code></pre>

  <!-- b5 (k=5) yaml 数字键后跟普通行：层 2 不剥 -->
  <pre data-idx="40"><code class="language-yaml" data-idx="41">1: a
2: b
foo: bar</code></pre>

  <!-- b6 (k=6) non_textual：pre 内嵌 img -->
  <pre data-idx="50"><code data-idx="51">code <img data-idx="52" src="x.png"> with img</code></pre>

  <!-- b7 (k=7) 空 pre：empty -->
  <pre data-idx="60"><code data-idx="61">   </code></pre>

  <!-- b8 (k=8) pre-wrap 真单行：single_line_suspect（渲染多行、结构 1 行） -->
  <pre class="narrow" data-idx="70"><code data-idx="71">this is one logical line that soft wraps visually across several rendered lines</code></pre>

  <!-- b9 (k=9) 内容含 ``` 与字面 {{CODE_2}}：围栏安全 + 精确匹配 -->
  <pre data-idx="80"><code class="language-markdown" data-idx="81">outer
```
inner fence
```
ref {{CODE_2}} inline</code></pre>

  <!-- b10 hidden pre：K5 独占，不占 k -->
  <div hidden data-idx="90"><pre data-idx="91"><code data-idx="92">hidden code</code></pre></div>

  <!-- b11 (k=10) br 分行 -->
  <pre data-idx="100"><code data-idx="101">alpha<br>beta<br>gamma</code></pre>

  <!-- b12 (k=11) 复制保护整块：user-select:none 非数字内容，层 1 不杀 -->
  <pre style="user-select:none" data-idx="110"><code data-idx="111">protected const a = 1;
protected const b = 2;</code></pre>

  <p data-idx="120">正文段落。</p>
</body></html>
```

**注意**：b3 内的 `<!-- -->` 在 HTML 源文件里是真实注释节点——写夹具时保留字面 `<!-- -->` 文本。

- [ ] **Step 2: 写集成测试**

创建 `test/integration/code-pipeline.test.mjs`（镜像 `table-pipeline.test.mjs` 基座）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

async function runClean(tmpRoot, url) {
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    fs.readFileSync(path.resolve('test/fixtures/code-blocks.html')));
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  return { r, dir };
}

const URL = 'https://example.com/code-blocks';

test('代码管线：2_code.json 各形态判定与内容（spec §6.3 验收基准）', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r, dir } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    // 11 个非 hidden pre：b6 non_textual、b7 empty、b8 single_line_suspect 失败
    assert.equal(out.codes.total, 11);
    assert.equal(out.codes.ok, 8);
    assert.equal(out.codes.failed, 3);

    const cj = JSON.parse(fs.readFileSync(path.join(dir, '2_code.json'), 'utf8'));
    // b1 shiki：ok、lang、两行
    assert.equal(cj['1'].status, 'ok');
    assert.equal(cj['1'].lang, 'javascript');
    assert.equal(cj['1'].content, 'import OpenAI;\nconst client = 1;');
    // b2 ra：grid 行重建 + LONG_TEXT 预展开（中文注释原文回归）
    assert.equal(cj['2'].status, 'ok');
    assert.equal(cj['2'].lang, 'tsx');
    assert.ok(cj['2'].content.startsWith('这是一条超过十六个汉字阈值的中文注释行内容\nsystem: `...`\nconst t = 1;'),
      `ra 形态内容: ${cj['2'].content}`);
    // b3 槽：gutterStripped、序号零贡献
    assert.equal(cj['3'].status, 'ok');
    assert.equal(cj['3'].gutterStripped, true);
    assert.equal(cj['3'].content, '{\n  "model": "gpt-5.6"\n}');
    // b4 内联序号：numberStripped
    assert.equal(cj['4'].status, 'ok');
    assert.equal(cj['4'].numberStripped, true);
    assert.equal(cj['4'].content, 'alpha\nbeta\ngamma');
    // b5 yaml：不剥
    assert.equal(cj['5'].status, 'ok');
    assert.equal(cj['5'].content, '1: a\n2: b\nfoo: bar');
    assert.ok(!cj['5'].numberStripped);
    // b6/b7/b8 失败原因
    assert.equal(cj['6'].reason, 'non_textual');
    assert.equal(cj['7'].reason, 'empty');
    assert.equal(cj['8'].reason, 'single_line_suspect');
    // b9 围栏素材：ok、字面 {{CODE_2}} 保留在内容里
    assert.equal(cj['9'].status, 'ok');
    assert.ok(cj['9'].content.includes('{{CODE_2}} inline'));
    // b11 br 分行
    assert.equal(cj['10'].content, 'alpha\nbeta\ngamma');
    // b12 复制保护：层 1 不杀
    assert.equal(cj['11'].status, 'ok');
    assert.equal(cj['11'].content, 'protected const a = 1;\nprotected const b = 2;');
    // 失败诊断日志：3 份
    assert.equal(fs.readdirSync(path.join(dir, 'logs', 'codes')).length, 3);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('代码管线：styled ok 折 / failed live，clean 恒折，k 对齐，data-language 提升', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
    const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
    assert.equal((styled.match(/\{\{CODE_\d+\|\d+_lines\}\}/g) || []).length, 8, '8 ok 块折叠');
    assert.equal((styled.match(/data-u2m-code="fail"/g) || []).length, 3, '3 失败块保 live');
    assert.equal((cleaned.match(/\{\{CODE_\d+\|\d+_lines\}\}/g) || []).length, 11, 'clean 恒折叠（含失败）');
    // k 对齐：hidden 块 b10 不占号——b11（br 分行块）是 k=10
    assert.match(cleaned, /<pre[^>]*data-idx="100"[^>]*>\{\{CODE_10\|3_lines\}\}/, 'br 块 k=10（hidden 不占号）');
    // data-language 提升（b1 本就在 code 上）
    assert.match(cleaned, /<pre[^>]*data-idx="10"[^>]*data-language="tsx"[^>]*>/, 'b2 lang 从 class 提升到 pre');
    // 失败块子树在 styled 保留
    assert.ok(styled.includes('src="x.png"'), 'b6 img 保留在 styled');
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('代码管线：步骤 8 精确匹配还原 + 步骤 9 自适应围栏（端到端）', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r, dir } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    fs.writeFileSync(path.join(dir, '3_key_ids.json'),
      JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [120], dumpIds: [] }));
    fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
      { h1: '# 代码块形态测试' },
      { code: '{{CODE_1}}' },
      { code: '{{CODE_9}}' },                                    // 内容含 ``` 与字面 {{CODE_2}}
      { code: { lang: 'wrong', content: 'protected const a = 1;\nprotected const b = 2;' } }, // LLM 自转（b12）
      { p: '正文段落。' },
    ], null, 2));
    const r8 = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', URL],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r8.code, 0, `stderr: ${r8.stderr}`);
    const out8 = JSON.parse(r8.stdout);
    assert.equal(out8.codesResolved, 2);
    assert.deepEqual(out8.failedCodes, []);
    const resolved = JSON.parse(fs.readFileSync(out8.resolvedSkeleton, 'utf8'));
    assert.deepEqual(resolved[1].code, { lang: 'javascript', content: 'import OpenAI;\nconst client = 1;' });
    // b9 的字面 {{CODE_2}} 不被误替换（2_code.json 里 2 号存在）
    assert.ok(resolved[2].code.content.includes('{{CODE_2}} inline'));
    const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', URL],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
    const md = fs.readFileSync(JSON.parse(r9.stdout).markdownPath, 'utf8');
    // b9 内容含 ``` → 4 重围栏
    assert.ok(md.includes('````markdown\nouter\n```\ninner fence\n```\nref {{CODE_2}} inline\n````'),
      `b9 应 4 重围栏: ${md}`);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: 运行确认通过（先失败后调夹具）**

Run: `node --test test/integration/code-pipeline.test.mjs`
Expected: 首跑可能因夹具细节（空白/样式计算差异）失败——按失败输出微调**夹具或断言**（如 b2 的 grid 类是否命中、b8 是否真软换行渲染 >1 行——`width:120px` 下长句应折 ≥2 行）。核心断言（形态判定、k 对齐、还原、围栏）不得放松。最终全部 PASS。

- [ ] **Step 4: 跑全部测试**

Run: `pnpm test && pnpm run test:integration`
Expected: 除 `clean-snapshot-golden.test.mjs`（Task 9 重生）外全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/code-blocks.html test/integration/code-pipeline.test.mjs
git commit -m "test(code): 多形态夹具 + 全链路集成——形态判定/k 对齐/还原/围栏"
```

---

### Task 9: golden 重生 + 指南与文档同步

**Files:**
- Modify: `test/fixtures/golden/article-1.styled.html`、`test/fixtures/golden/article-1.longtext.json`、`test/fixtures/golden/clean-simplify.styled.html`、`test/fixtures/golden/clean-simplify.longtext.json`（重生）
- Modify: `references/markdown_skeleton_guide.md`、`references/analyze_html_guide.md`、`SKILL.md`、`CLAUDE.md`、`docs/design/url-to-markdown-design.md`、`.docs/2026-08-29-code-block-placeholder-design.md`、`test/smoke/SMOKE.md`

**Interfaces:**
- Consumes: Task 1-8 完成的管线。
- Produces: 文档与 golden 与实现一致。

- [ ] **Step 1: 重生 golden**

```bash
for name in article-1 clean-simplify; do
  tmp=$(mktemp -d)
  dir="$tmp/$(node -e "console.log(require('./script/lib/env.mjs').urlToDirName('https://example.com/$name'))" 2>/dev/null || echo '')"
  mkdir -p "$dir"
  cp "test/fixtures/$name.html" "$dir/1_snapshot.html"
  U2M_WORKING_ROOT="$tmp" node script/clean_snapshot.mjs --url "https://example.com/$name"
  cp "$(U2M_WORKING_ROOT="$tmp" node -e "console.log('')" ; echo "$dir")/2_clean_style_snapshot.html" "test/fixtures/golden/$name.styled.html"
  cp "$dir/2_long_text.json" "test/fixtures/golden/$name.longtext.json"
  rm -rf "$tmp"
done
node --test test/unit/clean-snapshot-golden.test.mjs
```

（`env.mjs` 是 ESM——`urlToDirName` 直接用 `node --input-type=module -e "import {urlToDirName} from './script/lib/env.mjs'; console.log(urlToDirName('…'))"` 调用；或手写目录名 `example.com_$name`。重生后 `git diff test/fixtures/golden/` 逐字节审查：预期变化 = pre 折叠为 `{{CODE_k|n_lines}}`，无其他漂移。）

- [ ] **Step 2: 修订两指南**

`references/analyze_html_guide.md`——占位符 token 速览表：`{{PRE_CODE_TAG|N_lines}}` → `{{CODE_k|N_lines}}`（编号 + 行数语义；ok/failed 在清洗版同为占位符，标 paragraphIds 方式与表格占位符一致）。

`references/markdown_skeleton_guide.md`——code 分派节追加：

```markdown
#### 代码块：`{{CODE_k|N_lines}}` 占位符（预计算还原）

`6_article.html` 中 `<pre>` 含 `{{CODE_k|N_lines}}` 占位符时，产出引用条目——
**不要自转占位符块的代码内容**（预计算 JSON 是唯一事实源，转录会引入抄写错误）：

```json
{ "code": "{{CODE_3}}" }
```

- 剥掉 `|N_lines` 后缀，裸编号引用；每个 `{{CODE_k}}` 恰用一次（同 LONG_TEXT 约定）。
- `lang` 无需填写——步骤 8 物化时以快照的 `data-language` 收集值为准。
- 失败块（live 代码、无占位符）照旧自转 `{lang, content}`，lang 优先抄
  `data-language` 属性值。
```

（并清除该文件中 `{{PRE_CODE_TAG}}` 的全部残留提及。）

- [ ] **Step 3: SKILL.md / CLAUDE.md / 设计文档同步**

- `SKILL.md` 步骤 2：产物清单加 `2_code.json` / `logs/codes/`；stdout 字段表加 `codes` / `codeJson`。步骤 7：加一句「`{{CODE_k}}` 占位符块产出 `{"code": "{{CODE_k}}"}` 引用（见骨架指南）」。步骤 8：stdout 字段表加 `codesResolved` / `failedCodes`。
- `CLAUDE.md` 管线大段：步骤 2 描述在表格占位符段之后并列代码块占位符段（收集/七类校验/序号两层防线/双版折叠）；步骤 8 描述补 CODE 还原（LONG_TEXT → TABLE → CODE、精确匹配）；步骤 9 描述补自适应围栏与残留守卫；「测试须知」无改动。
- `docs/design/url-to-markdown-design.md`：§6 步骤 2 脚本设计与 §8 分派表补 code 占位符（对齐表格占位符当时的同步方式）。
- `.docs/2026-08-29-code-block-placeholder-design.md` 头部状态行后加：

```markdown
- **2026-09-02：已被取代（二次）**——正式设计与实施见
  `docs/superpowers/specs/2026-09-02-code-block-placeholder-design.md`
  （textContent 提取路线被浏览器探针否定：mmh1 形态零 `\n` 塌缩为 1 行；
  改为 computed display 结构化行重建 + fail-closed 校验 + 序号两层防线）
```

- [ ] **Step 4: SMOKE.md 场景**

`test/smoke/SMOKE.md` 追加场景（对齐既有场景条目格式）：

```markdown
### 场景 N：代码块占位符（mmh1.top prompt-cache 文章）

- URL: <mmh1.top prompt-cache 文章地址>
- 预期：步骤 2 emit `codes` 全 ok（≥2 块）；`9_markdown.md` 代码块换行与
  原 LLM 语义重建结果逐字一致；OpenAI prompt-caching 页：14 块全 ok、
  9 块 gutterStripped、`  "model"` 两格缩进保留。
```

- [ ] **Step 5: 全量验证 + 参考站验收**

```bash
pnpm test && pnpm run test:integration
```

Expected: 全部 PASS（含 golden）。

参考站验收（spec §12.4，需网络与登录态，手动执行）：

```bash
U2M_DEBUG=1 node script/snapshot.mjs --url <openai-prompt-caching-url>
node script/clean_snapshot.mjs --url <openai-prompt-caching-url>
# 检查 2_code.json：14 块 ok、9 块 gutterStripped、pre 2874 内容以 { 开头且 "model" 前有两格缩进
```

mmh1 同理（2 块 ok、内容与既有 7_skeleton.json 的 LLM 重建逐字 diff）。结果记入 SMOKE.md。

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/golden references SKILL.md CLAUDE.md docs/design/url-to-markdown-design.md .docs/2026-08-29-code-block-placeholder-design.md test/smoke/SMOKE.md
git commit -m "docs+golden: 代码块占位符落地同步——指南/SKILL/CLAUDE/设计文档 + golden 重生"
```

---

## Self-Review 记录

- **Spec 覆盖**：§5.1 收集→Task 3；§5.2 转换→Task 1/2；§5.3 styled 折叠→Task 4；§5.4 K7→Task 5；§5.5 编排→Task 5；§6.1 七类校验→Task 1；§6.2 层 2→Task 2（层 1 在 Task 3）；§7 步骤 8→Task 6；§8 步骤 9→Task 7；§9 失败路径（零代码，由 Task 8 集成间接验证 styled live 形态）；§10 指南文档→Task 9；§11 LONG_TEXT 交互→Task 1（预展开）+ Task 8（b2 夹具）；§12 测试→Task 1-8；golden→Task 9。无缺口。
- **占位符扫描**：Task 7 lang 清洗用例中标注了一处笔误风险并给出正确期望值；Task 8 Step 3 声明「夹具微调」边界（断言不放松）；Task 9 Step 1 给出重生命令与 ESM 调用修正说明。无 TBD/「适当处理」类占位。
- **类型一致性**：`convertCodes` 返回形状在 Task 1 定义、Task 5 消费（`codesJson[String(c.k)].status/lines/lang`）；`__u2mFoldCode` 的 map 形状 Task 4 定义 = Task 5 `codeResultByDataIdx` 构造（`{k, status, lines, lang}`）；codeFold map `{k, lines, lang}` 与 K7 消费一致；emit 字段名 `codes/codeJson/codesResolved/failedCodes` 全链一致；占位符语法 `{{CODE_k|N_lines}}` 各任务一致。
