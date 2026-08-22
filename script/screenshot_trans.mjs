#!/usr/bin/env node
/**
 * screenshot_trans.mjs —— 步骤 8：占位符还原 + trans2img 截图。
 * 读 7_skeleton.json + 6_article.html + 2_long_text.json，产出：
 *   8_resolved_skeleton.json  结构同步骤 7，所有 {{LONG_TEXT_k[|suffix]}}
 *                             替换为真实文本（trans2img 条目保留）
 *   assets/trans/{id}.webp    每个 trans2img 元素一张截图（WebP，2x 分辨率）
 *
 * 用法:
 *   node screenshot_trans.mjs <url-dir>
 *
 * 两轮处理：
 *   1. 纯 Node（playwright 之前）：读骨架 + 2_long_text.json 做占位符替换，
 *      写出 8_resolved_skeleton.json（条目数、顺序、key 与步骤 7 完全一致，
 *      value 全部为真实文本）。任一 value 引用了未定义编号 → 直接 error。
 *      骨架无 trans2img 条目时到此为止（skipped: "no_trans2img"，
 *      resolved skeleton 已写出）
 *   2. playwright：加载 6_article.html（body 已设 max-width: 768px，即真实
 *      渲染宽度）→ 注入 lib/page-resolve-placeholders.js 遍历全文档文本
 *      节点，把 {{LONG_TEXT_k|...}} 替换为原文（与 resolved skeleton 的
 *      还原结果一致）→ 对每个 trans2img id 定位元素并
 *      el.screenshot({type: 'webp'}) 写入 assets/trans/{id}.webp
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","count":N,"screenshots":[...],"replaced":M,
 *    "resolvedSkeleton":"..."}                          → 退出码 0
 *   {"status":"ok","skipped":"no_trans2img",
 *    "resolvedSkeleton":"..."}        无 trans2img 条目 → 退出码 0
 *   {"status":"error","reason":"..."} 前置缺失 / id 未命中 / 未定义编号 → 1
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
  if (path.isAbsolute(arg)) return arg;
  return path.join(workingRoot(), arg);
}

// 把骨架条目里 value 字符串中的 {{LONG_TEXT_k[|suffix]}} 替换为真实文本。
// 返回 { resolved, undefined: string[] }。
function resolveSkeletonString(value, longText) {
  if (typeof value !== 'string') return { resolved: value, undefined: [] };
  const PH_RE = /\{\{LONG_TEXT_(\d+)(?:\|[^}]*)?\}\}/g;
  const undef = [];
  const resolved = value.replace(PH_RE, (match, id) => {
    if (Object.prototype.hasOwnProperty.call(longText, id)) return longText[id];
    undef.push(id);
    return match;
  });
  return { resolved, undefined: undef };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: screenshot_trans.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const articlePath = path.join(urlDir, '6_article.html');
  const skeletonPath = path.join(urlDir, '7_skeleton.json');
  const longTextPath = path.join(urlDir, '2_long_text.json');

  if (!fs.existsSync(articlePath)) {
    return emitError(`找不到 ${articlePath}，请先运行步骤 6`);
  }
  if (!fs.existsSync(skeletonPath)) {
    return emitError(`找不到 ${skeletonPath}，请先运行步骤 7`);
  }
  if (!fs.existsSync(longTextPath)) {
    return emitError(`找不到 ${longTextPath}，请先运行步骤 2`);
  }

  const skeleton = JSON.parse(await fsPromises.readFile(skeletonPath, 'utf8'));
  const longText = JSON.parse(await fsPromises.readFile(longTextPath, 'utf8'));

  // ── resolved skeleton（纯 Node，不依赖 playwright）──
  const resolvedSkeleton = [];
  const undefinedRefs = new Set();
  for (const entry of skeleton) {
    const keys = Object.keys(entry);
    const key = keys[0];
    const { resolved, undefined: undef } = resolveSkeletonString(entry[key], longText);
    for (const u of undef) undefinedRefs.add(u);
    resolvedSkeleton.push({ [key]: resolved });
  }

  const resolvedPath = path.join(urlDir, '8_resolved_skeleton.json');
  await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));

  if (undefinedRefs.size > 0) {
    return emitError(
      `骨架引用了 2_long_text.json 中未定义的占位符编号: ${[...undefinedRefs].sort((a, b) => +a - +b).join(', ')}`,
      1
    );
  }

  // 按文档序收集 trans2img id
  const transIds = [];
  for (const entry of skeleton) {
    if (entry.trans2img !== undefined) transIds.push(String(entry.trans2img));
  }

  if (transIds.length === 0) {
    log('骨架无 trans2img 条目，跳过截图（已写出 resolved skeleton）');
    return emit({ status: 'ok', skipped: 'no_trans2img', resolvedSkeleton: resolvedPath });
  }

  const pageScriptFn = await readSharedScript('page-resolve-placeholders.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true, deviceScaleFactor: 2 });
    const page = await context.newPage();

    await page.goto(`file://${articlePath}`, { waitUntil: 'domcontentloaded' });

    // 占位符替换（全文档）
    const resolveResult = await page.evaluate(
      `(${pageScriptFn})(${JSON.stringify(longText)})`
    );

    if (resolveResult.undefined && resolveResult.undefined.length > 0) {
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `trans 子树引用了 2_long_text.json 中未定义的占位符编号: ${resolveResult.undefined.join(', ')}`,
        1
      );
    }

    // 取元素句柄并截图
    const transDir = path.join(urlDir, 'assets', 'trans');
    fs.mkdirSync(transDir, { recursive: true });

    const screenshots = [];
    for (const id of transIds) {
      const h = await page.$(`[data-u2m-id="${id}"]`);
      if (!h) {
        await context.close();
        await browser.close();
        browser = null;
        return emitError(
          `trans id 在 6_article DOM 中未命中: ${id}（骨架与视图不匹配，请重跑步骤 7）`,
          1
        );
      }
      const imgPath = path.join(transDir, `${id}.webp`);
      await h.screenshot({ path: imgPath, type: 'webp' });
      screenshots.push(imgPath);
    }

    await context.close();
    await browser.close();
    browser = null;

    log(`trans2img 截图完成: ${screenshots.length} 个 → ${transDir}`);

    emit({
      status: 'ok',
      count: screenshots.length,
      screenshots,
      replaced: resolveResult.replaced,
      resolvedSkeleton: resolvedPath,
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
