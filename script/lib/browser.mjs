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

/**
 * U2M_PROXY → chromium launch 代理选项。
 * ''（未设置）→ 继承系统代理；'direct' → --no-proxy-server 绕过系统代理；
 * URL（http/socks5 等）→ 显式代理，页面与 APIRequestContext 图片下载统一走它。
 * 真实冒烟教训：系统代理隧道失败时报 net::ERR_TUNNEL_CONNECTION_FAILED，需此开关逃生。
 */
export function proxyLaunchOptions(env = process.env) {
  const v = (env.U2M_PROXY || '').trim();
  if (!v) return {};
  if (v.toLowerCase() === 'direct') return { args: ['--no-proxy-server'] };
  return { proxy: { server: v } };
}

/**
 * goto：domcontentloaded 完成导航，再尽力等待网络静默（waitForLoadState
 * networkidle 封顶 settleMs，等不到不失败）。
 * 教训：networkidle 作为 goto 门条件会被长连接/轮询站点（埋点、WebSocket、
 * heartbeat）确定性卡死——30s 超时×重试+回落曾致 65s 才就绪。静默等待只在
 * 网络确实变静时提前返回，等不到由封顶兜底；真断网时 dcl goto 自会抛错。
 */
export async function gotoSettled(page, url, log = () => {}, opts = {}) {
  const { settleMs = 8000, gotoTimeout = 30000 } = opts;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
  try {
    await page.waitForLoadState('networkidle', { timeout: settleMs });
  } catch {
    log(`networkidle ${settleMs}ms 内未达成（长连接/轮询站点常态），继续`);
  }
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
  settleMs,
  log = () => {},
} = {}) {
  const browser = await chromium.launch({ headless, ...proxyLaunchOptions() });
  try {
    const ctxOpts = { viewport, bypassCSP: true }; // 严格 CSP 页面：addScriptTag/页面内 eval 注入不受页面策略拦截
    if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
    const context = await browser.newContext(ctxOpts);
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue());
    for (const script of initScripts) await context.addInitScript({ content: script });
    const page = await context.newPage();
    await gotoSettled(page, url, log, settleMs === undefined ? {} : { settleMs });
    return {
      browser, context, page,
      close: async () => { try { await context.close(); } finally { await browser.close(); } },
    };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
