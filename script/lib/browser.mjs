import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { debug } from './contract.mjs';

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
 * 浏览器 UA 去无头特征：把无头 UA 的 HeadlessChrome/ 换成 Chrome/。
 * 部分站点（如极客时间，响应头 X-GEEK-WARN: ua black list）按 UA 拉黑无头
 * 浏览器直接回 451 空页——快照拿到 0 元素空文档、登录检测六信号全 0 而误判
 * 已登录。Playwright 1.62 已移除 browser.userAgent()；经 CDP
 * Browser.getVersion 直读即可（实测与 navigator.userAgent 逐字符一致），
 * 无需起临时 context。
 * 注意：只改 UA 字符串不够——sec-ch-ua 头与页面侧 userAgentData 仍带
 * HeadlessChrome 品牌，与 Chrome/ UA 自相矛盾，见 newU2MContext。
 */
export async function realUserAgent(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { userAgent } = await cdp.send('Browser.getVersion');
    return userAgent.replace('HeadlessChrome/', 'Chrome/');
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * 隐身 initScript：抹掉页面脚本可见的剩余无头令牌（网络侧 UA/sec-ch-ua 由
 * newU2MContext 的 context 选项覆盖，这里只管 navigator）。
 * - navigator.webdriver → false（无头默认 true，JS 门禁常用判据）
 * - userAgentData.brands / getHighEntropyValues 的 HeadlessChrome →
 *   Google Chrome：Playwright setUserAgentOverride 不携带 UA-CH 元数据，
 *   brands 仍是浏览器默认无头品牌集
 */
const STEALTH_INIT = `
try {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  const ud = navigator.userAgentData;
  if (ud) {
    // 注意：navigator.userAgentData 每次访问返回新包装对象，补丁必须打在原型上
    const proto = Object.getPrototypeOf(ud);
    const fix = (list) => list.map((b) =>
      b.brand === 'HeadlessChrome' ? { brand: 'Google Chrome', version: b.version } : b);
    const brandsDesc = Object.getOwnPropertyDescriptor(proto, 'brands');
    if (brandsDesc?.get) {
      const origBrands = brandsDesc.get;
      Object.defineProperty(proto, 'brands', { get() { return fix(origBrands.call(this)); }, configurable: true });
    }
    const origHigh = proto.getHighEntropyValues;
    if (typeof origHigh === 'function') {
      proto.getHighEntropyValues = async function (hints) {
        const r = await origHigh.call(this, hints);
        if (Array.isArray(r.brands)) r.brands = fix(r.brands);
        if (Array.isArray(r.brandList)) r.brandList = fix(r.brandList);
        return r;
      };
    }
  }
} catch { /* 尽力而为，不破坏页面 */ }
`;

/**
 * U2M 统一上下文工厂：所有上下文一律从这里创建，指纹与拦截策略只维护一处。
 * - UA 去无头 + sec-ch-ua 头与 UA 版本对齐——只设 userAgent 选项时浏览器仍按
 *   默认无头元数据发 sec-ch-ua（HeadlessChrome 品牌），查客户端提示的站点照样拦
 * - bypassCSP：严格 CSP 站点会拦 addScriptTag/页面内 eval 注入
 * - route-abort media；先注入隐身 initScript，再注入调用方脚本
 * file:// 渲染阶段同样走工厂：不出网时这些覆盖是 no-op，但免去"哪天真要出网
 * 才发现裸上下文退回无头指纹"的隐形约定。
 */
export async function newU2MContext(browser, {
  viewport = { width: 1280, height: 3000 },
  deviceScaleFactor,
  storageState,
  initScripts = [],
} = {}) {
  const ua = await realUserAgent(browser);
  const ver = /Chrome\/(\d+)/.exec(ua)?.[1];
  const ctxOpts = {
    viewport,
    bypassCSP: true,
    userAgent: ua,
    // 与 UA 版本一致的品牌集（真 Chrome 的 Google Chrome + GREASE + Chromium）
    extraHTTPHeaders: { 'sec-ch-ua': `"Google Chrome";v="${ver}", "Chromium";v="${ver}", "Not=A?Brand";v="99"` },
  };
  if (deviceScaleFactor !== undefined) ctxOpts.deviceScaleFactor = deviceScaleFactor;
  if (storageState) ctxOpts.storageState = storageState;
  const context = await browser.newContext(ctxOpts);
  await context.route('**/*', (route) =>
    route.request().resourceType() === 'media' ? route.abort() : route.continue());
  await context.addInitScript({ content: STEALTH_INIT });
  for (const script of initScripts) await context.addInitScript({ content: script });
  return context;
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
  const t = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
  debug(`goto ${url}（${((performance.now() - t) / 1000).toFixed(2)}s）`);
  const t2 = performance.now();
  try {
    await page.waitForLoadState('networkidle', { timeout: settleMs });
    debug(`networkidle 达成（${((performance.now() - t2) / 1000).toFixed(2)}s）`);
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
    // storageState 存在则注入；上下文统一走 newU2MContext（含 UA 去无头）
    const context = await newU2MContext(browser, {
      viewport,
      storageState: ssPath && fsSync.existsSync(ssPath) ? ssPath : undefined,
      initScripts,
    });
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
