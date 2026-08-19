#!/usr/bin/env node
// render_markdown.mjs <url-dir> [--port 0] [--timeout 120000] [--open-timeout 5000] [--no-open]
// 单稿预览：渲染 <dir>/result.md（缺失降级 sketch.md 标"⚠️ 初稿"），用户确认后 emit selected。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import MarkdownIt from 'markdown-it';
import { emit, log } from './lib/contract.mjs';
import { workingRoot } from './lib/env.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-open') { out[key] = true; continue; } // 布尔标志无值
      const val = argv[++i];
      // emit 延迟 process.exit：返回 null 让 main 立即停，防止继续执行打出第二行 JSON
      if (val === undefined || val.startsWith('--')) { emit({ status: 'usage_error', reason: `参数 --${key} 缺少值` }, 2); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args) return; // usage_error 已 emit，契约要求后续不再执行
  const rawDir = args._[0];
  if (!rawDir) {
    emit({ status: 'usage_error', reason: '用法: render_markdown.mjs <url-dir> [--port n] [--timeout ms] [--open-timeout ms] [--no-open]' }, 2);
    return; // emit 延迟退出——必须停，否则 rawDir=undefined 继续解析会崩溃并产生第二行输出
  }
  const dir = path.isAbsolute(rawDir) ? rawDir : path.join(workingRoot(), rawDir);
  if (!fs.existsSync(dir)) { emit({ status: 'error', reason: `目录不存在: ${dir}` }, 1); return; }
  const port = Number(args.port ?? 0);
  const timeoutMs = Number(args.timeout ?? 120000);
  const openTimeoutMs = Number(args['open-timeout'] ?? 5000);

  // 源解析：优先 result.md，缺失降级 sketch.md
  const resultMd = path.join(dir, 'result.md');
  const sketchMd = path.join(dir, 'sketch.md');
  const file = fs.existsSync(resultMd) ? resultMd : (fs.existsSync(sketchMd) ? sketchMd : null);
  if (!file) { emit({ status: 'error', reason: `result.md/sketch.md 均缺失: ${dir}` }, 1); return; }
  const draft = !fs.existsSync(resultMd);
  const imagesDir = path.join(dir, 'assets', 'images');

  const md = new MarkdownIt({ html: true });

  /** 初稿模式：{{IMG_n}} → 本地图片；{{COMPLEX_DIV_n}} 原样保留（占位标记） */
  function resolveDraftPlaceholders(text) {
    return text.replace(/\{\{IMG_(\d+)\}\}/g, (m, n) => {
      try {
        const hit = fs.readdirSync(imagesDir).find((f) => f.startsWith(`IMG_${n}.`));
        return hit ? `![IMG_${n}](/file/assets/images/${hit})` : m;
      } catch { return m; }
    });
  }

  function renderContent() {
    let text = fs.readFileSync(file, 'utf8');
    if (draft) text = resolveDraftPlaceholders(text);
    let html = md.render(text);
    html = html.replace(/(<img[^>]+src=")(?!https?:|\/\/|data:|#|\/file\/)([^"]+)"/g, '$1/file/$2"');
    return html;
  }
  const RENDERED = renderContent();

  function pageHtml(remainingMs) {
    return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>确认交付</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #fafafa; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 8px 16px; display: flex; gap: 8px; align-items: center; z-index: 1; }
  header h1 { font-size: 16px; margin: 0; }
  #countdown { color: #888; margin-left: auto; font-size: 13px; }
  .pane { padding: 16px; max-width: 52em; margin: 0 auto; }
  .content { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; padding: 24px; overflow-x: auto; }
  .content img { max-width: 100%; }
  .pick { display: block; margin: 16px auto; padding: 10px 32px; font-size: 15px; border-radius: 8px;
          border: 1px solid #4a7dd6; background: #e8f0fe; cursor: pointer; }
  #done { text-align: center; color: #2e7d32; margin-top: 24px; white-space: pre-line; }
</style>
</head>
<body>
<header><h1>确认交付${draft ? ' ⚠️ 初稿' : ''}</h1><span id="countdown"></span></header>
<section class="pane">
  <div class="content md">${RENDERED}</div>
  <button class="pick">✅ 确认交付</button>
</section>
<p id="done"></p>
<script>
  const REMAINING_MS = ${remainingMs};
  const deadline = Date.now() + REMAINING_MS;
  const tick = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    document.getElementById('countdown').textContent = left > 0 ? '剩余 ' + Math.ceil(left / 1000) + ' 秒' : '';
    if (left === 0) { clearInterval(tick); document.getElementById('done').textContent = '已超时，可关闭此页'; disableAll(); }
  }, 250);
  function disableAll() { document.querySelectorAll('.pick').forEach((b) => b.disabled = true); }
  document.querySelector('.pick').onclick = async () => {
    try {
      const res = await fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      document.getElementById('done').textContent = '已提交，可以关闭此页';
    } catch { document.getElementById('done').textContent = '服务已关闭（可能已超时），可关闭此页'; }
    disableAll();
  };
