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

const run = (page) => runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs'), `${fx.url}/${page}`],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });

const wf = (page) => path.join(root, urlToDirName(`${fx.url}/${page}`), 'node_workflow');
const sketch = (page) => fs.readFileSync(path.join(wf(page), 'sketch.md'), 'utf8');

test('static-article: 契约输出 + 占位符 + 表格 + 围栏', async () => {
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(wf('static-article.html'), 'assets/images/IMG_1.png')));
  const md = sketch('static-article.html');
  assert.match(md, /示例文章标题/);
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /PARA_ONE/);
  assert.match(md, /\|\s*名称\s*\|\s*值\s*\|/); // GFM 表格（容忍单元格两侧空格）
  assert.match(md, /```js/);
});

test('lazy-load: IO 劫持使懒图入册', async () => {
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(wf('lazy-load.html'), 'assets/images/IMG_1.png')));
});

test('iframe-content: 主文档稀少时合并同源 iframe 正文', async () => {
  const r = await run('iframe-content.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('iframe-content.html');
  assert.match(md, /iframe 内的正文标题/);
  assert.match(md, /IFRAME_BODY/);
});

test('code-block: 行号与复制按钮被清理，语言保留', async () => {
  const r = await run('code-block.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('code-block.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  assert.doesNotMatch(md, /line-numbers-rows/);
  assert.doesNotMatch(md, /复制/);
  assert.match(md, /普通表格/); // 非行号表格不受影响
});

test('nav-noise: 导航/广告/页脚被剔除', async () => {
  const r = await run('nav-noise.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('nav-noise.html');
  assert.match(md, /MAIN_CONTENT/);
  assert.doesNotMatch(md, /NAV_LINKS/);
  assert.doesNotMatch(md, /ASIDE_AD/);
  assert.doesNotMatch(md, /FOOTER_COPY/);
});

test('complex-elements: 全分派端到端', async () => {
  const r = await run('complex-elements.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('complex-elements.html');
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /\$\$E=mc\^2\$\$/);
  assert.match(md, /\{\{COMPLEX_DIV_\d+\}\}/); // svg_convert 占位符
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.svg\)/); // passthrough 直替
  const manifest = JSON.parse(fs.readFileSync(path.join(wf('complex-elements.html'), 'assets/manifest.json'), 'utf8'));
  const types = manifest.items.map((i) => i.type).sort();
  // canvas、video 各一 screenshot；大 svg passthrough；.chart 与 #viz（启发式）各一 svg_convert；katex latex
  assert.deepEqual(types, ['latex', 'passthrough_svg', 'screenshot', 'screenshot', 'svg_convert', 'svg_convert']);
  const pending = manifest.items.filter((i) => i.status === 'pending');
  assert.equal(pending.length, 2);
  assert.ok(pending.every((i) => i.type === 'svg_convert'));
});

test('mermaid: 源码 → mermaid 围栏', async () => {
  const r = await run('mermaid.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('mermaid.html');
  assert.match(md, /```mermaid\ngraph TD; A-->B\n```/);
});

test('csp-article: 严格 CSP 页面（bypassCSP）→ ok + 正文保留', async () => {
  const r = await run('csp-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  const md = sketch('csp-article.html');
  assert.match(md, /CSP_PARA/);
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
