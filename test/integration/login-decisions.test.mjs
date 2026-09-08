// test/integration/login-decisions.test.mjs
// 跳过记忆 v2（working/cookies/login_decisions_skips.json，{hostname: [信号名,...]}）
// 的端到端行为：跳过确认 → 仅弱信号入档 + 状态还原；纯强信号跳过不落盘；
// 预置记忆 → 全命中豁免不弹 viewer + emit loginSkippedByMemory；新证据打破豁免；
// 旧版 login_decisions.json 忽略；损坏文件容忍。
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
const skipsPath = (root) => path.join(root, 'cookies', 'login_decisions_skips.json');
const readSkips = (root) => JSON.parse(fs.readFileSync(skipsPath(root), 'utf8'));
const presetSkips = (root, obj) => {
  fs.mkdirSync(path.dirname(skipsPath(root)), { recursive: true });
  fs.writeFileSync(skipsPath(root), JSON.stringify(obj));
};

/** 跑 snapshot.mjs，出现 viewer 地址时连 WS 并执行 wsAct(ws)。 */
function runWithViewer(url, root, wsAct, timeoutMs = 120000) {
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

const runPlain = (url, root, timeoutMs = 120000) =>
  runScript(process.execPath, [snapshotScript, '--url', url],
    { env: { U2M_WORKING_ROOT: root, U2M_VIEWER_NOOPEN: '1' }, timeoutMs });

test('viewer 跳过 → 弱信号入档 + 弹窗状态还原 + 管线继续 + storageState 刷新', async () => {
  const root = mkRoot();
  // member-preview：loginConfirmed（强，点击→弹窗）+ loginButton（弱）双命中触发 viewer
  const r = await runWithViewer(`${server.url}/member-preview.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' })));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok', '跳过登录后管线应继续到快照完成');
  assert.ok(fs.existsSync(out.snapshot), '1_snapshot.html 应存在');
  assert.deepEqual(readSkips(root)['127.0.0.1'], ['loginButton'],
    '仅弱信号 loginButton 入档；强信号 loginConfirmed 永不落盘');
  const snap = fs.readFileSync(out.snapshot, 'utf8');
  assert.ok(!snap.includes('signin-modal'),
    '跳过后应还原探测点开的弹窗——快照抓干净页而非登录弹窗');
  assert.ok(fs.existsSync(path.join(root, 'cookies', 'storage_state.json')),
    '跳过时也应刷新 storageState——用户若已实际登录不丢会话');
  assert.ok(!fs.existsSync(path.join(root, 'cookies', 'login_decisions.json')),
    '旧版 decisions 文件不应再被写入');
});

test('纯强信号页跳过 → 无弱票可记、不落盘 → 下次运行 viewer 照开', async () => {
  const root = mkRoot();
  // gate-pure：仅隐藏密码框命中 password（零弱票）
  const r1 = await runWithViewer(`${server.url}/gate-pure.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' })));
  assert.equal(r1.code, 0, `stderr: ${r1.stderr}`);
  assert.equal(JSON.parse(r1.stdout).status, 'ok');
  assert.equal(fs.existsSync(skipsPath(root)), false, '强信号跳过=一次性，不应创建记忆文件');
  // 第二次运行：无记忆 → viewer 再次打开
  let viewerOpened = false;
  const r2 = await runWithViewer(`${server.url}/gate-pure.html`, root, (ws) => {
    viewerOpened = true;
    ws.send(JSON.stringify({ type: 'skip_login' }));
  });
  assert.equal(r2.code, 0, `stderr: ${r2.stderr}`);
  assert.ok(viewerOpened, '纯强信号跳过不记忆，二次运行应再弹 viewer');
});

test('预置记忆全命中 → 豁免：不弹 viewer、emit 通报 loginSkippedByMemory', async () => {
  const root = mkRoot();
  presetSkips(root, { '127.0.0.1': ['loginButton'] });
  const r = await runPlain(`${server.url}/member-preview.html`, root);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(!r.stderr.includes('viewer:'), '豁免后不应弹 viewer');
  assert.deepEqual(out.loginSkippedByMemory, ['loginButton'],
    'emit 应如实通报「有信号命中但全在跳过记忆」');
  const snap = fs.readFileSync(out.snapshot, 'utf8');
  assert.ok(!snap.includes('signin-modal'), '豁免路径零探测零点击，页面应保持原状');
});

test('记忆外新证据 → 打破豁免：强信号复活，viewer 照开', async () => {
  const root = mkRoot();
  // member-span-late：初始无候选（loginButton 记忆看似可豁免），但 spa 窗内
  // 迟水合入口出现 → 探测确认 loginConfirmed（记忆外强信号）→ 必须弹 viewer
  presetSkips(root, { '127.0.0.1': ['loginButton'] });
  let viewerOpened = false;
  const r = await runWithViewer(`${server.url}/member-span-late.html`, root, (ws) => {
    viewerOpened = true;
    ws.send(JSON.stringify({ type: 'skip_login' }));
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.ok(viewerOpened, '新强信号不在记忆内，豁免不应生效');
  const skips = readSkips(root)['127.0.0.1'];
  assert.ok(skips.includes('loginButton') && !skips.includes('loginConfirmed'),
    '跳过后仍只记弱信号');
});

test('旧版 login_decisions.json（信号→choice 对象格式）被无视', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'cookies'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cookies', 'login_decisions.json'),
    JSON.stringify({ '127.0.0.1': { loginButton: 'skip' } }));
  // 旧记忆里 loginButton=skip（知乎误判根因 A 的形态）——新代码必须照常弹 viewer
  let viewerOpened = false;
  const r = await runWithViewer(`${server.url}/member-preview.html`, root, (ws) => {
    viewerOpened = true;
    ws.send(JSON.stringify({ type: 'skip_login' }));
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.ok(viewerOpened, '旧格式记忆不应再压制任何信号');
});

test('viewer 登录完成 → 不落盘任何记忆 + 管线继续', async () => {
  const root = mkRoot();
  // login-wall?auto=1：1500ms 后自登录并跳转 logged-in（绕开人工输入），
  // 登录完成按钮的 recheck 在跳转后执行即通过
  const r = await runWithViewer(`${server.url}/login-wall.html?auto=1`, root,
    (ws) => setTimeout(() => ws.send(JSON.stringify({ type: 'login_done' })), 2500));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(fs.existsSync(skipsPath(root)), false, '登录完成不写记忆文件');
  assert.ok(!fs.existsSync(path.join(root, 'cookies', 'login_decisions.json')),
    '旧版 login 记录也不应再写入');
});

test('损坏的 skips 文件（字面 null）→ 容忍并照常工作，回写合法结构', async () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(skipsPath(root)), { recursive: true });
  fs.writeFileSync(skipsPath(root), 'null');
  const r = await runWithViewer(`${server.url}/member-preview.html`, root,
    (ws) => ws.send(JSON.stringify({ type: 'skip_login' })));
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).status, 'ok', '损坏文件不应炸掉整次转换');
  assert.deepEqual(readSkips(root)['127.0.0.1'], ['loginButton'],
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
      for (let i = 0; i < 150; i++) {
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
