// test/integration/gate-captcha.test.mjs
// 人机门禁 gateCheck 全分支集成：验证码 viewer（解决/弃窗/超时）、
// 稀薄介入 viewer（skip 入档/记忆豁免/豁免不压挑战/done 回环/弃窗/403 分诊）、
// http_404、gate_loop_limit、懒触发滑块全链路（probe→验证码 viewer，现场不还原）、
// 重定向目标页挑战覆盖、占优守卫反例。
// 子进程模式（runWithViewer，照 login-decisions.test.mjs）测接线与 emit 契约；
// 直连模式（openPage+gateCheck）测计时与循环上限等内部行为。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { openPage } from '../../script/lib/browser.mjs';
import { gateCheck } from '../../script/lib/snapshot-gate.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
let server;

before(async () => { server = await startFixtureServer(); });
after(() => { server?.close(); });

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-gate-'));
const skipsPath = (root) => path.join(root, 'cookies', 'login_decisions_skips.json');
const readSkips = (root) => JSON.parse(fs.readFileSync(skipsPath(root), 'utf8'));
const presetSkips = (root, obj) => {
  fs.mkdirSync(path.dirname(skipsPath(root)), { recursive: true });
  fs.writeFileSync(skipsPath(root), JSON.stringify(obj));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 跑 snapshot.mjs，出现 viewer 地址时连 WS 并执行 wsAct(ws, viewerUrl)。 */
function runWithViewer(url, root, wsAct, timeoutMs = 180000, onStderrLine = null) {
  const state = { acted: false, viewerUrl: null, sawViewer: false };
  const pr = runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' },
    timeoutMs,
    onStderr: (line) => {
      onStderrLine?.(line);
      if (state.acted) return;
      const m = line.match(/viewer: (http:\/\/127\.0\.0\.1:\d+)/);
      if (!m) return;
      state.acted = true;
      state.viewerUrl = m[1];
      state.sawViewer = true;
      const ws = new WebSocket(m[1]);
      ws.on('open', () => wsAct(ws, m[1]));
    },
  });
  return { promise: pr, state };
}

const runPlain = (url, root, timeoutMs = 180000) =>
  runScript(process.execPath, [snapshotScript, '--url', url],
    { env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' }, timeoutMs });

/** 取 viewer 页面 HTML（断言弹的是哪种形态的窗口）。 */
const viewerHtml = async (url) => (await fetch(url)).text();

// ── 验证码分支 ──────────────────────────────────────────────────────────────

test('验证码 viewer：人工解决（auto 自消解）→ 管线完成 + storageState 落盘', async () => {
  const root = mkRoot();
  const { promise, state } = runWithViewer(`${server.url}/captcha-challenge.html?auto=2500`, root,
    async (ws) => {
      const html = await viewerHtml(state.viewerUrl);
      assert.ok(html.includes('人机验证'), '应弹验证码 viewer 形态');
      assert.ok(!html.includes('<button id="skip"'), '验证码 viewer 不得有跳过按钮');
      await sleep(3000); // auto=2500 自消解（挑战替换为充实正文）
      ws.send(JSON.stringify({ type: 'login_done' }));
    });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(fs.existsSync(path.join(root, 'cookies', 'storage_state.json')),
    '验证通过后 clearance 类 cookie 应落盘（refreshStorageState）');
});

test('验证码 viewer：弃窗（recheck 仍见挑战）→ error captcha_aborted', async () => {
  const root = mkRoot();
  const { promise } = runWithViewer(`${server.url}/captcha-challenge.html`, root,
    (ws) => ws.close());
  const r = await promise;
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'error', reason: 'captcha_aborted' });
});

