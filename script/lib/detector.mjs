// script/lib/detector.mjs
// 登录检测 v2（设计）：六信号两级制 + 登录入口点击探测。
// 强信号 = password / loginConfirmed（点击候选入口后出现全屏弹窗（表单+按钮）
// 或页面跳转）；loginButton（可见入口但点击无确认）只是普通一票。
// cookieMissing 信号已删除——现代站点给匿名会话也种 session/csrf 类 cookie
// （知乎 SESSIONID 假阴性），未登录时又近乎恒真，两个方向都无区分度。
// 人机门禁扩展：①点击探测增加挑战分类——探测点开的是验证码/滑块弹窗
// （reCAPTCHA 弹窗恰好满足旧「全屏登录弹窗」全部判据：dialog+可见+含 input，必然
// 误判 loginConfirmed）或跳转到挑战页时，probe.captcha=true 且不置 loginConfirmed，
// 由 gateCheck 路由到验证码 viewer；②collectSignals 增 allowProbe（false 禁点击
// 探测、保留只读等待——挑战占优页点登录入口无意义）。挑战标记数据来自
// detector-captcha.mjs 唯一数据源，经 JSON 插值注入字符串表达式——数据注入而非
// 逻辑分叉（page-detect-iframe.js 的 cfg 注入同款先例）。
import { URL as Url } from 'node:url';
import {
  CAPTCHA_SELECTORS, CAPTCHA_PREFIX_TAGS,
  DOMINANT_AREA_RATIO, TEXT_CHANNEL_MIN_AREA, SPARSE_TEXT_THRESHOLD,
} from './detector-captcha.mjs';

export const URL_PATTERNS = [
  '/login', '/signin', '/sign-in', '/sign_in', '/auth', '/sso', '/cas/login', '/oauth',
  '/account/login', '/user/login', '/passport/login',
  '[?&]redirect=', '[?&]return_url=', '[?&]returnurl=', '[?&]next=', '[?&]continue=',
];
export const TITLE_KEYWORDS = ['登录', '登陆', '登入', 'sign in', 'signin', 'log in', 'login'];
export const TEXT_KEYWORDS = [
  '忘记密码', '记住我', '自动登录', 'forgot password', 'remember me', 'keep me signed in',
  '没有账号', '注册账号', 'create account', 'sign up',
];

const norm = (u) => {
  try { const x = new Url(u); return `${x.origin}${x.pathname.replace(/\/$/, '')}`; } catch { return u; }
};

/** 强信号：单独命中即判定需登录。 */
const STRONG_SIGNALS = ['password', 'loginConfirmed'];

export const WEAK_SIGNALS = ['url', 'content', 'redirected', 'spa', 'loginButton'];

const SIGNAL_KEYS = [...STRONG_SIGNALS, ...WEAK_SIGNALS];

/**
 * 计分 v2：强信号单票成立，弱信号 ≥2 合议。
 * memorized = login_decisions_skips.json 里该域名的跳过信号名数组——
 * 命中信号**全部**在记忆内才整体豁免（dismissed，用户已裁决为误报且无新证据）；
 * 存在记忆外新信号时，记忆内信号照常态计票（旧证据与新证据合议）。
 */
export function scoreSignals(signals, memorized = []) {
  const hitNames = SIGNAL_KEYS.filter((k) => signals[k]);
  const dismissed = hitNames.length > 0 && hitNames.every((k) => memorized.includes(k));
  const strong = STRONG_SIGNALS.filter((k) => signals[k]);
  return {
    hits: hitNames.length,
    hitNames,
    dismissed,
    needsLogin: !dismissed && (strong.length > 0 || hitNames.length >= 2),
    strong,
  };
}

