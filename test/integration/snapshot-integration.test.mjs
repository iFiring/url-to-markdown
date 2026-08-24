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