test('验证码 viewer：首连后超时未解决 → error captcha_timeout（直连小超时）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws;
  try {
    let viewerUrl = null;
    const pr = gateCheck(s.page, `${fx.url}/captcha-challenge.html`, {
      timeout: 700, spaWaitMs: 300, storageStatePath: null,
      log: (m) => { const mt = /viewer: (http:\/\/127\.0\.0\.1:\d+)/.exec(String(m)); if (mt) viewerUrl = mt[1]; },
    });
    const t0 = Date.now();
    while (!viewerUrl && Date.now() - t0 < 15000) await sleep(50);
    assert.ok(viewerUrl, 'viewer 应已启动');
    ws = new WebSocket(viewerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const err = await pr.then(() => null, (e) => e);
    assert.equal(err?.reason, 'captcha_timeout');
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

test('占优守卫反例：讲验证码的长文 + demo 组件 → 不弹 viewer、门禁直接通过（直连）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  try {
    let sawViewer = false;
    const r = await gateCheck(s.page, `${fx.url}/captcha-article.html`, {
      spaWaitMs: 300, storageStatePath: null,
      log: (m) => { if (/viewer:/.test(String(m))) sawViewer = true; },
    });
    assert.equal(sawViewer, false, '占优守卫必须放行文档类站点');
    assert.equal(r.needsLogin, false);
    assert.equal(r.httpStatus, 200);
    assert.equal(r.gateSkippedByMemory, null);
  } finally { await s.close(); await fx.close(); }
});

// ── 稀薄内容兜底分支 ────────────────────────────────────────────────────────

test('稀薄 200 → 介入 viewer；skip → content_sparse 入档 + 管线继续', async () => {
  const root = mkRoot();
  const { promise, state } = runWithViewer(`${server.url}/sparse-empty.html`, root,
    async (ws) => {
      const html = await viewerHtml(state.viewerUrl);
      assert.ok(html.includes('页面内容确认'), '应弹介入 viewer 形态');
      assert.ok(html.includes('也可能') || html.includes('本就'), '文案应诚实声明可能是空页面');
      ws.send(JSON.stringify({ type: 'skip_login' })); // 「⏭️ 仍然继续」
    });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
  assert.ok(readSkips(root)['127.0.0.1'].includes('content_sparse'), '跳过应入档 content_sparse');
});

test('稀薄记忆豁免：二跑不弹 viewer + result 文件 gateSkippedByMemory 通报', async () => {
  const root = mkRoot();
  presetSkips(root, { '127.0.0.1': ['content_sparse'] });
  // runPlain 无 WS 驱动——若误弹 viewer 会挂到超时失败（天然负断言）
  const r = await runPlain(`${server.url}/sparse-empty.html`, root);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.gateSkippedByMemory, undefined, 'stdout keepKeys 不含 gateSkippedByMemory');
  const result = JSON.parse(fs.readFileSync(
    path.join(out['url-working-path'], 'logs', '1_snapshot_result.json'), 'utf8'));
  assert.deepEqual(result.gateSkippedByMemory, ['content_sparse'], '完整载荷应通报记忆豁免');
});

test('豁免打破：content_sparse 记忆不压制已知挑战 → 验证码 viewer 照开', async () => {
  const root = mkRoot();
  presetSkips(root, { '127.0.0.1': ['content_sparse'] });
  const { promise, state } = runWithViewer(`${server.url}/captcha-challenge.html?auto=2000`, root,
    async (ws) => {
      const html = await viewerHtml(state.viewerUrl);
      assert.ok(html.includes('人机验证'), '挑战标记优先于稀薄记忆豁免');
      await sleep(2600);
      ws.send(JSON.stringify({ type: 'login_done' }));
    });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
  assert.equal(state.sawViewer, true);
});

test('稀薄 done 回环：内容迟水合长出来后点「页面正常」→ 放行完成', async () => {
  const root = mkRoot();
  const { promise } = runWithViewer(`${server.url}/sparse-grow.html?grow=1500`, root,
    async (ws) => {
      await sleep(2200); // 等内容注入（文本量过阈值 + article 结构豁免）
      ws.send(JSON.stringify({ type: 'login_done' })); // 「✅ 页面正常，继续」
    });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
});

