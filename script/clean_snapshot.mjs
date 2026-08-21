#!/usr/bin/env node
// clean_snapshot.mjs <url-dir>
// 步骤 2：结构清洗。打开 1_snapshot.html，长文本占位，产出两份快照：
// 清洗版（剥样式/SVG 裸壳）与带样式版（保留 style/<style>，SVG 瘦身为壳）。
//
// 标签处理逻辑分类（实现在 lib/page-clean-snapshot.js，按执行序编号 1-13）：
//
// 【整体删除】与正文结构无关的噪声，连子树一起删：
//   - 文档级噪声：link / meta / base（title 保留，作步骤 3 识别线索）
//   - 按钮类控件：button、[role="button"]、按钮型 input[type=button|submit|reset]
//   - 页面骨架：nav / footer / form 及 role="navigation"/"contentinfo"/"form" 等价物
//   - 媒体播放器：video / audio（子元素 source / track 随之删除）
//   - 残余表单控件与模态框：input / select / textarea / label / dialog
//     （script / noscript / template 已在步骤 1 的 page-prepare.js 删除，此处不重复）
//
// 【级联删除】空元素：子树内既无非空白文本、也无白名单元素的空壳；
//   后序单趟判定，子空则父亦空，自然级联到任意深度；置于各类删除之后，
//   只含噪声的容器随之清除
//
// 【空壳保留】KEEP_EMPTY 白名单——即使为空也不删（自身即内容，且使祖先"有内容"）：
//   媒体/嵌入 img/iframe/canvas/object/embed/source/picture、排版 br/hr/wbr、
//   矢量/公式 svg/math、pre、h1-h6、表格结构 table/caption/colgroup/col/
//   thead/tbody/tfoot/tr/td/th（删空单元格/列定义会让行列错位）
//
// 【正文保留】header / aside 属正文结构（hero 主标题、章节交替），不删
//
// 【文本占位】长文本替换为 {{LONG_TEXT_k|n_chars}} / {{LONG_TEXT_k|n_words}}
//   （中文 >16 字符、英文 >12 单词），原文记入 2_long_text.json；
//   纯空白文本与 svg/style 子树文本不占位
//
// 【两版分叉】带样式版：保留 style 属性与 <style> 标签，SVG 瘦身为壳
//   （仅留 id/class/data-u2m-id）；清洗版：删 style 属性与 <style> 标签，
//   SVG 剥成裸 <svg></svg> 壳。其余清洗两版一致，占位符编号逐一对应
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
  if (!urlDirArg) return usage('用法: clean_snapshot.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    // 打开快照文件
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });

    // 执行清洗
    const result = await page.evaluate(`(${pageCleanFn})()`);

    // 写盘
    const cleanedPath = path.join(stepsDir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, result.html, 'utf8');
    // 带样式版：保留 style 属性/<style>/完整 SVG，占位符与清洗版逐一对应
    const styledPath = path.join(stepsDir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, result.styledHtml, 'utf8');
    // 长文本恢复清单：占位编号 → 原文
    const longTextPath = path.join(stepsDir, '2_long_text.json');
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