/**
 * 页面侧探测助手（字符串表达式完整调用形式——Playwright 1.62 evaluate 语义）。
 * 四种模式：
 * - ('find')            收集登录/注册入口候选（≤3，返回文本数组；交互元素看子树
 *                       文本，span/div 看自身直接文本且须指针光标；≤8 字；排除
 *                       退出/登出/切换；checkVisibility 可见）。已知边界：不穿透
 *                       shadow DOM、不读 aria-label。
 * - ('click', i)        重跑同一匹配逻辑点击第 i 个候选（不打标记属性——避免
 *                       data-* 痕迹流进快照产物）。原生 el.click() 绕过视觉遮挡，
 *                       弹窗已盖住按钮时事件仍可达。
 * - ('captcha')         落地页是否处于挑战占优（探测跳转后检查用）——占优双通道
 *                       与 __u2mDetectCaptcha 同口径：裸标记命中会把登录页角落的
 *                       passive badge（约 300×60）误判成挑战、把登录流死锁进
 *                       无跳过的验证码 viewer（修复）。成功态命中的
 *                       厂商整体抑制（已解决滑块不算活跃挑战）。
 * - ('overlay')         全屏弹窗分类，返回 'captcha' | 'login' | false：
 *                       几何判据 fixed/absolute 或 role=dialog、可见、面积 ≥50%
 *                       参照视口（min(clientHeight,1000) 归一——1280×3000 懒加载
 *                       视口下普通 modal 永远够不着绝对 50%）、排除含 main/h1 的
 *                       布局容器（页面级 absolute 包装恰好含搜索框时会假阳性——
 *                       modal 几乎从不包含 main/h1）；命中元素自身或子树含活跃
 *                       挑战标记 → 'captcha'（优先——挑战弹窗常盖在登录 modal
 *                       之上，且滑块弹窗可能无表单元素）；否则含表单元素
 *                       （input/form/textarea）与按钮元素 → 'login'。
 */
const CAPTCHA_MARK_DATA = JSON.stringify({
  vendors: CAPTCHA_SELECTORS.map((v) => ({ vendor: v.vendor, active: v.sel || [], success: v.successSel || [] })),
  prefixes: CAPTCHA_PREFIX_TAGS,
});

/** 'captcha' 模式的占优门控常量（与 page-detect-captcha.js 同源注入，防口径漂移）。 */
const PROBE_DOMINANCE = JSON.stringify({
  areaRatio: DOMINANT_AREA_RATIO,
  textMinArea: TEXT_CHANNEL_MIN_AREA,
  sparseThreshold: SPARSE_TEXT_THRESHOLD,
});

