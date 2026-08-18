// test/integration/browser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../../script/lib/browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

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
