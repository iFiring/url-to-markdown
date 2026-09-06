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

test('member-preview: 顶部「登录/注册」按钮（强信号）→ 需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-preview.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/member-preview.html`, { spaWaitMs: 500 });
    assert.equal(r.signals.loginButton, true, '应检测到登录/注册按钮');
    assert.deepEqual(r.strong, ['loginButton'], 'loginButton 应为单票强信号');
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

test('member-logout: 退出按钮/隐藏按钮/长文案/无光标 span → 不触发 loginButton', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-logout.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/member-logout.html`, { spaWaitMs: 500 });
    assert.equal(r.signals.loginButton, false, '退出登录/隐藏/超长文案/无光标 span 均不应命中');
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});

test('member-span: cursor:pointer 的 span 登录入口（极客时间形态）→ 需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-span.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/member-span.html`, { spaWaitMs: 500 });
    assert.equal(r.signals.loginButton, true, '应检测到 span 实现的登录入口');
    assert.deepEqual(r.strong, ['loginButton']);
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

test('member-span-late: 迟水合的登录入口在 spa 等待窗内被轮询捕获 → 需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-span-late.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/member-span-late.html`, { spaWaitMs: 2500 });
    assert.equal(r.signals.loginButton, true, '800ms 后注入的登录 span 应在等待窗内命中');
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

test('member-preview + auth cookie + demoted: 用户裁决过 skip → 失去单票资格', async () => {
  const fx = await startFixtureServer();
  // 预置 auth cookie 使 cookieMissing=false——命中数只剩 loginButton 一票，单测降级语义
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  const ss = path.join(root, 'storage_state.json');
  fs.writeFileSync(ss, JSON.stringify({ cookies: [
    { name: 'sessionid', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ], origins: [] }));
  const s = await openPage(`${fx.url}/member-preview.html`, { viewport: { width: 1280, height: 800 }, storageStatePath: ss });
  try {
    const url = `${fx.url}/member-preview.html`;
    const plain = await needsLogin(s.page, s.context, url, { spaWaitMs: 500 });
    assert.equal(plain.needsLogin, true, '未降级时强信号照常单票成立');
    const demoted = await needsLogin(s.page, s.context, url, { spaWaitMs: 500, demoted: ['loginButton'] });
    assert.equal(demoted.needsLogin, false, '降级后无佐证信号 → 不再判定需登录');
  } finally { await s.close(); await fx.close(); }
});
