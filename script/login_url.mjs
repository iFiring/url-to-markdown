#!/usr/bin/env node
// login_url.mjs <url> [--timeout 300000] [--port 0] [--no-open]
// 打开 URL 检测登录态；已登录→logged_in；未登录→Screencast viewer 人工登录→login_done；超时/中断→timeout/aborted。
import { execFile } from 'node:child_process';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath } from './lib/env.mjs';
import { openPage, readStorageState, writeStorageState, mergeStorageState } from './lib/browser.mjs';
import { needsLogin } from './lib/detector.mjs';
import { startScreencastViewer } from './lib/screencast.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-open') { out[key] = true; continue; } // 布尔标志无值
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) usage(`参数 --${key} 缺少值`);
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function saveMerged(page, filePath) {
  const base = await readStorageState(filePath);
  const fresh = await page.context().storageState();
  await writeStorageState(filePath, mergeStorageState(base, fresh));
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args._[0];
  if (!url) usage('用法: login_url.mjs <url> [--timeout ms] [--port n] [--no-open]');
  const timeoutMs = Number(args.timeout ?? 300000);
  const port = Number(args.port ?? 0);
  const ssPath = storageStatePath();

  const s = await openPage(url, { headless: true, viewport: { width: 1280, height: 800 }, storageStatePath: ssPath, log });
  const check = (spaWaitMs = 5000) => needsLogin(s.page, s.context, url, { spaWaitMs });

  let settled = false;
  let viewer = null;
  // 先关浏览器/viewer 再 emit：emit 内部 process.exit，顺序反了会留孤儿 chromium
  const finish = async (result, code) => {
    if (settled) return;
    settled = true;
    try { await viewer?.close(); } catch { /* 忽略 */ }
    try { await s.close(); } catch { /* 忽略 */ }
    emit(result, code);
  };

  try {
    const first = await check();
    if (!first.needsLogin) {
      await saveMerged(s.page, ssPath);
      log('检测为已登录，storageState 已刷新');
      return await finish({ status: 'logged_in' }, 0);
    }
    log('判定需要登录，进入 Screencast 登录模式');
    viewer = await startScreencastViewer({
      page: s.page, port,
      onLoginDone: async (ws) => {
        try {
          const r = await check(500); // 复检用短 SPA 等待
          if (!r.needsLogin) {
            await saveMerged(s.page, ssPath);
            finish({ status: 'login_done' }, 0);
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        try {
          const r = await check(500);
          if (!r.needsLogin) { await saveMerged(s.page, ssPath); finish({ status: 'login_done' }, 0); }
          else finish({ status: 'aborted' }, 1);
        } catch { finish({ status: 'aborted' }, 1); }
      },
      log,
    });
    log(`[login_url] viewer: ${viewer.url}`);
    const t = setTimeout(() => finish({ status: 'timeout' }, 1), timeoutMs);
    t.unref?.();
    if (!args['no-open']) {
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', viewer.url] : [viewer.url];
      execFile(cmd, cmdArgs, () => {}); // 打不开不致命：URL 已打印 stderr
    }
  } catch (e) {
    finish({ status: 'error', reason: e.message }, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
