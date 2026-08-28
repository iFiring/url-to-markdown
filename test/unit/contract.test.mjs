// test/unit/contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const mod = pathToFileURL(path.resolve('script/lib/contract.mjs')).href;
const node = (expr) => runScript(process.execPath, ['-e', `import('${mod}').then(m => { ${expr} })`]);

test('emit: stdout 恰一行 JSON 并按码退出', async () => {
  const r = await node("m.emit({status:'ok'}, 0)");
  assert.equal(r.code, 0);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['{"status":"ok"}']);
});

test('emitError: 失败也输出 JSON，退出码 1', async () => {
  const r = await node("m.emitError('页面加载失败')");
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'error');
  assert.equal(JSON.parse(r.stdout).reason, '页面加载失败');
});

test('usage: 参数错误输出 usage_error，退出码 2', async () => {
  const r = await node("m.usage('缺少 <url>')");
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

test('log: 走 stderr 不污染 stdout', async () => {
  const r = await node("m.log('进度信息'); m.emit({status:'ok'}, 0)");
  assert.equal(r.stdout, '{"status":"ok"}\n');
  assert.ok(r.stderr.includes('进度信息'));
});

test('debug: 默认静默，U2M_DEBUG 时输出到 stderr 且带耗时前缀', async () => {
  // 默认（未设 U2M_DEBUG）：无输出。用空串覆盖而非 delete——runScript 内部
  // 是 { ...process.env, ...env } 合并，只能覆值不能删键；用户终端调试时
  // 导出的 U2M_DEBUG=1 会渗进子进程，而 contract.mjs 按真值判定，空串即静默
  const off = await runScript(process.execPath,
    ['-e', `import('${mod}').then(m => { m.debug('调试信息'); m.emit({status:'ok'}, 0) })`],
    { env: { U2M_DEBUG: '' } });
  assert.equal(off.stdout, '{"status":"ok"}\n');
  assert.equal(off.stderr, '', '未设 U2M_DEBUG 时 debug 应静默');

  // U2M_DEBUG=1：输出到 stderr，带 [dbg +N.NNs] 耗时前缀
  const on = await runScript(process.execPath,
    ['-e', `import('${mod}').then(m => { m.debug('调试信息'); m.emit({status:'ok'}, 0) })`],
    { env: { U2M_DEBUG: '1' } });
  assert.equal(on.stdout, '{"status":"ok"}\n');
  assert.match(on.stderr, /\[dbg \+\d+\.\d+s\] 调试信息\n/);
});
