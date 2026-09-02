import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-fold-tables.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFoldTables', () => {
  assert.ok(src().includes('function __u2mFoldTables'));
});

function run(html, resultByDataIdx) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'resultByDataIdx', 'return (' + src() + ')(resultByDataIdx)');
  fn(dom.window.document, resultByDataIdx);
  return dom.window.document;
}

test('成功表折叠为 {{TABLE_k|rows×cols}} 文本、失败表保 live + data-u2m-table=fail', () => {
  const html = `
    <table data-idx="10"><thead><tr><th>H</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>
    <table data-idx="20"><tbody><tr><td>无表头</td></tr></tbody></table>`;
  const doc = run(html, { '10': { k: 1, status: 'ok', rows: 2, cols: 1 }, '20': { k: 2, status: 'failed', rows: 1, cols: 1 } });
  const t1 = doc.querySelector('table[data-idx="10"]');
  const t2 = doc.querySelector('table[data-idx="20"]');
  assert.equal(t1.textContent, '{{TABLE_1|2×1}}');
  assert.equal(t1.children.length, 0, '成功表子树清空');
  assert.equal(t2.getAttribute('data-u2m-table'), 'fail');
  assert.ok(t2.querySelector('td'), '失败表保 live 子树');
});

test('[hidden] 表不被折叠（K5 独占）', () => {
  const html = `<table data-idx="30" hidden><tbody><tr><td>x</td></tr></tbody></table>`;
  const doc = run(html, { '30': { k: 1, status: 'ok', rows: 1, cols: 1 } });
  const t = doc.querySelector('table[data-idx="30"]');
  assert.ok(t.querySelector('td'), 'hidden 表子树保留');
  assert.equal(t.textContent.includes('{{TABLE'), false);
});
