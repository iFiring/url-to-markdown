#!/usr/bin/env node
// screenshot_trans.mjs <url-dir>
// 步骤 3.5：trans2img 截图。读 3.4 骨架收集 trans2img id，
// playwright 加载 3.3 → 注入占位符替换（page-resolve-placeholders.js）→
// 逐元素 el.screenshot 写入 assets/trans/{id}.png。
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

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: screenshot_trans.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const articlePath = path.join(stepsDir, '3.3_article.html');
  const skeletonPath = path.join(stepsDir, '3.4_skeleton.json');
  const longTextPath = path.join(stepsDir, '2_long_text.json');

  if (!fs.existsSync(articlePath)) {
    return emitError(`找不到 ${articlePath}，请先运行步骤 3.3`);
  }
  if (!fs.existsSync(skeletonPath)) {
    return emitError(`找不到 ${skeletonPath}，请先运行步骤 3.4`);
  }
  if (!fs.existsSync(longTextPath)) {
    return emitError(`找不到 ${longTextPath}，请先运行步骤 2`);
  }

  const skeleton = JSON.parse(await fsPromises.readFile(skeletonPath, 'utf8'));

  // 按文档序收集 trans2img id
  const transIds = [];
  for (const entry of skeleton) {
    if (entry.trans2img !== undefined) transIds.push(String(entry.trans2img));
  }

  if (transIds.length === 0) {
    log('骨架无 trans2img 条目，跳过');
    return emit({ status: 'ok', skipped: 'no_trans2img' });
  }

  const longText = JSON.parse(await fsPromises.readFile(longTextPath, 'utf8'));
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
          `trans id 在 3.3 DOM 中未命中: ${id}（骨架与视图不匹配，请重跑步骤 3.4）`,
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
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
