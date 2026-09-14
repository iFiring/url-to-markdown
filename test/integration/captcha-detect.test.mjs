// test/integration/captcha-detect.test.mjs
// 人机验证检测层（2026-09-14）：collectGatePageSignals 占优双通道/成功态/跨 frame
// URL 通道/稀薄测量 + 点击探测挑战分类（probe.captcha，懒触发滑块）。
// 布局相关（面积/可见性）必须真浏览器——jsdom 无布局引擎。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../script/lib/browser.mjs';
import { collectGatePageSignals } from '../../script/lib/detector-captcha.mjs';
import { needsLogin, PROBE_HELPERS } from '../../script/lib/detector.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const VIEWPORT = { viewport: { width: 1280, height: 800 } };
const collect = (s) => collectGatePageSignals(s.page);

test('captcha-challenge: CF 风格 interstitial → 占优双通道命中 + 标题命中 + 稀薄', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-challenge.html`, VIEWPORT);
  try {
    const r = await collect(s);
    assert.equal(r.captcha.dominant, true, '挑战页应占优');
    assert.equal(r.captcha.areaChannel, true, 'fixed inset:0 全屏挑战 → 面积通道');
    assert.equal(r.captcha.textChannel, true, '正文 <200 → 文本通道');
    assert.equal(r.captcha.success, false);
    assert.ok(r.captcha.hits.some((h) => h.vendor === 'cloudflare'), `应命中 cloudflare 标记: ${JSON.stringify(r.captcha.hits)}`);
    assert.equal(r.titleHit, true, 'Just a moment 标题应命中');
    assert.ok(r.sparse.textLen < 200, `正文应稀薄（实际 ${r.sparse.textLen}）`);
    assert.equal(r.sparse.hasMain, false);
  } finally { await s.close(); await fx.close(); }
});

test('captcha-challenge?auto: 挑战消解后 → 无命中、正文充实、结构豁免', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-challenge.html?auto=600`, VIEWPORT);
  try {
    await s.page.waitForTimeout(1200);
    const r = await collect(s);
    assert.equal(r.captcha.dominant, false);
    assert.equal(r.captcha.hits.length, 0, '挑战 DOM 已移除');
    assert.ok(r.sparse.textLen >= 200, `消解后正文应充实（实际 ${r.sparse.textLen}）`);
    assert.equal(r.sparse.hasMain, true);
    assert.equal(r.titleHit, false, '标题已换成正文页');
  } finally { await s.close(); await fx.close(); }
});

test('captcha-slider-lazy: 懒触发滑块弹出 → geetest 命中；成功态 → success=true 且不再占优', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-slider-lazy.html?auto=700`, VIEWPORT);
  try {
    // 加载时无标记（懒触发的前提）
    const before = await collect(s);
    assert.equal(before.captcha.hits.length, 0, '点击前不应有挑战标记');
    assert.equal(before.sparse.hasMain, true, '正文有 article，结构豁免');
    // 手动点开滑块（模拟 probe 点击）
    await s.page.click('#loginBtn');
    await s.page.waitForTimeout(200);
    const during = await collect(s);
    assert.equal(during.captcha.dominant, true, '全屏滑块面板应占优');
    assert.ok(during.captcha.hits.some((h) => h.vendor === 'geetest'));
    // auto 成功态（700ms 置 success，1200ms 移除面板）
    await s.page.waitForTimeout(800);
    const done = await collect(s);
    assert.equal(done.captcha.success, true, '成功 widget 可见 → success');
    assert.equal(done.captcha.dominant, false, '成功态厂商的活跃标记不再收集（残留面板不触发占优）');
  } finally { await s.close(); await fx.close(); }
});

test('captcha-article: 讲验证码的长文 + 小面积 demo → 命中但不占优（守卫反例）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-article.html`, VIEWPORT);
  try {
    const r = await collect(s);
    assert.ok(r.captcha.hits.some((h) => h.vendor === 'recaptcha'), 'demo 组件应被记录为 hit');
    assert.equal(r.captcha.dominant, false, '长文 + 小面积 demo 不应占优');
    assert.equal(r.captcha.areaChannel, false);
    assert.equal(r.captcha.textChannel, false);
    assert.ok(r.sparse.textLen >= 200);
    assert.equal(r.sparse.hasMain, true);
  } finally { await s.close(); await fx.close(); }
});

