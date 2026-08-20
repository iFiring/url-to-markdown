// test/helpers/run-script.mjs
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function runScript(cmd, args, { env = {}, timeoutMs = 60000, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
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
