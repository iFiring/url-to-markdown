# 长文本行内 run 整段折叠 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把步骤 2 的长文本折叠单位从「单个文本节点」升级为「极大纯行内 run」（混排段落整段折成一个 `{{LONG_TEXT_k}}`，原文以规范化 HTML 入库），步骤 8 用确定性转换器 `inline2md` 还原行内 Markdown 语法（含 `$…$` 公式）。

**Architecture:** 检测与规范化序列化放在 `page-clean-snapshot.js` 两趟共享段末尾（两趟 DOM 一致 → 孪生守卫由构造保证）；序列化产物是剥净属性的 canonical HTML 片段（span 按 computed style 归一为 strong/em/del，math 压成仅含 annotation 的极简形态）。`2_long_text.json` 分 `texts`（散文本，现状形态）/`runs`（canonical HTML）两段，单一计数器全局编号。步骤 8 `screenshot_trans.mjs` 在纯 Node 阶段把 runs 逐 k 经新模块 `script/lib/inline2md.mjs`（jsdom + 递归下降）转成 markdown 值，与 texts 合并为扁平解析表，`resolveSkeletonString` 零改动。

**Tech Stack:** Node ≥20 ESM、jsdom（已有依赖）、Playwright chromium（既有测试基座）、`node --test`。

**Spec:** `docs/superpowers/specs/2026-09-06-long-text-inline-run-design.md`（含 2026-09-07 自审修订：转义排除 code/math、行首中断符转义、span 固定嵌套顺序）。本计划实现该 spec 全部条目；实现中如与 spec 冲突，以 spec 为准并停下来报告。

## Global Constraints

- **stdout 单行 JSON 契约**：所有 CLI（含 init.sh）stdout 恰好一行 JSON，失败路径也不例外；日志走 stderr，退出码 0/1/2。
- **emit 延迟退出陷阱**：`emit()` 先写行、再在写回调里 `process.exit`，本身同步返回。`usage()`/`emit()` 之后不得有继续执行的代码路径；新 emit 字段加进现有 `emit({...})` 对象，不新增 emit 调用点。
- **共享页面脚本是唯一事实源**：`script/lib/page-*.js` 是普通非模块文件、各含一个具名 `function __u2mXxx(...)`。分类/清洗/序列化逻辑只写在页面脚本里，`.mjs` 编排层不复制该逻辑（`inline2md.mjs` 是 Node 侧序列化器，与 table2md/code2md 同级、不属页面逻辑）。
- 页面脚本风格：ES5 风味（`var`、无箭头函数）、与 `page-clean-snapshot.js` 现有注释密度一致（中文、解释 why）。
- 测试命令：`pnpm test`（单测）、`pnpm run test:integration`、`pnpm test:all`；单文件 `node --test test/unit/<name>.test.mjs`。chromium 内联在 clean-snapshot 单测里（子进程跑真 CLI）。
- 本计划不新增任何 npm 依赖（jsdom 已有）。
- 提交信息用仓库惯例：中文 conventional commits（`feat(inline2md): …` / `test(clean-snapshot): …` / `docs(skill): …`），结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

### Task 1: inline2md 骨架——文本转义 + 未知标签解包

**Files:**
- Create: `script/lib/inline2md.mjs`
- Test: `test/unit/inline2md.test.mjs`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces: `inlineRunToMarkdown(html: string): string`——jsdom 解析 canonical HTML 片段、递归下降转 markdown；解析异常时抛错（由 Task 7 的调用方兜底）。本任务实现文本节点转义与未知标签解包；元素映射在 Task 2/3 增量补齐（未映射标签暂走「未知标签解包」分支）。

- [ ] **Step 1: 写失败测试**

创建 `test/unit/inline2md.test.mjs`：

```js
// test/unit/inline2md.test.mjs
// inline2md 单测：canonical HTML 片段 → GFM 行内 markdown（spec 2026-09-06 §5）。
// 转义规则（§5.3 自审修订）：常规文本反斜杠转义活动字符 + 行首中断符；
// code span 与 math 源照抄不转义（Task 3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineRunToMarkdown } from '../../script/lib/inline2md.mjs';

test('文本转义：活动字符反斜杠转义，普通字符照抄', () => {
  assert.equal(
    inlineRunToMarkdown('价格 $5 与 *星号* [链接] <标签> ~波浪~'),
    '价格 \\$5 与 \\*星号\\* \\[链接\\] \\<标签\\> \\~波浪\\~'
  );
  assert.equal(inlineRunToMarkdown('反斜杠 \\ 与反引号 ` 下划线 _'), '反斜杠 \\\\ 与反引号 \\` 下划线 \\_');
});

test('文本转义：! 仅在后随 [ 时转义（防误触图片下载扫描）', () => {
  assert.equal(inlineRunToMarkdown('看图![alt](u)'), '看图\\![alt](u)');
  assert.equal(inlineRunToMarkdown('太棒了!'), '太棒了!');
});

test('行首中断符转义：值开头、换行后、前导空白后', () => {
  assert.equal(inlineRunToMarkdown('# 标题样'), '\\# 标题样');
  assert.equal(inlineRunToMarkdown('a\n- b'), 'a\n\\- b');
  assert.equal(inlineRunToMarkdown('a\n  1) c'), 'a\n  1\\) c');
  assert.equal(inlineRunToMarkdown('a\n> 引用'), 'a\n\\> 引用');
  assert.equal(inlineRunToMarkdown('a\n==='), 'a\n\\===');
  // 非行首的中断符不转义（渲染透明原则的最小干预）
  assert.equal(inlineRunToMarkdown('a - b'), 'a - b');
  assert.equal(inlineRunToMarkdown('v1.2'), 'v1.2');
});

test('未知标签解包：只递归子节点', () => {
  assert.equal(inlineRunToMarkdown('<unknown>文本 $x</unknown>'), '文本 \\$x');
  assert.equal(inlineRunToMarkdown('a<foo>b</foo>c'), 'abc');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: FAIL——`Cannot find module '.../script/lib/inline2md.mjs'`。

- [ ] **Step 3: 写最小实现**

创建 `script/lib/inline2md.mjs`：

```js
// script/lib/inline2md.mjs
// 长文本行内 run 的确定性 Markdown 转换器（spec 2026-09-06 §5）。
// 输入是步骤 2 共享段规范化序列化的 canonical HTML 片段（2_long_text.json
// 的 runs 段）：剥净属性、span 已归一为 strong/em/del、math 已压成仅含
// annotation 的极简形态。jsdom 解析后递归下降映射为 GFM 行内语法。
//
// 转义策略（§5.3，2026-09-07 自审修订）：
//  - 常规文本节点：活动字符 `` \ ` * _ [ ] < $ ~ `` 反斜杠转义；`!` 仅后随
//    `[` 时转义（防误触步骤 8 图片下载扫描）；
//  - 行首中断符：处于输出行首（值开头 / 文本换行后 / br 硬换行后 / 前导
//    空白后）的 `# > - + =` 直接转义、「数字 + ./) + 空白」转义定界符——
//    防源码换行后随文本被解析为列表/标题/引用/setext（软折叠不覆盖块级
//    中断构造）；
//  - code span 内部与 math 源照抄不转义：code span 内反斜杠是字面字符
//    （转义即可见损坏），math 源 `\alpha` 不可翻倍。
import { JSDOM } from 'jsdom';

const ESCAPE_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '<', '$', '~']);
const LINE_START_ESCAPE = new Set(['#', '>', '-', '+', '=']);
// 行首有序列表定界：数字串（CommonMark 上限 9 位）+ ./) + 空白或行尾
const OL_LINE_RE = /^(\d{1,9})([.)])(\s|$)/;

// 文本节点转义。state.lineStart 跨元素线程：换行/br 置 true，空白保持
// true（CommonMark 允许 ≤3 前导空格的中断），任何非空白输出置 false。
// 元素包装（如 ** 前缀）后内层文本可能残留旧 lineStart → 过度转义，
// 渲染透明、无害；宁可过度不漏（漏 = 块结构被破坏）。
function escapeText(text, state) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { out += '\n'; state.lineStart = true; continue; }
    if (c === '\r') continue; // 归一：\r\n 按 \n（canonical 来自浏览器，防御）
    if (state.lineStart && LINE_START_ESCAPE.has(c)) {
      out += '\\' + c; state.lineStart = false; continue;
    }
    if (state.lineStart && c >= '0' && c <= '9') {
      const m = text.slice(i).match(OL_LINE_RE);
      if (m) {
        out += m[1] + '\\' + m[2];
        i += m[1].length + m[2].length - 1;
        state.lineStart = false; continue;
      }
    }
    if (ESCAPE_CHARS.has(c)) { out += '\\' + c; state.lineStart = false; continue; }
    if (c === '!' && text[i + 1] === '[') { out += '\\!'; state.lineStart = false; continue; }
    out += c;
    if (c !== ' ' && c !== '\t') state.lineStart = false;
  }
  return out;
}

