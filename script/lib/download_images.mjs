// script/lib/download_images.mjs
// 步骤 8 图片下载：把骨架 img 条目的远端图片落到 assets/images/。
// 命名规则（沿用旧管线经验：扩展名按 content-type、失败保留原 URL）：
//   - 优先用 URL 文件名（basename 去已知图片扩展名、百分号解码、清洗特殊字符）
//   - 同名冲突带编号：cover.png → cover-1.png → cover-2.png（不同扩展名不冲突）
//   - 扩展名：URL 已知图片扩展名优先，其次响应 content-type，兜底 .png
//   - 空路径/目录结尾/点路径/解码后为空 → 词干回退 image
//   - 同一 URL 只下载一次，多条目共享同一本地文件
//   - 并发限 4（旧管线 design §6.3 经验），命名按文档序分配（与网络完成顺序无关）
import fs from 'node:fs';
import path from 'node:path';

const KNOWN_EXTS = new Map([
  ['.png', '.png'], ['.jpg', '.jpg'], ['.jpeg', '.jpg'], ['.gif', '.gif'],
  ['.webp', '.webp'], ['.svg', '.svg'], ['.avif', '.avif'], ['.bmp', '.bmp'],
  ['.ico', '.ico'], ['.tif', '.tif'], ['.tiff', '.tif'],
]);

const CT_EXTS = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'],
  ['image/webp', '.webp'], ['image/svg+xml', '.svg'], ['image/avif', '.avif'],
  ['image/bmp', '.bmp'], ['image/x-icon', '.ico'], ['image/vnd.microsoft.icon', '.ico'],
  ['image/tiff', '.tif'],
]);

/** URL pathname 的 basename（百分号解码、去查询/哈希）；解析失败返回 ''。 */
function urlBasename(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  try {
    return decodeURIComponent(u.pathname.split('/').pop() || '');
  } catch {
    return u.pathname.split('/').pop() || ''; // 非法编码序列：退回原始片段
  }
}

/**
 * 词干清洗（黑名单制，尽量保留原文件名——CJK 等非 ASCII 合法且常见）：
 * 路径分隔符、Windows 非法字符、控制字符、空白 → _；首尾点剥掉；
 * 清洗后为空/./.. 时由调用方回退。
 */
function sanitizeStem(raw) {
  const s = raw
    .replace(/[\\/\x00-\x1f<>:"|?* ]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  if (!s || s === '.' || s === '..') return '';
  return [...s].length > 100 ? s.slice(0, 100) : s;
}

/** URL → 文件词干：basename 去已知图片扩展名；未知扩展名整体保留。 */
export function imageStemFromUrl(url) {
  const base = urlBasename(url);
  const stem = sanitizeStem(base.replace(/\.[A-Za-z0-9]+$/, (m) => (KNOWN_EXTS.has(m.toLowerCase()) ? '' : m)));
  return stem || 'image';
}

/** URL → 已知图片扩展名（带点、小写归一 jpeg→.jpg）；无则 null。 */
export function extFromUrl(url) {
  const m = urlBasename(url).match(/\.[A-Za-z0-9]+$/);
  if (!m) return null;
  return KNOWN_EXTS.get(m[0].toLowerCase()) ?? null;
}

/** content-type → 扩展名；忽略参数（; charset=...）；未知 null。 */
export function extFromContentType(ct) {
  if (!ct) return null;
  return CT_EXTS.get(ct.split(';')[0].trim().toLowerCase()) ?? null;
}

/** 文件名分配器：首个用原名，同名（词干+扩展名）冲突依次带 -1/-2/... 编号。 */
export class NameAllocator {
  constructor() {
    this.used = new Set();      // 已占用的完整文件名
    this.counters = new Map();  // 'stem|ext' → 已分配次数
  }

  take(stem, ext) {
    const key = `${stem}|${ext}`;
    const n = this.counters.get(key) || 0;
    this.counters.set(key, n + 1);
    let name = n === 0 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    while (this.used.has(name)) name = `${stem}-${++this.counters.get(key)}${ext}`;
    this.used.add(name);
    return name;
  }
}

/** 并发限流的顺序保持 map。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 下载图片到 imagesDir。
 * @param {import('playwright').APIRequestContext} request - 浏览器上下文的 request（共享代理与登录态）
 * @param {string[]} urls - 按文档序去重后的 http(s) URL
 * @param {string} imagesDir - 目标目录（自动创建）
 * @param {{concurrency?: number, timeout?: number, log?: Function}} opts
 * @returns {Promise<{map: Map<string,string>, failed: {url:string, reason:string}[]}>}
 *          map: url → 相对 urlDir 的路径（assets/images/<name>）；单 URL 失败不抛异常，记入 failed
 */
export async function downloadImages(request, urls, imagesDir, { concurrency = 4, timeout = 30000, log = () => {} } = {}) {
  fs.mkdirSync(imagesDir, { recursive: true });
  const bodies = await mapLimit(urls, concurrency, async (url) => {
    try {
      const resp = await request.get(url, { timeout });
      if (!resp.ok()) {
        log(`图片下载失败 HTTP ${resp.status()}: ${url}`);
        return { error: `HTTP ${resp.status()}` };
      }
      return { body: await resp.body(), contentType: resp.headers()['content-type'] };
    } catch (e) {
      log(`图片下载失败: ${url}（${e.message}）`);
      return { error: e.message };
    }
  });

  // 命名按文档序分配，与下载完成顺序无关（结果可复现）
  const relDir = ['assets', 'images'].join('/');
  const allocator = new NameAllocator();
  const map = new Map();
  const failed = [];
  urls.forEach((url, i) => {
    const r = bodies[i];
    if (!r || r.error) {
      failed.push({ url, reason: r ? r.error : 'unknown' });
      return;
    }
    const ext = extFromUrl(url) ?? extFromContentType(r.contentType) ?? '.png';
    const name = allocator.take(imageStemFromUrl(url), ext);
    fs.writeFileSync(path.join(imagesDir, name), r.body);
    map.set(url, `${relDir}/${name}`);
  });
  return { map, failed };
}
