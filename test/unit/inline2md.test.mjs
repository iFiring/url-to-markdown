// test/unit/inline2md.test.mjs
// inline2md 单测：canonical HTML 片段 → GFM 行内 markdown（spec 2026-09-06 §5）。
// 转义规则（§5.3 自审修订）：常规文本反斜杠转义活动字符 + 行首中断符；
// code span 与 math 源照抄不转义（Task 3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineRunToMarkdown, runTextContent } from '../../script/lib/inline2md.mjs';

test('文本转义：活动字符反斜杠转义，普通字符照抄', () => {
  assert.equal(
    inlineRunToMarkdown('价格 $5 与 *星号* [链接] <标签> ~波浪~'),
    '价格 \\$5 与 \\*星号\\* \\[链接\\] \\<标签> \\~波浪\\~'
  );
  assert.equal(inlineRunToMarkdown('反斜杠 \\ 与反引号 ` 下划线 _'), '反斜杠 \\\\ 与反引号 \\` 下划线 \\_');
});

test('文本转义：! 仅在后随 [ 时转义（防误触图片下载扫描）', () => {
  assert.equal(inlineRunToMarkdown('看图![alt](u)'), '看图\\!\\[alt\\](u)');
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
  // 内容以强调记号开头（嵌套强调）：** *x* ** 不闭合 → 退化（逐节点——外层
  // 退化时内层已是 markdown，CommonMark 对 raw HTML 内联内容仍解析，
  // 渲染等价 <strong><em>x</em></strong>）
  assert.equal(inlineRunToMarkdown('<strong><em>x</em></strong>'), '<strong>*x*</strong>');
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
