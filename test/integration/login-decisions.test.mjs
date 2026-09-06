// test/integration/login-decisions.test.mjs
// 强信号裁决记忆（working/cookies/login_decisions.json）的端到端行为：
// viewer 跳过 → 记录 skip；登录完成 → 记录 login；预置 skip → 不再弹 viewer。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { openPage } from '../../script/lib/browser.mjs';
import { snapshotLogin } from '../../script/lib/snapshot-login.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
let server;

before(async () => { server = await startFixtureServer(); });
after(() => { server?.close(); });

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-decisions-'));
const decisionsPath = (root) => path.join(root, 'cookies', 'login_decisions.json');
const readDecisions = (root) =>
  JSON.parse(fs.readFileSync(decisionsPath(root), 'utf8'));

/** 跑 snapshot.mjs，出现 viewer 地址时连 WS 并执行 wsAct(ws)。 */
function runWithViewer(url, root, wsAct, timeoutMs = 90000) {
  let acted = false;
  const pr = runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' },
    timeoutMs,
    onStderr: (line) => {
      if (acted) return;
      const m = line.match(/viewer: (http:\/\/127\.0\.0\.1:\d+)/);
      if (!m) return;
      acted = true;
      const ws = new WebSocket(m[1]);
      ws.on('open', () => wsAct(ws));
    },
  });
  return pr;
}

test('viewer 跳过登录 → 管线继续 + 记录 skip + 刷新 storageState', async () => {
  const root = mkRoot();
  const r = await runWithViewer(`${server.url}/member-preview.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' })));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok', '跳过登录后管线应继续到快照完成');
  assert.ok(fs.existsSync(out.snapshot), '1_snapshot.html 应存在');
  assert.deepEqual(readDecisions(root)['127.0.0.1'], { loginButton: 'skip' },
    '跳过选择应按域名+信号记录');
  assert.ok(fs.existsSync(path.join(root, 'cookies', 'storage_state.json')),
    '跳过时也应刷新 storageState——用户若已实际登录（recheck 永败的强信号场景）不丢会话');
});

test('viewer 登录完成 → 记录 login', async () => {
  const root = mkRoot();
  // login-wall?auto=1：1500ms 后自登录并跳转 logged-in（绕开人工输入），
  // 登录完成按钮的 recheck 在跳转后执行即通过
  const r = await runWithViewer(`${server.url}/login-wall.html?auto=1`, root,
    (ws) => setTimeout(() => ws.send(JSON.stringify({ type: 'login_done' })), 2500));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  // login-wall 的表单提交按钮文字即「登录」——password 与 loginButton 两个强信号都触发、都记录
  assert.deepEqual(readDecisions(root)['127.0.0.1'], { password: 'login', loginButton: 'login' },
    '登录完成应把触发的强信号记为 login');
});

test('预置 skip 裁决 → loginButton 视为不存在，不再弹 viewer', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(decisionsPath(root)), { recursive: true });
  fs.writeFileSync(decisionsPath(root),
    JSON.stringify({ '127.0.0.1': { loginButton: 'skip' } }));
  // 不预置 auth cookie——cookieMissing 对未登录上下文近乎恒真；裁决过 skip 的
  // 信号必须连凑票资格也没有，否则同站每次都重新弹 viewer、记忆形同虚设
  const r = await runScript(process.execPath,
    [snapshotScript, '--url', `${server.url}/member-preview.html`],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(!r.stderr.includes('viewer:'), '降级后不应弹 viewer');
});

test('损坏的 decisions 文件（null / 非对象条目）→ 容忍并照常工作', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(decisionsPath(root)), { recursive: true });
  // 字面 null 能通过 JSON.parse——不经形状强转会毒化整次快照
  fs.writeFileSync(decisionsPath(root), 'null');
  const r = await runWithViewer(`${server.url}/member-preview.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' })));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok', '损坏文件不应炸掉整次转换');
  assert.deepEqual(readDecisions(root)['127.0.0.1'], { loginButton: 'skip' },
    '回写应把坏内容整体替换为合法结构');
});

test('viewer：登录期间切换 1280×800 视口，结束后恢复懒加载视口', async () => {
  const fx = await startFixtureServer();
  // 复刻 snapshot.mjs 的懒加载视口——3000px 塞 800px 画布即「高度压缩+糊」的来源
  const s = await openPage(`${fx.url}/member-preview.html`,
    { viewport: { width: 1280, height: 3000 } });
  const prevNoopen = process.env.U2M_VIEWER_NOOPEN;
  process.env.U2M_VIEWER_NOOPEN = '1'; // 直连测试不真开浏览器
  try {
    const logs = [];
    const login = snapshotLogin(s.page, `${fx.url}/member-preview.html`,
      { log: (m) => logs.push(m) });
    // 等 viewer 起来（地址经 log 回调送出）
    const url = await (async () => {
      for (let i = 0; i < 100; i++) {
        const m = logs.join('\n').match(/viewer: (http:\/\/127\.0\.0\.1:\d+)/);
        if (m) return m[1];
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('viewer 未启动');
    })();
    assert.deepEqual(s.page.viewportSize(), { width: 1280, height: 800 },
      '登录期间应为 800 高视口，与 viewer 画布匹配');
    const ws = new WebSocket(url);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'skip_login' }));
    const r = await login;
    assert.equal(r.needsLogin, true);
    assert.deepEqual(s.page.viewportSize(), { width: 1280, height: 3000 },
      '结束后应恢复懒加载视口供滚动阶段');
  } finally {
    if (prevNoopen === undefined) delete process.env.U2M_VIEWER_NOOPEN;
    else process.env.U2M_VIEWER_NOOPEN = prevNoopen;
    await s.close(); await fx.close();
  }
});
