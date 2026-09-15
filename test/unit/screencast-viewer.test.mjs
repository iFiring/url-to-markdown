// test/unit/screencast-viewer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openViewerCommand, loginViewerHtml } from '../../script/lib/screencast.mjs';

// 密闭性：本文件断言默认语言（en）文案——清掉开发 shell 可能设的 U2M_LANG
//（node --test 每文件独立进程，删除只影响本文件）；覆盖用例经 withEnv 显式设置。
delete process.env.U2M_LANG;

// env 操作一律 try/finally 还原（防泄漏进其它测试）
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

test('openViewerCommand：三平台命令分派', () => {
  assert.deepEqual(openViewerCommand('darwin', 'http://x'),
    { cmd: 'open', args: ['http://x'] });
  assert.deepEqual(openViewerCommand('win32', 'http://x'),
    { cmd: 'cmd', args: ['/c', 'start', '', 'http://x'] });
  assert.deepEqual(openViewerCommand('linux', 'http://x'),
    { cmd: 'xdg-open', args: ['http://x'] });
});

test('viewer HTML：跳过按钮经确认框门控，确认文案服务端注入', () => {
  const html = loginViewerHtml({ skipConfirmText: '将记住：www.zhihu.com 的 url、content 信号' });
  assert.ok(html.includes('confirm('), '跳过必须先过 confirm 确认框');
  assert.ok(html.includes('将记住：www.zhihu.com 的 url、content 信号'), '确认文案应注入页面');
  // 确认文案经 JSON 注入 script，含引号/尖括号也不破坏页面
  const evil = loginViewerHtml({ skipConfirmText: '含"引号"与</script>的文案' });
  assert.ok(!evil.includes('</script>的文案'), '危险字符必须转义，不能提前闭合 script');
});

test('viewer HTML：未注入确认文案时回退当前语言默认文案，仍有确认框', () => {
  const html = loginViewerHtml({});
  assert.ok(html.includes('confirm('));
  assert.ok(html.includes('Skip login?'), 'en 默认确认文案应提及跳过后果');
  const zh = loginViewerHtml({ lang: 'zh' });
  assert.ok(zh.includes('确认跳过登录？'), 'zh 默认确认文案');
});

test('viewer HTML：判定详情（reason）原样展示且转义', () => {
  const reason = '检测到登录信号: 登录入口点击确认（全屏弹窗）｜票数 2/6：loginButton(记忆内)、spa';
  const html = loginViewerHtml({ reason });
  assert.ok(html.includes('票数 2/6'));
  assert.ok(html.includes('登录入口点击确认（全屏弹窗）'));
  const evilReason = loginViewerHtml({ reason: '<img src=x onerror=alert(1)>' });
  assert.ok(!evilReason.includes('<img src=x'), 'reason 必须 HTML 转义');
});

// —— 三形态参数化（登录/人机验证/稀薄介入）× 双语 ——

test('viewer HTML：零参数默认值 = 英文登录文案逐字锚点（源仓库开发态默认 en，防漂移）', () => {
  const html = withEnv('U2M_LANG', undefined, () => loginViewerHtml({}));
  assert.ok(html.includes('<html lang="en">'), 'lang 属性随语言');
  for (const anchor of [
    '<title>url-to-markdown Login</title>',
    '🖥️ Remote Page Login',
    '✅ Login Done',
    '⏭️ Skip Login',
    'Log in inside the canvas, then click “Login Done”. Click the canvas to type; use the wheel to scroll.',
    'Login not detected yet — please continue',
    'Checking login state…',
    'Skipping login, continuing…',
  ]) assert.ok(html.includes(anchor), `en 默认文案锚点缺失: ${anchor}`);
  // reason 尾句默认拼接（en 标点：'. ' 分隔 + '.' 收尾）
  const withReason = loginViewerHtml({ reason: 'R' });
  assert.ok(withReason.includes('📍 R. If no login is needed, click “Skip Login”.'), 'reason 行默认带尾句');
});

test('viewer HTML：lang:zh 默认值 = 中文登录文案逐字锚点（防漂移）', () => {
  const html = loginViewerHtml({ lang: 'zh' });
  assert.ok(html.includes('<html lang="zh">'));
  for (const anchor of [
    '<title>url-to-markdown 登录</title>',
    '🖥️ 远程页面登录',
    '✅ 登录完成',
    '⏭️ 跳过登录',
    '在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。',
    '仍未检测到登录态，请继续',
    '检测登录态中…',
    '跳过登录，继续转换…',
  ]) assert.ok(html.includes(anchor), `zh 默认文案锚点缺失: ${anchor}`);
  const withReason = loginViewerHtml({ lang: 'zh', reason: 'R' });
  assert.ok(withReason.includes('📍 R。若无需登录可点「跳过登录」。'), 'zh reason 行标点与旧版逐字节一致');
});

