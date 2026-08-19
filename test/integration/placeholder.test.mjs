// test/integration/placeholder.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openPage } from '../../script/lib/browser.mjs';
import { makeCtx, processMermaid, processImages, applyClassifyPlan, writeManifest, readSharedScript } from '../../script/lib/placeholder.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

let fx;
before(async () => { await writePixelPng('test/fixtures/pixel.png'); fx = await startFixtureServer(); });
after(async () => { await fx.close(); });

const tmpDirs = () => {
  const root = fs.mkdtempSync('/tmp/u2m-wf-');
  const assets = `${root}/assets`;
  for (const d of ['draft', 'complex', 'images']) fs.mkdirSync(`${assets}/${d}`, { recursive: true });
  return { wf: root, assets, draft: `${assets}/draft`, complex: `${assets}/complex`, images: `${assets}/images`, manifest: `${assets}/manifest.json` };
};

test('共享脚本可读取且为具名函数声明', async () => {
  for (const n of ['page-init.js', 'page-prepare.js', 'page-derive.js', 'page-clean.js', 'page-inline.js', 'page-latex.js']) {
    const src = await readSharedScript(n);
    assert.ok(/^function __u2m/.test(src.trim()), `${n} 应以 function __u2m 开头`);
  }
});

test('applyClassifyPlan: delete/code_block/block_screenshot 分支（setContent 迷你快照）', async () => {
  const dirs = tmpDirs();
  const s = await openPage('about:blank', { viewport: { width: 1280, height: 800 } });
  try {
    await s.page.setContent(`<!doctype html><html><body>
      <main data-u2m-id="1">
        <div class="ad" data-u2m-id="2">AD_BLOCK</div>
        <pre data-lang="python" data-u2m-id="3"><code>def hi(): pass</code></pre>
        <div class="chart" data-u2m-id="4" style="width:200px;height:100px"><canvas></canvas></div>
      </main></body></html>`, { waitUntil: 'domcontentloaded' });
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    const n = await applyClassifyPlan(s.page.mainFrame(), ctx, {
      version: 2, mode: 'whole', listFlowSelector: 'main',
      blocks: [
        { id: 1, action: 'keep' },
        { id: 2, action: 'delete' },
        { id: 3, action: 'code_block' },
        { id: 4, action: 'block_screenshot', blockOf: 4 },
      ],
    });
    assert.equal(n, 4);
    const html = await s.page.evaluate(() => document.body.innerHTML);
    assert.doesNotMatch(html, /AD_BLOCK/);
    assert.match(html, /<pre data-u2m-code(?:="")?><code class="language-python">def hi\(\): pass<\/code><\/pre>/);
    assert.match(html, /<img src="assets\/complex\/COMPLEX_DIV_1\.png"[^>]*data-u2m-asset="1">/);
    assert.deepEqual(ctx.entries.map((e) => e.type), ['block_screenshot']);
    assert.equal(ctx.entries[0].status, 'done');
    assert.ok(fs.existsSync(`${dirs.complex}/COMPLEX_DIV_1.png`));
  } finally { await s.close(); }
});

test('mermaid: 源码钩子命中 → 替换为 language-mermaid 代码块', async () => {
  const dirs = tmpDirs();
  const s = await openPage(`${fx.url}/mermaid.html`, {
    viewport: { width: 1280, height: 800 },
    initScripts: [await readSharedScript('page-init.js')],
  });
  try {
    await s.page.waitForTimeout(300); // 等模拟渲染完成
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    const n = await processMermaid(s.page.mainFrame(), ctx);
    assert.equal(n, 1);
    assert.equal(ctx.entries[0].type, 'mermaid');
    assert.equal(ctx.entries[0].status, 'done');
    const code = await s.page.locator('pre > code.language-mermaid').textContent();
    assert.equal(code, 'graph TD; A-->B');
    // 渲染后的 svg 已随容器替换消失，不再走 passthrough
    assert.equal(await s.page.locator('svg').count(), 0);
  } finally { await s.close(); }
});
