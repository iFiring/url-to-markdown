#!/usr/bin/env node
// capture_snapshot.mjs <url> [--token-budget 80000] [--placeholder-min-chars 40]
// 抓全保真快照 + 派生精简版（供 LLM 分类）。emit ok / too_large / error。
import path from 'node:path';
import fs from 'node:fs/promises';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath, workingRoot, urlToDirName } from './lib/env.mjs';
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

/** 渐进滚动到底再回顶（懒加载）。参数必须与 page-detect.js 的 scrollIters/scrollWait 一致（scroll-params 单测守护）。 */
async function progressiveScroll(page) {
  await page.evaluate(async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  });
}

/** DOM 稳定：节点数连续 stableMs 不变。沿用原 clear_trans_html 的值。 */
async function waitForDomStable(page, { stableMs = 1000, maxMs = 15000 } = {}) {
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= stableMs) return;
    await page.waitForTimeout(200);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return; // usage_error 已 emit
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: capture_snapshot.mjs <url> [--token-budget n] [--placeholder-min-chars n]');
  const tokenBudget = Number(args['token-budget'] ?? 80000);
  const placeholderMinChars = Number(args['placeholder-min-chars'] ?? 40);

  const pageInit = await readSharedScript('page-init.js');
  const pagePrepare = await readSharedScript('page-prepare.js');
  const pageDerive = await readSharedScript('page-derive.js');

  const urlDir = path.join(workingRoot(), urlToDirName(url));
  const classifyDir = path.join(urlDir, 'classify');

  let s;
  let result;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    await progressiveScroll(s.page);
    await waitForDomStable(s.page);

    await s.page.evaluate(`(${pagePrepare})()`);
    // 关键顺序：先取全保真 snapshot，再跑 derive（derive 会占位/剥 style，变异只影响其序列化结果）
    const snapshot = await s.page.evaluate(() => document.documentElement.outerHTML);
    const classifyInput = await s.page.evaluate(`(${pageDerive})(${JSON.stringify({ placeholderMinChars })})`);

    const idCount = (snapshot.match(/data-u2m-id="\d+"/g) || []).length;
    const tokenEstimate = Math.round(classifyInput.length / 4);
    const warnings = [];
    const keptLinks = (snapshot.match(/<link[^>]*rel=["']stylesheet["']/g) || []).length;
    if (keptLinks) warnings.push(`${keptLinks} 个外部 CSS 抓取失败（跨源无 CORS 等），保留 <link> 兜底`);

    await fs.mkdir(classifyDir, { recursive: true });
    await fs.writeFile(path.join(urlDir, 'snapshot.html'), snapshot, 'utf8');
    if (tokenEstimate > tokenBudget) {
      result = { status: 'too_large', tokenEstimate, elements: idCount, reason: `classify_input token 估算 ${tokenEstimate} 超预算 ${tokenBudget}；可用 --placeholder-min-chars 调大占位阈值后重跑` };
    } else {
      await fs.writeFile(path.join(classifyDir, 'classify_input.html'), classifyInput, 'utf8');
      result = { status: 'ok', snapshot: path.join(urlDir, 'snapshot.html'), classifyInput: path.join(classifyDir, 'classify_input.html'), elements: idCount, tokenEstimate, warnings };
    }
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {}); // 先关浏览器再 emit（emit 内 process.exit）
  emit(result, 0);
}

main().catch((e) => emitError(e.message, 1));
