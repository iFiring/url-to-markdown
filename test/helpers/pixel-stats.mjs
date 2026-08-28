// pixelStats：webp 截图像素统计辅助（spec §5 断言 1-6 的底座）。
// 文件读为 base64 注入 chromium 页面 canvas，逐像素统计后只把数值结果带回
// Node——避免把数 MB 像素数组跨 evaluate 边界序列化。浏览器进程跨多次调用
// 复用（模块级惰性单例），测试收尾调 closePixelStats() 关闭。
import fs from 'node:fs';
import { chromium } from 'playwright';

let browserPromise = null;
async function ensureBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

/** 关闭复用浏览器。用完 pixelStats 的测试文件在末尾调用。 */
export async function closePixelStats() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

/**
 * pixelStats(imgPath, queries) → { width, height, [name]: number }
 * queries: [
 *   { name, kind: 'count',   rgb: [r,g,b], tol?=40, rect?=[x,y,w,h] }  匹配像素数（rect 限设备像素矩形）
 *   { name, kind: 'density', rect: [x,y,w,h] }                          区域内与区域众色不同的像素占比
 * ]
 * tol 为每通道容差（抗 webp 有损）；众色按每通道 >>4 的 12bit 量化桶取众数。
 */
export async function pixelStats(imgPath, queries = []) {
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const browser = await ensureBrowser();
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ b64, queries }) => {
      const img = new Image();
      img.src = 'data:image/webp;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const out = { width: c.width, height: c.height };
      for (const q of queries) {
        if (q.kind === 'density') {
          const [rx, ry, rw, rh] = q.rect;
          const buckets = new Map();
          let total = 0;
          for (let y = ry; y < Math.min(ry + rh, c.height); y++) {
            for (let x = rx; x < Math.min(rx + rw, c.width); x++) {
              const i = (y * c.width + x) * 4;
              const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
              buckets.set(key, (buckets.get(key) || 0) + 1);
              total++;
            }
          }
          let modal = 0;
          for (const v of buckets.values()) if (v > modal) modal = v;
          out[q.name] = total > 0 ? 1 - modal / total : 0;
        } else if (q.kind === 'count') {
          const [tr, tg, tb] = q.rgb;
          const tol = q.tol === undefined ? 40 : q.tol;
          let n = 0;
          for (let p = 0; p < c.width * c.height; p++) {
            if (q.rect) {
              const x = p % c.width;
              const y = (p / c.width) | 0;
              if (x < q.rect[0] || x >= q.rect[0] + q.rect[2] || y < q.rect[1] || y >= q.rect[1] + q.rect[3]) continue;
            }
            const i = p * 4;
            if (Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol) n++;
          }
          out[q.name] = n;
        }
      }
      return out;
    }, { b64, queries });
  } finally {
    await page.close();
  }
}