function convertNodes(nodes, state) {
  let out = '';
  for (const n of nodes) out += convertNode(n, state);
  return out;
}

function convertNode(node, state) {
  if (node.nodeType === 3) return escapeText(node.textContent, state);
  if (node.nodeType !== 1) return '';
  // 元素映射在后续任务增量补齐；未映射标签一律解包（只递归子节点）
  return convertNodes(node.childNodes, state);
}

// canonical 片段 → markdown。解析失败抛错，调用方（screenshot_trans）
// 兜底为 textContent 纯文本（spec §5.4）。
export function inlineRunToMarkdown(html) {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  const state = { lineStart: true };
  return convertNodes(doc.body.childNodes, state);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add script/lib/inline2md.mjs test/unit/inline2md.test.mjs
git commit -m "feat(inline2md): 转换器骨架——文本活动字符转义 + 行首中断符转义 + 未知标签解包

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: inline2md 强调/链接/br 映射 + 强调边界退化

**Files:**
- Modify: `script/lib/inline2md.mjs`
- Test: `test/unit/inline2md.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `convertNodes/convertNode/escapeText`。
- Produces: `convertNode` 内 `STRONG/B → **…**`、`EM/I → *…*`、`DEL/S → ~~…~~`、`A[href] → […](…)`、`BR → \` + 换行`；强调边界退化（内容首/尾空白或 `*`/`_` → 原生 HTML 标签透传）。

- [ ] **Step 1: 写失败测试**

在 `test/unit/inline2md.test.mjs` 追加：

```js
test('强调映射：strong/em/del 语义标签 → **/* /~~', () => {
  assert.equal(inlineRunToMarkdown('<strong>加粗</strong> 普通 <em>斜体</em> 与 <del>删除</del>'),
    '**加粗** 普通 *斜体* 与 ~~删除~~');
});

test('强调嵌套：递归下降天然支持；外层遇内层强调记号 → 边界退化', () => {
  assert.equal(inlineRunToMarkdown('<strong>a <em>b</em> c</strong>'),
    '**a *b* c**');
  // 内层先产出 **x**，外层 *…* 内容以 * 开头 → 退化原生 HTML
  assert.equal(inlineRunToMarkdown('<em><strong>x</strong></em>'), '<em>**x**</em>');
});

test('强调边界退化：内容首/尾为空白或 */_ → 原生 HTML 透传（GFM 强调不闭合）', () => {
  // 首空白：** x** 左侧不满足左flanking → 退化
  assert.equal(inlineRunToMarkdown('<strong> x</strong>'), '<strong> x</strong>');
  // 尾空白
  assert.equal(inlineRunToMarkdown('<em>y </em>'), '<em>y </em>');
  // 内容以强调记号开头（嵌套强调）：** *x* ** 不闭合 → 退化
  assert.equal(inlineRunToMarkdown('<strong><em>x</em></strong>'), '<strong><em>x</em></strong>');
});

test('链接映射：a[href] → [文本](href)；含 ) 或空白的 href 角括号包裹；无 href 解包', () => {
  assert.equal(inlineRunToMarkdown('<a href="https://x.com/a">文本</a>'), '[文本](https://x.com/a)');
  assert.equal(inlineRunToMarkdown('<a href="https://x.com/a(1)">文本</a>'), '[文本](<https://x.com/a(1)>)');
  assert.equal(inlineRunToMarkdown('<a>裸链接</a>'), '裸链接');
  assert.equal(inlineRunToMarkdown('前 <a href="https://x.com/b"><strong>粗链</strong></a> 后'),
    '前 [**粗链**](https://x.com/b) 后');
});

test('br 硬换行：反斜杠 + 换行；换行后行首中断符仍转义', () => {
  assert.equal(inlineRunToMarkdown('a<br>b'), 'a\\\nb');
  assert.equal(inlineRunToMarkdown('a<br>- b'), 'a\\\n\\- b');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: 新增用例 FAIL（当前 strong/a/br 走未知标签解包，输出无 `**`/`[]`/`\` + 换行）。

- [ ] **Step 3: 实现 convertNode 元素分支**

在 `convertNode` 的 `if (node.nodeType !== 1) return '';` 之后替换裸 `return convertNodes(...)` 为：

```js
  const inner = () => convertNodes(node.childNodes, state);
  switch (node.tagName) {
    case 'STRONG': case 'B':
      return wrapEmphasis(inner(), '<strong>', '</strong>', '**');
    case 'EM': case 'I':
      return wrapEmphasis(inner(), '<em>', '</em>', '*');
    case 'DEL': case 'S':
      return wrapEmphasis(inner(), '<del>', '</del>', '~~');
    case 'A': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!href) return text;                       // canonical 已解包；防御
      // href 含 ) / 空白时角括号包裹（CommonMark 链接目标语法），防截断
      const dest = /[)\s]/.test(href) ? `<${href}>` : href;
      return `[${text}](${dest})`;
    }
    case 'BR':
      return '\\' + '\n';                            // GFM 硬换行；state 已由 convertNodes 线程置位
    default:
      return inner();                                // 未知标签解包（Task 3 增补 code/math/同族）
  }
```

并在 `convertNode` 上方加辅助函数与 state 说明：

```js
// 强调边界退化（spec §5.4）：内容首/尾为空白或 */_ 时 GFM 强调不闭合，
// 退化为原生 HTML 标签透传，保真优先。md 形态仅在边界合法时使用。
const EMPH_DEGENERATE = /^[\s*_]|[\s*_]$/;
function wrapEmphasis(content, openHtml, closeHtml, md) {
  if (EMPH_DEGENERATE.test(content)) return openHtml + content + closeHtml;
  return md + content + md;
}
```

**br 的 state 处理**：`convertNode` 的 BR 分支返回 `'\\' + '\n'` 后必须把 `state.lineStart` 置 true（换行后行首中断符要转义）。把 BR 分支改为：

```js
    case 'BR':
      state.lineStart = true;
      return '\\' + '\n';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/inline2md.mjs test/unit/inline2md.test.mjs
git commit -m "feat(inline2md): 强调/链接/br 映射 + 强调边界退化 + href 角括号包裹

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: inline2md code span / math / 行内同族透传 / runTextContent

**Files:**
- Modify: `script/lib/inline2md.mjs`
- Test: `test/unit/inline2md.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `convertNode` switch。
- Produces: `runTextContent(html: string): string`（jsdom 解析 → body.textContent，转换兜底用）；`convertNode` 的 `CODE`/`MATH`/行内同族分支。

- [ ] **Step 1: 写失败测试**

追加到 `test/unit/inline2md.test.mjs`：

```js
import { runTextContent } from '../../script/lib/inline2md.mjs';

test('code span：内容照抄不转义；含反引号 → 更长围栏 + 空格填充；内部换行折叠为空格', () => {
  assert.equal(inlineRunToMarkdown('用 <code>const x = 1;</code> 声明'), '用 `const x = 1;` 声明');
  // 反斜杠是 code span 字面字符——转义即可见损坏（spec §5.3 转义范围排除）
  assert.equal(inlineRunToMarkdown('<code>C:\\path\\to</code>'), '`C:\\path\\to`');
  // 内容含单反引号串 → 围栏长度 = 最长串 + 1，两端空格填充（GFM 规则）
  assert.equal(inlineRunToMarkdown('<code>a ` b</code>'), '`` a ` b ``');
  assert.equal(inlineRunToMarkdown('<code>``x``</code>'), '``` ``x`` ```');
  // 内部换行折叠为空格：浏览器行内流空白语义 + 防块中断（换行后 - 会拆列表）
  assert.equal(inlineRunToMarkdown('<code>a\n- b</code>'), '`a - b`');
});

