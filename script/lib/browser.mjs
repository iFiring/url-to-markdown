import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export const EMPTY_STATE = { cookies: [], origins: [] };

/** 剔除已过期 cookie（expires>0 且早于 now）。会话 cookie（-1）保留。 */
export function pruneExpired(state, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  const cookies = (state.cookies || []).filter(
    (c) => !(typeof c.expires === 'number' && c.expires > 0 && c.expires < nowSec),
  );
  return { ...state, cookies };
}

/** cookie 按 (name,domain,path)、localStorage 按 origin+name 去重，incoming 覆盖 base。 */
export function mergeStorageState(base = EMPTY_STATE, incoming = EMPTY_STATE) {
  const cookieMap = new Map();
  for (const c of [...(base.cookies || []), ...(incoming.cookies || [])]) {
    cookieMap.set(`${c.name}|${c.domain}|${c.path}`, c);
  }
  const originMap = new Map(); // origin -> Map(name -> entry)
  for (const o of [...(base.origins || []), ...(incoming.origins || [])]) {
    if (!originMap.has(o.origin)) originMap.set(o.origin, new Map());
    const ls = originMap.get(o.origin);
    for (const entry of o.localStorage || []) ls.set(entry.name, entry);
  }
  return {
    cookies: [...cookieMap.values()],
    origins: [...originMap.entries()].map(([origin, ls]) => ({ origin, localStorage: [...ls.values()] })),
  };
}

export async function readStorageState(filePath) {
  try {
    return pruneExpired(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function writeStorageState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

// ===== 浏览器会话（Task 5） =====

/** goto：networkidle 失败重试 1 次；两次失败回落 domcontentloaded + 5s 等待。 */
export async function gotoWithRetry(page, url, log = () => {}, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000, ...opts });
      return;
    } catch (e) {
      lastErr = e;
      log(`goto 失败(${attempt}/2): ${e.message}`);
    }
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // 兜底：README「等待 5S 再开始」
}

/**
 * 打开页面：storageState 存在则注入；route-block media；逐个注入 initScripts（页面脚本级钩子）。
 * 返回 {browser, context, page, close()}。
 */
export async function openPage(url, {
  headless = true,
  viewport = { width: 1280, height: 3000 },
  initScripts = [],
  storageStatePath: ssPath,
  log = () => {},
} = {}) {
  const browser = await chromium.launch({ headless });
  try {
    const ctxOpts = { viewport };
    if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
    const context = await browser.newContext(ctxOpts);
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue());
    for (const script of initScripts) await context.addInitScript({ content: script });
    const page = await context.newPage();
    await gotoWithRetry(page, url, log);
    return {
      browser, context, page,
      close: async () => { try { await context.close(); } finally { await browser.close(); } },
    };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
