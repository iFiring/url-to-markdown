#!/usr/bin/env node
/**
 * extract_styled.mjs —— 步骤 4：样式视图裁剪。读 3_key_ids.json 与
 * 2_clean_style_snapshot.html，裁剪出只含文章主体的带样式视图，
 * 产出 <url-dir>/4_styled_extract.html。
 *
 * 用法:
 *   node extract_styled.mjs <url-dir>
 *
 * 裁剪规则：
 *   - 完整保留（一字不动，含全部标签属性与样式属性）：三类 key 元素
 *     （titleIds/descriptionIds/listFlowIds）的子树 + 它们到 <body> 的
 *     祖先链——祖先上下文不变，CSS 选择器照常生效
 *   - <head> 完全不动（<title> + 全部 <style> 原地保留）；body 里即将删除
 *     的分支中若有 <style>，先挪入 <head> 再删分支，样式标签零丢失
 *   - 删除：其余全部 body 元素（封面区块、推荐、营销等步骤 3 排除的内容）
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","styledExtract":"...","removedCount":N,"keptCount":M} → 0
 *   {"status":"error","reason":"..."}   key_ids 缺失 / 快照缺失 / id 未命中 → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
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
  const styledPath = path.join(urlDir, '2_clean_style_snapshot.html');
  const keyIdsPath = path.join(urlDir, '3_key_ids.json');

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

    const extractPath = path.join(urlDir, '4_styled_extract.html');
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
