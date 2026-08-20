#!/usr/bin/env node
// chunker.mjs <url-dir>
// 步骤 4：分块。读 3_key_ids.json + 1_snapshot.html，按 Phrasing/Flow/MultiLayer 分块。
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { workingRoot } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions } from './lib/browser.mjs';

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

function resolveUrlDir(arg) {
  if (!arg) return null;
  if (path.isAbsolute(arg)) return arg;
  return path.join(workingRoot(), arg);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: chunker.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');
  const keyIdsPath = path.join(stepsDir, '3_key_ids.json');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
  const pageChunkFn = await readSharedScript('page-chunker.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });

    // 执行分块
    const result = await page.evaluate(
      `(${pageChunkFn})(${JSON.stringify({ keyIds })})`
    );

    // 写盘
    const chunkListPath = path.join(stepsDir, '4_chunk_list.json');
    await fsPromises.writeFile(chunkListPath, JSON.stringify(result, null, 2), 'utf8');

    const llmCount = result.chunks.filter((c) => c.needsLLM).length;
    log(`分块完成: ${result.chunks.length} 块, ${llmCount} 块需要 LLM 转化`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      chunkList: chunkListPath,
      totalChunks: result.chunks.length,
      llmChunks: llmCount,
      chunks: result.chunks,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
