// test/integration/init.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';

const URL = 'https://example.com/a?b=1';
// 与 lib/env.mjs urlToDirName 一致：剥 http(s):// 前缀，非 [A-Za-z0-9.-] → _
const URL_NAME = 'example.com_a_b_1';
let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-init-'));
});

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('init.sh: --url 输出 ok JSON（核心参数 + 环境信息）并创建工作目录', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 280000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'stdout 恰一行');
  const json = JSON.parse(lines[0]);
  assert.equal(json.status, 'ok');
  // 核心参数
  assert.equal(json['skill-root'], path.resolve('.'));
  assert.equal(json['url-name'], URL_NAME, 'url-name 须与步骤 1 的目录派生逻辑一致');
  assert.equal(json['url-working-path'], path.join(tmpRoot, URL_NAME));
  assert.ok(fs.existsSync(json['url-working-path']), '步骤 0 应创建工作目录');
  // 环境信息
  assert.ok(json.node);
  assert.ok(['pnpm', 'yarn', 'npm'].includes(json.pm));
  assert.equal(json.chromium, true);
});

test('init.sh: 幂等——二次运行依旧 ok', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 280000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const json = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
  assert.equal(json.status, 'ok');
});

test('init.sh: 缺 --url 时输出 usage_error 退出 2', async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
