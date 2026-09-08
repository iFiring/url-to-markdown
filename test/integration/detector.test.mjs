// test/integration/detector.test.mjs
// 登录检测 v2（2026-09-07 设计）：六信号 + 点击探测。
// 强信号 = password / loginConfirmed（点击登录入口后出现全屏弹窗或跳转）；
// loginButton（可见但点击无确认）只是普通一票；记忆豁免 = 命中全在 memorized 内。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../script/lib/browser.mjs';
import { needsLogin } from '../../script/lib/detector.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const detect = (s, url, opts = {}) =>
  needsLogin(s.page, url, { spaWaitMs: 500, ...opts });

test('login-wall: 密码框强信号 → 需登录；已定论不探测、不点击提交按钮', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const url = `${fx.url}/login-wall.html`;
    const r = await detect(s, url);
    assert.equal(r.needsLogin, true);
    assert.equal(r.signals.password, true);
    assert.equal(r.signals.loginConfirmed, false, 'password 已定论，不应再点击页面上的「登录」提交按钮');
    assert.equal(r.probe.clicked, false, '已定论路径零页面扰动');
    assert.ok(s.page.url().includes('login-wall'), '页面不应被探测点击导航走');
  } finally { await s.close(); await fx.close(); }
});

test('logged-in: 无登录入口无关键词 → 已登录（cookie 信号已删除，无需预置 cookie）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/logged-in.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/logged-in.html`);
    assert.equal(r.needsLogin, false);
    assert.equal(r.probe.clicked, false, '无候选按钮不应发生任何点击');
  } finally { await s.close(); await fx.close(); }
});

test('static-article: 公开内容页 → 无需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/static-article.html`);
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});

test('member-preview: 点击登录按钮 → 全屏弹窗（表单+按钮）→ loginConfirmed 强信号', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-preview.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-preview.html`);
    assert.equal(r.signals.loginButton, true, '可见登录按钮应命中弱信号');
    assert.equal(r.signals.loginConfirmed, true, '点击后出现全屏弹窗应确认');
    assert.deepEqual(r.strong, ['loginConfirmed']);
    assert.equal(r.probe.method, 'modal');
    assert.equal(r.needsLogin, true);
    const modalOpen = await s.page.evaluate(() => !!document.getElementById('signin-modal'));
    assert.ok(modalOpen, '确认后应保留点击后状态（弹窗开着进 viewer 最利于登录）');
  } finally { await s.close(); await fx.close(); }
});

test('member-span: cursor:pointer 的 span 入口，点击跳转登录页 → loginConfirmed(navigate)', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-span.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-span.html`);
    assert.equal(r.signals.loginConfirmed, true);
    assert.equal(r.probe.method, 'navigate');
    assert.equal(r.needsLogin, true);
    assert.ok(s.page.url().includes('login-wall'), '点击后应停在跳转目标页（viewer 直接呈现登录页）');
  } finally { await s.close(); await fx.close(); }
});

test('member-btn-dead: 按钮点击无反应 → 仅 loginButton 一票，不判定需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-btn-dead.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-btn-dead.html`);
    assert.equal(r.signals.loginButton, true);
    assert.equal(r.signals.loginConfirmed, false);
    assert.equal(r.needsLogin, false, '一票不成立');
    assert.equal(r.probe.clicked, true, '确实点击过（供状态还原决策）');
  } finally { await s.close(); await fx.close(); }
});

test('member-dropdown: 点击只弹小下拉（<50% 视口，即使含 form+button）→ 不算确认', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-dropdown.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-dropdown.html`);
    assert.equal(r.signals.loginButton, true);
    assert.equal(r.signals.loginConfirmed, false, '面积门槛应挡住小下拉');
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});

test('member-logout: 退出按钮/隐藏按钮/长文案/无光标 span → 无候选、不触发不点击', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-logout.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-logout.html`);
    assert.equal(r.signals.loginButton, false, '退出登录/隐藏/超长文案/无光标 span 均不应命中');
    assert.equal(r.needsLogin, false);
    assert.equal(r.probe.clicked, false);
  } finally { await s.close(); await fx.close(); }
});

test('member-span-late: 迟水合入口在 spa 等待窗内被轮询捕获并探测确认', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-span-late.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await detect(s, `${fx.url}/member-span-late.html`, { spaWaitMs: 3000 });
    assert.equal(r.signals.loginButton, true, '800ms 后注入的登录 span 应在等待窗内命中');
    assert.equal(r.signals.loginConfirmed, true, '捕获后应探测确认（点击→跳转）');
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

test('记忆豁免：loginButton 在记忆内且无其他命中 → dismissed，不探测不点击', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-preview.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const url = `${fx.url}/member-preview.html`;
    const r = await detect(s, url, { memorized: ['loginButton'] });
    assert.equal(r.dismissed, true, '命中全在记忆内应整体豁免');
    assert.equal(r.needsLogin, false);
    assert.equal(r.signals.loginConfirmed, false, '豁免后不应再探测——强信号复活会让记忆形同虚设');
    assert.equal(r.probe.clicked, false, '豁免路径零页面扰动');
    const modalOpen = await s.page.evaluate(() => !!document.getElementById('signin-modal'));
    assert.equal(modalOpen, false);
  } finally { await s.close(); await fx.close(); }
});