test('captcha-iframe: frame URL 特征通道——富文本不占优 / 稀薄壳占优', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-iframe.html`, VIEWPORT);
  try {
    const rich = await collect(s);
    assert.ok(rich.captcha.hits.some((h) => h.vendor === 'recaptcha' && h.sel.startsWith('frame:')),
      `iframe URL 特征应命中: ${JSON.stringify(rich.captcha.hits)}`);
    assert.equal(rich.captcha.dominant, false, '小面积 iframe + 富正文不占优');

    await s.page.goto(`${fx.url}/captcha-iframe.html?sparse=1`, { waitUntil: 'networkidle' });
    const sparse = await collect(s);
    assert.equal(sparse.captcha.dominant, true, '稀薄壳 + 可见挑战 iframe → 文本通道占优');
    assert.equal(sparse.captcha.textChannel, true);
    assert.equal(sparse.captcha.areaChannel, false, '300×200 iframe 不应触发面积通道');
    assert.ok(sparse.sparse.textLen < 200);
  } finally { await s.close(); await fx.close(); }
});

test('sparse-empty / sparse-grow: 稀薄测量与结构豁免', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/sparse-empty.html`, VIEWPORT);
  try {
    const r = await collect(s);
    assert.ok(r.sparse.textLen < 200, `应稀薄（实际 ${r.sparse.textLen}）`);
    assert.equal(r.sparse.hasMain, false);
    assert.equal(r.captcha.hits.length, 0, '无挑战标记——稀薄≠挑战，分诊归 gateCheck');
    assert.equal(r.captcha.dominant, false);

    // grow 须大于 networkidle 的 500ms 静默窗（否则 goto 返回时内容已注入）；
    // 早期采集用 domcontentloaded 抢在水合前
    await s.page.goto(`${fx.url}/sparse-grow.html?grow=1500`, { waitUntil: 'domcontentloaded' });
    const early = await collect(s);
    assert.ok(early.sparse.textLen < 200, '水合前应稀薄');
    await s.page.waitForTimeout(2000);
    const late = await collect(s);
    assert.ok(late.sparse.textLen >= 200, `水合后应充实（实际 ${late.sparse.textLen}）`);
    assert.equal(late.sparse.hasMain, true);
  } finally { await s.close(); await fx.close(); }
});

test('probe 分类: 点登录弹滑块 → probe.captcha=true 且不计 loginConfirmed，现场保留', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-slider-lazy.html`, VIEWPORT);
  try {
    const url = `${fx.url}/captcha-slider-lazy.html`;
    const r = await needsLogin(s.page, url, { spaWaitMs: 400 });
    assert.equal(r.signals.loginButton, true, '登录按钮应命中弱信号');
    assert.equal(r.signals.loginConfirmed, false, '挑战弹窗不得计入登录确认（reCAPTCHA 误判修复）');
    assert.equal(r.probe.captcha, true, '应分类为挑战弹窗');
    assert.equal(r.probe.clicked, true);
    assert.equal(r.probe.confirmed, false);
    assert.equal(r.needsLogin, false, '单弱票不成立');
    // 懒触发滑块的现场必须保留（gateCheck 直接以弹窗开着的状态进验证码 viewer）
    const panelOpen = await s.page.evaluate(() => !!document.querySelector('.geetest_panel'));
    assert.ok(panelOpen, '探测后滑块弹窗应仍开着（detector 不做还原）');
  } finally { await s.close(); await fx.close(); }
});

test('allowProbe=false: 挑战占优页禁点击探测——零扰动', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-slider-lazy.html`, VIEWPORT);
  try {
    const url = `${fx.url}/captcha-slider-lazy.html`;
    const r = await needsLogin(s.page, url, { spaWaitMs: 400, allowProbe: false });
    assert.equal(r.probe.clicked, false, '不应发生任何点击');
    assert.equal(r.probe.captcha, false);
    assert.equal(r.signals.loginButton, true, '只读候选收集不受门控影响');
    const panelOpen = await s.page.evaluate(() => !!document.querySelector('.geetest_panel'));
    assert.equal(panelOpen, false, '页面不应被扰动');
  } finally { await s.close(); await fx.close(); }
});

