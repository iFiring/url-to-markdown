#!/usr/bin/env node
/**
 * extract_article.mjs —— 步骤 6：文章视图提取。读 5_juice_styles.html 与
 * 3_key_ids.json（四键契约 titleId/descriptionIds/paragraphIds/dumpIds，
 * 校验与 paragraphIds 嵌套展开共享 lib/key-ids.mjs），新建一份只含文章
 * 主体的 html，产出 6_article.html（写入该 URL 的工作目录）。
 *
 * 用法:
 *   node extract_article.mjs --url <url>
 *
 * 提取规则（块模型——全部按元素本身迁移，收齐后统一按文档序迁入）：
 *   - titleId / descriptionIds / paragraphIds 块：元素本身（完整子树，
 *     属性与内容一字不动）；paragraphIds 嵌套（数组 = 子段落流）展开为
 *     扁平块清单，流容器/非流包装层/到 body 的祖先骨架不在任何键、
 *     自然不入。裸文本无 data-idx 不可标记、不迁——带裸文本的容器
 *     由步骤 3 整体标块兜底（子树完整迁入）
 *   - dumpIds：步骤 6 不消费——步骤 4 已把流内噪音折叠为空壳，壳不在
 *     任何键、自然不入文章（无迁移后剔除 pass；仅参与四键互斥校验）
 *   - 去重：同一元素被指名两次只出现一次；title/description 落在段落
 *     块子树内合法（四键只约束 ID 不相交）——最外层优先嵌套去重，
 *     被包含者跳过、内容随外层整块带入
 *   - 排序：全部收选节点按文档序（compareDocumentPosition）统一迁入，
 *     paragraphIds 的列出顺序与嵌套层级不影响输出顺序
 *   - 瘦身 pass：迁移完成后，同页 setContent 内存往返执行
 *     lib/page-slim-article.js 的六条结构规则（见其头注）；保护集 =
 *     迁入的 key 元素全集（titleId∪descriptionIds∪块——启发式只清理
 *     块内部的未标记残留，不重塑被标记的内容单元），emit 增 slim
 *     计数对象（加法式契约）
 *   - head：保留原文 <title>；<html lang> 照抄
 *   - 新 <body> 带阅读布局内联样式 max-width: 768px; margin: 4rem auto
 *     （限宽、水平居中）
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","article":"...","elementCount":N,"slim":{...}} → 0
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
import { parseKeyIds } from './lib/key-ids.mjs';
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

  // 四键校验与 paragraphIds 嵌套展开共享 lib/key-ids.mjs（与步骤 4
  // 同一校验事实源），开浏览器前拦截形状与自相矛盾输入
  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
  const parsed = parseKeyIds(keyIds);
  if (parsed.error) return emitError(parsed.error);
  const { titleId, descriptionIds, blockIds } = parsed;
  debug(`key_ids: title=${titleId ?? '无'} desc=${descriptionIds.length} blocks=${blockIds.length}`);

  const pageExtractFn = await readSharedScript('page-extract-article.js');
  const pageSlimFn = await readSharedScript('page-slim-article.js');
  const latexFn = await readSharedScript('page-latex.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    const page = await context.newPage();

    await page.goto(`file://${juicedPath}`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(
      `(${pageExtractFn})(${JSON.stringify({ titleId, descriptionIds, blockIds })})`
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

    // 瘦身 pass：迁移后的文章视图在内存中重载（同页 setContent，不落盘），
    // 六条结构规则见 page-slim-article.js 头注。保护集 = 迁入的 key
    // 元素全集（titleId∪descriptionIds∪块）
    await page.setContent(result.html, { waitUntil: 'domcontentloaded' });
    const protectedIds = [];
    if (titleId !== null) protectedIds.push(titleId);
    protectedIds.push(...descriptionIds, ...blockIds);
    // page-latex.js 的 __u2mLatexText 以函数声明进入同一作用域，
    // page-slim-article.js 规则② 闭包内可见
    const { html: slimHtml, ...slimStats } = await page.evaluate(
      `(function(){ ${latexFn} return (${pageSlimFn})(${JSON.stringify(protectedIds)}); })()`
    );

    const articlePath = path.join(dir, '6_article.html');
    await fsPromises.writeFile(articlePath, slimHtml, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${result.count} 个元素, 瘦身 ${JSON.stringify(slimStats)})`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      article: articlePath,
      elementCount: result.count,
      slim: slimStats,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