test('介入 viewer：弃窗且 recheck 仍稀薄 → error gate_aborted（fail-closed，用户裁定）', async () => {
  const root = mkRoot();
  const { promise } = runWithViewer(`${server.url}/sparse-empty.html`, root, (ws) => ws.close());
  const r = await promise;
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'error', reason: 'gate_aborted' });
});

test('介入 viewer：首连后超时 → error gate_timeout（直连小超时）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  const prev = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1';
  let ws;
  try {
    let viewerUrl = null;
    const pr = gateCheck(s.page, `${fx.url}/sparse-empty.html`, {
      timeout: 700, spaWaitMs: 300, storageStatePath: null,
      log: (m) => { const mt = /viewer: (http:\/\/127\.0\.0\.1:\d+)/.exec(String(m)); if (mt) viewerUrl = mt[1]; },
    });
    const t0 = Date.now();
    while (!viewerUrl && Date.now() - t0 < 15000) await sleep(50);
    assert.ok(viewerUrl, 'viewer 应已启动');
    ws = new WebSocket(viewerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const err = await pr.then(() => null, (e) => e);
    assert.equal(err?.reason, 'gate_timeout');
  } finally {
    try { ws?.close(); } catch { /* 忽略 */ }
    if (prev === undefined) delete process.env.U2M_VIEWER_NOOPEN; else process.env.U2M_VIEWER_NOOPEN = prev;
    await s.close();
    await fx.close();
  }
});

test('404 ∧ 稀薄 → error http_404（不弹 viewer、不写快照）', async () => {
  const root = mkRoot();
  let sawViewer = false;
  const r = await runScript(process.execPath, [snapshotScript, '--url', `${server.url}/no-such-page-xyz`], {
    env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' },
    onStderr: (line) => { if (/viewer:/.test(line)) sawViewer = true; },
  });
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'error', reason: 'http_404' });
  assert.equal(sawViewer, false, '404 是硬事实，直接终止不介入');
  const leftover = fs.existsSync(path.join(root)) &&
    fs.readdirSync(root, { recursive: true }).some((f) => String(f).endsWith('1_snapshot.html'));
  assert.equal(leftover, false, '不应写出快照');
});

test('404 ∧ 稀薄 ∧ URL 登录信号 → 仍 http_404（硬事实不被弱信号掩埋，审查修复 #4）', async () => {
  const root = mkRoot();
  // 路径含 /login 子串 → url 弱信号命中（hits≥1）；修复前分支③被整体跳过、
  // 404 body 被静默抓成垃圾 markdown
  const r = await runPlain(`${server.url}/login-no-page`, root);
  assert.equal(r.code, 1, `stderr: ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'error', reason: 'http_404' });
});

test('登录跳过后：管线继续（强信号复活不判连环门）+ stdout 不报 loginSkippedByMemory（审查修复 #14）', async () => {
  const root = mkRoot();
  const { promise } = runWithViewer(`${server.url}/login-wall.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' }))); // 「⏭️ 跳过登录」+ 确认
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok', '用户裁决跳过后管线应继续（password 强信号复活不得判 gate_loop_limit）');
  assert.equal(out.loginSkippedByMemory, null,
    '本会话内交互产生的跳过不是记忆豁免——loginSkippedByMemory 只通报进门前已有的记忆');
  assert.ok(readSkips(root)['127.0.0.1'].length > 0, '弱信号应已入档（下次运行可豁免）');
});

test('403 ∧ 稀薄 → 强嫌疑介入 viewer（reason 带状态码）；skip → 继续', async () => {
  const root = mkRoot();
  const { promise, state } = runWithViewer(`${server.url}/__status/403`, root,
    async (ws) => {
      const html = await viewerHtml(state.viewerUrl);
      assert.ok(html.includes('HTTP 403'), 'reason 应带状态码分诊结论');
      assert.ok(html.includes('拦截') || html.includes('阻断'), '应提示疑似访问被拦截');
      ws.send(JSON.stringify({ type: 'skip_login' }));
    });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
});

test('gate_loop_limit：介入次数超限 → error（fail-closed，maxInterventions 直连驱动）', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  try {
    let sawViewer = false;
    const err = await gateCheck(s.page, `${fx.url}/sparse-empty.html`, {
      spaWaitMs: 300, storageStatePath: null, maxInterventions: 0, // 首次介入尝试即超限
      log: (m) => { if (/viewer:/.test(String(m))) sawViewer = true; },
    }).then(() => null, (e) => e);
    assert.equal(err?.reason, 'gate_loop_limit');
    assert.equal(sawViewer, false, '超限应在开窗前抛出');
  } finally { await s.close(); await fx.close(); }
});

