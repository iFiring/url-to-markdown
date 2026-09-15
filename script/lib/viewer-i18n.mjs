// script/lib/viewer-i18n.mjs —— viewer UI 双语文案字典（登录/人机验证/稀薄介入三形态）。
// 唯一事实源：三形态静态文案（statics，loginViewerHtml 九参数）+ 公共片段（common：
// WS 连接三状态/默认确认框/reason 标点）+ 动态模板（build：reason/确认框等含 hostname、
// 信号名、字符数的现场拼装）。两语言字典各自手写、结构恒等（unit test 强制 walker 对照）——
// 全/半角标点与括号形状本就因语言而异，不做共享工厂。
// 语言解析：resolveViewerLang() = U2M_LANG 环境变量（白名单 en/zh，非法值静默回落）
// > locale.mjs 导出标记 > 'en'。每次调用时求值（不做模块级 const）——直连测试可进程内翻转 env。
// 边界：仅 viewer HTML 内用户可见文字走本字典；stderr 调试行恒中文（调用点各自保留，
// snapshot-gate.mjs 的 vendorNote 即 log 专用中文版，与本模块 captchaReason 分立）。
// builder 只收纯数据（不 import detector/gate——防循环依赖）：WEAK_SIGNALS 过滤、
// SPARSE_SIGNAL 传参均留在调用点。
import { SKILL_LOCALE } from './locale.mjs';

/** viewer UI 语言：U2M_LANG > 导出标记 SKILL_LOCALE > 'en'；fail-soft 不炸单行 JSON 契约。 */
export function resolveViewerLang() {
  const fromEnv = String(process.env.U2M_LANG ?? '').trim().toLowerCase();
  if (fromEnv === 'en' || fromEnv === 'zh') return fromEnv;
  return SKILL_LOCALE === 'zh' ? 'zh' : 'en';
}

// —— 英文字典 ——

const EN_LOGIN_FRAG = {
  strongNames: { password: 'password field', loginConfirmed: 'login entry click confirmed' },
  methodNames: { modal: 'fullscreen modal', navigate: 'redirect to login page' },
  memorizedTag: '(memorized)',
  listJoiner: ', ',
};
const EN_CAPTCHA_FRAG = { vendorUnknown: 'unknown type', vendorJoiner: ', ' };