test('math：无 display → $源$；display=block → $$源$$；源不转义、换行折叠为空格', () => {
  assert.equal(
    inlineRunToMarkdown('公式 <math><annotation encoding="application/x-tex">\\alpha + \\beta</annotation></math> 结束'),
    '公式 $\\alpha + \\beta$ 结束'
  );
  assert.equal(
    inlineRunToMarkdown('<math display="block"><annotation encoding="application/x-tex">E = mc^2</annotation></math>'),
    '$$E = mc^2$$'
  );
  assert.equal(
    inlineRunToMarkdown('<math><annotation encoding="application/x-tex">a\nb</annotation></math>'),
    '$a b$'
  );
});

test('行内同族透传：原生 HTML 标签（markdown 无对应语法，透传最保真）；wbr 解包', () => {
  assert.equal(inlineRunToMarkdown('H<sub>2</sub>O'), 'H<sub>2</sub>O');
  assert.equal(inlineRunToMarkdown('按 <kbd>Ctrl</kbd> 键'), '按 <kbd>Ctrl</kbd> 键');
  assert.equal(inlineRunToMarkdown('<mark>高亮</mark>'), '<mark>高亮</mark>');
  assert.equal(inlineRunToMarkdown('长词<wbr>断点'), '长词断点');
  // 透传标签内部文本照常转义
  assert.equal(inlineRunToMarkdown('<var>x_1</var>'), '<var>x\\_1</var>');
});

test('runTextContent：剥标签取纯文本（转换异常兜底）', () => {
  assert.equal(runTextContent('<strong>a</strong> b <code>c</code>'), 'a b c');
});

