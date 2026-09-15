// test/integration/viewer-session.test.mjs
// runViewerSession 计时语义（用户裁定，三形态统一）：
// 倒计时从用户首次打开 viewer 页面（首次 WS 连接）才开始——人没看到窗口不算人
// 超时；无人连接由启动起的 backstopMs 绝对上限兜底（到期照常 fail，守单行 JSON
// 契约、进程不无限期挂死）。直连模式（不 spawn 子进程），小超时参数确定性驱动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { openPage } from '../../script/lib/browser.mjs';
import { runViewerSession } from '../../script/lib/screencast.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 跑会话并追踪状态（pending/fulfilled/rejected）与 viewer URL（log 行解析）。 */
function startSession(page, opts) {
  const state = { status: 'pending', value: undefined, viewerUrl: null };
  const promise = runViewerSession(page, {
    ...opts,
    log: (m) => {
      const mt = /viewer: (http:\/\/127\.0\.0\.1:\d+)/.exec(String(m));
      if (mt) state.viewerUrl = mt[1];
      opts.log?.(m);
    },
  }).then(
    (v) => { state.status = 'fulfilled'; state.value = v; return v; },
    (e) => { state.status = 'rejected'; state.value = e; throw e; },
  );
  return { state, promise };
}

const waitForViewer = async (state, limitMs = 15000) => {
  const t0 = Date.now();
  while (!state.viewerUrl && Date.now() - t0 < limitMs) await sleep(50);
  assert.ok(state.viewerUrl, 'viewer URL 应已记录到 log');
};

test('runViewerSession: 无人连接 → backstopMs 绝对上限到期 fail（不无限期挂死）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  try {
    const { state, promise } = startSession(s.page, {
      timeout: 600000,   // 倒计时大——不应被触达
      backstopMs: 600,   // 绝对上限小——无人连接即到期
      timeoutReason: 'login_timeout',
      onDone: (ws, api) => api.finish('done'),
    });
    const err = await promise.then(() => null, (e) => e);
    assert.equal(err?.reason, 'login_timeout');
    assert.equal(state.status, 'rejected');
  } finally {
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

test('runViewerSession: 倒计时自首连始——连接前超 timeout 不超时，连接后到期 reject', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws;
  try {
    let firstConnects = 0;
    const { state, promise } = startSession(s.page, {
      timeout: 700,
      backstopMs: 60000, // 绝对上限大——本用例验证倒计时路径
      timeoutReason: 'login_timeout',
      onFirstConnect: () => { firstConnects += 1; },
      onDone: (w, api) => api.finish('done'),
    });
    await waitForViewer(state);
    // 连接前停留超过 timeout 也不应超时（人没看到窗口不算人超时）
    await sleep(1200);
    assert.equal(state.status, 'pending', '首连前不应启动倒计时');
    // 首连 → 撤绝对上限、起倒计时
    ws = new WebSocket(state.viewerUrl);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    await sleep(100);
    assert.equal(firstConnects, 1, 'onFirstConnect 应恰触发一次');
    assert.equal(state.status, 'pending', '连接后 100ms 不应已超时（倒计时 700ms）');
    // 倒计时到期 reject
    const err = await promise.then(() => null, (e) => e);
    assert.equal(err?.reason, 'login_timeout');
    assert.equal(state.status, 'rejected');
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

test('runViewerSession: finish 后视口恢复 + onDone 回调拿到会话 api', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 3000 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws;
  try {
    // 断言放回调外——回调内抛异常会被 guard 吞成 log、会话挂起（测试会假死而非红）
    let capturedApi = null;
    const { state, promise } = startSession(s.page, {
      timeout: 60000,
      backstopMs: 60000,
      onDone: (w, api) => { capturedApi = api; api.finish({ ok: true }); },
    });
    await waitForViewer(state);
    // 会话期间视口切 800（懒加载 3000 视口塞 800 画布会压扁）
    assert.equal(s.page.viewportSize().height, 800, '会话期间视口应临时切 1280×800');
    ws = new WebSocket(state.viewerUrl);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    ws.send(JSON.stringify({ type: 'login_done' }));
    const v = await promise;
    assert.deepEqual(v, { ok: true }, 'finish 入参应原样 resolve');
    assert.equal(state.status, 'fulfilled');
    assert.equal(typeof capturedApi?.finish, 'function', 'onDone 应拿到会话 api');
    assert.equal(typeof capturedApi?.fail, 'function');
    assert.equal(capturedApi.isSettled(), true, 'finish 后 settled 应置位');
    // 会话结束视口恢复（滚动阶段仍用高视口）
    assert.equal(s.page.viewportSize().height, 3000, '会话结束后视口应恢复');
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

// ── 审查修复 #13：连接同一性判定 ────────────────────────────────

test('runViewerSession: 双开 viewer 页关其一 → 仍有活连接不判弃窗；全关才 fail', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws1;
  let ws2;
  try {
    const { state, promise } = startSession(s.page, {
      timeout: 60000,
      backstopMs: 60000,
      timeoutReason: 'login_timeout',
      onDone: (w, api) => api.finish('done'),
      onClose: (api) => api.fail('login_aborted'),
    });
    await waitForViewer(state);
    const open = (w) => new Promise((r, j) => { w.on('open', r); w.on('error', j); });
    ws1 = new WebSocket(state.viewerUrl);
    await open(ws1);
    ws2 = new WebSocket(state.viewerUrl);
    await open(ws2);
    ws1.close(); // 关其一——另一个还开着，不是弃窗
    await sleep(2500); // 超过去抖窗（1.5s）
    assert.equal(state.status, 'pending', '仍有活连接时不得判弃窗（用户可能在另一标签页操作）');
    ws2.close(); // 最后一个连接关闭
    const err = await promise.then(() => null, (e) => e);
    assert.equal(err?.reason, 'login_aborted', '全关后（去抖到期）应判弃窗');
  } finally {
    try { ws1?.close(); } catch { /* 忽略 */ }
    try { ws2?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

test('runViewerSession: 断线重连（F5/网络抖动）在去抖窗内 → 会话不误杀', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws1;
  let ws2;
  try {
    const { state, promise } = startSession(s.page, {
      timeout: 60000,
      backstopMs: 60000,
      timeoutReason: 'login_timeout',
      onDone: (w, api) => api.finish('done'),
      onClose: (api) => api.fail('login_aborted'),
    });
    await waitForViewer(state);
    const open = (w) => new Promise((r, j) => { w.on('open', r); w.on('error', j); });
    ws1 = new WebSocket(state.viewerUrl);
    await open(ws1);
    ws1.close();              // 旧连接断（模拟刷新先断旧 socket）
    await sleep(600);         // 去抖窗（1.5s）内重连
    ws2 = new WebSocket(state.viewerUrl);
    await open(ws2);
    await sleep(2500);        // 超过去抖窗——重连已取消弃窗判定
    assert.equal(state.status, 'pending', '去抖窗内的重连不应触发弃窗');
    ws2.close();
    const err = await promise.then(() => null, (e) => e);
    assert.equal(err?.reason, 'login_aborted');
  } finally {
    try { ws1?.close(); } catch { /* 忽略 */ }
    try { ws2?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});
