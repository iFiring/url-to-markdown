// 留白扩盒语义单测：真实浏览器 setContent + 注入共享脚本，直接断言
// padding/margin 抵消矩阵——内容像素级零移动零形变、盒四向外扩 40px、
// 原有内边距设计保留、显式宽度自愈、display:contents 跳过、幂等。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-reveal-hidden.js');

test('page-reveal-hidden.js: 文件存在且包含 __u2mRevealHidden 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mRevealHidden'), '应定义 __u2mRevealHidden');
});

// 测量辅助：目标盒（border box）、四侧 padding/margin 计算值、内容探针
// （目标第一个子元素）的 rect——内容零重排的判定锚点
const MEASURE = `(() => {
  const t = document.querySelector('[data-u2m-id]');
  const mark = t.firstElementChild;
  const r = t.getBoundingClientRect();
  const cs = getComputedStyle(t);
  const m = mark.getBoundingClientRect();
  return {
    box: { w: r.width, h: r.height, l: r.left, t: r.top },
    pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
    mar: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft],
    mark: { w: m.width, h: m.height, l: m.left, t: m.top },
    inlinePad: t.style.padding,
    inlineW: t.style.width,
  };
})()`;

// auto 宽块（最常见形态）：占满 body 宽、不对称 padding/margin 设计
const AUTO_HTML = `<!DOCTYPE html><html><head><style>
  body { margin: 0; }
  #t { padding: 4px 8px 12px 16px; margin: 10px; background: rgb(240, 240, 240); }
</style></head><body>
<div data-u2m-id="1" id="t"><div id="mark" style="width: 200px; height: 50px; background: rgb(30, 30, 30)">内容探针</div></div>
</body></html>`;

async function evalReveal(page) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  return page.evaluate(`(${src})(1)`);
}

test('__u2mRevealHidden: auto 宽块留白扩盒——内容零移动、盒外扩 40px、内边距设计保留', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(AUTO_HTML);
    const before = await page.evaluate(MEASURE);
    const rev = await evalReveal(page);
    assert.ok(rev.found, '目标应命中');
    assert.equal(rev.occluders, 0, '夹具内只有亲族，无遮挡者');
    const after = await page.evaluate(MEASURE);

    // 盒四向外扩恰好 40px（20px 环 × 两侧）
    assert.ok(Math.abs(after.box.w - before.box.w - 40) < 0.5,
      `盒宽应 +40: ${before.box.w} → ${after.box.w}`);
    assert.ok(Math.abs(after.box.h - before.box.h - 40) < 0.5,
      `盒高应 +40: ${before.box.h} → ${after.box.h}`);

    // 内容探针零移动零形变（padding 挤窄内容的回归守卫）
    for (const k of ['w', 'h', 'l', 't']) {
      assert.ok(Math.abs(after.mark[k] - before.mark[k]) < 0.5,
        `内容探针 ${k} 不应变化: ${before.mark[k]} → ${after.mark[k]}`);
    }

    // 原有不对称内边距保留（每侧 +20）、margin 每侧 −20 抵消
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(parseFloat(after.pad[i]) - parseFloat(before.pad[i]) - 20) < 0.5,
        `padding 侧 ${i} 应 +20: ${before.pad[i]} → ${after.pad[i]}`);
      assert.ok(Math.abs(parseFloat(after.mar[i]) - parseFloat(before.mar[i]) + 20) < 0.5,
        `margin 侧 ${i} 应 -20: ${before.mar[i]} → ${after.mar[i]}`);
    }
  } finally {
    await browser.close();
  }
});

test('__u2mRevealHidden: 显式 border-box 宽（Tailwind 形态）自愈——内容不缩水、盒补足 +40', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<!DOCTYPE html><html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; }
      #t { width: 500px; background: rgb(240, 240, 240); }
    </style></head><body>
    <div data-u2m-id="1" id="t"><div id="mark" style="width: 480px; height: 50px; background: rgb(30, 30, 30)">内容探针</div></div>
    </body></html>`);
    const before = await page.evaluate(MEASURE);
    await evalReveal(page);
    const after = await page.evaluate(MEASURE);

    // 无自愈时 border-box 500 被钉住、padding 反吃内容（探针被挤到 x=20
    // 且外溢）；自愈后盒 = 540、探针原地
    assert.ok(Math.abs(after.box.w - 540) < 0.5, `盒宽应为 500+40: ${after.box.w}`);
    assert.equal(after.inlineW, '540px', `应补行内 width: ${after.inlineW}`);
    for (const k of ['w', 'h', 'l', 't']) {
      assert.ok(Math.abs(after.mark[k] - before.mark[k]) < 0.5,
        `内容探针 ${k} 不应变化: ${before.mark[k]} → ${after.mark[k]}`);
    }
  } finally {
    await browser.close();
  }
});

test('__u2mRevealHidden: 留白扩盒幂等——重复调用不叠加', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(AUTO_HTML);
    await evalReveal(page);
    const once = await page.evaluate(MEASURE);
    await evalReveal(page);
    const twice = await page.evaluate(MEASURE);
    assert.equal(twice.inlinePad, once.inlinePad, '第二次不应再叠 padding');
    assert.ok(Math.abs(twice.box.w - once.box.w) < 0.5, '盒宽不应再扩');
  } finally {
    await browser.close();
  }
});

test('__u2mRevealHidden: display:contents 无盒目标跳过留白扩盒', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<!DOCTYPE html><html><body>
    <div data-u2m-id="1" style="display: contents"><div id="mark" style="width: 100px; height: 20px">内容</div></div>
    </body></html>`);
    const rev = await evalReveal(page);
    assert.equal(rev.boxless, true, 'contents 应判为无盒');
    const inline = await page.evaluate(() => document.querySelector('[data-u2m-id]').getAttribute('style'));
    assert.equal(inline, 'display: contents', '不应写入任何行内覆写');
  } finally {
    await browser.close();
  }
});
