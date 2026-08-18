// test/integration/init.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import path from 'node:path';

test('init.sh: 环境就绪时输出 ok JSON 退出 0', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')], { timeoutMs: 280000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'stdout 恰一行');
  const json = JSON.parse(lines[0]);
  assert.equal(json.status, 'ok');
  assert.ok(json.node);
  assert.ok(json.python);
  assert.ok(['pnpm', 'yarn', 'npm'].includes(json.pm));
  assert.equal(json.chromium, true);
});

test('init.sh: 幂等——二次运行依旧 ok', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')], { timeoutMs: 280000 });
  assert.equal(r.code, 0);
});
