#!/usr/bin/env node
/**
 * extract_styled.mjs —— 步骤 4：样式视图裁剪。读 3_key_ids.json（四键契约
 * titleId/descriptionIds/paragraphIds/dumpIds）与 2_clean_style_snapshot.html，
 * 裁剪出只含文章主体的带样式视图，产出 4_styled_extract.html
 * （写入该 URL 的工作目录）。
 *
 * 用法:
 *   node extract_styled.mjs --url <url>
 *
 * 裁剪规则：
 *   - 完整保留（一字不动，含全部标签属性与样式属性）：titleId/
 *     descriptionIds/paragraphIds 所指标量块的子树 + 它们到 <body> 的
 *     祖先链——祖先上下文不变，CSS 选择器照常生效；paragraphIds 嵌套
 *     （数组 = 子段落流）在读取时展开为扁平块清单传给页面函数
 *   - dumpIds：段落流内噪音折叠为空元素——清空全部子节点，属性仅留
 *     id/class/data-idx；壳占住流内位置（步骤 5 juice 求值 nth-child/
 *     相邻选择器时兄弟结构不失真），步骤 6 迁移块时壳不在清单、自然
 *     不入文章。落在保留区外的 dump 随所属分支删除
 *   - <head> 完全不动（<title> + 全部 <style> 原地保留）；body 里即将删除
 *     或折叠的分支中若有 <style>，先挪入 <head> 再处理，样式标签零丢失
 *   - 删除：其余全部 body 元素（页面 chrome、流外噪音）
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","styledExtract":"...","removedCount":N,"keptCount":M,"dumpCollapsedCount":D} → 0
 *   {"status":"error","reason":"..."}   key_ids 缺失 / 快照缺失 / id 未命中 /
 *                                       四键重叠 / dump 是 key 祖先 → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { urlDir } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';

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
  const url = args.url;
  if (!url) return usage('用法: extract_styled.mjs --url <url>');

  const dir = urlDir(url);
  const styledPath = path.join(dir, '2_clean_style_snapshot.html');
  const keyIdsPath = path.join(dir, '3_key_ids.json');

  if (!fs.existsSync(styledPath)) {
    return emitError(`找不到 ${styledPath}，请先运行步骤 2`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));

  // 四键契约校验（开浏览器前拦截形状与自相矛盾输入）：
  // paragraphIds 嵌套展开为扁平块清单（数组 = 子段落流）
  const titleId = keyIds.titleId === undefined ? null : keyIds.titleId;
  const descriptionIds = Array.isArray(keyIds.descriptionIds) ? keyIds.descriptionIds : [];
  const dumpIds = Array.isArray(keyIds.dumpIds) ? keyIds.dumpIds : [];
  if (titleId !== null && !(Number.isInteger(titleId) && titleId > 0)) {
    return emitError('titleId 应为正整数或 null，请重跑步骤 3');
  }
  if (!Array.isArray(keyIds.paragraphIds) || keyIds.paragraphIds.length === 0) {
    return emitError('paragraphIds 为空（步骤 3 要求至少标一个段落块），请重跑步骤 3');
  }
  const blockIds = [];
  const invalidMembers = [];
  (function walk(node) {
    for (const item of node) {
      if (Array.isArray(item)) walk(item);
      else if (Number.isInteger(item) && item > 0) blockIds.push(item);
      else invalidMembers.push(item);
    }
  })(keyIds.paragraphIds);
  if (invalidMembers.length > 0) {
    return emitError(`paragraphIds 含非法成员: ${invalidMembers.map((m) => JSON.stringify(m)).join(', ')}（段落块 ID 应为正整数，数组为子段落流），请重跑步骤 3`);
  }

  // 四键互不相交——同一元素进两个键（或段落块重复列举）是自相矛盾的输入
  const seen = new Map();
  const dup = [];
  const collect = (id, label) => {
    if (seen.has(id)) dup.push(`id ${id} 同时在 ${seen.get(id)} 与 ${label}`);
    else seen.set(id, label);
  };
  if (titleId !== null) collect(titleId, 'titleId');
  for (const id of descriptionIds) collect(id, 'descriptionIds');
  for (const id of blockIds) collect(id, 'paragraphIds');
  for (const id of dumpIds) collect(id, 'dumpIds');
  if (dup.length > 0) {
    return emitError(`四键标记重叠: ${dup.join('; ')}（同一元素不得进两个键），请重跑步骤 3`);
  }
  debug(`key_ids: title=${titleId ?? '无'} desc=${descriptionIds.length} blocks=${blockIds.length} dump=${dumpIds.length}`);

  const pageExtractFn = await readSharedScript('page-extract-styled.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    const page = await context.newPage();

    await page.goto(`file://${styledPath}`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(
      `(${pageExtractFn})(${JSON.stringify({ titleId, descriptionIds, blockIds, dumpIds })})`
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
    if (result.conflict) {
      await context.close();
      await browser.close();
      return emitError(
        `dumpIds 与 key 元素冲突: dump ${result.conflict.dump} 是 key ${result.conflict.key} 的祖先（折叠会摧毁 key 子树），请重跑步骤 3`,
        1
      );
    }

    const extractPath = path.join(dir, '4_styled_extract.html');
    await fsPromises.writeFile(extractPath, result.html, 'utf8');
    log(`样式视图裁剪完成: ${extractPath} (删除 ${result.removed} 个元素, 折叠噪音 ${result.dumpCollapsed} 个)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      styledExtract: extractPath,
      removedCount: result.removed,
      keptCount: result.kept,
      dumpCollapsedCount: result.dumpCollapsed,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
