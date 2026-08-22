#!/usr/bin/env node
/**
 * compute_styles.mjs —— 步骤 5：样式内联（juice）。读 4_styled_extract.html，
 * 产出 <url-dir>/5_juice_styles.html。终态：无 <style>、无 class，
 * 内联声明只留有意义的。
 *
 * 用法:
 *   node compute_styles.mjs <url-dir>
 *
 * 两轮处理：
 *   1. juice（Node）：按自身 CSS 级联引擎把 <style> 规则内联到元素的
 *      style 属性并移除标签——字面声明值：不推导继承、不解析 var()；
 *      原有内联样式参与级联故保留
 *   2. 浏览器收尾（lib/page-finalize-inline.js）：
 *      - 噪声声明删除：font-family、font-style（任意值）、-webkit- 前缀
 *        属性、值为 inherit 的声明；清空后移除 style 属性。只动确有
 *        噪声的元素——无噪声的保持 juice 字面输出（被清理元素的声明经
 *        CSSOM 重序列化，颜色归一为 rgb() 形式，语义等价）
 *      - <style> 标签与 class 属性删净（正文含字面 class="..." 文本也
 *        不会误伤）
 *
 * 历史：getComputedStyle 计算版已按效果对比移除，只保留 juice 路径。
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","juiceStyles":"...","styledCount":N}  → 退出码 0
 *   {"status":"error","reason":"..."}                    → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import juice from 'juice';
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
  if (!urlDirArg) return usage('用法: compute_styles.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const extractPath = path.join(urlDir, '4_styled_extract.html');

  if (!fs.existsSync(extractPath)) {
    return emitError(`找不到 ${extractPath}，请先运行步骤 4`);
  }

  const extractHtml = await fsPromises.readFile(extractPath, 'utf8');
  const pageFinalizeFn = await readSharedScript('page-finalize-inline.js');
  debug(`读入 ${extractPath}（${extractHtml.length} 字节）`);

  // juice：Node 侧内联 <style> 规则并移除标签（class 稍后在浏览器删净）
  const juicedHtml = juice(extractHtml, { removeStyleTags: true });
  debug(`juice 内联后 ${juicedHtml.length} 字节`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();
    await page.setContent(juicedHtml, { waitUntil: 'domcontentloaded' });
    const final = await page.evaluate(`(${pageFinalizeFn})()`);

    const juicePath = path.join(urlDir, '5_juice_styles.html');
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
