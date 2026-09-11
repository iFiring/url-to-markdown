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

test('强调嵌套：递归下降天然支持；跨族嵌套边界触 * → 换 __/_ 备选定界符（2026-09-11 修订，取代 raw HTML 退化）', () => {
  assert.equal(inlineRunToMarkdown('<strong>a <em>b</em> c</strong>'),
    '**a *b* c**');
  // 跨族嵌套：内层先产出 **x**，外层 *…* 内容首/尾触 * → 换 _ 定界符
  // （marked --gfm 实渲 <em><strong>x</strong></em>，等价）
  assert.equal(inlineRunToMarkdown('<em><strong>x</strong></em>'), '_**x**_');
  assert.equal(inlineRunToMarkdown('<strong><em>x</em></strong>'), '__*x*__');
  // 三重嵌套：R2 亲链跨族不误并，逐层择优定界符
  assert.equal(inlineRunToMarkdown('<strong><em><strong>x</strong></em></strong>'), '**_**x**_**');
});

test('同族嵌套强调并为一层（微信双层加粗：strong 套 bold span 归一产物）', () => {
  assert.equal(inlineRunToMarkdown('<strong><strong>x</strong></strong>'), '**x**');
  assert.equal(inlineRunToMarkdown('<strong><b>x</b></strong>'), '**x**');
  assert.equal(inlineRunToMarkdown('<em><i>x</i></em>'), '*x*');
  assert.equal(inlineRunToMarkdown('<del><s>x</s></del>'), '~~x~~');
  // 多个内层段全部并入外层
  assert.equal(inlineRunToMarkdown('<strong><strong>A</strong><strong>B</strong></strong>'), '**AB**');
  // 跨族保留：strong 内 em 不被误并
  assert.equal(inlineRunToMarkdown('<strong>a<em>b</em>c</strong>'), '**a*b*c**');
});

test('强调边界空白/br：R3 提升到元素外，md 形态不再退化', () => {
  assert.equal(inlineRunToMarkdown('<strong> x</strong>'), ' **x**');
  assert.equal(inlineRunToMarkdown('<em>y </em>'), '*y* ');
  assert.equal(inlineRunToMarkdown('<strong> x </strong>'), ' **x** ');
  assert.equal(inlineRunToMarkdown('<strong>a<br></strong>b'), '**a**\\\nb');
});

test('空白/br-only 强调壳解包（R1）；中部 br 保留为硬换行', () => {
  assert.equal(inlineRunToMarkdown('前<strong><br></strong>后'), '前\\\n后');
  assert.equal(inlineRunToMarkdown('前<strong> </strong>后'), '前 后');
  assert.equal(inlineRunToMarkdown('<em><br></em>'), '');
});

test('run 尾部悬空 br 剥离（R4）；中部硬换行不受影响', () => {
  assert.equal(inlineRunToMarkdown('a<br>'), 'a');
  assert.equal(inlineRunToMarkdown('a<br><br>'), 'a');
  assert.equal(inlineRunToMarkdown('<u>x<br></u>'), '<u>x</u>');
  assert.equal(inlineRunToMarkdown('<strong>a<br></strong>'), '**a**');
  assert.equal(inlineRunToMarkdown('a<br>b<br>'), 'a\\\nb');
});

test('微信实测形态端到端：双层加粗 + br 壳 → 单层 **', () => {
  assert.equal(
    inlineRunToMarkdown('<strong><strong>作者：</strong><strong>尤逸晖，Datawhale优秀学习者</strong><strong><br></strong></strong>'),
    '**作者：尤逸晖，Datawhale优秀学习者**'
  );
  assert.equal(
    inlineRunToMarkdown('而是<strong><strong>工程设计是否扎实</strong></strong><strong>。</strong>'),
    '而是**工程设计是否扎实****。**'
  );
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

test('空强调元素产出空串（编辑器残留 <strong></strong> 不输出 ****）', () => {
  assert.equal(inlineRunToMarkdown('前<strong></strong>后'), '前后');
  assert.equal(inlineRunToMarkdown('<em></em>'), '');
});

test('href 含不配对括号或角括号：角括号包裹 + < > 百分号转义（CommonMark 链接目标语法）', () => {
  assert.equal(inlineRunToMarkdown('<a href="https://x.com/a(b">t</a>'), '[t](<https://x.com/a(b>)');
  assert.equal(inlineRunToMarkdown('<a href="https://x.com/a>b">t</a>'), '[t](<https://x.com/a%3Eb>)');
});
