#!/usr/bin/env node
// compute_styles.mjs <url-dir>
// 步骤 3.2：样式计算内联。读 3.1_styled_extract.html，两法各自独立产出：
//   计算版 3.2_computed_styles.html——浏览器 getComputedStyle 权威值
//     （border 三属性/背景色/纯文本元素的字号字重颜色）内联到 style 属性，
//     无意义默认（none 边框/透明背景/黑色文本）不写；
//   juice 版 3.2_juice_styles.html——juice 库按自身级联引擎内联 <style> 规则
//     （字面声明值，不推导继承、不解析 var()）。
// 两版终态一致：删除全部 <style> 标签与 class 属性，样式仅存于内联。
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import juice from 'juice';
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
  if (!urlDirArg) return usage('用法: compute_styles.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const extractPath = path.join(stepsDir, '3.1_styled_extract.html');

  if (!fs.existsSync(extractPath)) {
    return emitError(`找不到 ${extractPath}，请先运行步骤 3.1`);
  }

  const extractHtml = await fsPromises.readFile(extractPath, 'utf8');
  const pageComputeFn = await readSharedScript('page-compute-styles.js');

  // juice 版：Node 侧内联 <style> 规则并移除标签（class 稍后在浏览器删净）
  const juicedHtml = juice(extractHtml, { removeStyleTags: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });

    // 计算版：真实浏览器里测量计算值并替换内联
    const page = await context.newPage();
    await page.goto(`file://${extractPath}`, { waitUntil: 'domcontentloaded' });
    const computed = await page.evaluate(`(${pageComputeFn})()`);

    // juice 版：浏览器里仅清场（删 <style> 残留与 class）
    const stripPage = await context.newPage();
    await stripPage.setContent(juicedHtml, { waitUntil: 'domcontentloaded' });
    const stripped = await stripPage.evaluate(`(${pageComputeFn})({mode:'strip'})`);

    const computedPath = path.join(stepsDir, '3.2_computed_styles.html');
    const juicePath = path.join(stepsDir, '3.2_juice_styles.html');
    await fsPromises.writeFile(computedPath, computed.html, 'utf8');
    await fsPromises.writeFile(juicePath, stripped.html, 'utf8');
    log(`样式计算完成: ${computedPath} / ${juicePath} (${computed.styledCount} 个元素带样式)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      computedStyles: computedPath,
      juiceStyles: juicePath,
      styledCount: computed.styledCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
