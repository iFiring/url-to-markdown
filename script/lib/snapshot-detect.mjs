// script/lib/snapshot-detect.mjs
// 步骤 1 检测阶段：虚拟列表检测（复用滚动后页面状态）
import { readSharedScript } from './placeholder.mjs';

/**
 * 虚拟列表检测。复用步骤 1 滚动后的页面状态。
 * @param {import('playwright').Page} page
 * @param {{log?: Function}} opts
 * @throws {Error} reason='virtual_list' 当检测到虚拟列表时
 */
export async function snapshotDetect(page, opts = {}) {
  const { log = () => {} } = opts;
  const pageDetect = await readSharedScript('page-detect.js');
  const result = await page.evaluate(`(${pageDetect})()`);
  log(`虚拟列表检测: ${result.isVirtualList ? '命中——页面仅渲染可见窗口，终止' : '未命中'}`);
  if (result.isVirtualList) {
    const err = new Error('virtual_list');
    err.reason = 'virtual_list';
    throw err;
  }
}
