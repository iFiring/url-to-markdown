// test/integration/login.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const script = path.resolve('script/login_url.mjs');
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-login-'));
const SEED_STATE = (root) => {
  fs.mkdirSync(path.join(root, 'cookies'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cookies', 'storage_state.json'), JSON.stringify({ cookies: [
    { name: 'sessionid', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ], origins: [] }));
};
const viewerFromStderr = (line) => {
  const m = /\[login_url\] viewer: (http:\/\/\S+)/.exec(line);
  return m ? m[1] : null;
};

test('已登录：预置 cookie → logged_in，退出 0，storageState 回写', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  SEED_STATE(root);
  const r = await runScript(process.execPath, [script, `${fx.url}/logged-in.html`, '--no-open'], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'logged_in');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'cookies', 'storage_state.json'), 'utf8'));
  assert.ok(saved.cookies.some((c) => c.name === 'sessionid'));
  await fx.close();
});

test('未登录→自动登录→点击登录完成：login_done，退出 0', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  let frames = 0;
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html?auto=1`, '--no-open', '--timeout', '20000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const viewer = viewerFromStderr(line);
      if (!viewer) return;
      const ws = new WebSocket(viewer.replace('http://', 'ws://'));
      ws.on('message', (d) => { if (JSON.parse(d).type === 'frame') frames++; });
      ws.on('open', () => setTimeout(() => ws.send(JSON.stringify({ type: 'login_done' })), 1200));
    } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'login_done');
  assert.ok(frames > 0, 'Screencast 应持续推送画面帧');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'cookies', 'storage_state.json'), 'utf8'));
  assert.ok(saved.cookies.some((c) => c.name === 'sessionid'));
  await fx.close();
});

test('viewer 断开且未登录：aborted，退出 1', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html`, '--no-open', '--timeout', '20000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const viewer = viewerFromStderr(line);
      if (!viewer) return;
      const ws = new WebSocket(viewer.replace('http://', 'ws://'));
      ws.on('open', () => setTimeout(() => ws.close(), 300)); // 用户关闭 viewer
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'aborted');
  await fx.close();
});

test('超时：无人交互 → timeout，退出 1', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html`, '--no-open', '--timeout', '1500'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 20000 });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  await fx.close();
});
