// test/integration/browser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { openPage, realUserAgent } from '../../script/lib/browser.mjs';
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

test('openPage: 永不静默页面（流式长连接）不被 networkidle 卡死', async () => {
  // /stream.js 发完 headers 后保持连接不 end —— networkidle 永远等不到。
  // script 用 async 加载：不阻塞 domcontentloaded（同步 script 会卡住 dcl）。
  const server = http.createServer((req, res) => {
    if (req.url === '/stream.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.write('// open\n');
      const iv = setInterval(() => { try { res.write('// ping\n'); } catch { /* 已断开 */ } }, 200);
      res.on('close', () => clearInterval(iv));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>never idle</title><h1>hi</h1><script async src="/stream.js"></script>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  let s;
  try {
    s = await openPage(`http://127.0.0.1:${server.address().port}/`, { settleMs: 1500 });
    assert.equal(await s.page.title(), 'never idle');
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 20000, `永不静默页面应在 20s 内就绪（实际 ${elapsed}ms）—— networkidle 不应作为 goto 门条件`);
  } finally {
    await s?.close().catch(() => {});
    server.closeAllConnections(); // 流式连接常驻，须先踢掉才能 close
    await new Promise((r) => server.close(r));
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

/** 回显请求头的哑服务器：GET / → JSON.stringify(req.headers)。 */
function startHeaderEchoServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.headers));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise((r) => server.close(r)),
  })));
}

test('openPage: 去无头指纹——UA / sec-ch-ua / userAgentData / webdriver 全链路无 HeadlessChrome', async () => {
  const echo = await startHeaderEchoServer();
  let s;
  try {
    s = await openPage(`http://127.0.0.1:${echo.port}/`);
    // 网络侧：导航请求实际发出的头
    const headers = JSON.parse(await s.page.evaluate(() => document.body.textContent));
    const ua = headers['user-agent'];
    assert.ok(!/Headless/i.test(ua), `请求 UA 不应含无头特征: ${ua}`);
    const ver = /Chrome\/(\d+)/.exec(ua)?.[1];
    assert.ok(ver, `请求 UA 应含 Chrome 版本号: ${ua}`);
    const chUa = headers['sec-ch-ua'];
    assert.ok(chUa, '应发送 sec-ch-ua 头');
    assert.ok(!chUa.includes('HeadlessChrome'), `sec-ch-ua 不应泄露无头令牌: ${chUa}`);
    assert.ok(chUa.includes(`"Google Chrome";v="${ver}"`), `sec-ch-ua 应与 UA 版本一致: ${chUa}`);
    assert.equal((chUa.match(/"Chromium"/g) || []).length, 1,
      `sec-ch-ua 应恰好一份（未被浏览器自带值叠加）: ${chUa}`);
    // 平台归一：UA 钉 macOS（公众号风控按平台打分，Linux 判机器人），提示头对齐
    assert.ok(ua.includes('Macintosh; Intel Mac OS X'), `请求 UA 应为 macOS 平台: ${ua}`);
    assert.equal(headers['sec-ch-ua-platform'], '"macOS"',
      `sec-ch-ua-platform 应钉 macOS（实际 ${headers['sec-ch-ua-platform']}）`);
    assert.equal(headers['sec-ch-ua-mobile'], '?0', '桌面平台 sec-ch-ua-mobile 应为 ?0');
    // 页面侧：JS 可见的指纹
    const probe = await s.page.evaluate(() => ({
      ua: navigator.userAgent,
      webdriver: navigator.webdriver,
      platform: navigator.platform,
      uaPlatform: navigator.userAgentData?.platform,
      brands: (navigator.userAgentData?.brands || []).map((b) => b.brand),
    }));
    assert.ok(!/Headless/i.test(probe.ua), `navigator.userAgent 不应含无头特征: ${probe.ua}`);
    assert.equal(probe.webdriver, false, `navigator.webdriver 应为 false（实际 ${probe.webdriver}）`);
    assert.equal(probe.platform, 'MacIntel', `navigator.platform 应为 MacIntel（实际 ${probe.platform}）`);
    assert.equal(probe.uaPlatform, 'macOS', `userAgentData.platform 应为 macOS（实际 ${probe.uaPlatform}）`);
    assert.ok(!probe.brands.includes('HeadlessChrome'), `brands 不应含 HeadlessChrome: ${probe.brands}`);
    assert.ok(probe.brands.includes('Google Chrome'), `brands 应含 Google Chrome: ${probe.brands}`);
  } finally {
    await s?.close().catch(() => {});
    await echo.close();
  }
});

