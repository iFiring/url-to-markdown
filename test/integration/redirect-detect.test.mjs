// test/integration/redirect-detect.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { snapshotRedirectDetect } from '../../script/lib/snapshot-redirect.mjs';

let serverA; let serverB; let browser;
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 3000 } });
  return ctx.newPage();
};

before(async () => {
  serverA = await startFixtureServer();
  serverB = await startFixtureServer(); // 同目录不同端口 = 天然跨域
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  serverA?.close();
  serverB?.close();
});

test('同源占优 iframe → redirect 命中', async () => {
  const page = await newPage();
  await page.goto(`${serverA.url}/redirect-shell-dyn.html?to=/redirect-content.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const r = await snapshotRedirectDetect(page);
  assert.ok(r.redirect, '应命中');
  assert.ok(r.redirect.url.endsWith('/redirect-content.html'));
  assert.ok(r.redirect.frameText >= 500);
  assert.ok(r.mainText < 100, '壳页主文本极少');
  await page.context().close();
});

test('跨域 iframe（双端口）→ redirect 命中', async () => {
  const page = await newPage();
  await page.goto(`${serverA.url}/redirect-shell-dyn.html?to=${serverB.url}/redirect-content.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const r = await snapshotRedirectDetect(page);
  assert.ok(r.redirect);
  assert.equal(r.redirect.url, `${serverB.url}/redirect-content.html`);
  await page.context().close();
});

test('主文档充实 / frame 文本不足 / srcdoc → 不重定向', async () => {
  const page = await newPage();
  await page.goto(`${serverA.url}/redirect-busy-main.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const r = await snapshotRedirectDetect(page);
  assert.equal(r.redirect, null);
  assert.ok(r.mainText >= 500);
  await page.context().close();
});

test('无 iframe 普通页 → 不重定向', async () => {
  const page = await newPage();
  await page.goto(`${serverA.url}/static-article.html`, { waitUntil: 'networkidle' });
  const r = await snapshotRedirectDetect(page);
  assert.equal(r.redirect, null);
  await page.context().close();
});
