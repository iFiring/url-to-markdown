// test/integration/placeholder.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openPage } from '../../script/lib/browser.mjs';
import { makeCtx, processMermaid, processSpecialElements, processImages, writeManifest, readSharedScript } from '../../script/lib/placeholder.mjs';
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
  for (const n of ['page-init.js', 'page-merge.js', 'page-clean.js', 'page-classify.js', 'page-inline.js', 'page-latex.js']) {
    const src = await readSharedScript(n);
    assert.ok(/^function __u2m/.test(src.trim()), `${n} 应以 function __u2m 开头`);
  }
});

test('complex-elements: 四类分派 + latex 直出 + 图片下载 + manifest', async () => {
  const dirs = tmpDirs();
  const s = await openPage(`${fx.url}/complex-elements.html`, {
    viewport: { width: 1280, height: 800 },
    initScripts: [await readSharedScript('page-init.js')],
  });
  try {
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    await s.page.evaluate('(' + (await readSharedScript('page-merge.js')) + ')()');
    const mermaidN = await processMermaid(s.page.mainFrame(), ctx);
    assert.equal(mermaidN, 0);
    await processSpecialElements(s.page.mainFrame(), ctx);
    const imgs = await processImages(s.page.mainFrame(), ctx);

    // canvas → screenshot png；svg → passthrough svg；chart → svg_convert draft；katex → $$..$$ 直出；video → screenshot png
    const byType = Object.fromEntries(ctx.entries.map((e) => [e.type, e]));
    assert.ok(fs.existsSync(byType.screenshot.final.replace('assets/', `${dirs.assets}/`)), 'canvas/video 截图存在');
    assert.ok(fs.existsSync(byType.passthrough_svg.final.replace('assets/', `${dirs.assets}/`)), 'svg 导出存在');
    const draftFile = `${dirs.wf}/${byType.svg_convert.draft}`;
    assert.ok(fs.existsSync(draftFile), 'chart draft 存在');
    assert.match(fs.readFileSync(draftFile, 'utf8'), /style=/); // 计算样式已内联
    assert.equal(byType.latex.status, 'done'); // annotation 直出，不经 LLM

    const bodyText = await s.page.locator('body').innerText();
    assert.match(bodyText, /\$\$E=mc\^2\$\$/);            // latex 已替换为 $$..$$
    assert.match(bodyText, /\{\{COMPLEX_DIV_\d+\}\}/);     // svg_convert 留占位符
    assert.match(bodyText, /\{\{IMG_1\}\}/);               // 图片占位符
    assert.match(bodyText, /视频源：/);                    // video 附加原链接文本
    assert.equal(imgs, 1);
    assert.ok(fs.existsSync(`${dirs.images}/IMG_1.png`));
    // 启发式命中：#viz 无选择器特征，靠 尺寸+文本密度+非文本子元素数 判为 svg_convert
    assert.equal(ctx.entries.filter((e) => e.type === 'svg_convert').length, 2);

    await writeManifest(dirs.manifest, ctx.entries);
    const manifest = JSON.parse(fs.readFileSync(dirs.manifest, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.ok(manifest.items.length >= 5);
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
