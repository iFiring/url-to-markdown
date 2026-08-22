#!/usr/bin/env node
// extract_styled.mjs <url-dir>
// 步骤 4：样式视图裁剪。读 3_key_ids.json 与 2_clean_style_snapshot.html，
// 保留三类 key 元素（titleIds/descriptionIds/listFlowIds）的完整子树与到
// <body> 的祖先链（一字不动，含全部属性），删除其余 body 元素；
// <head>（title + <style>）不动，body 分支里的 <style> 挪入 head 后再删分支。
// 产物：steps/4_styled_extract.html
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
  if (!urlDirArg) return usage('用法: extract_styled.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const styledPath = path.join(stepsDir, '2_clean_style_snapshot.html');
  const keyIdsPath = path.join(stepsDir, '3_key_ids.json');

  if (!fs.existsSync(styledPath)) {
    return emitError(`找不到 ${styledPath}，请先运行步骤 2`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
  if (!Array.isArray(keyIds.listFlowIds) || keyIds.listFlowIds.length === 0) {
    return emitError('listFlowIds 为空（步骤 3 要求至少选一个列表流），请重跑步骤 3');
  }

  const pageExtractFn = await readSharedScript('page-extract-styled.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    await page.goto(`file://${styledPath}`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(
      `(${pageExtractFn})(${JSON.stringify(keyIds)})`
    );

    if (result.missing) {
      // 先关浏览器再 emit（emit 会退出进程）
      await context.close();
      await browser.close();
      return emitError(
        `key id 在带样式快照中未命中: ${result.missing.join(', ')}（key_ids 与快照不匹配，请重跑步骤 3）`,
        1
      );
    }

    const extractPath = path.join(stepsDir, '4_styled_extract.html');
    await fsPromises.writeFile(extractPath, result.html, 'utf8');
    log(`样式视图裁剪完成: ${extractPath} (删除 ${result.removed} 个元素)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      styledExtract: extractPath,
      removedCount: result.removed,
      keptCount: result.kept,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
