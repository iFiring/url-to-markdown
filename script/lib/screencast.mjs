// script/lib/screencast.mjs —— CDP Screencast → 本地 HTTP+WS viewer（移植 .temp/login.mjs，去 express）
// 泛化为三形态参数化 viewer（登录/人机验证/稀薄内容人工介入）：全部文案可参数化，
// 默认值 = 登录 viewer 原文案逐字一致（零参数调用产物与旧版相同）。skipText:null = 不渲染跳过
// 按钮（验证码 viewer 形态——只能解决或关窗）；reasonHint:null = 省略 reason 行尾句。
// WS 消息协议名不改（login_done/skip_login/recheck_failed）——viewer 会话是单用途的，
// 语义差异由调用方回调承载；改名会破坏现有集成测试的 WS 驱动。
// onFirstConnect：首个 WS 客户端连接时同步触发一次——「超时倒计时从用户真正打开 viewer
// 页面才开始」计时语义的挂钩点（人没看到窗口不算人超时；无人连接由调用方的绝对上限兜底）。
import http from 'node:http';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 跨平台打开 viewer 的命令分派（原 login_url.mjs 行为，合并进 snapshot.mjs 时遗失）。 */
export function openViewerCommand(platform, url) {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** JS 字符串安全注入：< 转义防 </script> 提前闭合标签（JSON.stringify 不处理 HTML 上下文）。 */
const safeJsString = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c');

const DEFAULT_SKIP_CONFIRM = '确认跳过登录？将不打开登录流程、直接继续转换本次页面。';

/** 文案默认值 = 登录 viewer 原文案（逐字）。null 语义仅 skipText/reasonHint 有（见上）。 */
const VIEWER_TEXT_DEFAULTS = {
  title: 'url-to-markdown 登录',
  headingText: '🖥️ 远程页面登录',
  doneText: '✅ 登录完成',
  skipText: '⏭️ 跳过登录',
  infoText: '在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。',
  reasonHint: '若无需登录可点「跳过登录」',
  recheckFailedText: '仍未检测到登录态，请继续',
  checkingText: '检测登录态中…',
  skippingText: '跳过登录，继续转换…',
};

export function loginViewerHtml({
  width = 1280, height = 800, reason = '', skipConfirmText = '',
  title, headingText, doneText, skipText, infoText, reasonHint,
  recheckFailedText, checkingText, skippingText,
} = {}) {
  const D = VIEWER_TEXT_DEFAULTS;
  const vTitle = title ?? D.title;
  const vHeading = headingText ?? D.headingText;
  const vDone = doneText ?? D.doneText;
  const vSkip = skipText === undefined ? D.skipText : skipText;       // null = 隐藏按钮
  const vInfo = infoText ?? D.infoText;
  const vHint = reasonHint === undefined ? D.reasonHint : reasonHint; // null = 省略尾句
  const vRecheckFailed = recheckFailedText ?? D.recheckFailedText;
  const vChecking = checkingText ?? D.checkingText;
  const vSkipping = skippingText ?? D.skippingText;
  const skipConfirm = safeJsString(skipConfirmText || DEFAULT_SKIP_CONFIRM);
  const skipBtnHtml = vSkip === null ? '' : `<button id="skip">${escapeHtml(vSkip)}</button>`;
  const reasonHtml = reason
    ? `<p class="info reason">📍 ${escapeHtml(reason)}。${vHint === null ? '' : escapeHtml(vHint) + '。'}</p>`
    : '';
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(vTitle)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f0f1a; display: flex; flex-direction: column; align-items: center;
         justify-content: center; min-height: 100vh; font-family: -apple-system, "PingFang SC", sans-serif; padding: 20px; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  h1 { color: #e0e0e0; font-size: 17px; font-weight: 500; }
  #status { font-size: 12px; padding: 3px 10px; border-radius: 10px; background: #1a1a2e; border: 1px solid #333; color: #fbbf24; }
  #status.connected { color: #4ade80; border-color: #4ade80; }
  #status.failed { color: #f87171; border-color: #f87171; }
  #screen { display: block; background: #1a1a2e; border-radius: 10px; border: 1px solid #2a2a3e; max-width: 95vw; max-height: 78vh; }
  .toolbar { margin-top: 12px; }
  #done { padding: 10px 28px; font-size: 15px; border-radius: 8px; border: 1px solid #4ade80;
          background: #14532d; color: #eafbe7; cursor: pointer; }
  #done:hover { background: #166534; }
  #skip { padding: 10px 28px; font-size: 15px; border-radius: 8px; border: 1px solid #555;
          background: #1a1a2e; color: #bbb; cursor: pointer; margin-left: 10px; }
  #skip:hover { background: #22223a; }
  .info { margin-top: 10px; color: #888; font-size: 12px; }
  .reason { color: #fbbf24; }
</style>
</head>
<body>
<div class="header"><h1>${escapeHtml(vHeading)}</h1><span id="status">连接中…</span></div>
<canvas id="screen" width="${width}" height="${height}" tabindex="0"></canvas>
<div class="toolbar"><button id="done">${escapeHtml(vDone)}</button>${skipBtnHtml}</div>
${reasonHtml}
<p class="info">${escapeHtml(vInfo)}</p>
<script>
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  let ws;
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
    ws.onopen = () => { statusEl.textContent = '已连接'; statusEl.className = 'connected'; canvas.focus(); };
    ws.onclose = () => { statusEl.textContent = '连接已断开'; statusEl.className = 'failed'; setTimeout(connect, 3000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'frame') {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = 'data:image/jpeg;base64,' + msg.data;
      } else if (msg.type === 'recheck_failed') {
        statusEl.textContent = ${safeJsString(vRecheckFailed)}; statusEl.className = 'failed';
      }
    };
  }
  connect();
  function coords(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (canvas.width / r.width)),
             y: Math.round((e.clientY - r.top) * (canvas.height / r.height)) };
  }
  function send(d) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(d)); }
  canvas.addEventListener('mousemove', (e) => { const {x, y} = coords(e); send({type:'mousemove', x, y}); });
  canvas.addEventListener('mousedown', (e) => { e.preventDefault(); canvas.focus();
    const {x, y} = coords(e); send({type:'mousedown', x, y, button: ['left','middle','right'][e.button] || 'left'}); });
  canvas.addEventListener('mouseup', (e) => { e.preventDefault();
    const {x, y} = coords(e); send({type:'mouseup', x, y, button: ['left','middle','right'][e.button] || 'left'}); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const {x, y} = coords(e);
    send({type:'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY}); }, { passive: false });
  document.addEventListener('keydown', (e) => { if (document.activeElement === canvas) { e.preventDefault();
    send({type:'keydown', key: e.key, code: e.code, text: e.key.length === 1 ? e.key : '', keyCode: e.keyCode}); } });
  document.addEventListener('keyup', (e) => { if (document.activeElement === canvas) { e.preventDefault();
    send({type:'keyup', key: e.key, code: e.code, keyCode: e.keyCode}); } });
  document.getElementById('done').onclick = () => { send({type:'login_done'});
    statusEl.textContent = ${safeJsString(vChecking)}; statusEl.className = ''; };
  const SKIP_CONFIRM = ${skipConfirm};
  const skipBtn = document.getElementById('skip');
  if (skipBtn) skipBtn.onclick = () => {
    if (!window.confirm(SKIP_CONFIRM)) return; // 确认框门控：跳过可能写入持久记忆，误点不可接受
    send({type:'skip_login'});
    statusEl.textContent = ${safeJsString(vSkipping)}; statusEl.className = ''; };
</script>
</body>
</html>`;
}

async function relayInput(cdp, msg) {
  switch (msg.type) {
    case 'mousemove': await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: msg.x, y: msg.y }); break;
    case 'mousedown': await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: msg.x, y: msg.y, button: msg.button || 'left', clickCount: 1 }); break;
    case 'mouseup':   await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: msg.x, y: msg.y, button: msg.button || 'left', clickCount: 1 }); break;
    case 'keydown':   await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: msg.key, code: msg.code, text: msg.text || '', windowsVirtualKeyCode: msg.keyCode, nativeVirtualKeyCode: msg.keyCode }); break;
    case 'keyup':     await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: msg.key, code: msg.code, windowsVirtualKeyCode: msg.keyCode, nativeVirtualKeyCode: msg.keyCode }); break;
    case 'scroll':    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: msg.x, y: msg.y, deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0 }); break;
  }
}

/** 起 HTTP(viewer 页)+WS 服务，把 page 的 CDP Screencast 转发给 WS 客户端并转发输入。 */
export async function startScreencastViewer({
  page, port = 0, width = 1280, height = 800, quality = 80, reason = '', skipConfirmText = '',
  title, headingText, doneText, skipText, infoText, reasonHint,
  recheckFailedText, checkingText, skippingText,
  onLoginDone, onSkipLogin, onClientClose, onFirstConnect, log = () => {},
}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(loginViewerHtml({
        width, height, reason, skipConfirmText,
        title, headingText, doneText, skipText, infoText, reasonHint,
        recheckFailedText, checkingText, skippingText,
      }));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ server });
  const cdp = await page.context().newCDPSession(page);
  let client = null;
  let firstConnected = false;
  let liveCount = 0;            // 活跃 WS 连接数（双开页面 >1——关其一不是弃窗）
  let closeTimer = null;        // 弃窗判定的去抖窗：F5/断线重连的旧 socket 先断、新 socket 随即建立

  wss.on('connection', (ws) => {
    liveCount += 1;
    // 去抖窗内有新连接 → 同一会话的断线重连/刷新，撤销 pending 的弃窗判定
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    client = ws;
    log('viewer 已连接');
    // 首连回调同步触发一次（吞异常——连接建立不能被调用方回调破坏；
    // 计时启动失败属调用方 bug，应由其自行保证回调不抛）
    if (!firstConnected) {
      firstConnected = true;
      try { onFirstConnect?.(); } catch { /* 忽略 */ }
    }
    // 监听器必须先于任何 await 挂载——客户端可能在握手完成后立即发消息
    // （自动化测试即如此），EventEmitter 不排队无监听期的帧，晚挂 = 静默丢消息
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'login_done') { onLoginDone?.(ws); return; }
      if (msg.type === 'skip_login') { onSkipLogin?.(); return; }
      await relayInput(cdp, msg).catch(() => {});
    });
    ws.on('close', () => {
      liveCount -= 1;
      if (client === ws) {
        client = null;
        // 当前画面通道断了但还有其他活连接（双开页面关其一）→ 切换画面通道不冻结
        for (const c of wss.clients) {
          if (c !== ws && c.readyState === 1) { client = c; break; }
        }
      }
      if (liveCount > 0) return;
      // 最后一个连接断了 → 去抖后再判弃窗：F5 刷新/网络抖动会先断旧连再建新连
      // （客户端 3s 自动重连），立即判定会把进行中的会话误杀为 aborted
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { closeTimer = null; onClientClose?.(); }, 1500);
      closeTimer.unref?.();
    });
    cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 }).catch(() => {});
  });

  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* session 已关 */ }
    if (client && client.readyState === 1) client.send(JSON.stringify({ type: 'frame', data }));
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: async () => {
      try { await cdp.send('Page.stopScreencast'); } catch { /* 忽略 */ }
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } // 服务关闭 ≠ 弃窗
      // 先断开所有 WS 客户端：server.close(cb) 会等全部连接排空，客户端不关则永久挂起
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
    },
  };
}

/**
 * 通用 viewer 会话骨架（人机门禁，自 snapshot-login.mjs 整体平移）：
 * 视口临时切 1280×800（管线 3000 高懒加载视口塞 800 画布会纵向压扁+模糊，会话
 * 结束恢复）→ prepare（进 viewer 前的页面状态整理）→ startScreencastViewer →
 * 自动 open 默认浏览器（U2M_VIEWER_NOOPEN=1 关，测试用）→ finish/fail/settled
 * 守卫 → 超时 timer。三种 viewer 形态（登录/验证码/稀薄介入）共用本机制，
 * 语义差异全部由调用方回调与 viewerOpts 文案参数承载。
 *
 * 回调（onDone(ws, api) / onSkip(api) / onClose(api)）拿到会话 api：
 * { finish(result), fail(reason), isSettled() }。
 * - 回调内必须先查 isSettled()——finish/fail 会 close viewer 并 terminate WS
 *   客户端、必然再触发 onClose；无守卫则迟到回调会再次变异页面、污染后续快照（实测竞态）
 * - 回调抛出的异常由本骨架捕获记 log（不炸进程——单行 JSON 契约优先），
 *   但善后语义（入档/刷新/还原）调用方仍需自行 try/catch 保证尽力执行
 *
 * 超时语义（用户裁定，三形态统一）：倒计时从用户**首次打开 viewer
 * 页面（首次 WS 连接）**才开始——人没看到窗口不算人超时；无人连接由启动起的
 * backstopMs 绝对上限（默认 1h）兜底，到期照常 fail(timeoutReason) 退出——守
 * 「失败也是单行 JSON」契约，进程不无限期挂死。
 * @param {import('playwright').Page} page
 * @returns {Promise<any>} finish 的入参 resolve；Error{reason} reject（超时 = timeoutReason）
 */
export async function runViewerSession(page, {
  viewerOpts = {}, timeout = 300000, timeoutReason = 'login_timeout',
  backstopMs = 3600000,
  prepare, onDone, onSkip, onClose, onFirstConnect, log = () => {},
} = {}) {
  const origViewport = page.viewportSize();
  if (origViewport) await page.setViewportSize({ width: origViewport.width || 1280, height: 800 });
  try {
    if (prepare) await prepare();
    return await new Promise((resolve, reject) => {
      let settled = false;
      let viewer = null;
      let countdownTimer = null; // 首连后的倒计时（timeout）
      let backstopTimer = null;  // 启动起的绝对上限（backstopMs）——无人打开 viewer 的兜底

      const clearTimers = () => {
        if (countdownTimer) clearTimeout(countdownTimer);
        if (backstopTimer) clearTimeout(backstopTimer);
      };
      const finish = (res) => {
        if (settled) return;
        settled = true;
        clearTimers();
        try { viewer?.close(); } catch { /* 忽略 */ }
        resolve(res);
      };
      const fail = (reason) => {
        if (settled) return;
        settled = true;
        clearTimers();
        try { viewer?.close(); } catch { /* 忽略 */ }
        const err = new Error(reason);
        err.reason = reason;
        reject(err);
      };
      const api = { finish, fail, isSettled: () => settled };

      backstopTimer = setTimeout(() => fail(timeoutReason), backstopMs);
      backstopTimer.unref?.();

      const guard = (fn) => (...args) => {
        try { Promise.resolve(fn(...args)).catch((e) => log(`viewer 回调异常: ${e.message}`)); }
        catch (e) { log(`viewer 回调异常: ${e.message}`); }
      };

      startScreencastViewer({
        page,
        quality: 85, // 文本可读性：800 高原生分辨率下 q80 的 jpeg 压缩伪影偏明显
        ...viewerOpts,
        onFirstConnect: () => {
          if (settled) return;
          // 首连：撤绝对上限、起正式倒计时
          if (backstopTimer) { clearTimeout(backstopTimer); backstopTimer = null; }
          countdownTimer = setTimeout(() => fail(timeoutReason), timeout);
          countdownTimer.unref?.();
          log(`viewer 首连，倒计时 ${timeout}ms 启动`);
          try { onFirstConnect?.(); } catch (e) { log(`onFirstConnect 异常: ${e.message}`); }
        },
        onLoginDone: onDone ? guard((ws) => onDone(ws, api)) : undefined,
        onSkipLogin: onSkip ? guard(() => onSkip(api)) : undefined,
        onClientClose: onClose ? guard(() => onClose(api)) : undefined,
        log,
      }).then((v) => {
        viewer = v;
        // viewer 地址行是人机交互契约（自动 open 失败时用户/测试的唯一入口）——
        // 走调用方传入的 log，调用方有责任保证它无条件到达 stderr：入口页 gateCheck
        // 的 log 即 contract.log；重定向门在 snapshot.mjs 调用点做 viewer 行提升
        // （曾因 log=debug 静默导致目标页 viewer 不可发现、进程挂到 backstop）
        log(`[snapshot] viewer: ${v.url}`);
        // 自动打开用户默认浏览器（打不开不致命——URL 已记 stderr；测试用
        // U2M_VIEWER_NOOPEN=1 关闭）
        if (process.env.U2M_VIEWER_NOOPEN !== '1') {
          const { cmd, args } = openViewerCommand(process.platform, v.url);
          execFile(cmd, args, () => {});
        }
      }).catch((e) => fail(e.message));
    });
  } finally {
    if (origViewport) {
      try { await page.setViewportSize(origViewport); } catch { /* 页面已关 */ }
    }
  }
}