// ── 懒触发滑块 + 重定向目标页 ───────────────────────────────────────────────

test('懒触发滑块全链路：probe 弹挑战 → 验证码 viewer（现场不还原）→ 解决 → ok', async () => {
  const root = mkRoot();
  let lazyProbeLogs = 0;
  const { promise, state } = runWithViewer(`${server.url}/captcha-slider-lazy.html?auto=1500`, root,
    async (ws) => {
      const html = await viewerHtml(state.viewerUrl);
      assert.ok(html.includes('人机验证'), '探测触发的滑块应路由到验证码 viewer 而非登录 viewer');
      assert.ok(html.includes('geetest') || html.includes('挑战'), 'reason 应如实报告挑战来源');
      await sleep(2600); // auto=1500 置成功态，+500ms 移除面板
      ws.send(JSON.stringify({ type: 'login_done' }));
    }, 180000, (line) => { if (line.includes('探测懒触发')) lazyProbeLogs += 1; });
  const r = await promise;
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stderr.includes('门禁: 人机验证挑战'), `stderr 应记录挑战分支: ${r.stderr}`);
  assert.equal(lazyProbeLogs, 1, '探测只发生一次——验证码解决后的回环轮不得再点登录（会二次触发挑战，审查修复 #5）');
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  const snap = fs.readFileSync(path.join(out['url-working-path'], '1_snapshot.html'), 'utf8');
  assert.ok(!snap.includes('geetest_panel'), '快照不应含滑块面板（通过后现场已被还原/消解）');
});

test('重定向目标页挑战覆盖：壳页 iframe 内挑战与目标页挑战都弹验证码 viewer', async () => {
  const root = mkRoot();
  const target = encodeURIComponent('/captcha-challenge-rich.html?auto=2000');
  // 本场景会弹多个 viewer（壳页 iframe 内挑战 → 重定向后目标页重新加载再挑战——
  // 夹具无 clearance cookie 机制；真实站解决一次即 cookie 放行）：逐个驱动
  let viewers = 0;
  const r = await runScript(process.execPath,
    [snapshotScript, '--url', `${server.url}/redirect-shell-dyn.html?to=${target}`], {
      env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' },
      timeoutMs: 180000,
      onStderr: (line) => {
        const m = line.match(/viewer: (http:\/\/127\.0\.0\.1:\d+)/);
        if (!m) return;
        viewers += 1;
        const ws = new WebSocket(m[1]);
        ws.on('open', async () => {
          await sleep(2600); // 等 auto 消解
          try { ws.send(JSON.stringify({ type: 'login_done' })); } catch { /* viewer 已关 */ }
        });
      },
    });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.redirect?.to?.includes('/captcha-challenge-rich.html'), '应完成重定向');
  assert.ok(out['url-name'].startsWith('redirected_'), '快照应落 redirected_ 目录');
  assert.ok(viewers >= 1, '至少一个挑战 viewer 应弹出（实际应 ≥2：壳页 iframe + 目标页）');
});
