import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertTable } from '../../script/lib/table2md-self.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const crossHtml = fs.readFileSync(
  path.resolve(thisDir, '../../.temp/cross_table/cross_table.html'), 'utf8');
// cross_table.html 整页含 <h1>/<p>/<table>；convertTable 只转首个 <table>

test('正常表（thead+th、无跨格）→ ok，含表头/分隔/数据行', () => {
  const r = convertTable(`<table><thead><tr><th>Setting</th><th>Impact</th></tr></thead>
    <tbody><tr><td>model</td><td>大</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  const lines = r.markdown.split('\n');
  assert.equal(lines[0], '| Setting | Impact |');
  assert.equal(lines[1], '| --- | --- |');
  assert.equal(lines[2], '| model | 大 |');
});

test('跨行跨列表 → ok，输出与 cross_table.md 同构（5 列、跨格内容重复填充）', () => {
  // cross_table.html 的表：thead row0 = 时间(rowspan2) + 上午(colspan2) + 下午(colspan2) = 5 列
  const m = crossHtml.match(/<table[\s\S]*?<\/table>/);
  assert.ok(m, 'cross_table.html 应含一个 table');
  const r = convertTable(m[0]);
  assert.equal(r.status, 'ok');
  const rows = r.markdown.split('\n');
  // 表头行 5 列：时间 | 上午 | 上午 | 下午 | 下午
  assert.equal(rows[0], '| 时间 | 上午 | 上午 | 下午 | 下午 |');
  assert.equal(rows[1], '| --- | --- | --- | --- | --- |');
  // 第二行（demoted thead row1，全 td）：时间 | 第1节 | 第2节 | 第3节 | 第4节
  assert.equal(rows[2], '| 时间 | 第1节 | 第2节 | 第3节 | 第4节 |');
  // 数据行：周一 重复（rowspan 填充）
  assert.equal(rows[3], '| 周一 | 语文 | 数学 | 英语 | 体育 |');
  assert.equal(rows[4], '| 周一 | 物理 | 化学 | 生物 | 历史 |');
});

test('单元格内 | 被转义、换行被空格化', () => {
  const r = convertTable(`<table><thead><tr><th>A</th></tr></thead>
    <tbody><tr><td>x|y</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.ok(r.markdown.includes('\\|'), '管道符转义');
});

test('行内格式：<code>→反引号、<a href>→[text](url)、<strong>→**', () => {
  const r = convertTable(`<table><thead><tr><th>H</th></tr></thead><tbody>
    <tr><td><a href="/x"><code>model</code></a> <strong>重要</strong></td></tr>
    </tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.match(r.markdown, /\[`model`\]\(\/x\)/);
  assert.match(r.markdown, /\*\*重要\*\*/);
});

test('无 <th> 表 → failed（reason=no header）', () => {
  const r = convertTable(`<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /no.*header/i);
});

test('单元格嵌套 <table>/<pre> 块级内容 → failed', () => {
  const r = convertTable(`<table><thead><tr><th>H</th></tr></thead><tbody>
    <tr><td><pre>code</pre></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /nested|block/i);
});

test('空表 → failed', () => {
  const r = convertTable(`<table></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /empty/i);
});

test('退化空网格（全空单元格）→ failed', () => {
  const r = convertTable(`<table><thead><tr><th></th></tr></thead><tbody><tr><td></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});
