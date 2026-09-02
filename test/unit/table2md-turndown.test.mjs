import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertTable as convertSelf } from '../../script/lib/table2md-self.mjs';
import { convertTable as convertTd } from '../../script/lib/table2md-turndown.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const crossHtml = fs.readFileSync(
  path.resolve(thisDir, '../../.temp/cross_table/cross_table.html'), 'utf8');

test('turndown 引擎：正常表 → ok 含表头/分隔/数据行', () => {
  const r = convertTd(`<table><thead><tr><th>S</th><th>I</th></tr></thead><tbody><tr><td>m</td><td>L</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.match(r.markdown, /\| S \| I \|/);
  assert.match(r.markdown, /\| --- \| --- \|/);
});

test('turndown 引擎：跨行跨列表与 self 列数等价（均 5 列）', () => {
  const m = crossHtml.match(/<table[\s\S]*?<\/table>/);
  const a = convertSelf(m[0]);
  const b = convertTd(m[0]);
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  const cols = (md) => md.split('\n')[0].split('|').filter((x) => x.trim() !== '').length;
  assert.equal(cols(a.markdown), cols(b.markdown), '两引擎列数一致');
  assert.equal(cols(b.markdown), 5);
});

test('turndown 引擎：无 <th> → failed', () => {
  const r = convertTd(`<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});

test('turndown 引擎：嵌套块级内容 → failed', () => {
  const r = convertTd(`<table><thead><tr><th>H</th></tr></thead><tbody><tr><td><pre>x</pre></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});
