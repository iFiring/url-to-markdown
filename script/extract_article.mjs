#!/usr/bin/env node
/**
 * extract_article.mjs —— 步骤 6：文章视图提取。读 5_juice_styles.html 与
 * 3_key_ids.json，新建一份只含文章主体的 html，产出 <url-dir>/6_article.html。
 *
 * 用法:
 *   node extract_article.mjs <url-dir>
 *
 * 提取规则（按分组顺序：标题 → 说明 → 正文块）：
 *   - titleIds / descriptionIds：元素本身（完整子树，属性与内容一字不动）
 *   - listFlowIds：遍历各容器子节点，元素与非空白裸文本按文档序交错迁入
 *     ——裸文本没有 data-u2m-id 但可能是未包标签的正文，丢弃即内容损失；
 *     纯空白文本与注释不迁；flow 容器本身与祖先骨架不入新 html
 *   - 去重：同一元素被指名两次（如 description 同时是 flow 子元素）只出现一次
 *   - head：保留原文 <title>；<html lang> 照抄
 *   - 新 <body> 带阅读布局内联样式 max-width: 768px; margin: 4rem auto
 *     （限宽、水平居中）
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","article":"...","elementCount":N}  → 退出码 0
 *   {"status":"error","reason":"..."}                 → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
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
  if (!urlDirArg) return usage('用法: extract_article.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const juicedPath = path.join(urlDir, '5_juice_styles.html');
  const keyIdsPath = path.join(urlDir, '3_key_ids.json');

  if (!fs.existsSync(juicedPath)) {
    return emitError(`找不到 ${juicedPath}，请先运行步骤 5`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
  if (!Array.isArray(keyIds.listFlowIds) || keyIds.listFlowIds.length === 0) {
    return emitError('listFlowIds 为空（步骤 3 要求至少选一个列表流），请重跑步骤 3');
  }
  debug(`key_ids: title=${keyIds.titleIds?.length ?? 0} desc=${keyIds.descriptionIds?.length ?? 0} flow=${keyIds.listFlowIds.length}`);

  const pageExtractFn = await readSharedScript('page-extract-article.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    await page.goto(`file://${juicedPath}`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(
      `(${pageExtractFn})(${JSON.stringify(keyIds)})`
    );

    if (result.missing) {
      // 先关浏览器再 emit（emit 会退出进程）
      await context.close();
      await browser.close();
      return emitError(
        `key id 在纯内联视图中未命中: ${result.missing.join(', ')}（key_ids 与视图不匹配，请重跑步骤 3）`,
        1
      );
    }

    const articlePath = path.join(urlDir, '6_article.html');
    await fsPromises.writeFile(articlePath, result.html, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${result.count} 个元素)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      article: articlePath,
      elementCount: result.count,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