// 重定向指纹完整性：Playwright 的 extraHTTPHeaders 不跟随重定向——实测第
// 2 跳起浏览器按默认无头元数据重新生成 sec-ch-ua（HeadlessChrome 泄露给
// 落地页请求；route.continue({headers}) 也覆盖不了客户端提示头）。修复：
// 每页 CDP Emulation.setUserAgentOverride 带 userAgentMetadata，浏览器原生
// 生成路径对每一跳生效。
test('openPage: 重定向每一跳的 sec-ch-ua 也不泄露 HeadlessChrome', async () => {
  const seen = [];
  const chain = http.createServer((req, res) => {
    seen.push({
      url: req.url,
      ua: req.headers['user-agent'] || '',
      ch: req.headers['sec-ch-ua'] || '',
      chp: req.headers['sec-ch-ua-platform'] || '',
    });
    if (req.url === '/redir1') { res.writeHead(302, { Location: '/redir2' }); return res.end(); }
    if (req.url === '/redir2') { res.writeHead(302, { Location: '/echo' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.headers));
  });
  await new Promise((r) => chain.listen(0, '127.0.0.1', r));
  let s;
  try {
    s = await openPage(`http://127.0.0.1:${chain.address().port}/redir1`);
    assert.equal(seen.length, 3, `应恰好三跳: ${seen.map((h) => h.url).join(' → ')}`);
    for (const h of seen) {
      assert.ok(!/Headless/i.test(h.ch), `${h.url} 的 sec-ch-ua 不应泄露无头品牌: ${h.ch}`);
      assert.ok(h.ch.includes('Google Chrome'), `${h.url} 的 sec-ch-ua 应含 Google Chrome: ${h.ch}`);
      // 恰好一份——CDP 元数据与 extraHTTPHeaders 不得叠加
      assert.equal((h.ch.match(/"Google Chrome"/g) || []).length, 1,
        `${h.url} 的 sec-ch-ua 不应叠加重复: ${h.ch}`);
      assert.ok(h.ua.includes('Macintosh; Intel Mac OS X'), `${h.url} 的 UA 应为 macOS 平台: ${h.ua}`);
      assert.equal(h.chp, '"macOS"', `${h.url} 的 sec-ch-ua-platform 应为 macOS: ${h.chp}`);
    }
  } finally {
    await s?.close().catch(() => {});
    chain.closeAllConnections();
    await new Promise((r) => chain.close(r));
  }
});

test('realUserAgent: 无头 UA 去除 HeadlessChrome 特征（CDP 直读，逐字符一致）', async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const rawCtx = await browser.newContext(); // 取原始无头 UA 做对照
    const raw = await (await rawCtx.newPage()).evaluate(() => navigator.userAgent);
    if (!raw.includes('HeadlessChrome')) {
      t.skip(`前置条件不满足：无头 UA 不含 HeadlessChrome（实际 ${raw}），replace 本应为 no-op`);
      return;
    }
    const ua = await realUserAgent(browser);
    assert.ok(!ua.includes('Headless'), `不应再含无头特征: ${ua}`);
    assert.ok(/Chrome\/\d+/.test(ua), `应保留 Chrome 版本号: ${ua}`);
    // 除 HeadlessChrome→Chrome 外逐字符一致
    assert.equal(ua, raw.replace('HeadlessChrome/', 'Chrome/'));
  } finally {
    await browser.close().catch(() => {});
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
