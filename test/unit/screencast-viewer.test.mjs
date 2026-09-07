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
