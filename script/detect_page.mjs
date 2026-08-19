#!/usr/bin/env node
// detect_page.mjs <url> [--timeout 120000] —— 检测虚拟列表；scrollable / virtual_list / error。
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath } from './lib/env.mjs';
import { openPage } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      // emit 延迟 process.exit：返回 null 让 main 立即停，防止继续执行打出第二行 JSON
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return; // usage_error 已 emit，契约要求后续不再执行
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: detect_page.mjs <url> [--timeout ms]');

  const pageInit = await readSharedScript('page-init.js');
  let s;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    // Task 2 将在此注入 page-detect.js 检测；本骨架恒判 scrollable
    await s.close().catch(() => {});
    emit({ status: 'scrollable', page_type: 'scrollable' }, 0);
  } catch (e) {
    await s?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
