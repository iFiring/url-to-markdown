// script/lib/screencast.mjs —— CDP Screencast → 本地 HTTP+WS viewer（移植 .temp/login.mjs，去 express）
import http from 'node:http';
import { WebSocketServer } from 'ws';

export function loginViewerHtml({ width = 1280, height = 800 } = {}) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>url-to-markdown 登录</title>
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
  .info { margin-top: 10px; color: #888; font-size: 12px; }
</style>
</head>
<body>
<div class="header"><h1>🖥️ 远程页面登录</h1><span id="status">连接中…</span></div>
<canvas id="screen" width="${width}" height="${height}" tabindex="0"></canvas>
<div class="toolbar"><button id="done">✅ 登录完成</button></div>
<p class="info">在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。</p>
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
        statusEl.textContent = '仍未检测到登录态，请继续'; statusEl.className = 'failed';
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
    statusEl.textContent = '检测登录态中…'; statusEl.className = ''; };
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
  page, port = 0, width = 1280, height = 800, quality = 80,
  onLoginDone, onClientClose, log = () => {},
}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(loginViewerHtml({ width, height }));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ server });
  const cdp = await page.context().newCDPSession(page);
  let client = null;

  wss.on('connection', async (ws) => {
    client = ws;
    log('viewer 已连接');
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 }).catch(() => {});
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'login_done') { onLoginDone?.(ws); return; }
      await relayInput(cdp, msg).catch(() => {});
    });
    ws.on('close', () => { client = null; onClientClose?.(); });
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
      // 先断开所有 WS 客户端：server.close(cb) 会等全部连接排空，客户端不关则永久挂起
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
    },
  };
}
