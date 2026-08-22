#!/usr/bin/env node
/**
 * screenshot_trans.mjs —— 步骤 8：占位符还原 + 图片下载 + trans2img 截图。
 * 读 7_skeleton.json + 1_snapshot.html + 2_long_text.json，产出：
 *   8_resolved_skeleton.json  结构同步骤 7，所有 {{LONG_TEXT_k[|suffix]}}
 *                             替换为真实文本（trans2img 条目保留）；img 条目
 *                             在下载成功后改写为本地相对路径并重写本文件
 *   assets/images/<name>      骨架 img 条目的远端图片（见 lib/download_images.mjs
 *                             头注：优先 URL 文件名、冲突带编号、扩展名按
 *                             content-type、失败保留原 URL）
 *   assets/trans/{id}.webp    每个 trans2img 元素一张截图（WebP，2x 分辨率）
 *
 * 用法:
 *   node screenshot_trans.mjs <url-dir>
 *
 * 三轮处理：
 *   1. 纯 Node（playwright 之前）：读骨架 + 2_long_text.json 做占位符替换，
 *      写出 8_resolved_skeleton.json（条目数、顺序、key 与步骤 7 完全一致，
 *      value 全部为真实文本）。任一 value 引用了未定义编号 → 直接 error。
 *      骨架无 trans2img 也无 img 条目时到此为止（skipped: "no_trans2img"，
 *      resolved skeleton 已写出）
 *   2. playwright · 图片下载：context.request（共享 U2M_PROXY 代理与
 *      storageState 登录态）按文档序去重下载 http(s) 图片（并发限 4），
 *      成功者把 resolved skeleton 的 img 值改写为 assets/images/<name>
 *      并重写 8_resolved_skeleton.json；失败不中断——保留原 URL、记入
 *      failedImages、stderr 警告。仅此无 trans2img 时到此为止
 *   3. playwright · 截图（live 重渲染 + 严校验 + 快照兜底）：
 *      页 A 加载 file://1_snapshot.html——真实文本 + 全量内联样式，既是
 *      签名基准也是兜底截图源；从其 <base data-u2m-base> 读回原 URL 开
 *      页 B 重渲染（gotoSettled + 复用 snapshotScroll 渐进滚动触发懒加载 +
 *      重注入 page-prepare.js 重标记——data-u2m-id 按文档序编号是 prepare
 *      后 DOM 的纯函数，两次渲染结构一致则 id 精确对位）。两侧用同一
 *      page-element-signature.js 对每个 trans2img id 计算签名，全等才在
 *      B 上截图，失配/B 侧缺失/live 整体失败（站点不可达等）在 A 上兜底。
 *      A 侧也未命中的 id → error（骨架与视图不匹配）。live 页与 1_snapshot
 *      都是真实文本，无需任何页面内占位符还原
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","count":N,"screenshots":[...],"source":"live"|"snapshot"|"mixed",
 *    "images":I,"failedImages":[...],"resolvedSkeleton":"..."}   → 退出码 0
 *   {"status":"ok","skipped":"no_trans2img","images":I,"failedImages":[...],
 *    "resolvedSkeleton":"..."}       无 trans2img 条目 → 退出码 0
 *   {"status":"error","reason":"..."} 前置缺失 / id 未命中 / 未定义编号 → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { workingRoot, storageStatePath } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, gotoSettled } from './lib/browser.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { downloadImages } from './lib/download_images.mjs';

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

// 把骨架条目里 value 中的 {{LONG_TEXT_k[|suffix]}} 替换为真实文本。
// 字符串直接替换；code 条目的 value 是 {lang, content} 对象——对其字符串
// 属性逐键递归替换（content 引用的长文本占位符同样要还原，否则步骤 9
// 会把字面占位符写进代码围栏），未定义编号同样上报。
// 返回 { resolved, undefined: string[] }。
function resolveSkeletonString(value, longText) {
  if (typeof value === 'string') {
    const PH_RE = /\{\{LONG_TEXT_(\d+)(?:\|[^}]*)?\}\}/g;
    const undef = [];
    const resolved = value.replace(PH_RE, (match, id) => {
      if (Object.prototype.hasOwnProperty.call(longText, id)) return longText[id];
      undef.push(id);
      return match;
    });
    return { resolved, undefined: undef };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    const undef = [];
    for (const key of Object.keys(value)) {
      const r = resolveSkeletonString(value[key], longText);
      out[key] = r.resolved;
      undef.push(...r.undefined);
    }
    return { resolved: out, undefined: undef };
  }
  return { resolved: value, undefined: [] };
}

// 签名逐字段比对（严校验：任何差异都判失配，宁降级不出错图）。
function sameSignature(a, b) {
  return a !== null && b !== null
    && a.tag === b.tag
    && a.childCount === b.childCount
    && a.text === b.text;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: screenshot_trans.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const snapshotPath = path.join(urlDir, '1_snapshot.html');
  const skeletonPath = path.join(urlDir, '7_skeleton.json');
  const longTextPath = path.join(urlDir, '2_long_text.json');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
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

  // 按文档序收集 trans2img id；按文档序收集 img URL（去重，只下 http/https）
  const transIds = [];
  for (const entry of skeleton) {
    if (entry.trans2img !== undefined) transIds.push(String(entry.trans2img));
  }
  const imgUrls = [];
  for (const entry of resolvedSkeleton) {
    const v = entry.img;
    if (typeof v === 'string' && /^https?:\/\//.test(v) && !imgUrls.includes(v)) imgUrls.push(v);
  }
  debug(`骨架 ${skeleton.length} 条：trans2img ${transIds.length} 个、img 去重后 ${imgUrls.length} 张`);

  if (transIds.length === 0 && imgUrls.length === 0) {
    log('骨架无 trans2img 条目也无 img 条目（已写出 resolved skeleton）');
    return emit({ status: 'ok', skipped: 'no_trans2img', resolvedSkeleton: resolvedPath });
  }

  const sigFn = await readSharedScript('page-element-signature.js');
  const prepareFn = await readSharedScript('page-prepare.js');
  const pageInitSrc = await readSharedScript('page-init.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    // storageState 存在则注入：live 重渲染与图片 CDN 常与页面同登录态
    const ctxOpts = {
      viewport: { width: 1280, height: 3000 },
      deviceScaleFactor: 2, // 原生 2x 截图
      bypassCSP: true,
    };
    const ssPath = storageStatePath();
    if (fs.existsSync(ssPath)) ctxOpts.storageState = ssPath;
    const context = await browser.newContext(ctxOpts);
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue());
    await context.addInitScript({ content: pageInitSrc });

    // ── 图片下载：成功条目把 resolved skeleton 改写为本地相对路径后重写文件 ──
    let images = 0;
    let failedImages = [];
    if (imgUrls.length > 0) {
      const imagesDir = path.join(urlDir, 'assets', 'images');
      const { map, failed } = await downloadImages(context.request, imgUrls, imagesDir, { log });
      images = map.size;
      failedImages = failed.map((f) => f.url);
      if (map.size > 0) {
        for (const entry of resolvedSkeleton) {
          const local = entry.img !== undefined ? map.get(entry.img) : undefined;
          if (local !== undefined) entry.img = local;
        }
        await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));
      }
      log(`图片下载完成: ${images} 张 → ${imagesDir}${failed.length ? `，失败 ${failed.length} 张（保留原 URL）` : ''}`);
    }

    if (transIds.length === 0) {
      await context.close();
      await browser.close();
      browser = null;
      return emit({
        status: 'ok',
        skipped: 'no_trans2img',
        resolvedSkeleton: resolvedPath,
        images,
        failedImages,
      });
    }

    // ── 页 A：file://1_snapshot.html——签名基准 + 兜底截图源 ──
    const pageA = await context.newPage();
    const tA = performance.now();
    await gotoSettled(pageA, `file://${snapshotPath}`, log);
    await pageA.evaluate(() => document.fonts.ready.then(() => true));
    debug(`页 A（快照渲染）就绪 ${((performance.now() - tA) / 1000).toFixed(2)}s`);

    const sigA = await pageA.evaluate(`(${sigFn})(${JSON.stringify(transIds)})`);
    const missingA = transIds.filter((id) => sigA[id] == null);
    if (missingA.length > 0) {
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `trans id 在 1_snapshot 中未命中: ${missingA.join(', ')}（骨架与视图不匹配，请重跑步骤 7）`,
        1
      );
    }

    const pageUrl = await pageA.evaluate(() => {
      const b = document.querySelector('base[data-u2m-base]');
      return b ? b.href : null;
    });

    // ── 页 B：live 重渲染 → 渐进滚动 → 重标记 → 严校验 ──
    let liveIds = [];
    let pageB = null;
    if (pageUrl) {
      try {
        const tB = performance.now();
        pageB = await context.newPage();
        await gotoSettled(pageB, pageUrl, log);
        await snapshotScroll(pageB, { log: debug });
        await pageB.evaluate(`(${prepareFn})()`);
        await pageB.evaluate(() => document.fonts.ready.then(() => true));
        try { await pageB.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* 尽力等待 */ }
        const sigB = await pageB.evaluate(`(${sigFn})(${JSON.stringify(transIds)})`);
        liveIds = transIds.filter((id) => sameSignature(sigA[id], sigB[id]));
        debug(`live 重渲染就绪 ${((performance.now() - tB) / 1000).toFixed(2)}s，签名命中 ${liveIds.length}/${transIds.length}`);
      } catch (e) {
        log(`live 重渲染失败，全部走快照兜底: ${e.message}`);
        liveIds = [];
        pageB = null;
      }
    } else {
      log('快照缺 <base data-u2m-base>，无法重渲染，全部走快照兜底');
    }

    // ── 截图：live 命中在 B，失配/缺失在 A 兜底 ──
    const transDir = path.join(urlDir, 'assets', 'trans');
    fs.mkdirSync(transDir, { recursive: true });

    const screenshots = [];
    for (const id of transIds) {
      const useLive = liveIds.includes(id);
      if (!useLive) debug(`trans2img ${id} live 签名失配或缺失 → 快照兜底`);
      const page = useLive ? pageB : pageA;
      const h = await page.$(`[data-u2m-id="${id}"]`);
      if (!h) {
        await context.close();
        await browser.close();
        browser = null;
        return emitError(`trans id 在渲染页未命中: ${id}`, 1);
      }
      const imgPath = path.join(transDir, `${id}.webp`);
      await h.screenshot({ path: imgPath, type: 'webp' });
      debug(`trans2img ${id} 截图（${useLive ? 'live' : 'snapshot'}）→ ${imgPath}`);
      screenshots.push(imgPath);
    }

    await context.close();
    await browser.close();
    browser = null;

    const source = liveIds.length === 0
      ? 'snapshot'
      : liveIds.length === transIds.length ? 'live' : 'mixed';
    log(`trans2img 截图完成: ${screenshots.length} 个（source=${source}）→ ${transDir}`);

    emit({
      status: 'ok',
      count: screenshots.length,
      screenshots,
      source,
      images,
      failedImages,
      resolvedSkeleton: resolvedPath,
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