export const PROBE_HELPERS = `(function(mode, arg){
  var INCLUDE = ['登录', '登入', '登陆', '注册', 'log in', 'sign in', 'login', 'register', 'sign-in', 'log-in'];
  var EXCLUDE = ['退出', '登出', 'logout', '切换'];
  var CAPTCHA_VENDORS = ${CAPTCHA_MARK_DATA}.vendors;
  var CAPTCHA_PREFIXES = ${CAPTCHA_MARK_DATA}.prefixes;
  var DOM = ${PROBE_DOMINANCE};
  // 活跃挑战标记收集（厂商分组）：成功态命中 → 该厂商整体抑制（与
  // __u2mDetectCaptcha 的 success 优先同语义——已解决滑块的成功面板残留不算挑战）
  var collectMarkEls = function(root){
    var out = [];
    if (!root) return out;
    for (var v = 0; v < CAPTCHA_VENDORS.length; v++) {
      var spec = CAPTCHA_VENDORS[v];
      var solved = false;
      for (var s = 0; s < (spec.success || []).length; s++) {
        try {
          if (root.matches && root.matches(spec.success[s])) { solved = true; break; }
          if (root.querySelector(spec.success[s])) { solved = true; break; }
        } catch (e) { /* 非法选择器容忍 */ }
      }
      if (solved) continue;
      for (var a = 0; a < (spec.active || []).length; a++) {
        try {
          if (root.matches && root.matches(spec.active[a])) out.push(root);
          var found = root.querySelectorAll(spec.active[a]);
          for (var k = 0; k < found.length; k++) out.push(found[k]);
        } catch (e) { /* 非法选择器容忍 */ }
      }
    }
    var pushIfPrefixed = function(el){
      if (!el.tagName) return;
      var tag = el.tagName.toLowerCase();
      for (var q = 0; q < CAPTCHA_PREFIXES.length; q++) {
        if (tag.indexOf(CAPTCHA_PREFIXES[q]) === 0) { out.push(el); return; }
      }
    };
    pushIfPrefixed(root);
    var inner = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var j = 0; j < inner.length; j++) pushIfPrefixed(inner[j]);
    return out;
  };
  var hasCaptchaMark = function(root){ return collectMarkEls(root).length > 0; };
  var ownText = function(el){
    return Array.from(el.childNodes).filter(function(n){ return n.nodeType === 3; })
      .map(function(n){ return n.textContent; }).join('').trim().toLowerCase();
  };
  var match = function(){
    var out = [];
    var els = document.querySelectorAll('a, button, [role="button"], span, div, li');
    for (var idx = 0; idx < els.length; idx++) {
      var el = els[idx];
      var interactive = el.tagName === 'A' || el.tagName === 'BUTTON' || el.hasAttribute('role');
      var text = interactive ? (el.textContent || '').trim().toLowerCase() : ownText(el);
      if (!text || text.length > 8) continue;
      if (EXCLUDE.some(function(w){ return text.includes(w); })) continue;
      if (!interactive && getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.checkVisibility ? !el.checkVisibility() : el.getClientRects().length === 0) continue;
      if (INCLUDE.some(function(w){ return text.includes(w); })) { out.push({ el: el, text: text }); }
      if (out.length >= 3) break;
    }
    return out;
  };
  if (mode === 'find') return match().map(function(c){ return c.text; });
  if (mode === 'click') {
    var c = match()[arg];
    if (!c) return false;
    c.el.click();
    return true;
  }
  if (mode === 'captcha') {
    // 落地页挑战占优（探测跳转后检查）：占优双通道与 __u2mDetectCaptcha 同口径——
    // 裸标记命中会把登录页角落的 passive badge 误判成挑战（修复）
    var mels = collectMarkEls(document.body || document.documentElement);
    if (!mels.length) return false;
    var vw2 = document.documentElement.clientWidth;
    var vh2 = Math.min(document.documentElement.clientHeight, 1000);
    var maxA = 0;
    for (var m = 0; m < mels.length; m++) {
      var r2 = mels[m].getBoundingClientRect();
      if (r2.width * r2.height > maxA) maxA = r2.width * r2.height;
    }
    if (maxA >= DOM.areaRatio * vw2 * vh2) return true;
    var tlen = ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().length;
    return maxA >= DOM.textMinArea && tlen < DOM.sparseThreshold;
  }
  if (mode === 'overlay') {
    var vw = document.documentElement.clientWidth;
    var vh = Math.min(document.documentElement.clientHeight, 1000);
    var all = document.querySelectorAll('body *');
    var loginFound = false;
    for (var j2 = 0; j2 < all.length; j2++) {
      var el2 = all[j2];
      var cs = getComputedStyle(el2);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var dialog = el2.getAttribute && el2.getAttribute('role') === 'dialog';
      if (cs.position !== 'fixed' && cs.position !== 'absolute' && !dialog) continue;
      var r = el2.getBoundingClientRect();
      if (r.width * r.height < 0.5 * vw * vh) continue;
      if (el2.querySelector('main, h1')) continue;
      if (hasCaptchaMark(el2)) return 'captcha';
      if (!loginFound
          && el2.querySelector('input, form, textarea')
          && el2.querySelector('button, [role="button"], input[type="submit"]')) loginFound = true;
    }
    return loginFound ? 'login' : false;
  }
  return false;
})`;

const findCandidates = (page) =>
  page.evaluate(`${PROBE_HELPERS}('find')`).catch(() => []);

const probeCandidate = async (page, i) => {
  const before = norm(page.url());
  const clicked = await page.evaluate(`${PROBE_HELPERS}('click', ${i})`).catch(() => false);
  if (!clicked) return { clicked: false, confirmed: false, captcha: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    await page.waitForTimeout(300).catch(() => {});
    try {
      if (norm(page.url()) !== before) {
        // 跳转后先查挑战标记：点登录被反爬拦到验证页是常见行为——
        // 计入 loginConfirmed 会把验证码路由进登录 viewer（语义错误）
        const chal = await page.evaluate(`${PROBE_HELPERS}('captcha')`).catch(() => false);
        if (chal) return { clicked: true, confirmed: false, captcha: true };
        return { clicked: true, confirmed: true, method: 'navigate' };
      }
    } catch { /* 导航中 */ }
    const overlay = await page.evaluate(`${PROBE_HELPERS}('overlay')`).catch(() => false);
    if (overlay === 'captcha') return { clicked: true, confirmed: false, captcha: true };
    if (overlay) return { clicked: true, confirmed: true, method: 'modal' };
  }
  return { clicked: true, confirmed: false, captcha: false };
};

