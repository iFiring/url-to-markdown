import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import path from 'node:path';

const script = path.resolve('script/snapshot.mjs');

test('snapshot.mjs: 无参数时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --timeout 缺值时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script, 'https://example.com', '--timeout']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --scroll-rounds 非数字时报 usage_error', async () => {
  const r = await runScript(process.execPath, [script, 'https://example.com', '--scroll-rounds', 'abc']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});
