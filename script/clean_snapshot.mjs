#!/usr/bin/env node
/**
 * clean_snapshot.mjs —— 步骤 2：结构清洗。打开 1_snapshot.html 单趟清洗，
 * 产出两份快照（共享同一套清洗与占位）+ 占位符原文清单：
 *   2_clean_snapshot.html        清洗版（供步骤 3 读结构）
 *   2_clean_style_snapshot.html  带样式版（供步骤 4 裁剪）
 *   2_long_text.json             编号 → 原文映射，供后续流程恢复
 *
 * 用法:
 *   node clean_snapshot.mjs --url <url>
 *
 * 共同清洗（两版一致；实现在 lib/page-clean-snapshot.js，按执行序编号 1-13）：
 *   【整体删除】与正文结构无关的噪声，连子树一起删：
 *     - 文档级噪声：link / meta / base（title 保留，作步骤 3 识别线索）
 *     - 按钮类控件：button、[role="button"]、按钮型 input[type=button|submit|reset]
 *     - 页面骨架：nav / footer / form 及 role="navigation"/"contentinfo"/"form"
 *       等价物（article 内嵌 footer 同删）
 *     - 媒体播放器：video / audio（子元素 source / track 随之删除）
 *     - 残余表单控件与模态框：input / select / textarea / label / dialog
 *       （form 外的搜索框等 UI 控件兜底；script / noscript / template 已在
 *       步骤 1 的 page-prepare.js 删除，此处不重复）
 *   【正文保留】header / aside 属正文结构（hero 主标题、章节交替），不删
 *   【级联删除】空元素：子树内既无非空白文本、也无白名单元素的空壳；
 *     后序单趟判定，子空则父亦空，自然级联到任意深度；置于各类删除之后，
 *     只含噪声的容器随之清除
 *   【空壳保留】KEEP_EMPTY 白名单——即使为空也不删（自身即内容，且使祖先
 *     "有内容"）：媒体/嵌入 img/iframe/canvas/object/embed/source/picture、
 *     排版 br/hr/wbr、矢量/公式 svg/math、pre、h1-h6、表格结构 table/
 *     caption/colgroup/col/thead/tbody/tfoot/tr/td/th（删空单元格/列定义
 *     会让行列错位，单元格内的噪声照删、留空壳）
 *
 * 两版分叉：
 *   - 带样式版：保留 style 属性与 <style> 标签，SVG 瘦身为壳
 *     （仅留 id/class/data-u2m-id）
 *   - 清洗版：删 style 属性与 <style> 标签，SVG 剥成裸 <svg></svg> 壳
 *
 * 长文本占位（两版编号逐一对应；纯空白文本与 svg/style 子树文本不占位）：
 *   中文（含汉字）字符数 > 16 → {{LONG_TEXT_k|n_chars}}
 *   英文（不含汉字）单词数 > 12 → {{LONG_TEXT_k|n_words}}
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","cleanedSnapshot":"...","styledSnapshot":"...",
 *    "longText":".../2_long_text.json","longTextCount":N}   → 退出码 0
 *   {"status":"error","reason":"..."}                        → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import juice from 'juice';
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
  if (!url) return usage('用法: clean_snapshot.mjs --url <url>');

  const dir = urlDir(url);
  const snapshotPath = path.join(dir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  debug(`读入快照 ${snapshotPath}（${fs.statSync(snapshotPath).size} 字节）`);

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');
  const normalizeFn = await readSharedScript('page-normalize-styles.js');
  const hiddenFn = await readSharedScript('page-hidden-detect.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    const page = await context.newPage();

    // 阶段 A：加载快照 + style 属性字符串规范化（防 juice 引号改写损毁声明，
    // 机制见 page-normalize-styles.js 头注；页 1 DOM 保持规范化态供阶段 D 复用）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const htmlNorm = await page.evaluate(`(${normalizeFn})()`);

    // 阶段 B+C：juice 级联内联 → 页 2 检测隐藏子树。任何失败都降级为「不折叠」
    // （失败方向安全：清洗版变大，正文与带样式版不受影响），不阻断步骤 2。
    let hidden = [];
    try {
      const t0 = performance.now();
      const juiced = juice(htmlNorm, { removeStyleTags: true, decodeStyleAttributes: true });
      debug(`juice 内联 ${((performance.now() - t0) / 1000).toFixed(2)}s（${juiced.length} 字节）`);
      const page2 = await context.newPage();
      try {
        await page2.setContent(juiced, { waitUntil: 'domcontentloaded' });
        const detect = await page2.evaluate(`(${hiddenFn})()`);
        // 雪崩护栏：juiced DOM 上折叠后可见文本占比 <5% 且折叠前文本充足（≥2000
        // 非空白字符）→ 本轮放弃折叠（整页被 cookie 墙 display:none 类极端页面）
        const visibleChars = detect.totalChars - detect.hiddenChars;
        if (detect.totalChars >= 2000 && visibleChars < detect.totalChars * 0.05) {
          debug(`[clean] 雪崩护栏：折叠后可见文本 ${visibleChars}/${detect.totalChars} 字符，放弃折叠`);
          hidden = [];
        } else {
          hidden = detect.items;
          debug(`[clean] 检测到 ${hidden.length} 个隐藏子树`);
        }
      } finally {
        await page2.close();
      }
    } catch (e) {
      debug(`隐藏检测失败，跳过折叠: ${e.message}`);
    }

    // 阶段 D：清洗（页 1，规范化态 DOM；hidden 随 cfg 传入）
    const result = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ hidden })})`);

    // 写盘
    const cleanedPath = path.join(dir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, result.html, 'utf8');
    // 带样式版：保留 style 属性/<style>/完整 SVG，占位符与清洗版逐一对应
    const styledPath = path.join(dir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, result.styledHtml, 'utf8');
    // 长文本恢复清单：占位编号 → 原文
    const longTextPath = path.join(dir, '2_long_text.json');
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