const EN = {
  common: {
    connectingText: 'Connecting…',
    connectedText: 'Connected',
    disconnectedText: 'Connection lost',
    defaultSkipConfirm: 'Skip login? The page will be converted as-is without opening the login flow.',
    reasonSep: '. ',
    reasonEnd: '.',
  },
  login: {
    statics: {
      title: 'url-to-markdown Login',
      headingText: '🖥️ Remote Page Login',
      doneText: '✅ Login Done',
      skipText: '⏭️ Skip Login',
      infoText: 'Log in inside the canvas, then click “Login Done”. Click the canvas to type; use the wheel to scroll.',
      reasonHint: 'If no login is needed, click “Skip Login”',
      recheckFailedText: 'Login not detected yet — please continue',
      checkingText: 'Checking login state…',
      skippingText: 'Skipping login, continuing…',
    },
    frag: EN_LOGIN_FRAG,
  },
  captcha: {
    statics: {
      title: 'url-to-markdown Human Verification',
      headingText: '🛡️ Human Verification',
      doneText: '✅ Verification Done',
      skipText: null, // 无跳过按钮（挑战页抓下来必然是垃圾产物）——null 语义见 loginViewerHtml
      infoText: 'Complete the human verification in the canvas (drag the slider / click to verify), then click “Verification Done”. Closing this window aborts the conversion.',
      reasonHint: null,
      recheckFailedText: 'Challenge still detected — please continue',
      checkingText: 'Checking challenge state…',
      skippingText: 'Continuing conversion…', // 无跳过按钮时不可达，仅为结构恒等
    },
    frag: EN_CAPTCHA_FRAG,
  },
  sparse: {
    statics: {
      title: 'url-to-markdown Manual Confirmation',
      headingText: '🔍 Page Content Check',
      doneText: '✅ Page OK, Continue',
      skipText: '⏭️ Continue Anyway',
      infoText: 'Check the page: if it needs human verification, complete it in the canvas and click “Page OK, Continue”; if the page is genuinely empty, click “Continue Anyway”.',
      reasonHint: null,
      recheckFailedText: 'Body text still insufficient — please continue',
      checkingText: 'Recording…',
      skippingText: 'Continuing conversion…',
    },
    frag: {},
  },
  build: {
    loginReason: ({ result, memorized }) => {
      const strong = result.strong
        .map((k) => (k === 'loginConfirmed' && result.probe?.method)
          ? `${EN_LOGIN_FRAG.strongNames[k] ?? k} (${EN_LOGIN_FRAG.methodNames[result.probe.method] || result.probe.method})`
          : (EN_LOGIN_FRAG.strongNames[k] || k))
        .join(EN_LOGIN_FRAG.listJoiner);
      const hitList = result.hitNames
        .map((k) => (memorized.includes(k) ? `${k} ${EN_LOGIN_FRAG.memorizedTag}` : k))
        .join(EN_LOGIN_FRAG.listJoiner);
      return `Login signals detected: ${strong} | votes ${result.hits}/6: ${hitList}`;
    },
    loginSkipConfirm: ({ hostname, weakHits }) => (weakHits.length
      ? `Skip login? Will remember for ${hostname}: ${weakHits.join(EN_LOGIN_FRAG.listJoiner)} — while all future hits are memorized this window will not reopen; new signals are still counted as usual. Strong signals are never remembered.`
      : 'Skip login? Triggered by strong signals only (nothing is remembered) — this skip applies to the current conversion only; the window may reopen next time.'),
    captchaReason: ({ vendors, textLen }) => {
      const v = vendors.length ? vendors.join(EN_CAPTCHA_FRAG.vendorJoiner) : EN_CAPTCHA_FRAG.vendorUnknown;
      return `Human verification challenge detected: ${v} (page body ${textLen} chars)`;
    },
    sparseReason: ({ textLen, httpStatus }) => {
      const suspicion = (httpStatus !== null && httpStatus !== undefined && httpStatus !== 200)
        ? `HTTP ${httpStatus} — access appears blocked`
        : 'the page may genuinely be empty';
      return `Page body is only ${textLen} chars with no main structure (${suspicion})`;
    },
    sparseSkipConfirm: ({ hostname, signal }) => `Continue anyway? Will remember the ${signal} signal for ${hostname} — thin-body pages on this site will proceed without this window; known verification challenges or login signals are still handled as usual.`,
  },
};

// —— 中文字典（现有文案逐字搬运）——

const ZH_LOGIN_FRAG = {
  strongNames: { password: '密码框', loginConfirmed: '登录入口点击确认' },
  methodNames: { modal: '全屏弹窗', navigate: '跳转登录页' },
  memorizedTag: '(记忆内)',
  listJoiner: '、',
};
const ZH_CAPTCHA_FRAG = { vendorUnknown: '未知类型', vendorJoiner: '、' };

