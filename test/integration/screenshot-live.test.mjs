import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { runScript } from '../helpers/run-script.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
const transScript = path.resolve('script/screenshot_trans.mjs');

// 可翻版的 live 夹具服务器：v1 → v2 在模块前插入新段落并改模块文本，
// 使 data-u2m-id 平移 + 签名失配 → 步骤 8 应自动降级快照兜底。
// 内联 script 刻意保留：验证「剥 script 再标记」的确定性在两次渲染间成立。
function startLiveServer() {
  let variant = 'v1';
  const html = () => variant === 'v1'
    ? `<!DOCTYPE html><html lang="zh-CN"><head><title>重渲染夹具</title>
<script>document.title = 'hydration';</script></head><body>
<h1>标题一级</h1>
<p>${'正文填充文本。'.repeat(8)}</p>
<div class="module" style="background-color: rgb(30, 30, 30); color: rgb(255, 255, 255); padding: 16px">模块内容原始版</div>
<p>结尾段落。</p>
</body></html>`
    : `<!DOCTYPE html><html lang="zh-CN"><head><title>重渲染夹具</title>
<script>document.title = 'hydration';</script></head><body>
<h1>标题一级</h1>
<p>${'正文填充文本。'.repeat(8)}</p>
<p>翻版后新插入的段落，使后续 data-u2m-id 整体平移。</p>
<div class="module" style="background-color: rgb(30, 30, 30); color: rgb(255, 255, 255); padding: 16px">模块内容翻新版</div>
<p>结尾段落。</p>
</body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/flip') {
      variant = 'v2';
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('flipped');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      url: `${base}/article`,
      flip: () => fetch(`${base}/flip`).then(() => {}),
      close: () => new Promise((r) => server.close(r)),
    });
  }));
}

let server;
let tmpRoot;

before(async () => {
  server = await startLiveServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-slive-'));
});

after(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('步骤 8 live 重渲染：同内容两次渲染 id 对位 → source:"live"；翻版失配 → 自动兜底 "snapshot"', async () => {
  // ── 步骤 1：对 v1 页面抓快照 ──
  const r1 = await runScript(process.execPath, [snapshotScript, '--url', server.url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 90000,
  });
  assert.equal(r1.code, 0, `stderr: ${r1.stderr}`);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.status, 'ok');

  const urlDir = path.dirname(out1.snapshot);
  const snapHtml = fs.readFileSync(out1.snapshot, 'utf8');

  // 从快照解析模块的 data-u2m-id（属性序两种可能都兼容）
  const m = snapHtml.match(/<div[^>]*(?:class="module"[^>]*data-u2m-id="(\d+)"|data-u2m-id="(\d+)"[^>]*class="module")[^>]*>/);
  assert.ok(m, '快照中应能定位 class="module" 元素');
  const moduleId = m[1] || m[2];
  assert.ok(Number(moduleId) > 0, `模块 id 应为正数: ${moduleId}`);

  fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), JSON.stringify([{ trans2img: String(moduleId) }]));
  fs.writeFileSync(path.join(urlDir, '2_long_text.json'), '{}');

  // ── 步骤 8（v1：live 重渲染结构一致 → id 对位、签名全等）──
  const r2 = await runScript(process.execPath, [transScript, '--url', server.url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 90000,
  });
  assert.equal(r2.code, 0, `stderr: ${r2.stderr}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.status, 'ok');
  assert.equal(out2.count, 1, '应截图 1 个');
  assert.equal(out2.source, 'live', '同内容重渲染应命中 live');

  const webp = path.join(urlDir, 'assets', 'trans', `${moduleId}.webp`);
  assert.ok(fs.existsSync(webp), `截图应存在: ${webp}`);
  const buf = fs.readFileSync(webp);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'WebP RIFF header');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WebP WEBP signature');

  // ── 翻版 → 步骤 8（v2：id 平移 + 文本变更 → 严校验失配 → 快照兜底）──
  await server.flip();
  const r3 = await runScript(process.execPath, [transScript, '--url', server.url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 90000,
  });
  assert.equal(r3.code, 0, `stderr: ${r3.stderr}`);
  const out3 = JSON.parse(r3.stdout);
  assert.equal(out3.status, 'ok');
  assert.equal(out3.count, 1, '兜底仍应出图');
  assert.equal(out3.source, 'snapshot', '翻版后签名失配应自动走快照兜底');
  assert.ok(fs.existsSync(webp), '兜底截图应覆盖写入');

  // resolved skeleton 同步产出
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [{ trans2img: String(moduleId) }]);
});
