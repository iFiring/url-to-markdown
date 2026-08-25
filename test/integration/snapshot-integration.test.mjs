import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
const cleanScript = path.resolve('script/clean_snapshot.mjs');
let server;
let tmpRoot;

before(async () => {
  server = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-snapshot-'));
});

after(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('snapshot.mjs: 静态文章页 → ok + 1_snapshot.html', async () => {
  const url = `${server.url}/static-article.html`;
  const r = await runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.elements > 0, '应有标记元素');
  assert.ok(fs.existsSync(out.snapshot), '1_snapshot.html 应存在');

  // 验证快照内容
  const html = fs.readFileSync(out.snapshot, 'utf8');
  assert.ok(html.includes('data-u2m-id'), '应含 data-u2m-id');
  assert.ok(!html.includes('<script'), '不应含 script 标签');
});

// 请求头日志（反爬诊断）：只记「打开的页面」——主 frame 的 document 导航
// （含重定向每一跳、登录跳转）的请求头与响应头；子资源（图片/XHR）不记。
// headersArray 保留原始大小写；headers() 会略去 Cookie 等安全相关头，不可用。
test('snapshot.mjs: U2M_DEBUG=1 时只记录打开页面（document/nav）的请求头与响应头', async () => {
  const url = `${server.url}/static-article.html`;
  const r = await runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot, U2M_DEBUG: '1' },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);

  const netLines = r.stderr.split('\n').filter((l) => l.includes('[net]'));
  assert.ok(netLines.length > 0, 'stderr 应含 [net] 请求日志');
  // [net] 行裸输出不加 [dbg +N.NNs] 时间前缀——成组请求头行里前缀是干扰项
  assert.ok(
    netLines.every((l) => !l.includes('[dbg')),
    '[net] 行不应带 [dbg 时间前缀',
  );
  // 打开页面：请求首行 + 请求头（> 前缀）
  assert.ok(
    netLines.some((l) => l.includes(`[net] GET ${url} (document`)),
    `应记录文档请求首行，实际: ${netLines.slice(0, 5).join(' || ')}`,
  );
  const ua = netLines.find((l) => l.includes('[net] >  User-Agent:'));
  assert.ok(ua, '应记录请求头 User-Agent（> 前缀）');
  assert.ok(/Chrome\/\d+/.test(ua), `UA 应含 Chrome 版本，实际: ${ua}`);
  assert.ok(!netLines.join('\n').includes('HeadlessChrome'), '请求头不应残留 HeadlessChrome');
  assert.ok(
    netLines.some((l) => /[Ss]ec-[Cc][Hh]-[Uu][Aa]: /.test(l)),
    '应记录 sec-ch-ua 头',
  );
  // 响应：状态行 + 响应头（< 前缀）
  assert.ok(netLines.some((l) => l.includes('[net] <  200')), '应记录响应状态行');
  assert.ok(
    netLines.some((l) => l.includes('[net] <  Content-Type: text/html')),
    '应记录响应头 Content-Type',
  );
  // 子资源（页面里的图片 pixel.png）不应记录
  assert.ok(
    !netLines.some((l) => l.includes('pixel.png')),
    '子资源请求不应记录，只记打开的页面',
  );
});

test('snapshot.mjs: 虚拟列表页 → error + virtual_list', async () => {
  const url = `${server.url}/virtual-list.html`;
  const r = await runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.equal(out.reason, 'virtual_list');
});

test('snapshot.mjs: 标记 body 全部元素（排除纯文本修饰标签与 svg/math 内部）', async () => {
  const url = `${server.url}/inline-marking.html`;
  const r = await runScript(process.execPath, [snapshotScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.elements > 0, '应有标记元素');
  const html = fs.readFileSync(out.snapshot, 'utf8');

  // 开标签计数（(?=[\s>/]) 防止 <b 误匹配 <br>/<body>、<i 误匹配 <img> 等）
  const total = (tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])`, 'g')) || []).length;
  const withId = (tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])(?=[^>]*data-u2m-id)[^>]*>`, 'g')) || []).length;

  // 块级与有结构意义的行内元素（span/a/code/img）：全部标记
  for (const tag of ['main', 'div', 'p', 'h1', 'span', 'a', 'code', 'img', 'svg', 'math']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), total(tag), `<${tag}> 应全部带 data-u2m-id`);
  }
  // 纯文本修饰与薄语义行内标签：不标记
  for (const tag of ['strong', 'em', 'b', 'i', 'u', 's', 'mark', 'sub', 'sup', 'br', 'wbr', 'abbr', 'q', 'time', 'kbd', 'samp', 'cite']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), 0, `<${tag}> 不应带 data-u2m-id`);
  }
  // svg/math 内部后代不标记（根元素在上面已验证标记）
  for (const tag of ['g', 'rect', 'circle', 'path', 'mrow', 'mi', 'mo', 'mn']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), 0, `<${tag}>（svg/math 内部）不应带 data-u2m-id`);
  }
});

