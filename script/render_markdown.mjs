#!/usr/bin/env node
// render_markdown.mjs <url-dir> [--port 0] [--timeout 120000] [--open-timeout 5000] [--no-open]
// 双 Tab 渲染两份 result.md（缺失降级 sketch.md 标注初稿），人工选择后复制到 <url-dir>/result.md，
// 复制时把 ](assets/...) 相对引用改写为 ](<wf>/assets/...)，使其从新层级仍可解析。
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

  const WORKFLOWS = ['node_workflow', 'python_workflow'];
  const SOURCES = WORKFLOWS.map((wf) => {
    const base = path.join(dir, wf);
    const resultMd = path.join(base, 'result.md');
    const sketchMd = path.join(base, 'sketch.md');
    const file = fs.existsSync(resultMd) ? resultMd : (fs.existsSync(sketchMd) ? sketchMd : null);
    return { wf, file, draft: !fs.existsSync(resultMd) && !!file, imagesDir: path.join(base, 'assets', 'images') };
  }).filter((s) => s.file);

  if (SOURCES.length === 0) { emit({ status: 'error', reason: '两个 workflow 均无 result.md/sketch.md' }, 1); return; }

  const md = new MarkdownIt({ html: true });

  /** 初稿模式：{{IMG_n}} → 本地图片；{{COMPLEX_DIV_n}} 原样保留（占位标记） */
  function resolveDraftPlaceholders(text, imagesDir, wf) {
    return text.replace(/\{\{IMG_(\d+)\}\}/g, (m, n) => {
      try {
        const hit = fs.readdirSync(imagesDir).find((f) => f.startsWith(`IMG_${n}.`));
        return hit ? `![IMG_${n}](/file/${wf}/assets/images/${hit})` : m;
      } catch { return m; }
    });
  }

  function renderSource(src) {
    let text = fs.readFileSync(src.file, 'utf8');
    if (src.draft) text = resolveDraftPlaceholders(text, src.imagesDir, src.wf);
    let html = md.render(text);
    // 相对图片引用 → /file/<wf>/...
    html = html.replace(/(<img[^>]+src=")(?!https?:|\/\/|data:|#|\/file\/)([^"]+)"/g, `$1/file/${src.wf}/$2"`);
    return html;
  }

  /**
   * 选中文件复制到 <url-dir>/result.md 后，assets/ 的相对基准从 <wf>/ 变为 <url-dir>/，
   * 需改写 `](assets/...` / `](./assets/...` 为 `](<wf>/assets/...`。
   * 只动 assets/ 前缀的相对引用：绝对 URL、data:、#、/、../ 等其余形态一律不动。
   */
  function rewriteAssetRefs(text, wf) {
    return text.replace(/\]\((\.\/)?assets\//g, `](${wf}/assets/`);
  }

  const RENDERED = Object.fromEntries(SOURCES.map((s) => [s.wf, renderSource(s)]));

  function pageHtml(remainingMs) {
    const tabs = SOURCES.map((s, i) => `
      <button class="tab${i === 0 ? ' active' : ''}" data-wf="${s.wf}">${s.wf === 'node_workflow' ? 'Node 版' : 'Python 版'}${s.draft ? ' ⚠️ 初稿' : ''}</button>`).join('');
    const panes = SOURCES.map((s, i) => `
      <section class="pane${i === 0 ? '' : ' hidden'}" data-wf="${s.wf}">
        <div class="content md">${RENDERED[s.wf]}</div>
        <button class="pick" data-wf="${s.wf}">✅ 选这个</button>
      </section>`).join('');
    return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>选择 Markdown</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #fafafa; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 8px 16px; display: flex; gap: 8px; align-items: center; z-index: 1; }
  .tab { padding: 8px 16px; border: 1px solid #ccc; border-radius: 8px; background: #fff; cursor: pointer; }
  .tab.active { background: #e8f0fe; border-color: #4a7dd6; }
  #countdown { color: #888; margin-left: auto; font-size: 13px; }
  .pane { padding: 16px; max-width: 52em; margin: 0 auto; }
  .hidden { display: none; }
  .content { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; padding: 24px; overflow-x: auto; }
  .content img { max-width: 100%; }
  .pick { display: block; margin: 16px auto; padding: 10px 32px; font-size: 15px; border-radius: 8px;
          border: 1px solid #4a7dd6; background: #e8f0fe; cursor: pointer; }
  #done { text-align: center; color: #2e7d32; margin-top: 24px; white-space: pre-line; }
</style>
</head>
<body>
<header>${tabs}<span id="countdown"></span></header>
${panes}
<p id="done"></p>
<script>
  const REMAINING_MS = ${remainingMs};
  const deadline = Date.now() + REMAINING_MS;
  const tick = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    document.getElementById('countdown').textContent = left > 0 ? '剩余 ' + Math.ceil(left / 1000) + ' 秒' : '';
    if (left === 0) { clearInterval(tick); document.getElementById('done').textContent = '已超时，可关闭此页'; disableAll(); }
  }, 250);
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.wf !== b.dataset.wf));
  });
  function disableAll() { document.querySelectorAll('.pick').forEach((b) => b.disabled = true); }
  document.querySelectorAll('.pick').forEach((b) => b.onclick = async () => {
    try {
      const res = await fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: b.dataset.wf }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      document.getElementById('done').textContent = '已提交，可以关闭此页';
    } catch { document.getElementById('done').textContent = '服务已关闭（可能已超时），可关闭此页'; }
    disableAll();
  });
</script>
</body>
</html>`;
  }

  // ── 两阶段超时（对齐 wait-click.mjs）──
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
    const safeFile = (wf, rel) => {
      const base = path.resolve(path.join(dir, wf));
      const full = path.resolve(path.join(dir, wf, rel));
      // 前缀必须带分隔符：否则 ../node_workflow_x/../ 可逃逸到同前缀兄弟目录
      if (full !== base && !full.startsWith(base + path.sep)) return null;
      return full;
    };
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageHtml(Math.max(0, timeoutMs)));
      return;
    }
    const mdMatch = req.url?.match(/^\/md\/(node_workflow|python_workflow)$/);
    if (req.method === 'GET' && mdMatch && RENDERED[mdMatch[1]] !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(RENDERED[mdMatch[1]]);
      return;
    }
    const fileMatch = req.url?.match(/^\/file\/(node_workflow|python_workflow)\/(.+)$/);
    if (req.method === 'GET' && fileMatch) {
      let rel = null;
      try { rel = decodeURIComponent(fileMatch[2]); } catch { /* 非法百分号编码 → 404 */ }
      const full = rel === null ? null : safeFile(fileMatch[1], rel);
      if (full && fs.existsSync(full)) {
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
        let source = null;
        try { source = JSON.parse(body).source; } catch { /* 400 */ }
        if (!WORKFLOWS.includes(source)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid source' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        const src = SOURCES.find((s) => s.wf === source);
        const dest = path.join(dir, 'result.md');
        // 读→改写→写全程同步，先于下方 150ms 延迟的 finish，保证 stdout 报告 selected 时文件已就绪
        fs.writeFileSync(dest, rewriteAssetRefs(fs.readFileSync(src.file, 'utf8'), src.wf));
        setTimeout(() => finish({ status: 'selected', source, path: dest, elapsedMs: Date.now() - t0 }, 0), 150);
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
    log(`[render] 页面: ${url()} （${SOURCES.length} 个 Tab，打开自检 ${Math.round(openTimeoutMs / 1000)}s，点击窗口 ${Math.round(timeoutMs / 1000)}s）`);
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
