// script/lib/snapshot-redirect.mjs
// 步骤 1 重定向门：占优内容 iframe 检测 + 跳转编排。
// 测量（正文长度归一化口径）唯一副本在本模块；判定规则唯一事实源在 page-detect-iframe.js。
import { readSharedScript } from './placeholder.mjs';
import { snapshotLogin } from './snapshot-login.mjs';
import { snapshotScroll } from './snapshot-scroll.mjs';
import { gotoSettled } from './browser.mjs';

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

/**
 * 重定向门编排：检测（仅一次，只判入口原页面）→ 命中则跳转目标页
 * （snapshotLogin 内含 gotoSettled + 登录检测复跑，跨域登录墙时 viewer
 * 开在内容页）→ 退化守卫 → 重新滚动。目标页不再重判（用户裁决）。
 * @returns {Promise<{redirected: boolean, to: string | null}>} to = 目标 URL
 */
export async function runRedirectGate(page, url, opts = {}) {
  const { timeout, storageStatePath: ssPath, scrollRounds, log = () => {} } = opts;
  const detect = await snapshotRedirectDetect(page, { log });
  if (!detect.redirect) return { redirected: false, to: null };

  const login = await snapshotLogin(page, detect.redirect.url, { timeout, storageStatePath: ssPath, log });

  // 退化守卫：目标页独立打开渲染不出内容（如 window.top 检测站）→ 回原页走现状路径
  const targetText = await measureTextLen(page);
  if (targetText < DEGENERATE_RATIO * detect.redirect.frameText) {
    log(`重定向目标正文退化（${targetText} < ${Math.round(DEGENERATE_RATIO * detect.redirect.frameText)}），回退 ${url}`);
    await gotoSettled(page, url, log);
    await snapshotScroll(page, { scrollRounds, log });
    return { redirected: false, to: null, loginSkippedByMemory: login?.loginSkippedByMemory };
  }

  await snapshotScroll(page, { scrollRounds, log });
  return { redirected: true, to: detect.redirect.url, loginSkippedByMemory: login?.loginSkippedByMemory };
}