test('组合端到端：典型 run 片段', () => {
  const canonical = '这是<strong>关键结论</strong>：见<a href="https://example.com/d">文档</a>，命令为 <code>u2m --run</code>，公式 <math><annotation encoding="application/x-tex">x^2</annotation></math> 成立。';
  assert.equal(
    inlineRunToMarkdown(canonical),
    '这是**关键结论**：见[文档](https://example.com/d)，命令为 `u2m --run`，公式 $x^2$ 成立。'
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: 新增用例 FAIL（code/math/同族当前走未知解包：code 输出转义文本、math 消失、sub 消失）。

- [ ] **Step 3: 实现 code/math/同族分支**

在 `inline2md.mjs` 顶部常量区加：

```js
// 内容最长反引号连续串长度（code span 围栏自适应——与步骤 9 围栏同哲学：
// 围栏严格长于内容最长串，GFM 不可闭合）
function longestTickRun(s) {
  const runs = s.match(/`+/g);
  return runs ? Math.max(...runs.map((t) => t.length)) : 0;
}
```

`convertNode` 的 switch 增加分支（放在 `default` 之前）：

```js
    case 'CODE': {
      // code span 内容照抄不转义；内部换行折叠为空格——浏览器对行内流
      // 空白的处理语义（white-space:normal 折叠），且防换行后 - / 1. 触发
      // 块中断拆碎 code span
      const raw = node.textContent.replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
      if (!raw.includes('`')) return '`' + raw + '`';
      const fence = '`'.repeat(longestTickRun(raw) + 1);
      return fence + ' ' + raw + ' ' + fence;
    }
    case 'MATH': {
      // 极简形态（步骤 2 序列化保证 annotation 存在）；源照抄不转义。
      // 换行折叠为空格：TeX 源中换行 = 空格 token，渲染等价且防 $…$ 内
      // 换行触发块中断
      const ann = node.querySelector('annotation');
      const src = (ann ? ann.textContent : '').trim().replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
      return node.getAttribute('display') === 'block' ? `$$${src}$$` : `$${src}$`;
    }
```

`default` 分支替换为行内同族透传 + 未知解包：

```js
    default: {
      // 行内同族（u/mark/small/sub/sup/abbr/cite/q/kbd/samp/time/var 等）：
      // markdown 无对应语法，GFM 允许行内 raw HTML，透传最保真；wbr 例外
      // ——零宽换行机会无输出，解包。未知标签解包（只递归子节点）。
      const RAW_PASS = new Set(['U', 'MARK', 'SMALL', 'SUB', 'SUP', 'ABBR', 'CITE', 'Q', 'KBD', 'SAMP', 'TIME', 'VAR']);
      if (node.tagName === 'WBR') return '';
      if (RAW_PASS.has(node.tagName)) {
        const tag = node.tagName.toLowerCase();
        return `<${tag}>${inner()}</${tag}>`;
      }
      return inner();
    }
```

（`RAW_PASS` 集合提到 switch 外的模块级常量区，避免每次调用重建。）

文件末尾加兜底导出：

```js
// 转换异常兜底（spec §5.4）：退回 jsdom textContent 纯文本。
export function runTextContent(html) {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  return doc.body.textContent || '';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/inline2md.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/inline2md.mjs test/unit/inline2md.test.mjs
git commit -m "feat(inline2md): code span 反引号自适应 + math \$/\$\$ + 行内同族透传 + runTextContent 兜底

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: run 检测 + 序列化 + 统一 walk + 两段 JSON 接线

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（共享段检测/序列化 + `foldLongText` 改造 + styled 返回值）
- Modify: `script/clean_snapshot.mjs`（page-latex 注入、两段 JSON、emit 计数、log）
- Modify: `test/unit/clean-snapshot.test.mjs`（新用例 + 既有断言迁移）
- Modify: `test/fixtures/golden/article-1.styled.html`、`test/fixtures/golden/article-1.longtext.json`、`test/fixtures/golden/clean-simplify.styled.html`、`test/fixtures/golden/clean-simplify.longtext.json`（重生）

**Interfaces:**
- Consumes: Task 1-3 无依赖（本任务在页面侧，先于 Task 7 接线）。
- Produces:
  - `2_long_text.json` 新 schema：`{"texts": {"k": "纯文本"}, "runs": {"k": "canonical HTML"}}`（单一计数器全局编号、文档序连续）。
  - `clean_snapshot.mjs` emit：`longTextCount` 从 number 变 `{"texts": N, "runs": N, "total": N}`。
  - `page-clean-snapshot.js` styled 返回值新增 `longTextRuns`（`{k: canonicalHtml}`）；`longTexts` 语义收窄为散文本段（表格/代码块展开表继续消费它，形状不变）。

- [ ] **Step 1: 写失败测试**

在 `test/unit/clean-snapshot.test.mjs` 追加（沿用文件顶部 `runClean` 基座）：

```js
test('run 折叠：混排长段落整段折叠——styled 单占位符 + runs 段 canonical + clean 无编号', async () => {
  // spec 2026-09-06 §3：折叠单位升级为「极大纯行内 run」。混排段落整段一
  // 个 {{LONG_TEXT_1|N_chars}}，行内结构随 canonical HTML 入 runs 段；散文本
  // 段为空；clean 版无编号整段形态。
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><base data-u2m-base="1" href="https://example.com/page/"></head>
<body>
  <h1 data-idx="1">标题</h1>
  <p data-idx="2">这是一段<strong>加粗强调</strong>的长文本，含<em>斜体</em>与<a href="/docs">链接文本</a>及<code>inline_code()</code>混排，用于验证整段 run 折叠行为。</p>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'run-basic');
  try {
    assert.match(styled, /<p data-idx="2">\{\{LONG_TEXT_1\|\d+_chars\}\}<\/p>/,
      'styled：整段一个占位符（壳保留 data-idx）');
    const lt = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    assert.deepEqual(Object.keys(lt.texts), [], '散文本段为空');
    assert.equal(lt.runs['1'],
      '这是一段<strong>加粗强调</strong>的长文本，含<em>斜体</em>与<a href="https://example.com/docs">链接文本</a>及<code>inline_code()</code>混排，用于验证整段 run 折叠行为。',
      'runs 段：语义归一 + href 绝对化 + 属性剥净');
    assert.match(cleaned, /<p data-idx="2">\{\{LONG_TEXT\|\d+_chars\}\}<\/p>/, 'clean：无编号整段形态');
    assert.deepEqual(out.longTextCount, { texts: 0, runs: 1, total: 1 }, 'emit 计数对象');
  } finally { cleanup(); }
});

test('run 检测边界：table/pre 内不 run 折叠（散文本照旧）；阈值下不折；嵌套容器不双折', async () => {
  const longZh = '这是一段超过十六个汉字的长文本用于验证折叠';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <table data-idx="1"><tbody><tr><td>单元格里${longZh}与<strong>加粗</strong>混排内容继续加长一些。</td></tr></tbody></table>
  <div data-idx="2"><p data-idx="3"><span data-idx="4">${longZh}外层</span></p></div>
  <p data-idx="5">短文本不折叠</p>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'run-edge');
  try {
    const lt = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    // 表格子树被位置条件排除：只有散文本占位（texts 段），无 runs
    assert.deepEqual(Object.keys(lt.runs), [], 'table 内不产生 run');
    assert.ok(Object.keys(lt.texts).length >= 1, 'table 内长文本照旧散折叠进 texts');
    assert.ok(styled.includes('{{LONG_TEXT_1|'), 'styled 表内散文本占位带编号（expandLongText 依赖）');
    // div>p>span：div 子树含 p（p 不在行内允许集）→ div 形状不合格 → p 是
    // 极大容器；span 在 p 内、p 形状合格 → span 非极大不单折，随 p 整段折入
    // （innerHTML 整体替换，span 及其 data-idx 随之消失——「壳保留」指 run
    // 容器 E 自身，不是内部结构）
    assert.match(styled, /<p data-idx="3">\{\{LONG_TEXT_\d+\|\d+_chars\}\}<\/p>/, 'p 整段折叠（极大）');
    assert.ok(!styled.includes('data-idx="4"'), 'p 内 span 随整段折叠消失');
    // 短文本原样
    assert.ok(styled.includes('短文本不折叠'));
  } finally { cleanup(); }
});
```

**注意**：`data-idx="4"` 断言——run 折叠把 p 的 innerHTML 整体换成占位符文本节点，p 内部的 span（含其 data-idx）随之消失；styled 版仍保留 p 自身与 data-idx。若实现后发现 span 壳被要求保留，重读 spec §3.4——「壳保留」指**run 容器 E 自身**的 data-idx/class/aria-label，不是内部结构。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 新用例 FAIL（现状散文本折叠产生多个占位符、无 runs 段、emit 是数字）。

- [ ] **Step 3: page-clean-snapshot.js——共享段插入 run 检测与序列化**

三处编辑：

**(a) 捕获 baseURI（base 删除之前）**——共享段步骤 3 会删 `<base>`，而 spec §3.3 要求以快照注入的 base 为绝对化基准。在 `// 3. 删除 <base> 标签` 之前插入：

```js
  // run 序列化的 URL 绝对化基准（spec 2026-09-06 §3.3）：快照已注入 <base>，
  // 但下方步骤 3 会删除它——先捕获 document.baseURI，检测/序列化在共享段
  // 末尾执行时基准已不可得
  var runBaseURI = document.baseURI;
```

**(b) 共享段末尾（aria 截断块之后、`// ---- mode 分叉` 之前）插入检测与序列化**：

```js
  // ---- run 检测 + 规范化序列化（两趟共享段末尾；spec 2026-09-06 §3）----
  // 长文本折叠单位升级为「极大纯行内 run」：流容器内 text 与行内元素混排的
  // 整段内容折成一个 {{LONG_TEXT_k}}（两趟折叠执行见 foldLongText），原文以
  // 规范化 HTML 片段入库（runs 段），步骤 8 inline2md 确定性转 markdown。
  // 检测放共享段末尾：两趟 DOM 完全一致（空元素级联 + astro 解包已完），
  // 决策天然一致——孪生守卫 clean⊆styled 由构造保证，免疫 clean 趟 K5/K10/
  // K11 的纯性扰动（K 规则删子树会让 clean 侧容器「变纯」而 styled 不纯）。
  // 检测结果挂元素 expando（__u2mRunHtml/__u2mRunSize，非属性、不序列化），
  // fold walk 按成员资格消费。
  var RUN_INLINE = { A: 1, SPAN: 1, CODE: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1,
    MARK: 1, SMALL: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1, SAMP: 1, TIME: 1,
    BR: 1, DEL: 1, VAR: 1, WBR: 1 };
  // 位置排除（§3.2-1）：table/pre 已有各自占位符体系；svg/style 随后删除；
  // h1-h3 整子树豁免沿用 skipPlaceholder 语义（标题是层级锚点）
  var RUN_SKIP_CLOSEST = 'table, pre, svg, style, h1, h2, h3';
  // computed display 记忆化：检测对每个候选的子树逐元素查 gCS，跨候选共享
  var runDisplayCache = new Map();
  function runHidden(el) {
    if (el.hasAttribute('hidden')) return true;
    if (!runDisplayCache.has(el)) {
      runDisplayCache.set(el, getComputedStyle(el).display === 'none');
    }
    return runDisplayCache.get(el);
  }
  // 子树纯行内（§3.2-2/3）：只约束后代元素（根自身标签不限——p/li/h4-h6/
  // summary/div/span 等流容器均可为 run 根，由极大性覆盖）；math 整棵放行
  // 但取不到 LaTeX 源则阻断（决策 3：无源 math 留 DOM 走现状链路）
  function runInnerOk(node) {
    if (node.nodeType === 3 || node.nodeType === 8) return true;
    if (node.nodeType !== 1) return false;
    var tag = node.tagName.toUpperCase();
    if (tag === 'MATH') {
      if (typeof __u2mLatexText !== 'function') return false;   // 未注入（单独跑本函数）→ 保守阻断
      var src = __u2mLatexText(node);
      return src !== null && src !== '';
    }
    if (RUN_INLINE[tag] !== 1) return false;
    if (runHidden(node)) return false;   // 隐藏内容不得随 run 折进恢复清单（styled 趟未剥隐藏）
    var kids = node.childNodes;
    for (var ri = 0; ri < kids.length; ri++) {
      if (!runInnerOk(kids[ri])) return false;
    }
    return true;
  }
  // 形状合格（§3.2-1/2/3，不含阈值）：候选与极大性判定共用
  function runShapeOk(el) {
    if (el.closest(RUN_SKIP_CLOSEST)) return false;
    if (runHidden(el)) return false;
    var kids = el.childNodes;
    for (var ri = 0; ri < kids.length; ri++) {
      if (!runInnerOk(kids[ri])) return false;
    }
    return true;
  }
  function escHtmlText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 规范化序列化（§3.3，检测通过当场执行）：canonical HTML 片段。span 按
  // computed style 归一（浏览器里不做，Node 侧永远无法补——class 驱动的强调
  // jsdom 无级联）；math 压成仅含 annotation 的极简形态（katex-html 视觉孪生
  // 不入库）；返回 null = 阻断信号（无源 math，防御分支——检测已挡）
  function serializeRunChildren(el) {
    var parts = [];
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var r = serializeRunNode(kids[i]);
      if (r === null) return null;
      parts.push(r);
    }
    return parts.join('');
  }
  function serializeRunNode(node) {
    if (node.nodeType === 3) return escHtmlText(node.textContent);   // 空白保真不归一
    if (node.nodeType !== 1) return '';
    var tag = node.tagName.toUpperCase();
    var kids = function () { return serializeRunChildren(node); };
    switch (tag) {
      case 'A': {
        var raw = node.getAttribute('href') || '';
        if (raw === '' || raw.charAt(0) === '#' || /^javascript:/i.test(raw)) return kids();
        var abs;
        try { abs = new URL(raw, runBaseURI).href; } catch (e) { return kids(); }
        return '<a href="' + escHtmlText(abs) + '">' + kids() + '</a>';
      }
      case 'SPAN': {
        var inner = kids();
        if (inner === null) return null;
        var cs = getComputedStyle(node);
        // 多信号固定嵌套（自审修订）：del 最内 → em → strong 最外，两趟/测试
        // golden 确定性
        if (String(cs.textDecorationLine || '').indexOf('line-through') !== -1) inner = '<del>' + inner + '</del>';
        if (cs.fontStyle === 'italic') inner = '<em>' + inner + '</em>';
        if (cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 600) inner = '<strong>' + inner + '</strong>';
        return inner;
      }
      case 'STRONG': case 'B': { var s1 = kids(); return s1 === null ? null : '<strong>' + s1 + '</strong>'; }
      case 'EM': case 'I': { var s2 = kids(); return s2 === null ? null : '<em>' + s2 + '</em>'; }
      case 'DEL': case 'S': { var s3 = kids(); return s3 === null ? null : '<del>' + s3 + '</del>'; }
      case 'MATH': {
        var msrc = typeof __u2mLatexText === 'function' ? __u2mLatexText(node) : null;
        if (msrc === null || msrc === '') return null;
        var isBlock = node.getAttribute('display') === 'block' || !!node.closest('.katex-display');
        return '<math' + (isBlock ? ' display="block"' : '') + '><annotation encoding="application/x-tex">'
          + escHtmlText(msrc) + '</annotation></math>';
      }
      default: {
        // code/br + 行内同族（u/mark/small/sub/sup/abbr/cite/q/kbd/samp/time/
        // var/wbr）：保原名、属性剥净；wbr 零宽信号在步骤 8 解包
        if (RUN_INLINE[tag] !== 1) return kids();   // 防御：允许集外透明（检测已挡）
        var s4 = kids();
        if (s4 === null) return null;
        var lower = node.tagName.toLowerCase();
        return '<' + lower + '>' + s4 + '</' + lower + '>';
      }
    }
  }
  // 检测主循环：形状 → 极大性（父形状合格则随父折，不单折）→ 阈值 → 序列化。
  // 顺序先形状后阈值：形状不合格（块级混排）的大多数容器零文本计量成本
  var runDetectAll = document.body.querySelectorAll('*');
  for (var i = 0; i < runDetectAll.length; i++) {
    var E = runDetectAll[i];
    if (!runShapeOk(E)) continue;
    var par = E.parentElement;
    if (par && runShapeOk(par)) continue;                       // 非极大——内部元素随父整段折
    var sz = sizeSuffix(E.textContent);
    if (sz.n <= (sz.unit === 'chars' ? MIN_CHARS : MIN_WORDS)) continue;
    var frag = serializeRunChildren(E);
    if (frag === null) continue;
    E.__u2mRunHtml = frag;
    E.__u2mRunSize = sz;
  }
```

**(c) `foldLongText` 改造为 run+散文本统一 walk**——整体替换现有函数体（原 TreeWalker 版）：

```js
  // 9. 长文本占位（foldLongText；中英文分标准）：run+散文本统一 walk。
  //    numbered=true（styled 趟，分支开头调用）：run 命中 → 整段占位
  //    {{LONG_TEXT_k|n_unit}}、canonical 片段按编号收集进 runs；散文本节点
  //    超阈值 → 现状逐节点占位、原文收集进 texts。k 全文档序连续单计数器
  //    （run 与散文本共用）。numbered=false（clean 趟，K11 之后调用）：
  //    同一套 walk 按记录成员资格执行（记录元素被 K5/K10/K11 删除或吞没则
  //    walk 不可达、自然跳过），无编号、不收集。
  //    散文本折叠不受 table/pre 排除影响（run 检测的位置排除只限整段折叠）：
  //    表格/pre 内部长文本节点照旧逐节点折叠——table2md/code2md 的
  //    expandLongText 预展开依赖这一形态（styled 趟先占位、收集在分支末尾）。
  //    纯空白文本节点不占位；svg/style/h1-h3 子树豁免（skipPlaceholder，
  //    与 run 检测的位置排除同源）。
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;
  var MIN_WORDS = typeof cfg.minWords === 'number' ? cfg.minWords : 12;
  function skipPlaceholder(textNode) {
    var p = textNode.parentElement;
    return !!(p && p.closest && p.closest('svg, style, h1, h2, h3'));
  }
  function foldLongText(numbered) {
    var k = 0;
    var texts = {};
    var runs = {};
    function foldTextNode(tn) {
      if (skipPlaceholder(tn)) return;
      var text = tn.textContent;
      if (text.trim() === '') return;
      var n, unit;
      if (CJK_RE.test(text)) {
        if (text.length <= MIN_CHARS) return;
        n = text.length;
        unit = 'chars';
      } else {
        n = text.trim().split(/\s+/).length;
        if (n <= MIN_WORDS) return;
        unit = 'words';
      }
      if (numbered) {
        k++;
        texts[String(k)] = text;
        tn.textContent = '{{LONG_TEXT_' + k + '|' + n + '_' + unit + '}}';
      } else {
        tn.textContent = '{{LONG_TEXT|' + n + '_' + unit + '}}';
      }
    }
    function walk(node) {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.nodeType === 3) { foldTextNode(c); continue; }
        if (c.nodeType !== 1) continue;
        var frag = c.__u2mRunHtml;
        if (frag !== undefined) {
          // 命中 run 记录：整段替换 innerHTML 为占位符（文本节点形态），
          // 不递归——行内结构已随 canonical 片段入库；壳（本元素）保留
          // data-idx/class/aria-label（机制同 K11 VIEW_TEXT）
          var sz = c.__u2mRunSize;
          if (numbered) {
            k++;
            runs[String(k)] = frag;
            c.textContent = '{{LONG_TEXT_' + k + '|' + sz.n + '_' + sz.unit + '}}';
          } else {
            c.textContent = '{{LONG_TEXT|' + sz.n + '_' + sz.unit + '}}';
          }
          continue;
        }
        walk(c);
      }
    }
    walk(document.body);
    return { count: k, texts: texts, runs: runs };
  }
```

（`MIN_CHARS`/`MIN_WORDS`/`skipPlaceholder` 三个定义保持在 `foldLongText` 上方的原位置不动，仅整体替换 `foldLongText` 函数体；删除旧 TreeWalker 版。）

**(d) styled 返回值**（`return { html: …` 处）：

```js
    return {
      html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
      longTextCount: ltStyled.count,
      longTexts: ltStyled.texts,
      longTextRuns: ltStyled.runs,
      tables: tablesCollected,
      codes: codesCollected
    };
```

文件头注第 28-30 行「K8 行内 run token 化已废除……」段落替换为：

```text
 * K8 行内 run 折叠已按 2026-09-06 spec 重设计（见
 *   docs/superpowers/specs/2026-09-06-long-text-inline-run-design.md）：
 *   折叠单位 = 极大纯行内 run，检测/规范化序列化在两趟共享段末尾执行，
 *   canonical HTML 入 2_long_text.json 的 runs 段，步骤 8 inline2md
 *   确定性转 markdown——行内结构不再依赖 LLM 转录。
```

- [ ] **Step 4: clean_snapshot.mjs 接线**

四处编辑：

```js
  // readSharedScript 区（line ~126 附近）新增：
  const latexFn = await readSharedScript('page-latex.js');
```

```js
  // styled evaluate（拼在最先——__u2mLatexText 与收集器同场进作用域）：
  const styledEvalSrc = `${latexFn}\n${collectTablesFn}\n${collectCodeFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'styled' })})`;
```

