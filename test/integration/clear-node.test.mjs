// test/integration/clear-node.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx; let root;
before(async () => {
  await writePixelPng('test/fixtures/pixel.png');
  fx = await startFixtureServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clear-'));
});
after(async () => { await fx.close(); });

const urlOf = (page) => `${fx.url}/${page}`;
const dirOf = (page) => path.join(root, urlToDirName(urlOf(page)));
const capture = async (page) => {
  // 使用新的 snapshot.mjs 生成快照
  const r = await runScript(process.execPath, [path.resolve('script/snapshot.mjs'), urlOf(page)],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
  if (r.code !== 0) throw new Error(`snapshot.mjs failed: ${r.stderr}`);
  // snapshot.mjs 输出到 steps/1_snapshot.html，但 clear_trans_html.mjs 期望 snapshot.html
  // 复制到旧位置以兼容
  const dir = dirOf(page);
  const newSnap = path.join(dir, 'steps', '1_snapshot.html');
  const oldSnap = path.join(dir, 'snapshot.html');
  if (fs.existsSync(newSnap)) fs.copyFileSync(newSnap, oldSnap);
  // 创建 classify 目录（测试会写入 classify_plan.json）
  fs.mkdirSync(path.join(dir, 'classify'), { recursive: true });
  return r;
};
const run = (page) => runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs'), urlOf(page)],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const sketch = (page) => fs.readFileSync(path.join(dirOf(page), 'sketch.md'), 'utf8');
// R1: manifest is TOP-LEVEL <url-dir>/manifest.json (not assets/manifest.json)
const manifestOf = (page) => JSON.parse(fs.readFileSync(path.join(dirOf(page), 'manifest.json'), 'utf8'));
const snapOf = (page) => fs.readFileSync(path.join(dirOf(page), 'snapshot.html'), 'utf8');

function writePlan(page, plan) {
  fs.mkdirSync(path.join(dirOf(page), 'classify'), { recursive: true });
  fs.writeFileSync(path.join(dirOf(page), 'classify/classify_plan.json'), JSON.stringify(plan), 'utf8');
}
/** keep-only plan：快照里全部 data-u2m-id 一律 keep（纯文本页的通用过法） */
function keepAllPlan(page, listFlowSelector) {
  const ids = [...snapOf(page).matchAll(/data-u2m-id="(\d+)"/g)].map((m) => Number(m[1]));
  return { version: 2, mode: 'whole', listFlowSelector, blocks: ids.map((id) => ({ id, action: 'keep' })) };
}
const idByMark = (page, markRe) => {
  const m = snapOf(page).match(markRe);
  assert.ok(m, `快照中未找到 ${markRe}`);
  return Number(m[1]);
};

test('static-article: 契约输出 + 占位符 + 表格 + 围栏', async () => {
  await capture('static-article.html');
  writePlan('static-article.html', keepAllPlan('static-article.html', 'main'));
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(dirOf('static-article.html'), 'assets/images/IMG_1.png')));
  const md = sketch('static-article.html');
  assert.match(md, /示例文章标题/);
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /PARA_ONE/);
  assert.match(md, /\|\s*名称\s*\|\s*值\s*\|/);
  assert.match(md, /```js/);
});

test('lazy-load: IO 劫持使懒图入册', async () => {
  await capture('lazy-load.html');
  writePlan('lazy-load.html', keepAllPlan('lazy-load.html', 'main'));
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).images, 1);
  assert.ok(fs.existsSync(path.join(dirOf('lazy-load.html'), 'assets/images/IMG_1.png')));
});

test('iframe-content: 主文档稀少时合并同源 iframe 正文', async () => {
  await capture('iframe-content.html');
  writePlan('iframe-content.html', keepAllPlan('iframe-content.html', 'body > div:not(#shell)'));
  const r = await run('iframe-content.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('iframe-content.html');
  assert.match(md, /iframe 内的正文标题/);
  assert.match(md, /IFRAME_BODY/);
});

test('code-block(keep): 行号与复制按钮被清理，语言保留', async () => {
  await capture('code-block.html');
  writePlan('code-block.html', keepAllPlan('code-block.html', 'main'));
  const r = await run('code-block.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('code-block.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  assert.doesNotMatch(md, /line-numbers-rows/);
  assert.doesNotMatch(md, /复制/);
  assert.match(md, /普通表格/);
});

test('nav-noise: 导航/广告/页脚被剔除', async () => {
  await capture('nav-noise.html');
  writePlan('nav-noise.html', keepAllPlan('nav-noise.html', 'main > article'));
  const r = await run('nav-noise.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('nav-noise.html');
  assert.match(md, /MAIN_CONTENT/);
  assert.doesNotMatch(md, /NAV_LINKS/);
  assert.doesNotMatch(md, /ASIDE_AD/);
  assert.doesNotMatch(md, /FOOTER_COPY/);
});

test('complex-elements: plan 驱动全分派端到端', async () => {
  await capture('complex-elements.html');
  const mainId  = idByMark('complex-elements.html', /<main[^>]*data-u2m-id="(\d+)"/);
  const canvasId = idByMark('complex-elements.html', /<canvas[^>]*data-u2m-id="(\d+)"/);
  const videoId  = idByMark('complex-elements.html', /<video[^>]*data-u2m-id="(\d+)"/);
  const svgId    = idByMark('complex-elements.html', /<svg id="big"[^>]*data-u2m-id="(\d+)"/);
  const chartId  = idByMark('complex-elements.html', /<div class="chart"[^>]*data-u2m-id="(\d+)"/);
  const vizId    = idByMark('complex-elements.html', /<div id="viz"[^>]*data-u2m-id="(\d+)"/);
  const katexId  = idByMark('complex-elements.html', /<span class="katex"[^>]*data-u2m-id="(\d+)"/);
  writePlan('complex-elements.html', { version: 2, mode: 'whole', listFlowSelector: 'main', blocks: [
    { id: mainId, action: 'keep' },
    { id: canvasId, action: 'screenshot' },
    { id: videoId, action: 'screenshot' },
    { id: svgId, action: 'passthrough_svg' },
    { id: chartId, action: 'block_screenshot', blockOf: chartId },
    { id: vizId, action: 'svg_convert' },
    { id: katexId, action: 'latex' },
  ] });
  const r = await run('complex-elements.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('complex-elements.html');
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /\$\$E=mc\^2\$\$/);
  assert.match(md, /\{\{COMPLEX_DIV_\d+\}\}/); // svg_convert 占位符
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.png\)/); // block_screenshot 直替
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.svg\)/); // passthrough 直替
  assert.match(md, /视频源：/); // video screenshot 附原链接
  const manifest = manifestOf('complex-elements.html');
  const types = manifest.items.map((i) => i.type).sort();
  assert.deepEqual(types, ['block_screenshot', 'latex', 'passthrough_svg', 'screenshot', 'screenshot', 'svg_convert']);
  const pending = manifest.items.filter((i) => i.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'svg_convert');
});

test('long-column: 正文完整保留，不误判 svg_convert', async () => {
  await capture('long-column.html');
  writePlan('long-column.html', keepAllPlan('long-column.html', '.page-layout__main'));
  const r = await run('long-column.html');
  assert.equal(r.code, 0, r.stderr);
  const manifest = manifestOf('long-column.html');
  assert.equal(manifest.items.filter((i) => i.type === 'svg_convert').length, 0,
    `不应有 svg_convert: ${JSON.stringify(manifest.items)}`);
  const md = sketch('long-column.html');
  assert.match(md, /LONGCOL_BODY/);
  assert.ok(!md.includes('{{COMPLEX_DIV_'));
});

test('mermaid: 源码 → mermaid 围栏', async () => {
  await capture('mermaid.html');
  writePlan('mermaid.html', keepAllPlan('mermaid.html', 'main'));
  const r = await run('mermaid.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('mermaid.html');
  assert.match(md, /```mermaid\ngraph TD; A-->B\n```/);
});

test('csp-article: 严格 CSP 页面（bypassCSP）→ ok + 正文保留', async () => {
  await capture('csp-article.html');
  writePlan('csp-article.html', keepAllPlan('csp-article.html', 'main'));
  const r = await run('csp-article.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
  assert.match(sketch('csp-article.html'), /CSP_PARA/);
});

test('classify-article: code_block 分支 → 语言围栏，不进 manifest', async () => {
  await capture('classify-article.html');
  const articleId = idByMark('classify-article.html', /<article[^>]*data-u2m-id="(\d+)"/);
  const preId = idByMark('classify-article.html', /<pre[^>]*data-u2m-id="(\d+)"/);
  writePlan('classify-article.html', { version: 2, mode: 'whole', listFlowSelector: 'main > article', blocks: [
    { id: articleId, action: 'keep' },
    { id: preId, action: 'code_block' },
  ] });
  const r = await run('classify-article.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('classify-article.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  const manifest = manifestOf('classify-article.html');
  assert.ok(!manifest.items.some((i) => i.type === 'code_block'), 'code_block 不进 manifest');
});

test('plan 缺失 → error 一行，提示先跑 1.6/1.8', async () => {
  await capture('nav-noise.html');
  // 不写 plan；清理可能被前测试遗留的 plan 文件
  const planFile = path.join(dirOf('nav-noise.html'), 'classify', 'classify_plan.json');
  if (fs.existsSync(planFile)) fs.unlinkSync(planFile);
  const r = await run('nav-noise.html');
  assert.equal(r.code, 1);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'error');
  assert.match(json.reason, /classify_plan\.json/);
});

test('plan 非法（version≠2）→ error', async () => {
  await capture('static-article.html');
  writePlan('static-article.html', { version: 1, mode: 'whole', listFlowSelector: 'main', blocks: [] });
  const r = await run('static-article.html');
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'error');
});

test('listFlowSelector 未命中 → error 指出选择器', async () => {
  await capture('mermaid.html');
  const p = keepAllPlan('mermaid.html', 'main');
  p.listFlowSelector = 'no-such-container-xyz';
  writePlan('mermaid.html', p);
  const r = await run('mermaid.html');
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).reason, /listFlowSelector/);
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