const ZH = {
  common: {
    connectingText: '连接中…',
    connectedText: '已连接',
    disconnectedText: '连接已断开',
    defaultSkipConfirm: '确认跳过登录？将不打开登录流程、直接继续转换本次页面。',
    reasonSep: '。',
    reasonEnd: '。',
  },
  login: {
    statics: {
      title: 'url-to-markdown 登录',
      headingText: '🖥️ 远程页面登录',
      doneText: '✅ 登录完成',
      skipText: '⏭️ 跳过登录',
      infoText: '在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。',
      reasonHint: '若无需登录可点「跳过登录」',
      recheckFailedText: '仍未检测到登录态，请继续',
      checkingText: '检测登录态中…',
      skippingText: '跳过登录，继续转换…',
    },
    frag: ZH_LOGIN_FRAG,
  },
  captcha: {
    statics: {
      title: 'url-to-markdown 人机验证',
      headingText: '🛡️ 人机验证',
      doneText: '✅ 验证完成',
      skipText: null, // 无跳过按钮（挑战页抓下来必然是垃圾产物）——null 语义见 loginViewerHtml
      infoText: '请在画面中完成人机验证（支持拖动滑块/点击验证），完成后点「验证完成」。关闭窗口将终止本次转换。',
      reasonHint: null,
      recheckFailedText: '仍检测到验证挑战，请继续完成',
      checkingText: '检测挑战状态中…',
      skippingText: '继续转换…', // 无跳过按钮时不可达，仅为结构恒等
    },
    frag: ZH_CAPTCHA_FRAG,
  },
  sparse: {
    statics: {
      title: 'url-to-markdown 人工确认',
      headingText: '🔍 页面内容确认',
      doneText: '✅ 页面正常，继续',
      skipText: '⏭️ 仍然继续',
      infoText: '请确认页面状态：需要人机验证就在画面中完成它，然后点「页面正常，继续」；页面本就为空则点「仍然继续」。',
      reasonHint: null,
      recheckFailedText: '正文仍不足，请继续确认',
      checkingText: '记录中…',
      skippingText: '继续转换…',
    },
    frag: {},
  },
  build: {
    loginReason: ({ result, memorized }) => {
      const strong = result.strong
        .map((k) => (k === 'loginConfirmed' && result.probe?.method)
          ? `${ZH_LOGIN_FRAG.strongNames[k] ?? k}（${ZH_LOGIN_FRAG.methodNames[result.probe.method] || result.probe.method}）`
          : (ZH_LOGIN_FRAG.strongNames[k] || k))
        .join(ZH_LOGIN_FRAG.listJoiner);
      const hitList = result.hitNames
        .map((k) => (memorized.includes(k) ? `${k}${ZH_LOGIN_FRAG.memorizedTag}` : k))
        .join(ZH_LOGIN_FRAG.listJoiner);
      return `检测到登录信号: ${strong}｜票数 ${result.hits}/6：${hitList}`;
    },
    loginSkipConfirm: ({ hostname, weakHits }) => (weakHits.length
      ? `确认跳过登录？将记住：${hostname} 的 ${weakHits.join(ZH_LOGIN_FRAG.listJoiner)} 信号——后续命中全部在记忆内时不再弹本窗口；出现新信号仍会照常计票。强信号不记忆。`
      : '确认跳过登录？本次仅由强信号触发（不写入记忆），跳过只对本次转换生效，下次可能再次弹出。'),
    captchaReason: ({ vendors, textLen }) => {
      const v = vendors.length ? vendors.join(ZH_CAPTCHA_FRAG.vendorJoiner) : ZH_CAPTCHA_FRAG.vendorUnknown;
      return `检测到人机验证挑战: ${v}（页面正文 ${textLen} 字符）`;
    },
    sparseReason: ({ textLen, httpStatus }) => {
      const suspicion = (httpStatus !== null && httpStatus !== undefined && httpStatus !== 200)
        ? `HTTP ${httpStatus}，疑似访问被拦截`
        : '也可能是本就内容为空的页面';
      return `页面正文仅 ${textLen} 字符且无主体结构（${suspicion}）`;
    },
    sparseSkipConfirm: ({ hostname, signal }) => `确认仍然继续？将记住：${hostname} 的 ${signal} 信号——后续该站正文稀薄时不再弹本窗口、直接继续转换；出现已知验证挑战或登录信号时仍会照常处理。`,
  },
};

/** 两语言字典（结构恒等由 test/unit/viewer-i18n.test.mjs 的递归 walker 强制）。 */
export const TEXT = { en: EN, zh: ZH };

/** 取语言字典；lang 缺省或非法时回落 resolveViewerLang()（fail-soft）。 */
export const viewerText = (lang) => TEXT[lang] ?? TEXT[resolveViewerLang()];
