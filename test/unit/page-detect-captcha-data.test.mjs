// test/unit/page-detect-captcha-data.test.mjs
// 检测层数据与插值一致性单测（布局相关的判定走集成测试 captcha-detect.test.mjs——
// jsdom 无布局引擎，getClientRects 恒空、innerText 未实现）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTCHA_SELECTORS, CAPTCHA_PREFIX_TAGS, CAPTCHA_TITLE_KEYWORDS,
  CAPTCHA_FRAME_URL_PATTERNS, classifyFrameUrl,
  SPARSE_TEXT_THRESHOLD, DOMINANT_AREA_RATIO, TEXT_CHANNEL_MIN_AREA,
} from '../../script/lib/detector-captcha.mjs';
import { PROBE_HELPERS } from '../../script/lib/detector.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = fs.readFileSync(path.resolve(thisDir, '../../script/lib/page-detect-captcha.js'), 'utf8');

test('page-detect-captcha.js：恰一个具名函数且可解析为表达式', () => {
  assert.ok(pageSrc.includes('function __u2mDetectCaptcha'), '应含具名函数 __u2mDetectCaptcha');
  assert.doesNotThrow(() => new Function(`return (${pageSrc})`), '整文件文本应可包裹为函数表达式（含头注）');
});

test('CAPTCHA_SELECTORS：形状合法（vendor 唯一、sel 非空字符串数组）', () => {
  assert.ok(Array.isArray(CAPTCHA_SELECTORS) && CAPTCHA_SELECTORS.length >= 6);
  const vendors = new Set();
  for (const spec of CAPTCHA_SELECTORS) {
    assert.equal(typeof spec.vendor, 'string');
    assert.ok(!vendors.has(spec.vendor), `vendor 重复: ${spec.vendor}`);
    vendors.add(spec.vendor);
    assert.ok(Array.isArray(spec.sel) && spec.sel.length > 0, `${spec.vendor}.sel 应非空`);
    assert.ok(spec.sel.every((s) => typeof s === 'string' && s.length > 0));
    assert.ok(Array.isArray(spec.successSel));
  }
  // 覆盖设计清单的核心厂商
  for (const v of ['cloudflare', 'recaptcha', 'hcaptcha', 'geetest', 'alibaba', 'tencent', 'yidun', 'jd']) {
    assert.ok(vendors.has(v), `厂商缺失: ${v}`);
  }
  assert.ok(CAPTCHA_PREFIX_TAGS.includes('geetest-'), '极验 4.x 前缀应在清单');
});

test('CAPTCHA_FRAME_URL_PATTERNS：形状合法（字符串正则源，可被页面脚本 RegExp 化）', () => {
  assert.ok(Array.isArray(CAPTCHA_FRAME_URL_PATTERNS) && CAPTCHA_FRAME_URL_PATTERNS.length >= 5);
  for (const p of CAPTCHA_FRAME_URL_PATTERNS) {
    assert.equal(typeof p.vendor, 'string');
    assert.equal(typeof p.pattern, 'string');
    assert.doesNotThrow(() => new RegExp(p.pattern, 'i'), `非法正则源: ${p.pattern}`);
  }
});

test('classifyFrameUrl：各厂商 URL 特征分类 + 无关 URL 返回 null', () => {
  assert.equal(classifyFrameUrl('https://www.google.com/recaptcha/api2/anchor?k=x'), 'recaptcha');
  assert.equal(classifyFrameUrl('https://newassets.hcaptcha.com/captcha/v2/x'), 'hcaptcha');
  assert.equal(classifyFrameUrl('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile'), 'cloudflare');
  assert.equal(classifyFrameUrl('https://ssl.captcha.qq.com/cap_union_new_show'), 'tencent');
  assert.equal(classifyFrameUrl('https://captcha.dun.163.com/tools/ip'), 'yidun');
  assert.equal(classifyFrameUrl('https://static.geetest.com/static/js/x.js'), 'geetest');
  assert.equal(classifyFrameUrl('https://example.com/article/123'), null);
  assert.equal(classifyFrameUrl(''), null);
  assert.equal(classifyFrameUrl(null), null);
});

test('阈值常量：稀薄 200 / 占优面积 0.35 / 文本通道面积下限 200×200（设计裁定值防漂移）', () => {
  assert.equal(SPARSE_TEXT_THRESHOLD, 200);
  assert.equal(DOMINANT_AREA_RATIO, 0.35);
  assert.equal(TEXT_CHANNEL_MIN_AREA, 40000);
  assert.ok(CAPTCHA_TITLE_KEYWORDS.length > 0);
  // 标题关键词不含裸「验证码」/「请稍候」——讲验证码的文章会误伤
  assert.ok(!CAPTCHA_TITLE_KEYWORDS.includes('验证码'));
});

test('PROBE_HELPERS：挑战标记数据插值完整且表达式语法合法', () => {
  // 语法合法（插值破坏字符串表达式 = probe 全挂的回归护栏）
  assert.doesNotThrow(() => new Function(`return ${PROBE_HELPERS}`));
  // 唯一数据源的全部选择器都进了插值（探测 overlay 分类与页面检测同源）
  // 比对 JSON 转义后的形态——含引号选择器（iframe[src*="recaptcha"]）在字符串表达式里是 \" 形态
  const flat = CAPTCHA_SELECTORS.flatMap((v) => [...v.sel, ...v.successSel]);
  for (const sel of flat) {
    const escaped = JSON.stringify(sel).slice(1, -1);
    assert.ok(PROBE_HELPERS.includes(escaped), `PROBE_HELPERS 缺选择器: ${sel}`);
  }
  for (const p of CAPTCHA_PREFIX_TAGS) assert.ok(PROBE_HELPERS.includes(p));
  // 新增的分类模式与助手函数在位
  assert.ok(PROBE_HELPERS.includes("mode === 'captcha'"), '应含 captcha 模式（跳转落地页检查）');
  assert.ok(PROBE_HELPERS.includes('collectMarkEls'), '应含挑战标记收集助手');
  assert.ok(PROBE_HELPERS.includes("return 'captcha'") && PROBE_HELPERS.includes("'login'"),
    'overlay 模式应返回 login|captcha 分类');
  // 占优门控常量同源注入（'captcha' 模式与页面检测同口径）
  for (const c of [DOMINANT_AREA_RATIO, TEXT_CHANNEL_MIN_AREA, SPARSE_TEXT_THRESHOLD]) {
    assert.ok(PROBE_HELPERS.includes(`:${c}`), `PROBE_HELPERS 缺占优常量: ${c}`);
  }
});

test('page-detect-captcha.js：iframe URL 特征与稀薄 thin 判定在共享脚本内（判定归一铁律）', () => {
  assert.ok(pageSrc.includes('frameUrlPatterns'), 'iframe URL 特征检测应在共享脚本内');
  assert.ok(pageSrc.includes('const thin ='), '稀薄 thin 判定应在共享脚本内（.mjs 层只消费）');
});
