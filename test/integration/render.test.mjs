// test/integration/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

await writePixelPng('test/fixtures/pixel.png');

const script = path.resolve('script/render_markdown.mjs');

function prepWorking() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-render-'));
  const dir = path.join(root, 'example_com_page');
  fs.mkdirSync(path.join(dir, 'assets/images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.md'),
    '# 结果\n\n![IMG_1](assets/images/IMG_1.png)\n\n![相对](./assets/images/IMG_1.png)\n\n' +
    '![外链](https://example.com/assets/logo.png)\n\n![内联](data:image/gif;base64,R0lGOD)\n\nRESULT_BODY');
  fs.copyFileSync('test/fixtures/pixel.png', path.join(dir, 'assets/images/IMG_1.png'));
  return { root, dir };
}

test('确认交付：stdout selected + path 指向 result.md + 退出 0', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((html) => {
        assert.match(html, /RESULT_BODY/);
        return fetch(`${m[1]}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      }).catch(() => {});
    } });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'selected');
  assert.equal(json.path, path.join(dir, 'result.md'));
  // 无复制改写：result.md 原样保留 assets/ 相对引用
  const finalMd = fs.readFileSync(path.join(dir, 'result.md'), 'utf8');
  assert.match(finalMd, /!\[IMG_1\]\(assets\/images\/IMG_1\.png\)/);
});

test('降级 sketch.md：⚠️ 初稿标注 + {{IMG_n}} 还原（只访问不点击 → timeout）', async () => {
  const { root, dir } = prepWorking();
  fs.rmSync(path.join(dir, 'result.md'));
  fs.writeFileSync(path.join(dir, 'sketch.md'), '# 初稿\n\n{{IMG_1}}\n\n{{COMPLEX_DIV_9}}\n\nSKETCH_BODY');
  let pageHtml = '', mdHtml = '';
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((t) => {
        pageHtml = t;
        return fetch(`${m[1]}/md`);
      }).then((res) => res.text()).then((t) => { mdHtml = t; }).catch(() => {});
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.match(pageHtml, /⚠️ 初稿/);
  assert.match(mdHtml, /<img[^>]+IMG_1\.png/);
  assert.match(mdHtml, /\{\{COMPLEX_DIV_9\}\}/);
});

test('点击窗口超时：timeout 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '1500', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (m) fetch(m[1]).catch(() => {});
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
});

test('打开失败：open-timeout 内无请求 → open_failed 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--open-timeout', '1200', '--timeout', '60000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000 });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'open_failed');
});

test('file 指向目录：404 而非 EISDIR 崩溃，服务器继续正常服务', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '3000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(`${m[1]}/file/assets`) // 目录路径 → 404
        .then((res) => {
          assert.equal(res.status, 404);
          return fetch(`${m[1]}/file/assets/images/IMG_1.png`);
        })
        .then((res) => { assert.equal(res.status, 200); })
        .catch(() => {});
    } });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.equal(r.stdout.split('\n').filter((l) => l.trim() !== '').length, 1);
});
