// test/integration/detector.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPage } from '../../script/lib/browser.mjs';
import { needsLogin } from '../../script/lib/detector.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

test('login-wall: 密码框+URL/内容 命中 → 需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/login-wall.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, true);
    assert.equal(r.signals.password, true);
  } finally { await s.close(); await fx.close(); }
});

test('logged-in: 预置 session cookie → 已登录', async () => {
  const fx = await startFixtureServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  const ss = path.join(root, 'storage_state.json');
  fs.writeFileSync(ss, JSON.stringify({ cookies: [
    { name: 'sessionid', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ], origins: [] }));
  const s = await openPage(`${fx.url}/logged-in.html`, { viewport: { width: 1280, height: 800 }, storageStatePath: ss });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/logged-in.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});

test('static-article: 公开内容页 → 无需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/static-article.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});
