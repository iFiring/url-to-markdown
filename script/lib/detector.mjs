// script/lib/detector.mjs
import { URL as Url } from 'node:url';

export const URL_PATTERNS = [
  '/login', '/signin', '/sign-in', '/sign_in', '/auth', '/sso', '/cas/login', '/oauth',
  '/account/login', '/user/login', '/passport/login',
  '[?&]redirect=', '[?&]return_url=', '[?&]returnurl=', '[?&]next=', '[?&]continue=',
];
export const USERNAME_SELECTORS = [
  'input[type="email"]', 'input[name*="user"]', 'input[name*="account"]', 'input[name*="email"]',
  'input[name*="login"]', 'input[id*="user"]', 'input[id*="account"]', 'input[id*="email"]',
  'input[placeholder*="用户名"]', 'input[placeholder*="账号"]', 'input[placeholder*="邮箱"]', 'input[placeholder*="手机号"]',
  'input[placeholder*="username"]', 'input[placeholder*="email"]', 'input[autocomplete="username"]', 'input[autocomplete="email"]',
];
export const TITLE_KEYWORDS = ['登录', '登陆', '登入', 'sign in', 'signin', 'log in', 'login'];
export const TEXT_KEYWORDS = [
  '忘记密码', '记住我', '自动登录', 'forgot password', 'remember me', 'keep me signed in',
  '没有账号', '注册账号', 'create account', 'sign up',
];
export const AUTH_COOKIE_PATTERNS = [
  'token', 'session', 'jwt', 'auth', 'sid', 'csrf', 'access_token', 'refresh_token', 'ssoid',
];

const norm = (u) => {
  try { const x = new Url(u); return `${x.origin}${x.pathname.replace(/\/$/, '')}`; } catch { return u; }
};

/** 强信号：单独命中即判定需登录；demoted = 用户已裁决为 skip 的强信号（按域名记忆），在该域名视为不存在——不单票、不计票。 */
const STRONG_SIGNALS = ['password', 'loginButton'];

/** 强信号单票成立，其余 ≥2 项命中判定需登录（README/spec 裁决）。 */
export function scoreSignals(signals, demoted = []) {
  const keys = ['password', 'url', 'content', 'cookieMissing', 'redirected', 'spa', 'loginButton'];
  const hits = keys.filter((k) => signals[k] && !demoted.includes(k)).length;
  const strong = STRONG_SIGNALS.filter((k) => signals[k] && !demoted.includes(k));
  return { hits, needsLogin: strong.length > 0 || hits >= 2, strong };
}

/**
 * 登录/注册入口匹配（只扫主 frame——广告 iframe 里的「立即注册」不误伤；
 * iframe 内登录表单由 password 信号覆盖，其遍历全部 frames）。
 * 交互元素（a/button/[role=button]）看子树文本；其余元素（Vue/React 常用
 * span/div 实现按钮——真实站实测：极客时间登录注册入口即 cursor:pointer
 * 的 span，无 role 无 onclick 属性）看自身直接文本且须有指针光标佐证交互性。
 * 长度上限挡「登录后查看全文」类长文案；EXCLUDE 排除「退出登录」等已登录态
 * 文案；可见性用 checkVisibility（Chromium 105+，连 visibility:hidden 一起
 * 挡，比 getClientRects 严）。已知边界：不穿透 shadow DOM、不读 aria-label。
 */
const matchLoginButton = (page) => page.evaluate(() => {
  const INCLUDE = ['登录', '登入', '登陆', '注册', 'log in', 'sign in', 'login', 'register', 'sign-in', 'log-in'];
  const EXCLUDE = ['退出', '登出', 'logout', '切换'];
  const ownText = (el) => Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim().toLowerCase();
  for (const el of document.querySelectorAll('a, button, [role="button"], span, div, li')) {
    const interactive = el.tagName === 'A' || el.tagName === 'BUTTON' || el.hasAttribute('role');
    const text = interactive ? (el.textContent || '').trim().toLowerCase() : ownText(el);
    if (!text || text.length > 8) continue;
    if (EXCLUDE.some((w) => text.includes(w))) continue;
    if (!interactive && getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.checkVisibility ? !el.checkVisibility() : el.getClientRects().length === 0) continue;
    if (INCLUDE.some((w) => text.includes(w))) return true;
  }
  return false;
}).catch(() => false);

export async function collectSignals(page, context, originalUrl, { spaWaitMs = 5000, includeSpa = true, demoted = [] } = {}) {
  const signals = { password: false, url: false, content: false, cookieMissing: false, redirected: false, spa: false, loginButton: false };
  const currentUrl = page.url().toLowerCase();
  signals.url = URL_PATTERNS.some((p) => new RegExp(p).test(currentUrl));

  for (const f of page.frames()) { // 遍历全部 frames（含 iframe 内登录表单）
    if (await f.locator('input[type="password"]').count() > 0) { signals.password = true; break; }
  }

  // 登录/注册入口（强信号）：检测时刻一次；未定论时在 spa 等待窗内轮询——
  // SPA 迟水合（真实站实测：极客时间偶发 networkidle 提前达成、检测跑在
  // 头部渲染完成之前）会让一次性检查随机扑空
  signals.loginButton = await matchLoginButton(page);

  try {
    const title = (await page.title()).toLowerCase();
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000).toLowerCase();
    // 标题关键词只匹配 <title>，文本关键词只匹配正文——避免"已登录状态"这类正文误命中 '登录'
    signals.content = TITLE_KEYWORDS.some((k) => title.includes(k)) || TEXT_KEYWORDS.some((k) => body.includes(k));
  } catch { /* 忽略 */ }

  if (context) {
    const cookies = await context.cookies();
    const names = cookies.map((c) => c.name.toLowerCase());
    signals.cookieMissing = !names.some((n) => AUTH_COOKIE_PATTERNS.some((p) => n.includes(p)));
  }

  signals.redirected = norm(page.url()) !== norm(originalUrl) && (signals.url || signals.password);

  if (includeSpa && !scoreSignals(signals, demoted).needsLogin) {
    // 等待窗内两路并行：可见密码框（spa）与迟水合的登录入口（loginButton 轮询）
    await Promise.all([
      page.waitForSelector('input[type="password"]', { state: 'visible', timeout: spaWaitMs })
        .then(() => { signals.spa = true; })
        .catch(() => { /* 未出现 */ }),
      (async () => {
        const deadline = Date.now() + spaWaitMs;
        while (!signals.loginButton && Date.now() < deadline) {
          if (await matchLoginButton(page)) { signals.loginButton = true; break; }
          await page.waitForTimeout(400);
        }
      })(),
    ]).catch(() => { /* 页面关闭等异常，未出现处理 */ });
  }
  return signals;
}

export async function needsLogin(page, context, originalUrl, opts = {}) {
  const { log = () => {}, demoted = [] } = opts;
  const signals = await collectSignals(page, context, originalUrl, { ...opts, demoted });
  const score = scoreSignals(signals, demoted);
  const hits = Object.keys(signals).filter((k) => signals[k]);
  const strongNote = score.strong.length ? `，强信号 ${score.strong.join('+')}` : '';
  log(`登录检测: ${hits.length ? hits.join('+') : '无信号'} 命中（${score.hits}/7）${strongNote} → ${score.needsLogin ? '需要登录' : '已登录'}`);
  return { ...score, signals };
}
