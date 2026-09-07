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