</script>
</body>
</html>`;
  }

  // ── 两阶段超时 ──
  const t0 = Date.now();
  const url = () => `http://127.0.0.1:${server.address().port}`;
  let settled = null;
  let visitedAt = null;
  let openTimer = null;
  let clickTimer = null;

  function finish(result, code) {
    if (settled) return;
    settled = result;
    clearTimeout(openTimer); clearTimeout(clickTimer);
    server.close(); server.closeAllConnections();
    emit(result, code);
  }

  const server = http.createServer((req, res) => {
    if (visitedAt === null) { // 首个请求 = 页面已打开，进入点击窗口
      visitedAt = Date.now();
      clearTimeout(openTimer);
      clickTimer = setTimeout(() => finish({ status: 'timeout' }, 1), timeoutMs);
    }
    const safeFile = (rel) => {
      const base = path.resolve(dir);
      const full = path.resolve(path.join(dir, rel));
      if (full !== base && !full.startsWith(base + path.sep)) return null;
      return full;
    };
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageHtml(Math.max(0, timeoutMs)));
      return;
    }
    if (req.method === 'GET' && req.url === '/md') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(RENDERED);
      return;
    }
    const fileMatch = req.url?.match(/^\/file\/(.+)$/);
    if (req.method === 'GET' && fileMatch) {
      let rel = null;
      try { rel = decodeURIComponent(fileMatch[1]); } catch { /* 非法百分号编码 → 404 */ }
      const full = rel === null ? null : safeFile(rel);
      // 目录同样通过 existsSync + isFile 防止 EISDIR 崩溃
      if (full && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ext = path.extname(full);
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(fs.readFileSync(full));
        return;
      }
      res.writeHead(404); res.end();
      return;
    }
    if (req.method === 'POST' && req.url === '/select') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        // body 解析但忽略内容（兼容旧 {"source":...} 调用）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(() => finish({ status: 'selected', path: file, elapsedMs: Date.now() - t0 }, 0), 150);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  // listen 失败等也守契约：单行 JSON 后退出 1（emit 延迟退出，settled 挡住后续 finish 重复 emit）
  server.on('error', (e) => {
    if (settled) return;
    settled = { status: 'error' };
    log(`[render] 服务启动失败: ${e.message}`);
    emit({ status: 'error', reason: `HTTP 服务错误: ${e.message}` }, 1);
  });

  server.listen(port, '127.0.0.1', () => {
    // 注意：URL 后必须留空格再接中文括号——消费方用 \S+ 截取 URL，紧贴会把全角括号吞进 URL
    log(`[render] 页面: ${url()} （${draft ? '初稿预览' : 'result.md'}，打开自检 ${Math.round(openTimeoutMs / 1000)}s，点击窗口 ${Math.round(timeoutMs / 1000)}s）`);
    if (!args['no-open']) {
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url()] : [url()];
      execFile(cmd, cmdArgs, () => {});
    }
    openTimer = setTimeout(() => {
      log(`[render] 打开失败：${openTimeoutMs}ms 内浏览器没有加载页面；可手动访问 ${url()}`);
      finish({ status: 'open_failed', url: url() }, 1);
    }, openTimeoutMs);
  });
}

try {
  main();
} catch (e) {
  emit({ status: 'error', reason: e.message }, 1);
}
