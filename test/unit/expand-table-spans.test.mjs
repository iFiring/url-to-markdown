import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { expandTableSpans, parseSpan, parseRowspan } from '../../script/lib/expand-table-spans.mjs';

function docOf(html) { return new JSDOM(`<html><body>${html}</body></html>`).window.document; }
// 展开后取首个 table 的网格：返回 [[cellText, tag], ...] 行数组（tag = 'th'|'td'）
function grid(doc) {
  const tb = doc.querySelector('table');
  const trs = [...tb.querySelectorAll('tr')].filter((tr) => tr.closest('table') === tb);
  return trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName))
    .map((c) => [c.textContent, c.tagName.toLowerCase()]));
}

test('parseSpan: 非法值/0/负数按 1，正常值原样，上限 1000', () => {
  assert.equal(parseSpan('1'), 1);
  assert.equal(parseSpan('0'), 1);
  assert.equal(parseSpan('abc'), 1);
  assert.equal(parseSpan('-3'), 1);
  assert.equal(parseSpan('3'), 3);
  assert.equal(parseSpan('5000'), 1000);
});

test('parseRowspan: 0 延伸到表尾（remainingRows）', () => {
  assert.equal(parseRowspan('0', 4), 4);
  assert.equal(parseRowspan('2', 4), 2);
  assert.equal(parseRowspan('0', 1), 1);
});

test('纯 rowspan：跨行单元格内容重复填充到覆盖的每一行', () => {
  const d = docOf(`<table><tbody>
    <tr><td rowspan="2">Q1</td><td>150</td></tr>
    <tr><td>250</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['Q1','td'],['150','td']], [['Q1','td'],['250','td']]]);
});

test('纯 colspan：跨列单元格内容重复填充到覆盖的每一列', () => {
  const d = docOf(`<table><tbody><tr><td colspan="2">合并</td><td>B</td></tr></tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['合并','td'],['合并','td'],['B','td']]]);
});

test('rowspan × colspan 交叉：列对齐无错位', () => {
  const d = docOf(`<table><thead>
    <tr><th rowspan="2">时间</th><th colspan="2">上午</th></tr>
    <tr><th>第1节</th><th>第2节</th></tr>
  </thead><tbody><tr><td>周一</td><td>语文</td><td>数学</td></tr></tbody></table>`);
  expandTableSpans(d);
  // 首行: 时间(占1列) + 上午(跨2列展开) = 3 列；第二行 col0 被 时间 rowspan 覆盖
  // → 填充格复制 时间 内容。多行 thead 降级把第二行 th→td 移入 tbody，故第二行
  // 全 td（与参考 cross_table.md 输出一致：时间作为数据行重复）
  assert.deepEqual(grid(d), [
    [['时间','th'],['上午','th'],['上午','th']],
    [['时间','td'],['第1节','td'],['第2节','td']],
    [['周一','td'],['语文','td'],['数学','td']],
  ]);
});

test('rowspan="0" 延伸到表格末尾', () => {
  const d = docOf(`<table><tbody>
    <tr><td rowspan="0">A</td><td>1</td></tr>
    <tr><td>2</td></tr>
    <tr><td>3</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['1','td']], [['A','td'],['2','td']], [['A','td'],['3','td']]]);
});

test('rowspan 超出剩余行数时截断到表尾', () => {
  const d = docOf(`<table><tbody><tr><td rowspan="9">A</td><td>1</td></tr><tr><td>2</td></tr></tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['1','td']], [['A','td'],['2','td']]]);
});

test('无跨单元格的表不受预处理影响（早退）', () => {
  const html = `<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>`;
  const d = docOf(html);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['B','td']]]);
});

test('多行 thead：第 2 行起降级为 tbody 数据行', () => {
  const d = docOf(`<table><thead>
    <tr><th>H1</th><th>H2</th></tr>
    <tr><th>S1</th><th>S2</th></tr>
  </thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`);
  expandTableSpans(d);
  // 无跨越 → 表本身不动，但多行 thead 降级逻辑对 >1 行 thead 仍执行
  const theadRows = d.querySelectorAll('thead tr').length;
  const tbodyRows = d.querySelectorAll('tbody tr').length;
  assert.equal(theadRows, 1, 'thead 只剩 1 行');
  assert.equal(tbodyRows, 2, '原 thead 第 2 行降级进 tbody（加原 tbody 1 行 = 2）');
});

test('参差行：跨列表展开后参差行补空 td 保证矩形', () => {
  // colspan=3 定 width=3；第二行仅 1 单元格 → 补 2 个空 td
  const d = docOf(`<table><tbody>
    <tr><td colspan="3">宽</td></tr>
    <tr><td>D</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  const g = grid(d);
  assert.equal(g[0].length, 3);
  assert.equal(g[1].length, 3, '参差行补齐到 3 列');
  assert.equal(g[1][1][0], '', '补位为空');
  assert.equal(g[1][1][1], 'td', '补位标签为 td');
  assert.equal(g[1][2][1], 'td');
});

test('填充格保持原标签类型（th→th / td→td），不破坏表头行判定', () => {
  const d = docOf(`<table><thead><tr><th colspan="2">合并头</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`);
  expandTableSpans(d);
  const g = grid(d);
  assert.equal(g[0][0][1], 'th', '原 th 保留');
  assert.equal(g[0][1][1], 'th', 'colspan 填充格也是 th（复制原标签）');
});
