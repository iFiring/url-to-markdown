// test/unit/browser-proxy.test.mjs —— U2M_PROXY → chromium launch 选项映射（纯函数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyLaunchOptions } from '../../script/lib/browser.mjs';

test('U2M_PROXY 未设置或空白 → 不加任何代理选项（继承系统代理）', () => {
  assert.deepEqual(proxyLaunchOptions({}), {});
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: '' }), {});
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: '   ' }), {});
});

test('U2M_PROXY=direct → --no-proxy-server（忽略大小写与首尾空白）', () => {
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: 'direct' }), { args: ['--no-proxy-server'] });
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: ' Direct ' }), { args: ['--no-proxy-server'] });
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: 'DIRECT' }), { args: ['--no-proxy-server'] });
});

test('U2M_PROXY=URL → 显式代理 server（页面与图片下载统一走它）', () => {
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: 'http://127.0.0.1:1082' }),
    { proxy: { server: 'http://127.0.0.1:1082' } });
  assert.deepEqual(proxyLaunchOptions({ U2M_PROXY: 'socks5://127.0.0.1:1080' }),
    { proxy: { server: 'socks5://127.0.0.1:1080' } });
});
