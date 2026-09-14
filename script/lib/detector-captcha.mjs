// script/lib/detector-captcha.mjs
// 人机门禁检测的 Node 侧编排：厂商挑战标记数据（**唯一数据源**——同时注入
// page-detect-captcha.js 的 cfg 与 detector.mjs PROBE_HELPERS 的字符串插值，
// 两处消费同一常量，无分叉）、同源 frame 扫描。
// 占优/稀薄/iframe URL 特征的判定规则唯一事实源在 page-detect-captcha.js——本模块
// 只做测量编排，严禁把判定逻辑分叉进来。
import { readSharedScript } from './placeholder.mjs';

/**
 * 厂商挑战标记：sel = 活跃挑战 DOM；successSel = 通过后的成功态
 * （成功态可见 → 该厂商视为已通过，不再触发占优——滑块成功后面板残留是常态）。
 * 已知边界：不穿透 shadow DOM（极验 4.x 靠 CAPTCHA_PREFIX_TAGS 宿主标签兜底）。
 */
export const CAPTCHA_SELECTORS = [
  { vendor: 'cloudflare', sel: ['#challenge-form', '.cf-turnstile', '#cf-challenge-running', '[data-cf-challenge]'], successSel: [] },
  { vendor: 'recaptcha', sel: ['#rc-anchor', '.g-recaptcha', 'iframe[src*="recaptcha"]'], successSel: [] },
  { vendor: 'hcaptcha', sel: ['.h-captcha', '#hcaptcha-challenge', 'iframe[src*="hcaptcha"]'], successSel: [] },
  { vendor: 'geetest', sel: ['.geetest_panel', '.geetest_widget', '.geetest_holder', '.geetest_radar_tip', '.geetest_slider_button'], successSel: ['.geetest_panel_success', '.geetest_success'] },
  { vendor: 'alibaba', sel: ['.nc-container', '.nc_scale', '#nc_1_n1z', '#nocaptcha'], successSel: ['.nc-container .btnok', '.nc-container .scale_text2'] },
  { vendor: 'tencent', sel: ['.tcaptcha-popup', '.tcaptcha-container', '#tcaptcha_transform', 'iframe[src*="tcaptcha"]', 'iframe[src*="cap_union"]'], successSel: [] },
  { vendor: 'yidun', sel: ['.yidun_slider', '.yidun-modal', 'iframe[src*="captcha.dun.163"]'], successSel: ['.yidun_slide-success'] },
  { vendor: 'jd', sel: ['.JDJRV-wrap', '.JDJRV-slide', '#JDJRV-wrap'], successSel: [] },
];

/** 自定义元素标签前缀（极验 4.x：宿主标签名在 light DOM 可见，内部 shadow DOM 不穿透）。 */
export const CAPTCHA_PREFIX_TAGS = ['geetest-'];

/**
 * 跨域 iframe 的 URL 挑战特征（字符串正则源，i 标志）——页面侧 querySelector 不可达
 * 跨域 frame 内部（Cloudflare Turnstile / reCAPTCHA anchor 的常态）。主文档侧对
 * iframe 元素自身的 src 匹配 + 可见性 + 面积测量在 page-detect-captcha.js 内完成
 * （判定归一）；本常量同时供 classifyFrameUrl（测试/诊断锚定）消费。
 */
export const CAPTCHA_FRAME_URL_PATTERNS = [
  { vendor: 'recaptcha', pattern: 'recaptcha' },
  { vendor: 'hcaptcha', pattern: 'hcaptcha\\.com' },
  { vendor: 'cloudflare', pattern: 'challenges\\.cloudflare\\.com|_cf_chl' },
  { vendor: 'tencent', pattern: 'cap_union|tcaptcha' },
  { vendor: 'yidun', pattern: 'captcha\\.dun\\.163\\.com' },
  { vendor: 'geetest', pattern: 'geetest\\.com|gcaptcha' },
];

/** 标题关键词（小写子串）。刻意不含裸「验证码」/「请稍候」——讲验证码的文章会误伤。 */
export const CAPTCHA_TITLE_KEYWORDS = [
  'just a moment', 'attention required', 'verify you are human', 'human verification',
  'security check', 'access denied', '安全验证', '人机验证', '正在验证', '验证码拦截',
];

