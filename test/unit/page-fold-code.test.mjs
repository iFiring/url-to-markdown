import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-fold-code.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFoldCode', () => {
  assert.ok(src().includes('function __u2mFoldCode'));
});

function run(html, resultByDataIdx) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'resultByDataIdx', 'return (' + src() + ')(resultByDataIdx)');
  fn(dom.window.document, resultByDataIdx);
  return dom.window.document;
}

test('成功块折叠为 {{CODE_k|n_lines}}——data-language 提升、子树清空', () => {
  const doc = run(
    `<pre data-idx="10"><code data-language="tsx" data-idx="11"><span data-idx="12">system:</span> \`...\`</code></pre>`,
    { 10: { k: 1, status: 'ok', lines: 22, lang: 'tsx' } });
  const pre = doc.querySelector('pre[data-idx="10"]');
  assert.equal(pre.textContent, '{{CODE_1|22_lines}}');
  assert.equal(pre.children.length, 0, '子树清空');
  assert.equal(pre.getAttribute('data-language'), 'tsx', 'lang 提升到 pre');
});

test('lang 来自 class 推断（无 data-language）时也提升', () => {
  const doc = run(
    `<pre data-idx="20"><code class="language-python" data-idx="21">x = 1</code></pre>`,
    { 20: { k: 2, status: 'ok', lines: 1, lang: 'python' } });
  assert.equal(doc.querySelector('pre[data-idx="20"]').getAttribute('data-language'), 'python');
});

test('失败块保 live + data-u2m-code=fail', () => {
  const doc = run(
    `<pre data-idx="30"><code data-idx="31"><img src="x"></code></pre>`,
    { 30: { k: 3, status: 'failed', lines: 1, lang: '' } });
  const pre = doc.querySelector('pre[data-idx="30"]');
  assert.equal(pre.getAttribute('data-u2m-code'), 'fail');
  assert.ok(pre.querySelector('img'), '子树保留');
});

test('!parentNode / [hidden] / map 未命中均跳过折叠与标记', () => {
  const doc = run(
    `<div><pre data-idx="40"><code data-idx="41">kept</code></pre></div>
     <pre data-idx="50" hidden><code data-idx="51">hidden</code></pre>
     <pre data-idx="60"><code data-idx="61">unmapped</code></pre>`,
    {});
  // 先取引用再 detach——脱离文档树后 querySelector 找不到
  const p40 = doc.querySelector('pre[data-idx="40"]');
  const p50 = doc.querySelector('pre[data-idx="50"]');
  const p60 = doc.querySelector('pre[data-idx="60"]');
  p40.parentNode.removeChild(p40); // detach
  assert.ok(!p40.textContent.includes('{{CODE'), 'detached 跳过');
  assert.ok(!p50.textContent.includes('{{CODE'), 'hidden 跳过（K5 独占）');
  assert.equal(p50.getAttribute('data-u2m-code'), null, 'hidden 不打标记');
  assert.equal(p60.textContent, 'unmapped', 'map 未命中不动');
  assert.equal(p60.getAttribute('data-u2m-code'), null);
});
