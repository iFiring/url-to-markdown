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

/** ≥2 项命中判定需登录（README/spec 裁决）。 */
export function scoreSignals(signals) {
  const keys = ['password', 'url', 'content', 'cookieMissing', 'redirected', 'spa'];
  const hits = keys.filter((k) => signals[k]).length;
  return { hits, needsLogin: hits >= 2 };
}

export async function collectSignals(page, context, originalUrl, { spaWaitMs = 5000, includeSpa = true } = {}) {
  const signals = { password: false, url: false, content: false, cookieMissing: false, redirected: false, spa: false };
  const currentUrl = page.url().toLowerCase();
  signals.url = URL_PATTERNS.some((p) => new RegExp(p).test(currentUrl));

  for (const f of page.frames()) { // 遍历全部 frames（含 iframe 内登录表单）
    if (await f.locator('input[type="password"]').count() > 0) { signals.password = true; break; }
  }

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

  if (includeSpa && !scoreSignals(signals).needsLogin) {
    try {
      await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: spaWaitMs });
      signals.spa = true;
    } catch { /* 未出现 */ }
  }
  return signals;
}

export async function needsLogin(page, context, originalUrl, opts = {}) {
  const { log = () => {} } = opts;
  const signals = await collectSignals(page, context, originalUrl, opts);
  const score = scoreSignals(signals);
  const hits = Object.keys(signals).filter((k) => signals[k]);
  log(`登录检测: ${hits.length ? hits.join('+') : '无信号'} 命中（${score.hits}/6）→ ${score.needsLogin ? '需要登录' : '已登录'}`);
  return { ...score, signals };
}
