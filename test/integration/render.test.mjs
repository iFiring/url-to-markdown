// test/integration/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

const script = path.resolve('script/render_markdown.mjs');

function prepWorking() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-render-'));
  const dir = path.join(root, 'example_com_page');
  for (const wf of ['node_workflow', 'python_workflow']) {
    fs.mkdirSync(path.join(dir, wf, 'assets/images'), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'node_workflow', 'result.md'),
    '# Node 版\n\n![IMG_1](assets/images/IMG_1.png)\n\nNODE_RESULT_BODY');
  fs.writeFileSync(path.join(dir, 'python_workflow', 'result.md'), '# Python 版\n\nPYTHON_RESULT_BODY');
  fs.copyFileSync('test/fixtures/pixel.png', path.join(dir, 'node_workflow', 'assets/images/IMG_1.png'));
  return { root, dir };
}

test('选择 node_workflow：复制 result.md + stdout selected + 退出 0', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((html) => {
        assert.match(html, /Node 版/); assert.match(html, /Python 版/);
        return fetch(`${m[1]}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'node_workflow' }) });
      }).catch(() => {});
    } });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'selected');
  assert.equal(json.source, 'node_workflow');
  assert.ok(fs.existsSync(path.join(dir, 'result.md')));
  assert.match(fs.readFileSync(path.join(dir, 'result.md'), 'utf8'), /NODE_RESULT_BODY/);
});

test('降级 sketch.md：⚠️ 初稿标注 + {{IMG_n}} 还原（未点击 → 最终 timeout 属预期）', async () => {
  const { root, dir } = prepWorking();
  fs.rmSync(path.join(dir, 'node_workflow', 'result.md'));
  fs.rmSync(path.join(dir, 'python_workflow', 'result.md'));
  for (const wf of ['node_workflow', 'python_workflow']) {
    fs.writeFileSync(path.join(dir, wf, 'sketch.md'), `# 初稿 ${wf}\n\n{{IMG_1}}\n\n{{COMPLEX_DIV_9}}\n\nSKETCH_${wf}`);
  }
  let pageHtml = '', mdHtml = '';
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((t) => {
        pageHtml = t;
        return fetch(`${m[1]}/md/node_workflow`);
      }).then((res) => res.text()).then((t) => { mdHtml = t; }).catch(() => {});
    } });
  assert.equal(r.code, 1); // 只访问不点击 → 点击窗口超时
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.match(pageHtml, /⚠️ 初稿/);
  assert.match(mdHtml, /<img[^>]+IMG_1\.png/);   // 占位符已还原为本地图片
  assert.match(mdHtml, /\{\{COMPLEX_DIV_9\}\}/); // 未处置占位保留为标记
});

test('点击窗口超时：timeout 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '1500', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (m) fetch(m[1]).catch(() => {}); // 只访问不点击 → 点击窗口超时
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
