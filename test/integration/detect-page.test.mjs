// test/integration/detect-page.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx; let root;
before(async () => {
  fx = await startFixtureServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-detect-'));
});
after(async () => { await fx.close(); });

const run = (page) => runScript(process.execPath, [path.resolve('script/detect_page.mjs'), `${fx.url}/${page}`],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 60000 });

test('virtual-list: 命中即 virtual_list、退出 0、不写 working 目录', async () => {
  const r = await run('virtual-list.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'virtual_list');
  assert.equal(json.page_type, 'virtual_list');
  // 检测门不产文件：working/<url-dir> 不应被创建
  const dir = path.join(root, urlToDirName(`${fx.url}/virtual-list.html`));
  assert.ok(!fs.existsSync(dir), `不应创建 working 目录: ${dir}`);
});

test('long-column: 长静态页判 scrollable', async () => {
  const r = await run('long-column.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('lazy-load: 懒加载页判 scrollable（顶部内容仍在 DOM）', async () => {
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('static-article: 短静态页判 scrollable', async () => {
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/detect_page.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