```js
  // clean evaluate（两趟共享段检测都调 __u2mLatexText——只注入一趟会让两趟
  // 的 math 阻断判定不一致、破坏孪生守卫）：
  const clean = await page.evaluate(`${latexFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'clean', codeFold })})`);
```

```js
  // 2_long_text.json 两段 schema（spec §4）：
  await fsPromises.writeFile(longTextPath,
    JSON.stringify({ texts: styled.longTexts || {}, runs: styled.longTextRuns || {} }), 'utf8');
```

emit 与 log：

```js
  const ltTextCount = Object.keys(styled.longTexts || {}).length;
  const ltRunCount = Object.keys(styled.longTextRuns || {}).length;
  log(`清洗完成: ${cleanedPath} (长文本 ${styled.longTextCount} 个: 散文本 ${ltTextCount} + 行内 run ${ltRunCount}, 表格 ${tableCounts.total} 个: ${tableCounts.ok} 成功 ${tableCounts.failed} 失败, 代码块 ${codeCounts.total} 个: ${codeCounts.ok} 成功 ${codeCounts.failed} 失败)`);
```

emit 对象里 `longTextCount: styled.longTextCount` 替换为：

```js
      longTextCount: { texts: ltTextCount, runs: ltRunCount, total: styled.longTextCount },
```

文件头注的 stdout 示例行同步（`"longTextCount":N` → `"longTextCount":{"texts":N,"runs":N,"total":N}`）。

- [ ] **Step 5: 跑新用例确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 两个新用例 PASS；**其余既有用例出现预期失败**（见 Step 6）。

- [ ] **Step 6: 迁移既有断言（语义变更部分）**

已知必改的六处 `assert.equal(out.longTextCount, N)` → `assert.equal(out.longTextCount.total, N)`：`test/unit/clean-snapshot.test.mjs` 行 423、464、546、964、1135、1501 附近。