export async function collectSignals(page, originalUrl, { spaWaitMs = 5000, includeSpa = true, memorized = [], allowProbe = true } = {}) {
  const signals = { password: false, url: false, content: false, redirected: false, spa: false, loginButton: false, loginConfirmed: false };
  const probe = { clicked: false, confirmed: false, method: null, captcha: false };
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

  signals.redirected = norm(page.url()) !== norm(originalUrl) && (signals.url || signals.password);

  // 登录入口候选（只扫主 frame——广告 iframe 里的「立即注册」不误伤；
  // iframe 内登录表单由 password 信号覆盖，其遍历全部 frames）
  let candidates = await findCandidates(page);
  signals.loginButton = candidates.length > 0;

  /** 逐候选点击探测（每候选整个检测生命周期至多一次，防轮询期反复点击）。返回是否确认/触发挑战。 */
  const runProbe = async (from) => {
    for (let i = from; i < candidates.length; i++) {
      const r = await probeCandidate(page, i);
      if (r.clicked) probe.clicked = true;
      if (r.captcha) {
        // 探测点出挑战弹窗/跳到挑战页——不计 loginConfirmed（懒触发滑块的现场
        // 必须保留，由 gateCheck 路由到验证码 viewer；薄壳 snapshotLogin 不消费）
        probe.captcha = true;
        return true;
      }
      if (r.confirmed) {
        signals.loginConfirmed = true;
        probe.confirmed = true;
        probe.method = r.method;
        return true;
      }
    }
    return false;
  };

  // 探测只在判定未定论、未被记忆豁免且 allowProbe 时执行：
  // - 已定论（password 强信号 / 弱票已够）→ 零页面扰动，不点击任何东西
  // - dismissed（命中全在跳过记忆）→ 用户已裁决为误报，探测会让强信号复活、记忆形同虚设
  // - allowProbe=false（gateCheck 挑战占优页）→ 挑战页上点登录入口无意义且会触发二次风控
  let score = scoreSignals(signals, memorized);
  if (allowProbe && !score.needsLogin && !score.dismissed && candidates.length) await runProbe(0);

  score = scoreSignals(signals, memorized);
  if (includeSpa && !score.needsLogin && !score.dismissed) {
    // 等待窗内两路并行：可见密码框（spa，只读）与迟水合的登录入口（候选轮询 + 探测，受 allowProbe 门控）
    await Promise.all([
      page.waitForSelector('input[type="password"]', { state: 'visible', timeout: spaWaitMs })
        .then(() => { signals.spa = true; })
        .catch(() => { /* 未出现 */ }),
      allowProbe ? (async () => {
        const deadline = Date.now() + spaWaitMs;
        // 进窗前的候选已全部探测过（或本就为空）——窗口内只探测新出现的
        let probedCount = candidates.length;
        while (Date.now() < deadline) {
          if (scoreSignals(signals, memorized).needsLogin) return;
          const found = await findCandidates(page);
          if (found.length) signals.loginButton = true;
          if (found.length > probedCount) {
            candidates = found;
            if (await runProbe(probedCount)) return;
            probedCount = found.length;
          }
          await page.waitForTimeout(400);
        }
      })() : Promise.resolve(),
    ]).catch(() => { /* 页面关闭等异常，未出现处理 */ });
  }
  return { signals, probe };
}

export async function needsLogin(page, originalUrl, opts = {}) {
  const { log = () => {}, memorized = [] } = opts;
  const { signals, probe } = await collectSignals(page, originalUrl, { ...opts, memorized });
  const score = scoreSignals(signals, memorized);
  const strongNote = score.strong.length ? `，强信号 ${score.strong.join('+')}${probe.method ? `（${probe.method}）` : ''}` : '';
  const dismissedNote = score.dismissed ? '，命中全在跳过记忆 → 豁免' : '';
  const captchaNote = probe.captcha ? '，探测触发挑战弹窗/挑战页（gateCheck 路由验证码 viewer）' : '';
  log(`登录检测: ${score.hitNames.length ? score.hitNames.join('+') : '无信号'} 命中（${score.hits}/6）${strongNote}${dismissedNote}${captchaNote} → ${score.needsLogin ? '需要登录' : '已登录'}`);
  return { ...score, signals, probe };
}
