// test/helpers/run-script.mjs
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function runScript(cmd, args, { env = {}, timeoutMs = 60000, onStderr } = {}) {
  return new Promise((resolve) => {
    // 测试子进程永不打开桌面浏览器（全局不变量）：CLI 弹 viewer 时会自动 `open`
    // 默认浏览器——生产功能，但测试里任何意外弹 viewer 的路径都会在开发者桌面
    // 开一堆死标签页（曾由重定向回归实际触发）。显式传 '1' 以外的值可覆盖
    const child = spawn(cmd, args, {
      env: { ...process.env, U2M_VIEWER_NOOPEN: '1', ...env },
    });
    // 累积原始字节、结束时整体解码：多字节 UTF-8 字符可能横跨两个 data 事件，
    // 逐段 string 拼接会把跨界字符解码成 U+FFFD
    const stdoutParts = [];
    const stderrParts = [];
    const stderrDecoder = new StringDecoder('utf8');
    let stderrBuf = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdoutParts.push(d); });
    child.stderr.on('data', (d) => {
      stderrParts.push(d);
      if (!onStderr) return;
      stderrBuf += stderrDecoder.write(d);
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      for (const line of lines) onStderr(line);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      stderrBuf += stderrDecoder.end();
      if (onStderr && stderrBuf) onStderr(stderrBuf);
      resolve({
        code,
        stdout: Buffer.concat(stdoutParts).toString('utf8'),
        stderr: Buffer.concat(stderrParts).toString('utf8'),
      });
    });
  });
}