其余失败按此裁决规则处理：
- 断言「占位符个数/编号」的用例：若夹具段落现在被整段 run 折叠（原 N 个散占位 → 1 个 run 占位），更新计数与形态断言、注释标注「run 折叠后」——这是 spec 预期的语义变化。
- 断言「2_long_text.json 内容」的用例：改为读 `lt.texts` / `lt.runs`。
- 出现**非占位符语义**的失败（如清洗规则行为变化、元素意外消失）：停下，用 systematic-debugging 排查——不许为绿改断言。

- [ ] **Step 7: 重生 golden**

产物路径从 CLI 自己的 stdout JSON 取（`styledSnapshot`/`longText` 字段），不盲拼目录名：

```bash
TMP=$(mktemp -d)
for name in article-1 clean-simplify; do
  OUT=$(U2M_WORKING_ROOT="$TMP" node script/clean_snapshot.mjs --url "https://example.com/${name}")
  STYLED=$(node -e "console.log(JSON.parse(process.argv[1]).styledSnapshot)" "$OUT")
  LT=$(node -e "console.log(JSON.parse(process.argv[1]).longText)" "$OUT")
  cp "$STYLED" "test/fixtures/golden/${name}.styled.html"
  cp "$LT" "test/fixtures/golden/${name}.longtext.json"
done
rm -rf "$TMP"
node --test test/unit/clean-snapshot-golden.test.mjs
```

人工检视 golden diff（`git diff test/fixtures/golden/`）：占位符合并（散段 → 整段）、`longtext.json` 两段化、无意外内容丢失。

- [ ] **Step 8: 全量单测**

Run: `pnpm test`
Expected: PASS（integration 未动，可一并跑 `pnpm test:all` 确认无回归）。

- [ ] **Step 9: Commit**

```bash
git add script/lib/page-clean-snapshot.js script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs test/fixtures/golden/
git commit -m "feat(clean-snapshot): 长文本行内 run 整段折叠——共享段检测 + 规范化序列化 + 两段 JSON

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: span 样式归一（computed style 多信号）

**Files:**
- Modify: 无新改动（Task 4 已实现 serializeRunNode 的 SPAN 分支——本任务是它的行为验证与修正）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 4 的 SPAN 序列化分支。
- Produces: 验证结论——inline style 与 class 两种驱动都能归一；无信号 span 透明；多信号固定嵌套 `<strong><em><del>…` 。

- [ ] **Step 1: 写测试（先行——若 Task 4 实现已满足则直接转绿，作为行为钉住）**

```js
test('run 序列化：span 样式归一——inline/class 两驱动 + 多信号固定嵌套 strong>em>del', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>.b{font-weight:700}.i{font-style:italic}.s{text-decoration:line-through}</style></head>
<body>
  <p data-idx="1">前缀<span style="font-weight:700">样式驱动加粗</span>中间<span class="b">class 驱动加粗</span>后缀，继续补足十六个汉字的长度要求。</p>
  <p data-idx="2">无信号 span<span>透明丢弃</span>保留文本，继续补足十六个汉字的长度要求哦。</p>
  <p data-idx="3">三信号<span class="b i s" style="font-weight:700">叠加</span>验证嵌套顺序，继续补足十六个汉字的长度要求。</p>
</body></html>`;
  const { out, cleanup } = await runClean(snapshot, 'run-span-norm');
  try {
    const lt = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    const runs = Object.values(lt.runs).join('\n');
    assert.ok(runs.includes('<strong>样式驱动加粗</strong>'), `inline style 驱动: ${runs}`);
    assert.ok(runs.includes('<strong>class 驱动加粗</strong>'), `class 驱动（<style> 规则）: ${runs}`);
    assert.ok(!/<span>/.test(runs) && runs.includes('透明丢弃'), '无信号 span 透明、文本保留');
    assert.ok(runs.includes('<strong><em><del>叠加</del></em></strong>'),
      '多信号固定嵌套 del 最内 → em → strong 最外');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试**

Run: `node --test test/unit/clean-snapshot.test.mjs -t "span 样式归一"`
Expected: PASS（Task 4 实现正确时）。若 FAIL：按 spec §3.3 修正 SPAN 分支（常见偏差：`textDecorationLine` 兼容性——chromium 支持标准属性；`font-weight:700` 数字比较 `parseInt >= 600`）。

- [ ] **Step 3: Commit（仅测试新增时）**

```bash
git add test/unit/clean-snapshot.test.mjs
git commit -m "test(clean-snapshot): span 样式归一行为钉住——两驱动 + 固定嵌套顺序

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: math 链路——有源极简形态 / display 判定 / 无源阻断

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（仅当 Task 4 的注入或判定有缺陷时修正）
- Modify: `script/clean_snapshot.mjs`（仅当 Task 4 注入遗漏时修正）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 4 的 `__u2mLatexText` 注入（两趟）与 MATH 序列化分支。
- Produces: 行为钉住——KaTeX annotation 数学整段折叠为 `<math…><annotation…>`；`.katex-display` / `display` 属性 → `display="block"`；无源 math 阻断 run（段落留在 DOM 走现状链路）。

- [ ] **Step 1: 写测试**

注意体量门槛（§3.2-5）对 display math 同样生效：`.katex-display` 独立容器只含公式、词数过不了 >12 阈值——**块级公式要折进 run，必须处在够长的段落流内**（真实形态：`<p>文本 <span class="katex-display">…math…</span> 文本</p>`）。夹具按此构造：

```js
test('run 折叠：math 有源整段折叠（极简形态）+ display 判定 + 无源阻断', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <p data-idx="1">行内公式<math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math>之后的说明文字继续补足十六个汉字的长度要求。</p>
  <p data-idx="2">块级公式在段落流内<span class="katex-display"><math><annotation encoding="application/x-tex">\\\\int f(x)dx</annotation></math></span>之后的说明文字继续补足长度要求。</p>
  <p data-idx="3">无源公式<math><mi>x</mi><mo>+</mo><mi>y</mi></math>之后的说明文字继续补足十六个汉字。</p>
</body></html>`;
  const { out, styled, cleanup } = await runClean(snapshot, 'run-math');
  try {
    const lt = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    const runs = Object.values(lt.runs);
    assert.equal(runs.length, 2, '有源两段折（行内 math + 段内 katex-display）；无源段阻断');
    assert.ok(runs.some((r) => r.includes('<math><annotation encoding="application/x-tex">E = mc^2</annotation></math>')),
      '行内 math 极简形态（semantics/mrow 不入库）');
    assert.ok(runs.some((r) => r.includes('<math display="block"><annotation encoding="application/x-tex">')),
      '.katex-display 祖先 → display="block"');
    // 无源：run 不折——styled 保留 <math> 原树与 <mi> 结构（现状链路，
    // 步骤 6 才是 math 消费者），散文本折叠照旧
    assert.ok(styled.includes('<mi>x</mi>'), '无源 math 原树保留');
  } finally { cleanup(); }
});
```

（模板字符串里 `\\\\int` 的实际 annotation 文本是 `\\int`——转义嵌套对本测试无害：断言只查前缀 `<math display="block"><annotation encoding="application/x-tex">`，不断言源码内容。）

- [ ] **Step 2: 跑测试**

Run: `node --test test/unit/clean-snapshot.test.mjs -t "math"`
Expected: PASS（Task 4/注入已正确时）。FAIL 时的已知坑：
- `katex-display` 容器作为 run 根：其子树须纯（math 整棵放行）——若未命中，查 `runInnerOk` 的 MATH 分支是否在无 `__u2mLatexText` 注入时返回 false（= 漏注入，修 `clean_snapshot.mjs`）。
- `__u2mLatexText` 对 `<annotation encoding="application/x-tex">` 的选择器命中（`page-latex.js:17`）。

- [ ] **Step 3: Commit（仅测试/修正有改动时）**

```bash
git add script/lib/page-clean-snapshot.js script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs
git commit -m "test(clean-snapshot): math 链路钉住——有源极简形态 + display 判定 + 无源阻断

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: screenshot_trans runs 转换接线 + 夹具两段迁移

**Files:**
- Modify: `script/screenshot_trans.mjs`（runs→markdown 转换 + 合并解析表 + emit `runsResolved`）
- Modify: `test/unit/screenshot-trans.test.mjs`（夹具两段化 + 新用例）
- Modify: `test/helpers/code-restore.mjs`（`'{}'` → 两段空对象，防御性一致）