test('member-preview 回归: 普通登录弹窗（无挑战标记）→ loginConfirmed(modal) 照旧', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/member-preview.html`, VIEWPORT);
  try {
    const url = `${fx.url}/member-preview.html`;
    const r = await needsLogin(s.page, url, { spaWaitMs: 400 });
    assert.equal(r.signals.loginConfirmed, true);
    assert.equal(r.probe.method, 'modal');
    assert.equal(r.probe.captcha, false, '登录弹窗不得误分类为挑战');
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

// ── 2026-09-14 审查修复回归（badge 误伤族）───────────────────────────────────

test('recaptcha-badge-sparse: 稀薄正文 + passive badge iframe → 不占优、走稀薄而非挑战', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/recaptcha-badge-sparse.html`, VIEWPORT);
  try {
    const r = await collect(s);
    assert.ok(r.captcha.hits.some((h) => h.vendor === 'recaptcha'), 'badge iframe 应被记录为 hit（src 特征）');
    assert.equal(r.captcha.dominant, false, 'badge（~320×60）是表单内嵌 widget 不是整页挑战');
    assert.equal(r.captcha.textChannel, false, '文本通道面积下限（200×200）应挡住 badge');
    assert.equal(r.captcha.areaChannel, false);
    assert.equal(r.sparse.thin, true, 'badge 不构成 hasFrame，页面仍判稀薄（归分支③人工确认）');

    // 隐藏形态（离屏钉 / opacity:0）：命中与 hasFrame 都应忽略（可见性同口径）
    await s.page.goto(`${fx.url}/recaptcha-badge-sparse.html?hide=offscreen`, { waitUntil: 'networkidle' });
    const off = await collect(s);
    assert.equal(off.captcha.hits.length, 0, '离屏 iframe 不应命中（可见性过滤）');
    assert.equal(off.sparse.thin, true);

    await s.page.goto(`${fx.url}/recaptcha-badge-sparse.html?hide=opacity`, { waitUntil: 'networkidle' });
    const op = await collect(s);
    assert.equal(op.captcha.hits.length, 0, 'opacity:0 iframe 不应命中（checkVisibility 不查 opacity 的手查兜底）');
    assert.equal(op.sparse.thin, true);
  } finally { await s.close(); await fx.close(); }
});

test('probe 落地页占优门控: 登录页带 passive badge → loginConfirmed(navigate) 而非误判挑战', async () => {
  const fx = await startFixtureServer();
  // 入口页文件名刻意不含 login 子串——URL 特征会把判定推成「已定论」而跳过探测
  const s = await openPage(`${fx.url}/badge-entry.html`, VIEWPORT);
  try {
    const r = await needsLogin(s.page, `${fx.url}/badge-entry.html`, { spaWaitMs: 400 });
    assert.equal(r.probe.clicked, true);
    assert.equal(r.signals.loginConfirmed, true, 'badge 不是挑战占优——跳转登录页应确认登录信号');
    assert.equal(r.probe.method, 'navigate');
    assert.equal(r.probe.captcha, false, '落地页裸标记扫描会把 badge 误判成挑战（审查修复 #2）');
    assert.equal(r.needsLogin, true);
  } finally { await s.close(); await fx.close(); }
});

test("PROBE_HELPERS('captcha'): 已解决滑块（成功态残留）不算活跃挑战（successSel 抑制）", async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/captcha-slider-lazy.html?auto=500`, VIEWPORT);
  try {
    await s.page.click('#loginBtn');
    await s.page.waitForTimeout(900); // 500ms 置成功态（面板仍在），未到 1000ms 移除
    const live = await s.page.evaluate(`(${PROBE_HELPERS})('captcha')`);
    assert.equal(live, false, '成功态厂商应被抑制——.geetest_panel 残留不是活跃挑战');
  } finally { await s.close(); await fx.close(); }
});
