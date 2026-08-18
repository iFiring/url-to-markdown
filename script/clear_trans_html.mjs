#!/usr/bin/env node
// clear_trans_html.mjs <url> —— Node 工作流：完整性→特殊元素→清理→readability→turndown→sketch.md
import path from 'node:path';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { projectRoot, ensureWorkflowDirs, storageStatePath } from './lib/env.mjs';
import { openPage } from './lib/browser.mjs';
import { makeCtx, readSharedScript, processMermaid, processSpecialElements, processImages, writeManifest } from './lib/placeholder.mjs';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import fs from 'node:fs/promises';

const READABILITY_JS = path.join(projectRoot(), 'node_modules', '@mozilla', 'readability', 'Readability.js');

/** 渐进滚动到底再回顶（懒加载） */
async function progressiveScroll(page) {
  await page.evaluate(async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  });
}

/** DOM 稳定：节点数连续 stableMs 不变（虚拟 DOM 场景；不移除任何元素） */
async function waitForDomStable(page, { stableMs = 1000, maxMs = 15000 } = {}) {
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= stableMs) return;
    await page.waitForTimeout(200);
  }
}

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--')) return usage('用法: clear_trans_html.mjs <url>');
  const dirs = ensureWorkflowDirs(url, 'node_workflow');

  const pageInit = await readSharedScript('page-init.js');
  const pageMerge = await readSharedScript('page-merge.js');
  const pageClean = await readSharedScript('page-clean.js');

  let s;
  let result;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    await progressiveScroll(s.page);
    await waitForDomStable(s.page);

    const ctx = makeCtx(dirs, { context: s.context, log });
    await s.page.evaluate(`(${pageMerge})()`);
    await processMermaid(s.page.mainFrame(), ctx);
    await processSpecialElements(s.page.mainFrame(), ctx);
    await processImages(s.page.mainFrame(), ctx);

    await s.page.evaluate(`(${pageClean})()`);

    // Readability 在页面内运行（避免 jsdom 依赖）
    await s.page.addScriptTag({ path: READABILITY_JS });
    // keepClasses: 默认会剥除全部 class，fenced 代码块语言标注（language-*）将丢失
    const article = await s.page.evaluate(() => {
      const a = new Readability(document, { keepClasses: true }).parse();
      return a ? { title: a.title, content: a.content } : null;
    });
    let html;
    if (article?.content) {
      html = article.content;
    } else {
      ctx.warnings.push('readability 未能解析主体，回退 body 全文');
      html = await s.page.evaluate(() => document.body.innerHTML);
    }
    // Readability _fixRelativeUris 会把分派自产的 assets/ 相对引用绝对化——按 manifest 还原
    for (const e of ctx.entries) {
      if (e.final) html = html.split(new URL(e.final, url).href).join(e.final);
    }

    const td = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx', bulletListMarker: '-' });
    td.use(gfm);
    // 不转义下划线：{{IMG_n}}/{{COMPLEX_DIV_n}} 是后续精确替换的机器令牌，须原样保留
    const md = td.turndown(html).replace(/\\_/g, '_');

    await fs.writeFile(path.join(dirs.wf, 'sketch.md'), md, 'utf8');
    await writeManifest(dirs.manifest, ctx.entries);
    result = {
      status: 'ok',
      sketch: path.join(dirs.wf, 'sketch.md'),
      images: ctx.counters.img,
      complex: ctx.entries.length,
      warnings: ctx.warnings,
    };
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {}); // 先关浏览器再 emit（emit 内 process.exit）
  emit(result, 0);
}

main().catch((e) => emitError(e.message, 1));
