// test/unit/viewer-i18n.test.mjs
// viewer UI 双语字典：两语言结构恒等（递归 walker）、resolveViewerLang 优先级、
// 动态模板金样、null 语义（skipText/reasonHint 显式 null ≠ undefined）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT, viewerText, resolveViewerLang } from '../../script/lib/viewer-i18n.mjs';

// env 操作一律 try/finally 还原（runScript 透传 process.env，防泄漏进其它测试）
const withEnv = (name, value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const prev = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    return fn();
  } finally {
    if (had) process.env[name] = prev;
    else delete process.env[name];
  }
};

// —— 结构恒等 ——

const isLeaf = (v) => typeof v !== 'object' || v === null;

function assertSameShape(a, b, path) {
  assert.equal(isLeaf(a), isLeaf(b), `${path}: 叶子性不一致`);
  if (isLeaf(a)) {
    assert.equal(typeof a, typeof b, `${path}: 类型不一致`);
    if (typeof a === 'string') assert.ok(a.length > 0, `${path}: 空字符串`);
    if (typeof a === 'function') assert.equal(a.length, b.length, `${path}: 函数形参数不一致`);
    return;
  }
  if (a === null || b === null) {
    assert.equal(a, b, `${path}: null 语义必须两侧一致（skipText/reasonHint）`);
    return;
  }
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: key 集不一致`);
  for (const k of Object.keys(a)) assertSameShape(a[k], b[k], `${path}.${k}`);
}

test('viewer-i18n：en/zh 字典结构恒等（key 集/叶子类型/函数 arity）', () => {
  assertSameShape(TEXT.en, TEXT.zh, 'TEXT');
});

test('viewer-i18n：statics 九键与 loginViewerHtml 消费清单对照', () => {
  const expected = ['title', 'headingText', 'doneText', 'skipText', 'infoText',
    'reasonHint', 'recheckFailedText', 'checkingText', 'skippingText'].sort();
  for (const lang of ['en', 'zh']) {
    for (const shape of ['login', 'captcha', 'sparse']) {
      assert.deepEqual(Object.keys(TEXT[lang][shape].statics).sort(), expected,
        `${lang}.${shape}.statics 键集`);
    }
  }
});

test('viewer-i18n：captcha/sparse 的 null 语义显式（防手滑写 undefined）', () => {
  for (const lang of ['en', 'zh']) {
    assert.equal(TEXT[lang].captcha.statics.skipText, null, 'captcha 无跳过按钮 = 显式 null');
    assert.equal(TEXT[lang].captcha.statics.reasonHint, null);
    assert.equal(TEXT[lang].sparse.statics.reasonHint, null);
    assert.ok('skipText' in TEXT[lang].captcha.statics);
  }
});

// —— resolveViewerLang 优先级 ——

test('resolveViewerLang：U2M_LANG > 导出标记 > en（源仓库标记恒 en）', () => {
  withEnv('U2M_LANG', 'zh', () => assert.equal(resolveViewerLang(), 'zh'));
  withEnv('U2M_LANG', 'ZH ', () => assert.equal(resolveViewerLang(), 'zh', '大小写/空白归一'));
  withEnv('U2M_LANG', 'en', () => assert.equal(resolveViewerLang(), 'en'));
  withEnv('U2M_LANG', 'fr', () => assert.equal(resolveViewerLang(), 'en', '非法值静默回落标记（源仓库=en）'));
  withEnv('U2M_LANG', '', () => assert.equal(resolveViewerLang(), 'en'));
  withEnv('U2M_LANG', undefined, () => assert.equal(resolveViewerLang(), 'en', '未设=回落标记'));
});

test('viewerText：缺省参数走 resolveViewerLang，非法 lang fail-soft', () => {
  withEnv('U2M_LANG', 'zh', () => assert.equal(viewerText(), TEXT.zh));
  withEnv('U2M_LANG', undefined, () => assert.equal(viewerText(), TEXT.en));
  assert.equal(viewerText('fr'), viewerText(), '非法 lang 回落当前解析语言');
  assert.equal(viewerText('zh'), TEXT.zh);
});

// —— builder 金样 ——

const loginResult = {
  strong: ['loginConfirmed'],
  probe: { method: 'modal' },
  hits: 3,
  hitNames: ['loginConfirmed', 'loginButton', 'spa'],
};

test('build.loginReason：强信号带形态括注、记忆内标注、票数（两语言）', () => {
  assert.equal(TEXT.zh.build.loginReason({ result: loginResult, memorized: ['loginButton'] }),
    '检测到登录信号: 登录入口点击确认（全屏弹窗）｜票数 3/6：loginConfirmed、loginButton(记忆内)、spa');
  assert.equal(TEXT.en.build.loginReason({ result: loginResult, memorized: ['loginButton'] }),
    'Login signals detected: login entry click confirmed (fullscreen modal) | votes 3/6: loginConfirmed, loginButton (memorized), spa');
  // 强信号名兜底：未知 key 原样、无 method 时不带括注
  const plain = { strong: ['password'], probe: {}, hits: 1, hitNames: ['password'] };
  assert.equal(TEXT.zh.build.loginReason({ result: plain, memorized: [] }),
    '检测到登录信号: 密码框｜票数 1/6：password');
  assert.equal(TEXT.en.build.loginReason({ result: plain, memorized: [] }),
    'Login signals detected: password field | votes 1/6: password');
});

test('build.loginSkipConfirm：弱信号/强信号两变体（两语言）', () => {
  assert.equal(TEXT.zh.build.loginSkipConfirm({ hostname: 'www.zhihu.com', weakHits: ['url', 'content'] }),
    '确认跳过登录？将记住：www.zhihu.com 的 url、content 信号——后续命中全部在记忆内时不再弹本窗口；出现新信号仍会照常计票。强信号不记忆。');
  assert.equal(TEXT.zh.build.loginSkipConfirm({ hostname: 'x.com', weakHits: [] }),
    '确认跳过登录？本次仅由强信号触发（不写入记忆），跳过只对本次转换生效，下次可能再次弹出。');
  const en = TEXT.en.build.loginSkipConfirm({ hostname: 'www.zhihu.com', weakHits: ['url', 'content'] });
  assert.ok(en.includes('www.zhihu.com') && en.includes('url, content') && en.startsWith('Skip login?'));
  const enStrong = TEXT.en.build.loginSkipConfirm({ hostname: 'x.com', weakHits: [] });
  assert.ok(enStrong.includes('strong signals only') && enStrong.includes('nothing is remembered'));
});

test('build.captchaReason：厂商清单 join 与未知兜底（两语言）', () => {
  assert.equal(TEXT.zh.build.captchaReason({ vendors: ['geetest', 'cloudflare'], textLen: 42 }),
    '检测到人机验证挑战: geetest、cloudflare（页面正文 42 字符）');
  assert.equal(TEXT.zh.build.captchaReason({ vendors: [], textLen: 0 }),
    '检测到人机验证挑战: 未知类型（页面正文 0 字符）');
  assert.equal(TEXT.en.build.captchaReason({ vendors: ['geetest'], textLen: 42 }),
    'Human verification challenge detected: geetest (page body 42 chars)');
  assert.equal(TEXT.en.build.captchaReason({ vendors: [], textLen: 0 }),
    'Human verification challenge detected: unknown type (page body 0 chars)');
});

test('build.sparseReason：HTTP 状态分诊两 suspicion（两语言）', () => {
  assert.equal(TEXT.zh.build.sparseReason({ textLen: 30, httpStatus: 403 }),
    '页面正文仅 30 字符且无主体结构（HTTP 403，疑似访问被拦截）');
  assert.equal(TEXT.zh.build.sparseReason({ textLen: 30, httpStatus: 200 }),
    '页面正文仅 30 字符且无主体结构（也可能是本就内容为空的页面）');
  assert.equal(TEXT.zh.build.sparseReason({ textLen: 30, httpStatus: null }),
    '页面正文仅 30 字符且无主体结构（也可能是本就内容为空的页面）');
  assert.equal(TEXT.en.build.sparseReason({ textLen: 30, httpStatus: 503 }),
    'Page body is only 30 chars with no main structure (HTTP 503 — access appears blocked)');
  assert.equal(TEXT.en.build.sparseReason({ textLen: 30, httpStatus: 200 }),
    'Page body is only 30 chars with no main structure (the page may genuinely be empty)');
});

test('build.sparseSkipConfirm：hostname/signal 注入（两语言）', () => {
  assert.equal(TEXT.zh.build.sparseSkipConfirm({ hostname: 'a.com', signal: 'content_sparse' }),
    '确认仍然继续？将记住：a.com 的 content_sparse 信号——后续该站正文稀薄时不再弹本窗口、直接继续转换；出现已知验证挑战或登录信号时仍会照常处理。');
  const en = TEXT.en.build.sparseSkipConfirm({ hostname: 'a.com', signal: 'content_sparse' });
  assert.ok(en.includes('a.com') && en.includes('content_sparse') && en.startsWith('Continue anyway?'));
});

// —— 默认确认框 / WS 三状态非空且两语言各自语言字符 ——

test('common：WS 三状态与默认确认框两语言非空', () => {
  for (const lang of ['en', 'zh']) {
    const c = TEXT[lang].common;
    for (const k of ['connectingText', 'connectedText', 'disconnectedText', 'defaultSkipConfirm', 'reasonSep', 'reasonEnd']) {
      assert.ok(typeof c[k] === 'string' && c[k].length > 0, `${lang}.common.${k}`);
    }
  }
  assert.match(TEXT.zh.common.connectingText, /[一-鿿]/, 'zh 状态文案应为中文');
  assert.doesNotMatch(TEXT.en.common.connectingText, /[一-鿿]/, 'en 状态文案不应含汉字');
});