**Interfaces:**
- Consumes: Task 1-3 的 `inlineRunToMarkdown(html) → string`（抛错语义）与 `runTextContent(html) → string`；Task 4 的 `2_long_text.json` 两段 schema。
- Produces: `8_resolved_skeleton.json` 中 run 编号的 value 已是 markdown（行内语法 + `$…$`）；emit 新增 `runsResolved: number`；`resolveSkeletonString` 零改动（消费合并后的扁平 `{k: 字符串}`）。

- [ ] **Step 1: 写失败测试**

`test/unit/screenshot-trans.test.mjs` 顶部 `LONG_TEXT` 常量改两段：

```js
const LONG_TEXT = {
  texts: { '5': '段落一文本内容', '6': '重要内容', '8': '段落二文本内容' },
  runs: {},
};
```

行 567 附近 `longText: { '5': '其他文本' }` → `longText: { texts: { '5': '其他文本' }, runs: {} }`。

追加新用例（放在 `{{TABLE_k}}` 还原用例之后）：

```js
test('screenshot_trans: runs 段经 inline2md 转 markdown 合并还原 + runsResolved + 步骤 9 端到端', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-st-runs-'));
  const url = 'https://example.com/run-restore';
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    '<!DOCTYPE html><html><body><h1 data-idx="1">t</h1><p data-idx="2">body</p></body></html>');
  fs.writeFileSync(path.join(dir, '2_long_text.json'), JSON.stringify({
    texts: { '2': '散文本原文' },
    runs: {
      '1': '这是<strong>关键</strong>：见<a href="https://example.com/d">文档</a>，命令 <code>u2m --run</code>。',
      '3': '公式 <math><annotation encoding="application/x-tex">x^2</annotation></math> 成立。',
    },
  }));
  fs.writeFileSync(path.join(dir, '3_key_ids.json'),
    JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [2], dumpIds: [] }));
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
    { p: '{{LONG_TEXT_1}}' },
    { p: '{{LONG_TEXT_2}}' },
    { p: '{{LONG_TEXT_3}}' },
  ], null, 2));
  try {
    const r = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', url],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.runsResolved, 2);
    const resolved = JSON.parse(fs.readFileSync(out.resolvedSkeleton, 'utf8'));
    assert.equal(resolved[0].p, '这是**关键**：见[文档](https://example.com/d)，命令 `u2m --run`。');
    assert.equal(resolved[1].p, '散文本原文');
    assert.equal(resolved[2].p, '公式 $x^2$ 成立。');
    // 步骤 8→9 端到端（spec §7）：p 值透传落盘，行内语法原样到达 markdown
    const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', url],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
    const md = fs.readFileSync(path.join(dir, '9_markdown.md'), 'utf8');
    assert.ok(md.includes('这是**关键**：见[文档](https://example.com/d)，命令 `u2m --run`。'), md);
    assert.ok(md.includes('公式 $x^2$ 成立。'), md);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
```

`test/helpers/code-restore.mjs` 的 `JSON.stringify({})` → `JSON.stringify({ texts: {}, runs: {} })`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 新用例 FAIL（无 runsResolved 字段、run 编号被当未定义报 error）；既有用例因夹具两段化维持绿（`lt.texts || {}` 防御）。

- [ ] **Step 3: 实现 screenshot_trans.mjs**

导入区（lib imports 之后）加：

```js
import { inlineRunToMarkdown, runTextContent } from './lib/inline2md.mjs';
```

`main()` 里读 longText 处（`const longText = JSON.parse(...)`）替换为：

```js
  // ── runs 段 → markdown（spec §5.1）：逐 k 经 inline2md 确定性转换，与
  //    texts 合并为扁平解析表——resolveSkeletonString 零改动。转换异常退回
  //    jsdom textContent 纯文本 + stderr warning（§5.4），对应 k 照常出值 ──
  const lt = JSON.parse(await fsPromises.readFile(longTextPath, 'utf8'));
  const longText = { ...(lt.texts || {}) };
  let runsResolved = 0;
  for (const [k, html] of Object.entries(lt.runs || {})) {
    try {
      longText[k] = inlineRunToMarkdown(html);
      runsResolved++;
    } catch (e) {
      let fallback;
      try { fallback = runTextContent(html); }
      catch { fallback = String(html).replace(/<[^>]*>/g, ''); }
      longText[k] = fallback;
      log(`[runs] LONG_TEXT_${k} 行内转换失败，退回纯文本: ${e.message}`);
    }
  }
```

三个 ok emit 站点（`skipped: 'no_trans2img'` 两处 + 末尾主 emit）各加 `runsResolved,` 字段。

文件头注 stdout 示例行补 `"runsResolved":N`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/screenshot-trans.test.mjs && node --test test/unit/code2md.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs test/helpers/code-restore.mjs
git commit -m "feat(screenshot-trans): runs 段 inline2md 确定性转换 + 合并解析表 + runsResolved

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 孪生守卫与边缘测试补强

**Files:**
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 4-6 的全部行为。
- Produces: 无代码产出——spec §3.4 边缘条目与 §9 风险项的行为钉住（hidden 祖先 / K10 拆包 / K11 吞没 / 孪生后缀 ⊆）。

- [ ] **Step 1: 写测试**

