import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFinalizeInline', () => {
  assert.ok(src().includes('function __u2mFinalizeInline'));
});

// finalize 需 computedMap 参数；传 {} 即可（table 分支在 computedMap 之前）
function run(html) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'return (' + src() + ')({})');
  fn(dom.window.document);
  return dom.window.document;
}

test('失败 live 表子树全部 style 删除', () => {
  const html = `<table data-u2m-table="fail" style="border:1px solid red">
    <thead><tr><th style="background:#eef;font-weight:bold">H</th></tr></thead>
    <tbody><tr><td style="border:1px solid blue;color:red">a</td></tr></tbody></table>`;
  const doc = run(html);
  assert.equal(doc.querySelector('table').getAttribute('style'), null, 'table 自身 style 删除');
  assert.equal(doc.querySelector('th').getAttribute('style'), null, 'th style 删除');
  assert.equal(doc.querySelector('td').getAttribute('style'), null, 'td style 删除');
});

test('成功折叠表（仅文本节点、无 [style] 子树）→ no-op', () => {
  const html = `<table data-idx="5">{{TABLE_1|2×2}}</table>`;
  const doc = run(html);
  assert.equal(doc.querySelector('table').getAttribute('style'), null);
  assert.match(doc.body.textContent, /\{\{TABLE_1/);
});

test('表外元素样式不受影响（仍走白名单）', () => {
  const html = `<div style="display:flex;border:1px solid green"><p style="font-size:14px">x</p></div>
    <table><tbody><tr><td style="border:1px solid red">y</td></tr></tbody></table>`;
  const doc = run(html);
  const div = doc.querySelector('div');
  assert.match(div.getAttribute('style') || '', /display/i);
  assert.match(div.getAttribute('style') || '', /border/i);
  assert.equal(doc.querySelector('td').getAttribute('style'), null);
});
