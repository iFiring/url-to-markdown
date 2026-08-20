// script/lib/snapshot-scroll.mjs
// 步骤 1 滚动阶段：渐进滚动 + DOM 稳定等待

/**
 * 渐进滚动到底再回顶（触发懒加载）+ DOM 稳定等待。
 * 滚动参数必须与 page-detect.js 的 scrollIters/scrollWait 一致（scroll-params 单测守护）。
 * @param {import('playwright').Page} page
 * @param {{scrollRounds?: number}} opts
 */
export async function snapshotScroll(page, opts = {}) {
  const { scrollRounds = 60 } = opts;

  // 渐进滚动
  await page.evaluate(async (rounds) => {
    let last = -1;
    for (let i = 0; i < rounds; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  }, scrollRounds);

  // DOM 稳定：节点数连续 1s 不变
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < 15000) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= 1000) break;
    await page.waitForTimeout(200);
  }
}
