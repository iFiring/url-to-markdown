// test/helpers/run-script.mjs
import { spawn } from 'node:child_process';

export function runScript(cmd, args, { env = {}, timeoutMs = 60000, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = '', stderr = '', stderrBuf = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (!onStderr) return;
      stderrBuf += d;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      for (const line of lines) onStderr(line);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onStderr && stderrBuf) onStderr(stderrBuf);
      resolve({ code, stdout, stderr });
    });
  });
}
