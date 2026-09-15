// test/unit/screencast-viewer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openViewerCommand, loginViewerHtml } from '../../script/lib/screencast.mjs';

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

test('viewer HTML：未注入确认文案时回退默认文案，仍有确认框', () => {
  const html = loginViewerHtml({});
  assert.ok(html.includes('confirm('));
  assert.ok(html.includes('跳过登录'), '默认确认文案应提及跳过后果');
});

test('viewer HTML：判定详情（reason）原样展示且转义', () => {
  const reason = '检测到登录信号: 登录入口点击确认（全屏弹窗）｜票数 2/6：loginButton(记忆内)、spa';
  const html = loginViewerHtml({ reason });
  assert.ok(html.includes('票数 2/6'));
  assert.ok(html.includes('登录入口点击确认（全屏弹窗）'));
  const evilReason = loginViewerHtml({ reason: '<img src=x onerror=alert(1)>' });
  assert.ok(!evilReason.includes('<img src=x'), 'reason 必须 HTML 转义');
});

// —— 三形态参数化（登录/人机验证/稀薄介入）——

test('viewer HTML：零参数默认值 = 登录文案逐字锚点（防默认值漂移）', () => {
  const html = loginViewerHtml({});
  for (const anchor of [
    '<title>url-to-markdown 登录</title>',
    '🖥️ 远程页面登录',
    '✅ 登录完成',
    '⏭️ 跳过登录',
    '在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。',
    '仍未检测到登录态，请继续',
    '检测登录态中…',
    '跳过登录，继续转换…',
  ]) assert.ok(html.includes(anchor), `默认文案锚点缺失: ${anchor}`);
  // reason 尾句默认拼接
  const withReason = loginViewerHtml({ reason: 'R' });
  assert.ok(withReason.includes('📍 R。若无需登录可点「跳过登录」。'), 'reason 行默认带尾句');
});

test('viewer HTML：skipText:null 不渲染跳过按钮（验证码 viewer 形态）', () => {
  const html = loginViewerHtml({ skipText: null, doneText: '✅ 验证完成' });
  assert.ok(!html.includes('<button id="skip"'), '跳过按钮不得渲染');
  assert.ok(html.includes('<button id="done">✅ 验证完成</button>'), 'done 按钮照常渲染');
  assert.ok(html.includes('skipBtn.onclick') || html.includes('if (skipBtn)'), 'onclick 须有存在性守卫');
});

test('viewer HTML：reasonHint:null 省略 reason 尾句', () => {
  const html = loginViewerHtml({ reason: 'R', reasonHint: null });
  assert.ok(html.includes('📍 R。</p>'), 'reason 行保留但不带尾句');
  assert.ok(!html.includes('若无需登录'), '默认尾句不得出现');
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
