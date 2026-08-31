// script/lib/snapshot-capture.mjs
// 步骤 1 快照阶段：注入 page-prepare.js → evaluate → 写盘
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSharedScript } from './placeholder.mjs';

/**
 * 全保真快照抓取。evaluate __u2mPrepareBody 后序列化 DOM。
 * @param {import('playwright').Page} page
 * @param {{outDir: string, log?: Function}} opts
 * @returns {Promise<{snapshotPath: string, elements: number}>}
 */
export async function snapshotCapture(page, opts = {}) {
  const { outDir, log = () => {} } = opts;

  const pagePrepare = await readSharedScript('page-prepare.js');

  // 注入并执行 page-prepare（iframe 合并 + CSS 内联 + 剥 JS + data-idx）
  await page.evaluate(`(${pagePrepare})()`);

  // 取全保真快照
  const snapshot = await page.evaluate(() => document.documentElement.outerHTML);

  // 统计 data-idx 数量
  const elements = (snapshot.match(/data-idx="\d+"/g) || []).length;

  // 写盘
  await fs.mkdir(outDir, { recursive: true });
  const snapshotPath = path.join(outDir, '1_snapshot.html');
  await fs.writeFile(snapshotPath, '<!DOCTYPE html>\n' + snapshot, 'utf8');

  log(`快照已保存: ${snapshotPath} (${elements} 个标记元素)`);

  return { snapshotPath, elements };
}
