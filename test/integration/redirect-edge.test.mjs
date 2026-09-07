// test/integration/redirect-edge.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName, redirectedDirName } from '../../script/lib/env.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
let serverA; let serverB; let tmpRoot;

before(async () => {
  serverA = await startFixtureServer();
  serverB = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-redirect-edge-'));
  process.env.U2M_WORKING_ROOT = tmpRoot;
});
after(() => {
  delete process.env.U2M_WORKING_ROOT;
  serverA?.close();
  serverB?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const runSnapshot = (url) => runScript(process.execPath, [snapshotScript, '--url', url], {
  env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 90000,
});

test('退化守卫：目标页顶层打开渲染空 → 回退原页现状路径，不写 marker', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=/redirect-degenerate.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect, null, '退化应回退为未重定向');
  assert.equal(out['url-name'], urlToDirName(url), '产物落原名目录');
  assert.ok(fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')), '回退后仍应产出原页快照');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')));
});

test('单次判定：跳转后目标页自身的占优 iframe 不触发二次跳转', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=/redirect-content-outer.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect.to, `${serverA.url}/redirect-content-outer.html`, '只跳一跳，停在外层');
  const html = fs.readFileSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html'), 'utf8');
  assert.ok(html.includes('外层内容页标题'), '快照为外层页');
});

test('跨域全管线：壳(A) → 内容(B)', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=${serverB.url}/redirect-content.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect.to, `${serverB.url}/redirect-content.html`);
  assert.ok(fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html')));
});
