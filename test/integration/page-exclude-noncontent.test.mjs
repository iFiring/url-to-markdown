// 分类层语义单测（spec §3.1 / §5）：真实浏览器 setContent + 注入共享脚本，
// 直接断言保护规则矩阵——keep 自身/祖先/子孙保、非内容藏、delete 在 keep
// 子树内藏、delete 为 keep 祖先时保优先、子代显式 visible 穿透一并覆写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-exclude-noncontent.js');

test('page-exclude-noncontent.js: 文件存在且包含 __u2mExcludeNonContent 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mExcludeNonContent'), '应定义 __u2mExcludeNonContent');
});

test('page-exclude-noncontent.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})([1], [])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

// 矩阵夹具：
//   #1 keep 标题（子孙 #2 保、#8 delete 在子树内→藏）
//   #3 非内容侧栏（→藏），内含未打标子代 span（显式 visibility:visible，穿透→一并藏，不计入 hidden 计数）
//   #4 非内容包装（→藏），内含 #5 delete（→藏）
//   #6 delete 但同时是 keep #7 的祖先（保优先→保），#7 keep（→保）
const MATRIX_HTML = `<!DOCTYPE html><html><body>
<div data-u2m-id="1" id="title">标题 <span data-u2m-id="2" id="inner">内文</span> <span data-u2m-id="8" id="del-inside">子树噪音</span></div>
<div data-u2m-id="3" id="sidebar">侧栏 <span id="penetrator" style="visibility: visible">穿透</span></div>
<div data-u2m-id="4" id="outer">包装 <span data-u2m-id="5" id="del-noise">噪音</span></div>
<div data-u2m-id="6" id="del-ancestor">容器 <span data-u2m-id="7" id="kept-child">正文</span></div>
</body></html>`;

test('__u2mExcludeNonContent: 保护规则矩阵（keep/祖先/子孙/delete/保优先/穿透）', async () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(MATRIX_HTML);
    const r = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    // 藏：#3 #4 #5 #8 #9（#9 未打标不计入 hidden 计数，但穿透覆写生效）
    assert.deepEqual(r, { hidden: 4, kept: 2 },
      `隐藏 #3/#4/#5/#8，keep 命中 #1/#7: ${JSON.stringify(r)}`);
    const vis = await page.evaluate(() => ({
      title: getComputedStyle(document.getElementById('title')).visibility,
      inner: getComputedStyle(document.getElementById('inner')).visibility,
      sidebar: getComputedStyle(document.getElementById('sidebar')).visibility,
      penetrator: getComputedStyle(document.getElementById('penetrator')).visibility,
      outer: getComputedStyle(document.getElementById('outer')).visibility,
      delNoise: getComputedStyle(document.getElementById('del-noise')).visibility,
      delInside: getComputedStyle(document.getElementById('del-inside')).visibility,
      delAncestor: getComputedStyle(document.getElementById('del-ancestor')).visibility,
      keptChild: getComputedStyle(document.getElementById('kept-child')).visibility,
    }));
    assert.equal(vis.title, 'visible', 'keep 自身保');
    assert.equal(vis.inner, 'visible', 'keep 子孙保');
    assert.equal(vis.sidebar, 'hidden', '非内容藏');
    assert.equal(vis.penetrator, 'hidden', '子代显式 visible 穿透一并覆写');
    assert.equal(vis.outer, 'hidden', '非内容包装藏');
    assert.equal(vis.delNoise, 'hidden', 'delete 噪音藏');
    assert.equal(vis.delInside, 'hidden', 'delete 在 keep 子树内也藏');
    assert.equal(vis.delAncestor, 'visible', 'delete 为 keep 祖先时保优先');
    assert.equal(vis.keptChild, 'visible', 'keep 命中保');
  } finally {
    await browser.close();
  }
});

test('__u2mExcludeNonContent: 幂等——重复执行零额外副作用', async () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(MATRIX_HTML);
    const r1 = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    const r2 = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    assert.deepEqual(r1, r2, '两次执行结果一致（重复覆写无副作用）');
  } finally {
    await browser.close();
  }
});
