#!/usr/bin/env node
// compute_styles.mjs <url-dir>
// 步骤 5：样式内联（juice）。读 4_styled_extract.html，juice 按自身
// CSS 级联引擎把 <style> 规则内联到元素的 style 属性并移除标签
// （字面声明值：不推导继承、不解析 var()；原有内联样式参与级联故保留），
// 再在浏览器里删净残留 <style> 与全部 class 属性（page-finalize-inline.js）。
// 终态：无 <style>、无 class，样式仅存于内联。
// 产物：steps/5_juice_styles.html
// （getComputedStyle 计算版已按效果对比移除，只保留 juice 路径）
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
  const extractPath = path.join(stepsDir, '4_styled_extract.html');

  if (!fs.existsSync(extractPath)) {
    return emitError(`找不到 ${extractPath}，请先运行步骤 4`);
  }

  const extractHtml = await fsPromises.readFile(extractPath, 'utf8');
  const pageFinalizeFn = await readSharedScript('page-finalize-inline.js');

  // juice：Node 侧内联 <style> 规则并移除标签（class 稍后在浏览器删净）
  const juicedHtml = juice(extractHtml, { removeStyleTags: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();
    await page.setContent(juicedHtml, { waitUntil: 'domcontentloaded' });
    const final = await page.evaluate(`(${pageFinalizeFn})()`);

    const juicePath = path.join(stepsDir, '5_juice_styles.html');
    await fsPromises.writeFile(juicePath, final.html, 'utf8');
    log(`样式内联完成: ${juicePath} (${final.styledCount} 个元素带样式)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      juiceStyles: juicePath,
      styledCount: final.styledCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
