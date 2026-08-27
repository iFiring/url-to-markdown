#!/usr/bin/env node
/**
 * extract_article.mjs —— 步骤 6：文章视图提取。读 5_juice_styles.html 与
 * 3_key_ids.json，新建一份只含文章主体的 html，产出 6_article.html
 * （写入该 URL 的工作目录）。
 *
 * 用法:
 *   node extract_article.mjs --url <url>
 *
 * 提取规则（收齐后统一按文档序迁入）：
 *   - titleIds / descriptionIds / standaloneIds：元素本身（完整子树，属性与
 *     内容一字不动；standaloneIds 为不在任何流子树内的游离内容——流的
 *     兄弟或流的祖先的兄弟，同路径整体迁入）
 *   - listFlowIds：遍历各容器子节点，元素与非空白裸文本收齐
 *     ——裸文本没有 data-u2m-id 但可能是未包标签的正文，丢弃即内容损失；
 *     纯空白文本与注释不迁；flow 容器本身与祖先骨架不入新 html。
 *     流容器可嵌套（步骤 3 标记所有层级）：最外层优先去重——被另一
 *     收选节点包含的跳过，内容已随外层整块带入，结构保留不拆散
 *   - listFlowDeleteIds：列表流噪音（菜单/导航/广告/推荐），迁移完成后
 *     按 id 在新 body 里整棵剔除（不限深度）；与 key id 重叠或未命中报 error
 *   - 去重：同一元素被指名两次（如 description 同时是 flow 子元素）只出现一次
 *   - 排序：全部收选节点按文档序（compareDocumentPosition）统一迁入，
 *     key_ids 的列出顺序与流层级嵌套都不影响输出顺序
 *   - head：保留原文 <title>；<html lang> 照抄
 *   - 新 <body> 带阅读布局内联样式 max-width: 768px; margin: 4rem auto
 *     （限宽、水平居中）
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","article":"...","elementCount":N,"removedNoiseCount":M} → 0
 *   {"status":"error","reason":"..."}                 → 1
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
  if (!url) return usage('用法: extract_article.mjs --url <url>');

  const dir = urlDir(url);
  const juicedPath = path.join(dir, '5_juice_styles.html');
  const keyIdsPath = path.join(dir, '3_key_ids.json');

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
  // 噪音 id 与 key id 重叠是自相矛盾的输入（同一元素既是标题/说明/列表流
  // 又是噪音）——提前拦截，防止步骤 6 把 key 元素静默剔掉
  const keyIdSet = new Set([
    ...(keyIds.titleIds || []),
    ...(keyIds.descriptionIds || []),
    ...(keyIds.standaloneIds || []),
    ...keyIds.listFlowIds,
  ]);
  const deleteIds = Array.isArray(keyIds.listFlowDeleteIds) ? keyIds.listFlowDeleteIds : [];
  const overlap = deleteIds.filter((id) => keyIdSet.has(id));
  if (overlap.length > 0) {
    return emitError(
      `listFlowDeleteIds 与 key id 重叠: ${overlap.join(', ')}（同一元素不能既是关键元素又是噪音，请重跑步骤 3）`
    );
  }
  debug(`key_ids: title=${keyIds.titleIds?.length ?? 0} desc=${keyIds.descriptionIds?.length ?? 0} standalone=${keyIds.standaloneIds?.length ?? 0} flow=${keyIds.listFlowIds.length} delete=${deleteIds.length}`);

  const pageExtractFn = await readSharedScript('page-extract-article.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
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

    const articlePath = path.join(dir, '6_article.html');
    await fsPromises.writeFile(articlePath, result.html, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${result.count} 个元素, 剔除噪音 ${result.removedNoise} 个)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      article: articlePath,
      elementCount: result.count,
      removedNoiseCount: result.removedNoise,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
