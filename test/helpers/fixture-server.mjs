import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript',
};

export async function startFixtureServer(dirname = 'test/fixtures') {
  const root = path.resolve(dirname);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      // /__status/<code>：状态码分诊测试专用路由（稀薄兜底的 403/429/503 分支）——
      // 指定状态码 + 稀薄 body（无 main/article/iframe、无登录信号，恰好落入介入分支）
      const statusMatch = /^\/__status\/(\d{3})$/.exec(urlPath);
      if (statusMatch) {
        res.writeHead(Number(statusMatch[1]), { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>blocked</title></head><body><p>Access restricted.</p></body></html>');
        return;
      }
      const file = path.join(root, urlPath === '/' ? '/static-article.html' : urlPath);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
