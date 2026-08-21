#!/usr/bin/env node
// clean_snapshot.mjs <url-dir>
// 步骤 2：结构清洗。打开 1_snapshot.html，长文本占位，产出两份快照：
// 清洗版（剥样式/清空 SVG）与带样式版（保留 style/<style>/完整 SVG）。
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
  if (path.isAbsolute(arg)) return arg;  // 绝对路径直接使用（测试隔离用）
  return path.join(workingRoot(), arg);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: clean_snapshot.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    // 打开快照文件
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });

    // 执行清洗
    const result = await page.evaluate(`(${pageCleanFn})()`);

    // 写盘
    const cleanedPath = path.join(stepsDir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, result.html, 'utf8');
    // 带样式版：保留 style 属性/<style>/完整 SVG，占位符与清洗版逐一对应
    const styledPath = path.join(stepsDir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, result.styledHtml, 'utf8');
    // 长文本恢复清单：占位编号 → 原文
    const longTextPath = path.join(stepsDir, '2_long_text.json');
    await fsPromises.writeFile(longTextPath, JSON.stringify(result.longTexts), 'utf8');
    log(`清洗完成: ${cleanedPath} (${result.longTextCount} 个长文本占位符)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      cleanedSnapshot: cleanedPath,
      styledSnapshot: styledPath,
      longText: longTextPath,
      longTextCount: result.longTextCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
