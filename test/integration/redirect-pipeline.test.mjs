// test/integration/redirect-pipeline.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName, redirectedDirName, writeRedirectMarker } from '../../script/lib/env.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
const cleanScript = path.resolve('script/clean_snapshot.mjs');
let server;
let tmpRoot;

before(async () => {
  server = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-redirect-'));
  // 测试进程内的 env.mjs 调用（writeRedirectMarker 等）也须隔离
  process.env.U2M_WORKING_ROOT = tmpRoot;
});
after(() => {
  delete process.env.U2M_WORKING_ROOT;
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const runSnapshot = (url, extraEnv = {}) => runScript(process.execPath, [snapshotScript, '--url', url], {
  env: { U2M_WORKING_ROOT: tmpRoot, ...extraEnv },
  timeoutMs: 90000,
});

test('壳页+占优 iframe → redirected_ 目录快照 + emit 四字段 + marker + 步骤 2 交接', async () => {
  const url = `${server.url}/redirect-shell-dyn.html?to=/redirect-content.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out['url-name'], redirectedDirName(url), 'url-name 应为 redirected_ 特殊名');
  assert.equal(out['url-working-path'], path.join(tmpRoot, redirectedDirName(url)));
  assert.equal(path.resolve(out['skill-root']), path.resolve('.'));
  assert.equal(out.redirect.to, `${server.url}/redirect-content.html`);
  assert.equal(out.redirect.urlName, redirectedDirName(url));

  const snapFile = path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html');
  assert.ok(fs.existsSync(snapFile), '快照应在 redirected_ 目录');
  const html = fs.readFileSync(snapFile, 'utf8');
  assert.ok(html.includes('内容页主标题'), '快照应为内容页');
  assert.ok(!html.includes('<iframe'), '内容页不应残留 iframe 元素');
  assert.ok(!fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')), '原名目录不应有快照');

  const marker = path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml');
  assert.ok(fs.existsSync(marker));
  assert.equal(fs.readFileSync(marker, 'utf8'), `to: ${server.url}/redirect-content.html\n`);

  // 步骤 2 交接：仍用原 URL 调用，产物应落在 redirected_ 目录
  const c = await runScript(process.execPath, [cleanScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 90000,
  });
  assert.equal(c.code, 0, `stderr: ${c.stderr}`);
  assert.ok(fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '2_clean_snapshot.html')), '步骤 2 应经 marker 定位 redirected_ 目录');
});

test('普通页 → redirect:null + 原名目录 + 无 marker', async () => {
  const url = `${server.url}/static-article.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect, null);
  assert.equal(out['url-name'], urlToDirName(url));
  assert.ok(fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')));
});

test('stale marker：普通页运行后被清除', async () => {
  const url = `${server.url}/static-article.html`;
  writeRedirectMarker(url, 'https://stale.example.com/x.html');
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')), '未命中应删 stale marker');
});

test('重定向后虚拟列表 → error 不写 marker 不建 redirected 目录', async () => {
  const url = `${server.url}/redirect-shell-dyn.html?to=/redirect-content-vlist.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).reason, 'virtual_list');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')), '失败不写 marker');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html')), '失败无快照');
});
