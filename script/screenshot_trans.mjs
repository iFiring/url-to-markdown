#!/usr/bin/env node
/**
 * screenshot_trans.mjs —— 步骤 8：占位符还原 + 图片下载 + trans2img 截图。
 * 读 7_skeleton.json + 1_snapshot.html + 2_long_text.json + 3_key_ids.json，产出：
 * 
 *   8_resolved_skeleton.json  结构同步骤 7，所有 {{LONG_TEXT_k[|suffix]}}
 *                             替换为真实文本；img 条目（![img](url) 形态）在
 *                             下载成功后只换括号内 URL 改写为
 *                             ![img](assets/images/<name>) 并重写本文件；
 *                             trans2img 条目在截图择优后回写为选中路径
 *                             assets/trans/{id}.webp 并重写本文件
 *
 *   assets/images/<name>      骨架 img 条目的远端图片（见 lib/download_images.mjs
 *                             头注：优先 URL 文件名、冲突带编号、扩展名按
 *                             content-type、失败保留原 URL）
 *
 *   assets/trans/{id}.webp    trans2img 单传祖先链上每个 id 各一张截图
 *                             （WebP，2x 分辨率，全部落盘保留）
 *
 * 用法:
 *   node screenshot_trans.mjs --url <url>
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
 *      签名基准也是兜底截图源；直接用 --url 开页 B 重渲染（gotoSettled +
 *      复用 snapshotScroll 渐进滚动触发懒加载 + 重注入 page-prepare.js
 *      重标记——data-idx 按文档序编号是 prepare 后 DOM 的纯函数，
 *      两次渲染结构一致则 id 精确对位）。两侧用同一
 *      page-element-signature.js 对每个 trans2img id 计算签名，全等才在
 *      B 上截图，失配/B 侧缺失/live 整体失败（站点不可达等）在 A 上兜底。
 *      A 侧也未命中的 id → error（骨架与视图不匹配）。折叠模块（手风琴
 *      收起等）两侧同为隐藏态——每个 id 截图前先跑 page-reveal-hidden.js
 *      强制展开（只覆写正在隐藏的属性，可见时零改动；签名在展开前算好，
 *      不受影响）。截图循环之前另有双层排除：分类层
 *      page-exclude-noncontent.js 每页一次（keep =
 *      titleId∪descriptionIds∪paragraphIds 块（嵌套展开）∪trans2img id，
 *      隐藏集 = id 全集 − keep − keep 祖先 − keep 子孙，并入
 *      dumpIds，保优先；visibility:hidden 零重排），几何层
 *      即上述 page-reveal-hidden.js 逐 id 四段（纵向展开 + 横向裁剪 reveal +
 *      留白扩盒（四边 20px 呼吸位，负 margin 抵消内容零重排）+ 非亲族遮挡者
 *      隐藏——fixed/sticky 一律、其余盒相交即藏，亲族保留）；
 *      首选页盒无效或截图失败（有界超时 10s，不整页挂死）换
 *      另一页再试，仍失败汇总 error 列出 id。live 页与 1_snapshot
 *      都是真实文本，无需任何页面内占位符还原。链上每个 id 各截一张并
 *      记录 boundingBox（展开后的真实尺寸），随后逐条目择优——宽度优先、
 *      等宽选高、宽高全同选最外层（数组首位）——把条目 value 回写为选中路径
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   `resolvedSkeleton` 为 resolved skeleton 路径；
 *   `count` 为截图数；`source` 为截图来源（`live` 全部来自重渲染 / `snapshot` 全部快照兜底 / `mixed` 混合——均无需处理）；
 *   `images` 为下载成功数、`failedImages` 为失败 URL（其骨架条目保留原 URL，无需处理）；
 *   `skipped: "no_trans2img"` 时无截图但图片下载照常；
 *   {"status":"ok","count":N,"screenshots":[...],"source":"live"|"snapshot"|"mixed",
 *    "images":I,"failedImages":[...],"resolvedSkeleton":"..."}   → 退出码 0
 *   {"status":"ok","skipped":"no_trans2img","images":I,"failedImages":[...],
 *    "resolvedSkeleton":"..."}       无 trans2img 条目 → 退出码 0
 *   {"status":"error","reason":"..."} 前置缺失 / 非四键契约 / id 未命中 / 未定义编号 → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { urlDir, storageStatePath } from './lib/env.mjs';
import { parseKeyIds } from './lib/key-ids.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, gotoSettled, newU2MContext } from './lib/browser.mjs';
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

// 从 img 条目 value（![img](url) 形态）解包出 {alt, url}。
// 非该形态或 URL 非 http(s) 返回 null——跳过下载。
const IMG_MD_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
function unpackImgEntry(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(IMG_MD_RE);
  if (!m || !/^https?:\/\//.test(m[2])) return null;
  return { alt: m[1], url: m[2] };
}

// trans2img 条目择优：宽度优先 → 等宽选高 → 宽高全同选最外层（数组首位）。
// boundingBox 缺失（null）按 -1 计，排序垫底但不影响平局规则。
function pickBestId(ids, boxes) {
  const boxOf = (id) => boxes[id] || { width: -1, height: -1 };
  let best = ids[0];
  for (const id of ids.slice(1)) {
    const a = boxOf(id);
    const b = boxOf(best);
    if (a.width > b.width || (a.width === b.width && a.height > b.height)) best = id;
  }
  return best;
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
  const url = args.url;
  if (!url) return usage('用法: screenshot_trans.mjs --url <url>');

  const dir = urlDir(url);
  const snapshotPath = path.join(dir, '1_snapshot.html');
  const skeletonPath = path.join(dir, '7_skeleton.json');
  const longTextPath = path.join(dir, '2_long_text.json');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  if (!fs.existsSync(skeletonPath)) {
    return emitError(`找不到 ${skeletonPath}，请先运行步骤 7`);
  }
  if (!fs.existsSync(longTextPath)) {
    return emitError(`找不到 ${longTextPath}，请先运行步骤 2`);
  }
  const keyIdsPath = path.join(dir, '3_key_ids.json');
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }
  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));

  // 四键契约校验与 paragraphIds 嵌套展开共享 lib/key-ids.mjs（与步骤 4/6
  // 同一校验事实源），开浏览器前拦截形状与自相矛盾输入
  const parsed = parseKeyIds(keyIds);
  if (parsed.error) return emitError(parsed.error);
  const { titleId, descriptionIds, blockIds, dumpIds } = parsed;
  debug(`key_ids: title=${titleId ?? '无'} desc=${descriptionIds.length} blocks=${blockIds.length} dump=${dumpIds.length}`);

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

  const resolvedPath = path.join(dir, '8_resolved_skeleton.json');
  await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));

  if (undefinedRefs.size > 0) {
    return emitError(
      `骨架引用了 2_long_text.json 中未定义的占位符编号: ${[...undefinedRefs].sort((a, b) => +a - +b).join(', ')}`,
      1
    );
  }

  // ── {{TABLE_k[|...]}} 还原（LONG_TEXT 之后）——成功路径表 markdown 已预展开
  //    无 LONG_TEXT 占位，失败路径表值已是具体 markdown 不匹配。查 2_tables.json
  //    替换为预计算 markdown；未定义/失败 k 保留字面、记 failedTables（不阻断）──
  const tablesJsonPath = path.join(dir, '2_tables.json');
  const tablesJson = fs.existsSync(tablesJsonPath)
    ? JSON.parse(await fsPromises.readFile(tablesJsonPath, 'utf8'))
    : {};
  const TABLE_PH_RE = /\{\{TABLE_(\d+)(?:\|[^}]*)?\}\}/g;
  const failedTables = [];
  let tablesResolved = 0;
  for (const entry of resolvedSkeleton) {
    const key = Object.keys(entry)[0];
    const val = entry[key];
    if (typeof val !== 'string' || !val.includes('{{TABLE_')) continue;
    entry[key] = val.replace(TABLE_PH_RE, (match, id) => {
      const t = tablesJson[id];
      if (t && t.status === 'ok' && t.markdown) { tablesResolved++; return t.markdown; }
      failedTables.push(id);
      return match; // 保留字面
    });
  }
  await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));

  // 按文档序收集 trans2img 条目（value 应为非空正整数 ID 数组——单传祖先链）；
  // 按文档序收集 img 条目括号内 URL（去重，只下 http/https）
  const transEntries = [];
  for (const entry of skeleton) {
    if (entry.trans2img === undefined) continue;
    const v = entry.trans2img;
    const okShape = Array.isArray(v) && v.length > 0 && v.every((id) => Number.isInteger(id) && id > 0);
    if (!okShape) {
      return emitError(
        `trans2img 条目 value 应为非空正整数 ID 数组（单传祖先链），实际为: ${JSON.stringify(v)}——请按步骤 7 指南修正 7_skeleton.json`,
        1
      );
    }
    transEntries.push(v);
  }
  const transIds = [...new Set(transEntries.flat())];
  // 分类层 keep 集（spec §3.1）：titleId ∪ descriptionIds ∪ paragraphIds 块
  // （已展开）∪ trans2img id（截图目标必须保）；噪音集 = dumpIds
  const keepIds = [...new Set([
    ...(titleId !== null ? [titleId] : []),
    ...descriptionIds,
    ...blockIds,
    ...transIds,
  ])];
  const noiseIds = dumpIds;
  const imgUrls = [];
  for (const entry of resolvedSkeleton) {
    const img = unpackImgEntry(entry.img);
    if (img && !imgUrls.includes(img.url)) imgUrls.push(img.url);
  }
  debug(`骨架 ${skeleton.length} 条：trans2img 条目 ${transEntries.length} 个（去重 id ${transIds.length} 个）、img 去重后 ${imgUrls.length} 张`);

  if (transIds.length === 0 && imgUrls.length === 0) {
    log('骨架无 trans2img 条目也无 img 条目（已写出 resolved skeleton）');
    return emit({ status: 'ok', skipped: 'no_trans2img', resolvedSkeleton: resolvedPath, tablesResolved, failedTables });
  }

  const sigFn = await readSharedScript('page-element-signature.js');
  const prepareFn = await readSharedScript('page-prepare.js');
  const revealFn = await readSharedScript('page-reveal-hidden.js');
  const excludeFn = await readSharedScript('page-exclude-noncontent.js');
  const pageInitSrc = await readSharedScript('page-init.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    // storageState 存在则注入：live 重渲染与图片 CDN 常与页面同登录态；
    // deviceScaleFactor 2 → 原生 2x 截图；UA/指纹门禁由 newU2MContext 统一处理
    const ssPath = storageStatePath();
    const context = await newU2MContext(browser, {
      deviceScaleFactor: 2,
      storageState: fs.existsSync(ssPath) ? ssPath : undefined,
      initScripts: [pageInitSrc],
    });

    // ── 图片下载：成功条目把 resolved skeleton 改写为本地相对路径后重写文件 ──
    let images = 0;
    let failedImages = [];
    if (imgUrls.length > 0) {
      const imagesDir = path.join(dir, 'assets', 'images');
      const { map, failed } = await downloadImages(context.request, imgUrls, imagesDir, { log });
      images = map.size;
      failedImages = failed.map((f) => f.url);
      if (map.size > 0) {
        for (const entry of resolvedSkeleton) {
          const img = entry.img !== undefined ? unpackImgEntry(entry.img) : null;
          if (!img) continue;
          const local = map.get(img.url);
          if (local !== undefined) entry.img = `![${img.alt}](${local})`;
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

    // ── 页 B：live 重渲染（--url）→ 渐进滚动 → 重标记 → 严校验 ──
    let liveIds = [];
    let pageB = null;
    try {
      const tB = performance.now();
      pageB = await context.newPage();
      await gotoSettled(pageB, url, log);
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

    // ── 截图：live 命中在 B，失配/缺失在 A 兜底 ──
    // 折叠模块（手风琴收起等，步骤 2 检测、带样式版保真流到步骤 7 的合法
    // trans2img）两侧同为隐藏态：el.screenshot() 自动等可见会挂到超时，
    // 被塌缩祖先裁剪的模块更会截出空白图——每 id 截图前先跑共享
    // page-reveal-hidden.js 强制展开（只覆写正在隐藏的属性，可见时零改动，
    // 不动 tag/children/textContent、签名不受影响）；首选页盒无效或截图
    // 失败再试另一页（快照 A 无 JS，展开 100% 确定），仍失败汇总报 error
    const transDir = path.join(dir, 'assets', 'trans');
    fs.mkdirSync(transDir, { recursive: true });

    const srcLabel = (pg) => (pg === pageB ? 'live' : 'snapshot');
    // ── 分类层：非文章内容元素页面级排除（双层第一层，spec §3.1）──
    // 签名计算之后、截图循环之前执行（visibility 不动 tag/children/
    // textContent，签名不受影响；零重排，boundingBox 择优不受影响）
    for (const page of [pageA, pageB]) {
      if (!page) continue;
      const ex = await page.evaluate(`(${excludeFn})(${JSON.stringify(keepIds)}, ${JSON.stringify(noiseIds)})`);
      debug(`分类层排除（${srcLabel(page)}）: 隐藏 ${ex.hidden} / keep 命中 ${ex.kept}`);
    }
    const screenshots = [];
    const boxes = {}; // id → boundingBox（CSS px）——择优依据
    const failedIds = [];
    for (const id of transIds) {
      const useLive = liveIds.includes(id);
      if (!useLive) debug(`trans2img ${id} live 签名失配或缺失 → 快照兜底`);
      const pages = (useLive ? [pageB, pageA] : [pageA, pageB]).filter(Boolean);
      const imgPath = path.join(transDir, `${id}.webp`);
      let done = false;
      let skipped = false;
      for (const page of pages) {
        if (done) break;
        const rev = await page.evaluate(`(${revealFn})(${id})`);
        if (!rev.found) continue; // 该页无此元素 → 换页（A 侧缺失已在签名阶段报错）
        if (rev.touched > 0) {
          debug(`trans2img ${id} 隐藏态强制展开（${srcLabel(page)}，覆写 ${rev.touched} 处）`);
        }
        if (rev.wideTouched > 0) {
          debug(`trans2img ${id} 横向裁剪 reveal（${srcLabel(page)}，覆写 ${rev.wideTouched} 处）`);
        }
        if (rev.occluders > 0) {
          debug(`trans2img ${id} 遮挡者隐藏（${srcLabel(page)}，${rev.occluders} 个）`);
        }
        // display:contents 透明包装：结构性无盒（与隐藏无关），截不出图——
        // 跳过该 id，视觉由链上其余 id 承载（择优自然落选它）
        if (rev.boxless) {
          debug(`trans2img ${id} 为 display:contents 透明包装，自身无盒 → 跳过`);
          skipped = true;
          break;
        }
        if (!(rev.box && rev.box.width > 0 && rev.box.height > 0)) {
          debug(`trans2img ${id} 展开后仍无有效盒（${srcLabel(page)}）→ 换页`);
          continue;
        }
        const h = await page.$(`[data-idx="${id}"]`);
        if (!h) continue;
        try {
          // 有界超时：防御未预见隐藏形态，不整页挂死
          await h.screenshot({ path: imgPath, type: 'webp', timeout: 10000 });
        } catch (e) {
          debug(`trans2img ${id} 截图失败（${srcLabel(page)}）: ${String(e.message).split('\n')[0]} → 换页`);
          continue;
        }
        boxes[id] = await h.boundingBox();
        debug(`trans2img ${id} 截图（${srcLabel(page)}）→ ${imgPath}${boxes[id] ? `（${Math.round(boxes[id].width)}×${Math.round(boxes[id].height)}）` : ''}`);
        screenshots.push(imgPath);
        done = true;
      }
      if (!done && !skipped) failedIds.push(id);
    }
    if (failedIds.length > 0) {
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `trans id 无法截图（隐藏且强制展开无效）: ${failedIds.join(', ')}（请检查该模块是否值得 trans2img，必要时调整步骤 7 标记后重跑）`,
        1
      );
    }

    // 逐条目择优（宽度优先 → 等宽选高 → 全同选最外层），回写为选中路径。
    // trans2img 数组经 resolveSkeletonString 原引用透传，直接按形态识别条目。
    // 条目全部 id 结构性无盒（如整链 display:contents）→ 无一真实出图，
    // 回写会指向不存在的文件——收集后统一报错
    const boxlessEntries = [];
    for (const entry of resolvedSkeleton) {
      if (!Array.isArray(entry.trans2img)) continue;
      const best = pickBestId(entry.trans2img, boxes);
      if (boxes[best] === undefined) {
        boxlessEntries.push(`[${entry.trans2img.join(', ')}]`);
        continue;
      }
      debug(`trans2img [${entry.trans2img.join(', ')}] 择优 → ${best}`);
      entry.trans2img = `assets/trans/${best}.webp`;
    }
    if (boxlessEntries.length > 0) {
      await context.close();
      await browser.close();
      browser = null;
      return emitError(
        `trans2img 条目全部 id 结构性无盒（如 display:contents 透明包装链）: ${boxlessEntries.join('; ')}（请调整步骤 7 标记，选有真实视觉盒的元素后重跑）`,
        1
      );
    }
    await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));

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
      tablesResolved,
      failedTables,
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