```js
test('run 孪生守卫：hidden 祖先 / K10 拆包 / K11 吞没——clean LT 后缀 ⊆ styled', async () => {
  const longZh = '这是一段超过十六个汉字的长文本用于验证折叠行为。';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1" hidden><p data-idx="2">${longZh}<strong>隐藏 FAQ 答案</strong>继续长度。</p></div>
  <p data-idx="3"><span data-idx="4" style="color:red">${longZh}拆包场景</span></p>
  <div class="chart" data-idx="5">
    <div data-idx="6">step one</div><div data-idx="7">step two</div>
    <div data-idx="8">step three</div><div data-idx="9">step four</div>
    <div data-idx="10">step five</div><div data-idx="11">step six</div>
    <div data-idx="12">step seven</div>
  </div>
</body></html>`;
  const { cleaned, styled, out, cleanup } = await runClean(snapshot, 'run-twin');
  try {
    // hidden 祖先：styled 照折（编号进恢复清单——FAQ 还原路径），clean 被 K5
    // 吞没（HIDDEN_TAG 内无 LT）
    assert.ok(/<div data-idx="1" hidden>\{\{HIDDEN_TAG\|/.test(cleaned), 'clean：hidden 块 K5 折叠');
    const hiddenBlock = styled.match(/<div data-idx="1" hidden>[\s\S]*?<\/div>/)[0];
    assert.ok(/\{\{LONG_TEXT_1\|/.test(hiddenBlock), 'styled：hidden 内 run 照折（带编号）');
    // K10：仅 data-idx 的 span 在 clean 拆包 → 文本上提为 p 的散文本节点；
    // styled 保留 span 整段 run——两趟粒度不同、位置包含
    assert.match(cleaned, /<p data-idx="3">\{\{LONG_TEXT\|\d+_chars\}\}<\/p>/, 'clean：拆包后散文本占位');
    assert.match(styled, /<p data-idx="3">\{\{LONG_TEXT_\d+\|\d+_chars\}\}<\/p>/, 'styled：整段 run 占位');
    // K11：chart 模块整棵 VIEW_TEXT（模块内若有 run 随折吞没）
    assert.match(cleaned, /<div class="chart" data-idx="5">\{\{VIEW_TEXT\|\d+_words\}\}<\/div>/);
    // 孪生守卫：clean LT 后缀集合 ⊆ styled（多场景合并断言）
    const suf = (h) => (h.match(/\{\{LONG_TEXT(?:_\d+)?\|(\d+_[a-z]+)\}\}/g) || [])
      .map((s) => s.replace(/^.*\|/, '')).sort();
    const cs = suf(cleaned), ss = suf(styled);
    assert.ok(cs.every((v) => ss.includes(v)), `clean LT 后缀 ⊆ styled: clean=${cs} styled=${ss}`);
    assert.ok(out.longTextCount.runs >= 1 && out.longTextCount.total >= out.longTextCount.runs);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试**

Run: `node --test test/unit/clean-snapshot.test.mjs -t "孪生守卫"`
Expected: PASS。若 `cs.every(...)` 失败——这是 spec §9 预警的反例场景：**停**，按 spec §9 的收紧手段（clean 趟记录集折叠排在 K10 之前）评估，属实现期决策、先报告再动。

- [ ] **Step 3: Commit**

```bash
git add test/unit/clean-snapshot.test.mjs
git commit -m "test(clean-snapshot): run 孪生守卫钉住——hidden 祖先 / K10 拆包 / K11 吞没

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: golden 复核 + 全量回归

**Files:**
- Modify: `test/fixtures/golden/*`（仅当 Task 5-8 修正过序列化行为时需再重生）
- 验证：全部测试

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 绿色全量套件 + golden 与最终代码一致。

- [ ] **Step 1: 全量测试**

Run: `pnpm test:all`
Expected: PASS。golden 若红：按 Task 4 Step 7 流程重生后复跑。

- [ ] **Step 2: 端到端冒烟（人工，可选但推荐）**

对一个含混排段落/公式的真实 URL 跑步骤 0-9（SMOKE.md 场景追加），检查 `9_markdown.md`：`**粗体**`/链接/行内 code/`$公式$` 来自确定性通道、无字面 `{{LONG_TEXT` 残留。发现问题时回对应任务修，不在本任务打补丁。

- [ ] **Step 3: Commit（如有 golden 变更）**

```bash
git add test/fixtures/golden/
git commit -m "test(golden): run 折叠最终行为对齐 golden 重生

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 文档同步

**Files:**
- Modify: `SKILL.md`（步骤 2 产物树注释、步骤 8 描述）
- Modify: `references/analyze_html_guide.md`（§占位符语义，line 213 附近）
- Modify: `references/markdown_skeleton_guide.md`（长文本引用规则，line 39 附近）
- Modify: `CLAUDE.md`（管线段长文本描述 + 步骤 8 段 + schema）

**Interfaces:**
- Consumes: 最终实现行为。
- Produces: 文档与实现一致（spec §6 全部条目）。

- [ ] **Step 1: SKILL.md**

步骤 2 产物树里：

```diff
-  2_long_text.json             # 占位符原文映射
+  2_long_text.json             # 占位符原文映射（texts 散文本 + runs 行内 run 规范化 HTML）
```

全文件 grep `长文本`/`LONG_TEXT` 确认无其他需要同步的描述（当前无——若有按新语义改写）。

- [ ] **Step 2: references/analyze_html_guide.md**

line 213 的占位符语义句改写为：

```markdown
- `{{LONG_TEXT|n_chars}}` / `{{LONG_TEXT|n_words}}` 为长文本占位符（清洗版**无编号**——编号只存在于带样式版还原链，与判读无关）。**整段形态是常态**：超阈值（>16 汉字 / >12 词）的极大纯行内 run（段落内 text 与 strong/em/code/a 等行内元素混排的整段内容）折叠为单个占位符；夹在块级子元素之间的散长文本节点同样占位；短文本（≤16 汉字 / ≤12 词）保留原文。占位符分布是判读线索——段落/标题/按钮的位置与体量看得到；`<title>` 原文保留（不占位）
```

（同文件示例区 line 292 附近若含散占位示意，保持不动——整段/散段形态对判读等价。）

- [ ] **Step 3: references/markdown_skeleton_guide.md**

line 39 的长文本引用规则条目后追加一条（同列表层级）：

```markdown
- LONG_TEXT 编号引用后由步骤 8 **确定性转换**还原：run 折叠的编号（混排段落的整段占位）写 `{"p": "{{LONG_TEXT_k}}"}` 即可，**不要**试图自行还原其中的行内格式（粗体/斜体/链接/行内 code/`$公式$` 都由转换器生成）；未折叠内容（含无源公式的段落、短文本）的行内格式照旧手写
```

- [ ] **Step 4: CLAUDE.md 管线段**

`docs/superpowers/specs/` 引用与三处描述同步：

1. 步骤 2 段：「超阈值 16 汉字/12 词的**单个文本节点**折叠为 `{{LONG_TEXT_k|n_chars}}`/`{{LONG_TEXT_k|n_words}}`，行内结构 a/code/strong 混排保真，K8 行内 run 整段折叠已废除」替换为：

```markdown
超阈值 16 汉字/12 词的内容按两级折叠（spec 2026-09-06：`docs/superpowers/specs/2026-09-06-long-text-inline-run-design.md`）——**极大纯行内 run**（流容器内 text 与行内元素混排的整段内容；检测/规范化序列化在两趟共享段末尾执行、结果挂元素 expando，孪生守卫由构造保证）折为单个 `{{LONG_TEXT_k|n_unit}}`、原文以剥净属性的 canonical HTML 片段入 `2_long_text.json` 的 `runs` 段（span 按 computed style 归一 strong/em/del、math 压成仅含 annotation 的极简形态、href 绝对化、`#`/`javascript:`/空 href 解包）；**散文本节点**（非纯容器/表格/pre 内部）照旧逐节点折叠入 `texts` 段；k 全文档序连续单计数器。table/pre/svg/style 子树与 h1-h3 整子树豁免 run 折叠；含 `[hidden]`/display:none 元素或无源 math 的 run 阻断不折；步骤 8 `inline2md` 确定性转 markdown（含 `$$…$$`）
```

2. 步骤 8 段（screenshot_trans 描述处）：「先纯 Node 把步骤 7 骨架里所有 `{{LONG_TEXT_k[|suffix]}}` 替换为 `2_long_text.json` 原文」扩写为「先纯 Node 把 `2_long_text.json` 两段的 `runs` 逐 k 经 `lib/inline2md.mjs` 转成 markdown 值（异常退回 textContent 纯文本 + warning）、与 `texts` 合并为扁平解析表，再把步骤 7 骨架里所有 `{{LONG_TEXT_k[|suffix]}}` 替换为解析表值（emit 增 `runsResolved`）」。

3. 产物列表处 `2_long_text.json` 并列描述补一句（紧跟现有「原文进 `2_long_text.json`」之后）：

```markdown
（两段 schema：`texts` 散文本纯文本 + `runs` 行内 run 规范化 HTML，单一计数器全局编号；table2md/code2md 的 expandLongText 只消费 `texts` 段——表格/pre 子树被 run 检测的位置条件排除、其内部永远只有散文本占位符，扁平展开表零改动）
```

- [ ] **Step 5: 验证文档与实现一致**

```bash
grep -n "单个文本节点" SKILL.md references/*.md CLAUDE.md   # 应无残留旧描述（CLAUDE.md 历史记录性文字除外——只改现行规则段）
pnpm test                                                    # 文档改动零测试影响，跑一遍防手滑
```

- [ ] **Step 6: Commit**

```bash
git add SKILL.md references/analyze_html_guide.md references/markdown_skeleton_guide.md CLAUDE.md
git commit -m "docs(skill): 长文本行内 run 折叠——SKILL/步骤 3 指南/步骤 7 指南/CLAUDE.md 同步

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 自审记录（写计划时已核对，自审修订已并入各任务）

- **Spec 覆盖**：§3.1 共享段时机（Task 4a/b）、§3.2 判定五条（Task 4b）、§3.3 序列化表（Task 4b + Task 5/6 钉住）、§3.4 两趟执行与边缘（Task 4c + Task 8）、§3.5 步骤 3 视角（Task 10 Step 2）、§4 schema（Task 4 Step 4 + Task 10 Step 4.3）、§5.1-5.5（Task 1-3 + Task 7）、§6 文档（Task 10）、§7 测试（各任务 + Task 9 端到端）、§8 文件清单（一一对应）、§9 风险（Task 8 收紧预案）。
- **两处实现细化（不违背 spec）**：① `document.baseURI` 在共享段开头捕获（spec §3.3 说「快照已注入 `<base>`」，但共享段步骤 3 会删 base——先捕获再删，语义相同）；② 检测循环的判定顺序（形状 → 极大性 → 阈值 → 序列化）为成本优化，判定结果与 spec 条件集合等价。
- **自审发现并已修入计划**：Task 6 原夹具的 `.katex-display` 独立容器过不了体量门槛（块级公式须在够长段落流内才折——阈值对 run 一律生效，spec §3.2-5）；Task 7 补齐 spec §7 的 9_markdown 端到端断言；golden 重生改从 stdout JSON 取产物路径。
- **已知迁移面**：`out.longTextCount` 六处数值断言（Task 4 Step 6 列明行号）、screenshot-trans/code-restore 夹具两段化、golden 四文件重生——全部有专属步骤。