/**
 * 稀薄正文阈值（归一字符数）——挑战 interstitial 通常 <100 字符，而懒加载壳站
 * 在门禁时点一般已有导航/页头/页脚文本；200 保守分界（占优文本通道同用此值）。
 */
export const SPARSE_TEXT_THRESHOLD = 200;

/** 占优面积通道比例：最大命中面积 ≥ 0.35 × clientWidth × min(clientHeight, 1000)。 */
export const DOMINANT_AREA_RATIO = 0.35;

/**
 * 占优文本通道的命中面积下限（px²）：文本通道语义是「整页就是挑战」（interstitial），
 * 表单内嵌 widget / passive badge（约 300×60）配稀薄正文会误伤——低于该下限的命中
 * 不参与文本通道（CF 盾卡/极验弹窗等真挑战卡 ≥200×200 不受影响）。
 */
export const TEXT_CHANNEL_MIN_AREA = 200 * 200;

/** 纯函数：frame/页面 URL → 厂商名（无匹配返回 null）。诊断/测试锚定用。 */
export function classifyFrameUrl(url) {
  if (!url || typeof url !== 'string') return null;
  for (const p of CAPTCHA_FRAME_URL_PATTERNS) if (new RegExp(p.pattern, 'i').test(url)) return p.vendor;
  return null;
}

/**
 * 门禁页面信号采集（只读零扰动，gateCheck 每轮调用）。
 * 采集顺序：同源 frame 复用同一 page 脚本追加采集（跨域抛错吞掉）→ 主 frame 单次
 * 合并 evaluate（自身标记 + iframe src 特征 + 稀薄度 + 标题，sub 帧命中经 cfg 并入）。
 * 主 evaluate 失败（导航竞态/自刷新 interstitial）重试一次后**上抛**——测量失败
 * 不能冒充「无挑战且空页」（否则验证码 recheck 误判通过、稀薄分诊误报 0 字符）。
 * @param {import('playwright').Page} page
 * @param {{log?: Function}} opts
 * @returns {Promise<{captcha:{hits:Array,dominant:boolean,success:boolean,areaChannel:boolean,textChannel:boolean},
 *                    sparse:{textLen:number,hasMain:boolean,hasFrame:boolean,thin:boolean}, titleHit:boolean}>}
 * @throws {Error} 主 frame evaluate 重试后仍失败（页面处于导航/销毁中）
 */
export async function collectGatePageSignals(page, { log = () => {} } = {}) {
  const src = await readSharedScript('page-detect-captcha.js');
  const baseCfg = {
    vendors: CAPTCHA_SELECTORS,
    prefixTags: CAPTCHA_PREFIX_TAGS,
    titleKeywords: CAPTCHA_TITLE_KEYWORDS,
    frameUrlPatterns: CAPTCHA_FRAME_URL_PATTERNS,
    areaRatio: DOMINANT_AREA_RATIO,
    textThreshold: SPARSE_TEXT_THRESHOLD,
    textChannelMinArea: TEXT_CHANNEL_MIN_AREA,
  };

  // 同源 frame（URL 无挑战特征）内部可能藏着 DOM 标记——复用同一 page 脚本采集
  // （复用非分叉）；判定结果（dominant/sparse）只信主文档，这里只并入 hits/success
  const frameHits = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    let furl = '';
    try { furl = f.url(); } catch { continue; }
    if (!furl || furl === 'about:blank' || furl === 'about:srcdoc') continue;
    if (classifyFrameUrl(furl)) continue; // URL 特征命中已由主文档侧按 src 测量，不重复
    try {
      const sub = await f.evaluate(`(${src})(${JSON.stringify({ ...baseCfg, frameHits: [] })})`);
      if (sub?.captcha?.hits?.length) frameHits.push(...sub.captcha.hits);
    } catch { /* 跨域不可达/已销毁 */ }
  }

  let main = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 2 && !main; attempt++) {
    try {
      main = await page.evaluate(`(${src})(${JSON.stringify({ ...baseCfg, frameHits })})`);
    } catch (e) {
      lastErr = e;
      log(`挑战检测主 frame 失败（第 ${attempt + 1} 次）: ${e.message}`);
      if (attempt === 0) await page.waitForTimeout(400).catch(() => {});
    }
  }
  if (!main) throw lastErr;

  return {
    captcha: main.captcha,
    sparse: main.sparse,
    titleHit: main.titleHit,
  };
}
