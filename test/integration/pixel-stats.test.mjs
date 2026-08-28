// pixelStats 辅助自测：webp 截图 → 尺寸/矩形计数/纯色区密度往返
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { pixelStats, closePixelStats } from '../helpers/pixel-stats.mjs';

test('pixelStats: webp 截图像素统计往返（尺寸/计数/矩形计数/密度）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-pstats-'));
  let browser;
  try {
    const imgPath = path.join(tmp, 'stripes.webp');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(
      '<!DOCTYPE html><body style="margin:0;width:fit-content">'
      + '<div style="width:100px;height:50px;background:rgb(255,0,255)"></div>'
      + '<div style="width:100px;height:50px;background:rgb(0,0,255)"></div>'
      + '</body>'
    );
    await page.locator('body').screenshot({ path: imgPath, type: 'webp' });

    const s = await pixelStats(imgPath, [
      { name: 'magenta', kind: 'count', rgb: [255, 0, 255] },
      { name: 'magentaTop', kind: 'count', rgb: [255, 0, 255], rect: [0, 0, 100, 50] },
      { name: 'magentaBottom', kind: 'count', rgb: [255, 0, 255], rect: [0, 50, 100, 50] },
      { name: 'bottomDensity', kind: 'density', rect: [0, 50, 100, 50] },
    ]);
    assert.equal(s.width, 100, 'deviceScaleFactor 默认 1，宽应等于 CSS 宽');
    assert.equal(s.height, 100);
    assert.ok(s.magenta > 100 * 50 * 0.9, `品红应约占一半: ${s.magenta}`);
    assert.ok(s.magentaTop > 100 * 50 * 0.9, `矩形内品红计数: ${s.magentaTop}`);
    assert.equal(s.magentaBottom, 0, `下半矩形无品红: ${s.magentaBottom}`);
    assert.ok(s.bottomDensity < 0.01, `纯色区密度应≈0: ${s.bottomDensity}`);
  } finally {
    await browser?.close().catch(() => {});
    await closePixelStats();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
