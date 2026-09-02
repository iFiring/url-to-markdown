import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-collect-tables.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('page-collect-tables.js: 文件存在且含 __u2mCollectTables', () => {
  assert.ok(src().includes('function __u2mCollectTables'), '应定义 __u2mCollectTables');
});

test('__u2mCollectTables: 可被 evaluate 格式调用', () => {
  assert.doesNotThrow(() => new Function('return (' + src() + ')()'));
});

// 用 jsdom 跑真实 DOM 验证收集逻辑
function run(html) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'return (' + src() + ')()');
  return fn(dom.window.document);
}

test('__u2mCollectTables: 文档序编号、跳过 [hidden] 表、colspan 展开列数', () => {
  const html = `
    <table data-idx="10" hidden><thead><tr><th>H</th></tr></thead></table>
    <table data-idx="20"><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td colspan="2">合并</td></tr></tbody></table>`;
  const list = run(html);
  assert.equal(list.length, 1, 'hidden 表跳过');
  assert.equal(list[0].k, 1, '编号从 1、跳过 hidden 后紧接');
  assert.equal(list[0].dataIdx, '20');
  assert.equal(list[0].rows, 2);
  assert.equal(list[0].cols, 2, 'colspan=2 展开为 2 列');
  assert.match(list[0].outerHTML, /<table[^>]*data-idx="20"/);
});

test('__u2mCollectTables: 嵌套表行归属最近 table（外层不计内层行）', () => {
  const html = `<table data-idx="1"><tbody><tr><td>外</td>
    <td><table data-idx="2"><tbody><tr><td>内</td></tr></tbody></table></td></tr></tbody></table>`;
  const list = run(html);
  assert.equal(list.length, 2);
  const outer = list.find((t) => t.dataIdx === '1');
  const inner = list.find((t) => t.dataIdx === '2');
  assert.equal(outer.rows, 1, '外层只 1 行（内层行不计）');
  assert.equal(inner.rows, 1);
});
