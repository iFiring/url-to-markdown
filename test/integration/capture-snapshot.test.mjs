import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx, fx2, root;
before(async () => {
  await writePixelPng('test/fixtures/pixel.png');
  fx = await startFixtureServer();
  fx2 = await startFixtureServer(); // 第二个随机端口 = 跨源（无 CORS 头）
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'u2m-cap-'));
});
after(async () => { await fx.close(); await fx2.close(); });

const cap = (url) => runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs'), url],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const dirOf = (url) => path.join(root, urlToDirName(url));

test('capture: ok 路径写两份产物 + emit 恰一行 JSON', async () => {
  const url = `${fx.url}/classify-article.html`;
  const r = await cap(url);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.match(json.snapshot, /snapshot\.html$/);
  assert.match(json.classifyInput, /classify_input\.html$/);
  assert.ok(json.elements > 0);
  assert.ok(json.tokenEstimate > 0);

  const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
  assert.doesNotMatch(snap, /<script[\s>]/);                                    // script 已剥
  assert.match(snap, /<style data-u2m-inlined=/);                               // 外部 CSS 已内联
  assert.doesNotMatch(snap, /<link[^>]*rel=["']stylesheet["']/);                // <link> 已移除
  assert.match(snap, /\.from-style\{color:red\}/);                              // 既有 <style> 保留
  assert.match(snap, /<base [^>]*href=/);                                       // base 已注入
  assert.match(snap, /style="width:400px;height:300px"/);                       // 元素 inline style 保留
  assert.doesNotMatch(snap, /\son\w+=/);                                        // on* 已剥
  assert.doesNotMatch(snap, /copy-btn/);                                        // 复制按钮已剥
  assert.match(snap, /src="http:\/\/127\.0\.0\.1:\d+\/pixel\.png"/);            // img src 已绝对化

  const ci = await fs.readFile(path.join(dirOf(url), 'classify/classify_input.html'), 'utf8');
  assert.match(ci, /\{\{T\d+\}\}/);                                             // 长文本占位
  assert.match(ci, /data-lang="python"/);                                       // 代码靠结构识别（文本同样占位）
  assert.doesNotMatch(ci, /<style[\s>]/);                                       // style 已剥
  const snapIds = new Set([...snap.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  const ciIds = new Set([...ci.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  assert.ok(ciIds.size > 0);
  for (const id of ciIds) assert.ok(snapIds.has(id), `id ${id} 在 classify 但不在 snapshot`);
});

test('capture: 嵌套候选都有 id（无 closest 守卫）', async () => {
  const url = `${fx.url}/classify-article.html`;
  await cap(url);
  const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
  // main 与其内部 article 都有 id（父子同级候选，逐一可寻址）
  assert.match(snap, /<main[^>]*data-u2m-id="\d+"/);
  assert.match(snap, /<article[^>]*data-u2m-id="\d+"/);
  assert.match(snap, /<pre[^>]*data-u2m-id="\d+"/);
  // 叶子文本元素不打 id
  assert.doesNotMatch(snap, /<p[\s>][^>]*data-u2m-id=/);
  assert.doesNotMatch(snap, /<h1[\s>][^>]*data-u2m-id=/);
});

test('capture: too_large（--token-budget 1）→ exit 0，不写 classify_input，snapshot 仍在', async () => {
  const url = `${fx.url}/classify-article.html`;
  // 清理前次 ok 测试留下的 classify_input（测试隔离，不断言前次产物）
  const dir = dirOf(url);
  await fs.rm(path.join(dir, 'classify'), { recursive: true, force: true });
  const r = await runScript(process.execPath,
    [path.resolve('script/capture_snapshot.mjs'), url, '--token-budget', '1'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'too_large');
  assert.ok(json.tokenEstimate >= 1);
  assert.ok(fssync.existsSync(path.join(dir, 'snapshot.html')));
  assert.ok(!fssync.existsSync(path.join(dir, 'classify/classify_input.html')));
});

test('capture: 跨源 CSS（无 CORS）→ <link> 原样保留 + warning', async () => {
  // 临时夹具目录：页面引用第二个服务器（跨源、无 ACAO 头）的 CSS
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'u2m-xorigin-'));
  await fs.writeFile(path.join(tmp, 'xorigin.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>x</title>` +
    `<link rel="stylesheet" href="${fx2.url}/style.css"></head>` +
    `<body><main><p>足够长的正文文本用于通过各类阈值这里继续补充一些字数以满足占位与检测需要。</p></main></body></html>`, 'utf8');
  const fxLocal = await startFixtureServer(tmp);
  try {
    const url = `${fxLocal.url}/xorigin.html`;
    const r = await cap(url);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.status, 'ok');
    assert.ok(json.warnings.some((w) => /CSS/.test(w)), `warnings: ${JSON.stringify(json.warnings)}`);
    const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
    assert.match(snap, new RegExp(`<link[^>]*href="${fx2.url}/style.css"`)); // 兜底保留
  } finally { await fxLocal.close(); }
});

test('capture: usage_error 无参退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs')],
    { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

test('capture: usage_error 数值旗标非法（--token-budget abc）退出 2', async () => {
  const url = `${fx.url}/classify-article.html`;
  const r = await runScript(process.execPath,
    [path.resolve('script/capture_snapshot.mjs'), url, '--token-budget', 'abc'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
