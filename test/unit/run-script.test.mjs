import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';

test('runScript: 跨 chunk 的多字节 UTF-8 字符不损坏', async () => {
  // '测' = 3 字节（E6 B5 8B）。先写 4 字节（完整 1 字符 + 第 2 字符的首字节），
  // 延迟后再写剩余字节——强制字符横跨两个 data 事件。
  // 按 chunk 逐段解码的实现会产出 U+FFFD 替换字符；整段解码则无损。
  const r = await runScript(process.execPath, ['-e', `
    const b = Buffer.from('测测测', 'utf8');
    process.stdout.write(b.subarray(0, 4));
    setTimeout(() => process.stdout.write(b.subarray(4)), 50);
  `]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '测测测');
});

test('runScript: stderr 跨 chunk 的多字节 UTF-8 字符不损坏', async () => {
  const r = await runScript(process.execPath, ['-e', `
    const b = Buffer.from('分块完成', 'utf8');
    process.stderr.write(b.subarray(0, 4));
    setTimeout(() => process.stderr.write(b.subarray(4)), 50);
  `]);
  assert.equal(r.stderr, '分块完成');
});

test('runScript: onStderr 按行回调在跨 chunk 时不截断多字节字符', async () => {
  const lines = [];
  // 一行中文日志被拆成两段发送，onStderr 应收到完整的一行
  await runScript(process.execPath, ['-e', `
    const b = Buffer.from('日志：分块完成\\n', 'utf8');
    process.stderr.write(b.subarray(0, 8));
    setTimeout(() => process.stderr.write(b.subarray(8)), 50);
  `], { onStderr: (l) => lines.push(l) });
  assert.deepEqual(lines, ['日志：分块完成']);
});
