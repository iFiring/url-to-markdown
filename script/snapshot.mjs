#!/usr/bin/env node
// snapshot.mjs <url> [--timeout 300000] [--scroll-rounds 60]
// 步骤 1：合并登录、滚动、虚拟列表检测、快照下载。共享单个浏览器实例。
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath, ensureUrlDirs } from './lib/env.mjs';
import { proxyLaunchOptions, readStorageState, writeStorageState, mergeStorageState, EMPTY_STATE } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { snapshotLogin } from './lib/snapshot-login.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { snapshotDetect } from './lib/snapshot-detect.mjs';
import { snapshotCapture } from './lib/snapshot-capture.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: snapshot.mjs <url> [--timeout ms] [--scroll-rounds n]');

  const timeout = Number(args.timeout ?? 300000);
  const scrollRounds = Number(args['scroll-rounds'] ?? 60);
  if (!Number.isFinite(timeout)) { usage(`--timeout 须为数字，收到 ${args.timeout}`); return; }
  if (!Number.isFinite(scrollRounds)) { usage(`--scroll-rounds 须为数字，收到 ${args['scroll-rounds']}`); return; }

  const ssPath = storageStatePath();
  const dirs = ensureUrlDirs(url);

  // 加载 initScript
  const pageInit = await readSharedScript('page-init.js');

  // 启动浏览器（共享上下文）
  const browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
  const ctxOpts = { viewport: { width: 1280, height: 3000 }, bypassCSP: true };
  if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
  const context = await browser.newContext(ctxOpts);
  await context.route('**/*', (route) =>
    route.request().resourceType() === 'media' ? route.abort() : route.continue());
  await context.addInitScript({ content: pageInit });
  const page = await context.newPage();

  try {
    await snapshotLogin(page, url, { timeout, storageStatePath: ssPath, log });
    await snapshotScroll(page, { scrollRounds });
    await snapshotDetect(page);
    const result = await snapshotCapture(page, { stepsDir: dirs.steps, log });

    // 先关浏览器再 emit
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: result.snapshotPath,
      elements: result.elements,
    });
  } catch (e) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    emitError(e.reason || e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
