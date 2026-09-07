// script/lib/snapshot-redirect.mjs
// 步骤 1 重定向门：占优内容 iframe 检测 + 跳转编排（runRedirectGate 见接线任务）。
// 测量（正文长度归一化口径）唯一副本在本模块；判定规则唯一事实源在 page-detect-iframe.js。
import { readSharedScript } from './placeholder.mjs';

const MIN_FRAME_TEXT = 500;
const TEXT_RATIO = 3;
const MIN_BOX = 200;
export const DEGENERATE_RATIO = 0.5;

const measureTextLen = async (target) => target.evaluate(() => {
  const t = document.body && document.body.innerText ? document.body.innerText : '';
  return t.replace(/\s+/g, ' ').trim().length;
});

/**
 * 占优内容 iframe 检测。在当前页面（主文档）上执行。
 * @param {import('playwright').Page} page
 * @param {{log?: Function}} opts
 * @returns {Promise<{redirect: {url: string, frameText: number} | null, mainText: number}>}
 */
export async function snapshotRedirectDetect(page, opts = {}) {
  const { log = () => {} } = opts;
  const pageDetect = await readSharedScript('page-detect-iframe.js');

  // 逐 frame 测正文（Playwright 经 CDP，跨域 frame 同样可测；导航中的 frame 跳过）
  const frameTexts = {};
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try { frameTexts[f.url().split('#')[0]] = await measureTextLen(f); }
    catch { /* frame 正在导航/已销毁 */ }
  }
  const mainText = await measureTextLen(page);

  const cfg = { mainText, frameTexts, minFrameText: MIN_FRAME_TEXT, textRatio: TEXT_RATIO, minBox: MIN_BOX };
  const { redirect } = await page.evaluate(`(${pageDetect})(${JSON.stringify(cfg)})`);
  if (redirect) log(`重定向门命中: ${redirect.url}（frame ${redirect.frameText} vs 主文档 ${mainText}）`);
  else log('重定向门未命中');
  return { redirect, mainText };
}