test('viewer HTML：U2M_LANG 环境变量覆盖语言（进程内生效）', () => {
  const html = withEnv('U2M_LANG', 'zh', () => loginViewerHtml({}));
  assert.ok(html.includes('<html lang="zh">'));
  assert.ok(html.includes('✅ 登录完成'), 'env=zh → 中文默认文案');
});

test('viewer HTML：skipText:null 不渲染跳过按钮（验证码 viewer 形态）', () => {
  const html = loginViewerHtml({ skipText: null, doneText: '✅ 验证完成' });
  assert.ok(!html.includes('<button id="skip"'), '跳过按钮不得渲染');
  assert.ok(html.includes('<button id="done">✅ 验证完成</button>'), 'done 按钮照常渲染');
  assert.ok(html.includes('skipBtn.onclick') || html.includes('if (skipBtn)'), 'onclick 须有存在性守卫');
});

test('viewer HTML：reasonHint:null 省略 reason 尾句（双语标点）', () => {
  const html = loginViewerHtml({ reason: 'R', reasonHint: null });
  assert.ok(html.includes('📍 R.</p>'), 'en：reason 行保留但不带尾句');
  assert.ok(!html.includes('If no login is needed'), 'en 默认尾句不得出现');
  const zh = loginViewerHtml({ lang: 'zh', reason: 'R', reasonHint: null });
  assert.ok(zh.includes('📍 R。</p>'), 'zh：reason 行保留但不带尾句');
  assert.ok(!zh.includes('若无需登录'), 'zh 默认尾句不得出现');
});

test('viewer HTML：自定义文案注入且 HTML/JS 双上下文转义', () => {
  const html = loginViewerHtml({
    title: '人机验证',
    headingText: '<b>🛡️ 验证</b>',
    infoText: '完成验证后点「验证完成」',
    recheckFailedText: '</script><img src=x>',
    checkingText: '检测中…',
    skippingText: '继续转换…',
  });
  assert.ok(html.includes('<title>人机验证</title>'));
  assert.ok(html.includes('&lt;b&gt;🛡️ 验证&lt;/b&gt;'), 'heading 必须 HTML 转义');
  assert.ok(html.includes('完成验证后点「验证完成」'));
  assert.ok(!html.includes('</script><img src=x>'), 'JS 上下文文案必须转义 </script>');
  assert.ok(html.includes('\\u003cimg src=x\\u003e') || !/<img src=x>/.test(html), '尖括号转 JS 转义序列');
  assert.ok(html.includes('检测中…') && html.includes('继续转换…'));
});

// —— WS 连接三状态（原写死于模板，现走字典/参数）——

test('viewer HTML：WS 三状态默认注入（双语）', () => {
  const en = loginViewerHtml({});
  assert.ok(en.includes('<span id="status">Connecting…</span>'), 'en 初始状态');
  assert.ok(en.includes('"Connected"') && en.includes('"Connection lost"'), 'en onopen/onclose 状态');
  const zh = loginViewerHtml({ lang: 'zh' });
  assert.ok(zh.includes('<span id="status">连接中…</span>'), 'zh 初始状态');
  assert.ok(zh.includes('"已连接"') && zh.includes('"连接已断开"'), 'zh onopen/onclose 状态');
});

test('viewer HTML：WS 三状态可参数覆盖且双上下文转义', () => {
  const html = loginViewerHtml({
    connectingText: '<b>wait</b>',                 // HTML 上下文（初始 span）
    connectedText: '</script><img src=x>',          // JS 上下文（onopen）
    disconnectedText: 'bye',
  });
  assert.ok(html.includes('<span id="status">&lt;b&gt;wait&lt;/b&gt;</span>'), 'connecting 必须 HTML 转义');
  assert.ok(!html.includes('</script><img src=x>'), 'connected 必须防提前闭合 script');
  assert.ok(html.includes('\\u003cimg src=x>'), 'connected 的 < 转 JS 转义序列（safeJsString 只转 <）');
  assert.ok(html.includes('"bye"'));
});
