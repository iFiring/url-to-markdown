// test/integration/browser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openPage } from '../../script/lib/browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

/** 哑代理：记录收到的请求行（absolute-form URI），返回固定页。 */
function startDummyProxy() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>via proxy</title><h1>via proxy</h1>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    hits,
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
  })));
}

test('openPage: 打开夹具页、注入 storageState、拦截媒体请求', async () => {
  await writePixelPng('test/fixtures/pixel.png');
  const fx = await startFixtureServer();
  const { page, context, close } = await openPage(`${fx.url}/static-article.html`, {
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.locator('h1').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.title(), '示例文章');
    // 媒体拦截：<video> 请求 resourceType=media → 被 abort（fetch() 的 resourceType 是 fetch，拦不到，勿用）
    const failed = page.waitForEvent('requestfailed',
      { predicate: (r) => r.resourceType() === 'media', timeout: 5000 });
    await page.evaluate(() => {
      const v = document.createElement('video');
      v.src = '/media.mp4';
      document.body.appendChild(v);
    });
    const req = await failed;
    assert.equal(req.failure()?.errorText, 'net::ERR_FAILED');
  } finally {
    await close();
    await fx.close();
  }
});

test('openPage: U2M_PROXY=URL → 页面请求走该代理（absolute-form GET）', async () => {
  const proxy = await startDummyProxy();
  const fx = await startFixtureServer();
  const prev = process.env.U2M_PROXY;
  process.env.U2M_PROXY = `http://127.0.0.1:${proxy.port}`;
  let s;
  try {
    s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
    await s.page.locator('h1').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await s.page.title(), 'via proxy');
    assert.ok(proxy.hits.length > 0, '代理应收到请求');
    assert.ok(proxy.hits.every((u) => u.startsWith('http://')), '应为 absolute-form URI');
  } finally {
    if (prev === undefined) delete process.env.U2M_PROXY; else process.env.U2M_PROXY = prev;
    await s?.close().catch(() => {});
    await proxy.close();
    await fx.close();
  }
});

test('openPage: U2M_PROXY=direct → 直连加载正常（--no-proxy-server 回归护栏）', async () => {
  const fx = await startFixtureServer();
  const prev = process.env.U2M_PROXY;
  process.env.U2M_PROXY = 'direct';
  let s;
  try {
    s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
    await s.page.locator('h1').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await s.page.title(), '示例文章');
  } finally {
    if (prev === undefined) delete process.env.U2M_PROXY; else process.env.U2M_PROXY = prev;
    await s?.close().catch(() => {});
    await fx.close();
  }
});
