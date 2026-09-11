import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';

const script = path.resolve('script/snapshot.mjs');

test('snapshot.mjs: 无参数时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: 缺 --url 时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script, '--timeout', '1000']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --timeout 缺值时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script, '--url', 'https://example.com', '--timeout']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --scroll-rounds 非数字时报 usage_error', async () => {
  const r = await runScript(process.execPath, [script, '--url', 'https://example.com', '--scroll-rounds', 'abc']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --table-engine 非法值时报 usage_error', async () => {
  const r = await runScript(process.execPath, [script, '--url', 'https://example.com', '--table-engine', 'foo']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --from-snapshot 缺快照时报 error 并指路去掉 flag', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-snap-usage-'));
  try {
    const r = await runScript(process.execPath,
      [script, '--url', 'https://example.com/nope', '--from-snapshot'],
      { env: { U2M_WORKING_ROOT: tmpRoot } });
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'error');
    assert.ok(out.reason.includes('去掉 --from-snapshot'), `reason 应指路去掉 flag: ${out.reason}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
