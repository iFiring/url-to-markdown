# 步骤 8 双层排除 + 三段手术 实施计划（trans2img wide reveal）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 步骤 8 trans2img 截图截到超视口宽度的完整像素（横向裁剪 reveal），且任何非文章内容元素（导航/侧栏/浮窗/广告）不进图（分类层 + 几何层双层排除）。

**Architecture:** 全部改动落在截图前的页内手术——`page-reveal-hidden.js` 从纵向展开扩为三段（纵向/横向/遮挡者），新增共享脚本 `page-exclude-noncontent.js` 做页面级语义排除（keep = 正文分类 id ∪ trans2img id，隐藏其余），`screenshot_trans.mjs` 只做接线（读 `3_key_ids.json`、拼 keep 集、每页执行一次分类层）。像素断言用新测试辅助 `pixelStats`（webp 进 chromium canvas 逐像素统计）。

**Tech Stack:** Node ≥20、playwright（chromium）、node:test。无新依赖。

**Spec:** `docs/superpowers/specs/2026-08-28-trans2img-wide-reveal-design.md`（二稿，含同日精化；本计划据其论证，执行者须同读）

## Global Constraints

- stdout 恰好一行 JSON（失败路径也不例外），日志一律 stderr，退出码 0/1/2（usage_error=2）。
- **emit 延迟退出陷阱**：`emit()` 先写行、在写回调里 `process.exit`、本身同步返回——所有 `usage()`/`emit()` 之后必须立即 return，不得输出第二行。
- 共享页面脚本是唯一事实源：横向 reveal / 遮挡者隐藏只存在于 `page-reveal-hidden.js`，分类层只存在于 `page-exclude-noncontent.js`，严禁分叉进 `.mjs` 编排层。
- Playwright evaluate 语义：字符串表达式只能用完整表达式形式 `page.evaluate(`(${src})()`)`。
- 视口一律不动（默认 1280×3000）；`deviceScaleFactor: 2` 不动。
- 共享页面脚本风格：非模块文件、单个具名 `function __u2mXxx(...)`、`var` + 无箭头函数（可用 Set/Map 等 chromium 内建）。
- 测试命令：单文件 `node --test test/unit/screenshot-trans.test.mjs`；全量 `pnpm test:all`（需已装 chromium：`npx playwright install chromium`）。
- 提交信息用中文、`feat:`/`test:`/`fix:`/`docs:` 前缀，末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 手术全部行内 `!important` + 幂等：可见且无裁剪的元素链零改动。

---

### Task 1: pixelStats 测试辅助 + 往返自测

**Files:**
- Create: `test/helpers/pixel-stats.mjs`
- Test: `test/integration/pixel-stats.test.mjs`

**Interfaces:**
- Consumes: 无（独立辅助）。
- Produces: `pixelStats(imgPath, queries) → Promise<{width, height, [name]: number}>` 与 `closePixelStats() → Promise<void>`（`test/helpers/pixel-stats.mjs`）。queries 为数组，每项 `{name, kind:'count', rgb:[r,g,b], tol?=40, rect?=[x,y,w,h]}`（设备像素矩形内计数）或 `{name, kind:'density', rect:[x,y,w,h]}`（区域内与区域众色不同的像素占比，众色按 16 级/通道量化桶抗 webp 有损）。Task 2/4 的断言依赖此签名。

- [ ] **Step 1: 写失败的自测**

创建 `test/integration/pixel-stats.test.mjs`：

```js
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
  const imgPath = path.join(tmp, 'stripes.webp');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(
    '<body style="margin:0">'
    + '<div style="width:100px;height:50px;background:rgb(255,0,255)"></div>'
    + '<div style="width:100px;height:50px;background:rgb(0,0,255)"></div>'
    + '</body>'
  );
  await page.locator('body').screenshot({ path: imgPath, type: 'webp' });
  await browser.close();

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

  await closePixelStats();
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/integration/pixel-stats.test.mjs`
Expected: FAIL——`Cannot find module .../test/helpers/pixel-stats.mjs`

- [ ] **Step 3: 实现辅助**

创建 `test/helpers/pixel-stats.mjs`：

```js
// pixelStats：webp 截图像素统计辅助（spec §5 断言 1-6 的底座）。
// 文件读为 base64 注入 chromium 页面 canvas，逐像素统计后只把数值结果带回
// Node——避免把数 MB 像素数组跨 evaluate 边界序列化。浏览器进程跨多次调用
// 复用（模块级惰性单例），测试收尾调 closePixelStats() 关闭。
import fs from 'node:fs';
import { chromium } from 'playwright';

let browserPromise = null;
async function ensureBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

/** 关闭复用浏览器。用完 pixelStats 的测试文件在末尾调用。 */
export async function closePixelStats() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

/**
 * pixelStats(imgPath, queries) → { width, height, [name]: number }
 * queries: [
 *   { name, kind: 'count',   rgb: [r,g,b], tol?=40, rect?=[x,y,w,h] }  匹配像素数（rect 限设备像素矩形）
 *   { name, kind: 'density', rect: [x,y,w,h] }                          区域内与区域众色不同的像素占比
 * ]
 * tol 为每通道容差（抗 webp 有损）；众色按每通道 >>4 的 12bit 量化桶取众数。
 */
export async function pixelStats(imgPath, queries = []) {
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const browser = await ensureBrowser();
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ b64, queries }) => {
      const img = new Image();
      img.src = 'data:image/webp;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const out = { width: c.width, height: c.height };
      for (const q of queries) {
        if (q.kind === 'density') {
          const [rx, ry, rw, rh] = q.rect;
          const buckets = new Map();
          let total = 0;
          for (let y = ry; y < Math.min(ry + rh, c.height); y++) {
            for (let x = rx; x < Math.min(rx + rw, c.width); x++) {
              const i = (y * c.width + x) * 4;
              const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
              buckets.set(key, (buckets.get(key) || 0) + 1);
              total++;
            }
          }
          let modal = 0;
          for (const v of buckets.values()) if (v > modal) modal = v;
          out[q.name] = total > 0 ? 1 - modal / total : 0;
        } else if (q.kind === 'count') {
          const [tr, tg, tb] = q.rgb;
          const tol = q.tol === undefined ? 40 : q.tol;
          let n = 0;
          for (let p = 0; p < c.width * c.height; p++) {
            if (q.rect) {
              const x = p % c.width;
              const y = (p / c.width) | 0;
              if (x < q.rect[0] || x >= q.rect[0] + q.rect[2] || y < q.rect[1] || y >= q.rect[1] + q.rect[3]) continue;
            }
            const i = p * 4;
            if (Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol) n++;
          }
          out[q.name] = n;
        }
      }
      return out;
    }, { b64, queries });
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/integration/pixel-stats.test.mjs`
Expected: PASS（1 test）

- [ ] **Step 5: 提交**

```bash
git add test/helpers/pixel-stats.mjs test/integration/pixel-stats.test.mjs
git commit -m "test: pixelStats 截图像素统计辅助——webp 进 canvas 逐像素计数/密度

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: page-reveal-hidden.js 三段手术（横向裁剪 reveal + 遮挡者隐藏泛化）+ 超宽夹具 CLI 测试

**Files:**
- Modify: `script/lib/page-reveal-hidden.js`（整文件替换为下方内容）
- Modify: `script/screenshot_trans.mjs`（截图循环内加两行 debug，见 Step 6）
- Test: `test/unit/screenshot-trans.test.mjs`（追加夹具与测试）

**Interfaces:**
- Consumes: Task 1 的 `pixelStats`/`closePixelStats`（`test/helpers/pixel-stats.mjs`）。
- Produces: `__u2mRevealHidden(id) → { found, touched, wideTouched, occluders, box:{width,height}|null, boxless:boolean }`——调用点（`screenshot_trans.mjs` 现有 `page.evaluate`）不变；`touched` 语义不变（纵向计数）；`wideTouched`（横向覆写处数）、`occluders`（遮挡者隐藏数）供 debug。Task 4 的分类层与之幂等共存（同写 `visibility:hidden`）。

- [ ] **Step 1: 写失败的 CLI 测试**

在 `test/unit/screenshot-trans.test.mjs` 顶部 import 区追加：

```js
import { pixelStats, closePixelStats } from '../helpers/pixel-stats.mjs';
```

在文件末尾（图片下载区块之前或之后均可，建议紧随 display:contents 区块）追加：

```js
// ── 超宽裁剪 + 遮挡（spec §5 超宽裁剪夹具）──
// 真实盒裁剪形态：html{overflow-x:auto} 让 body 的 overflow-x:hidden 作为
// 普通盒裁剪（视口传播形态测不到 bug，见 spec §1）；.wrap 再叠一层
// overflow-x:auto（宽表格站点的标准写法）。表 2800px 超视口（1280）。
// 品红 fixed 假导航×2 横跨表格区域（非亲族 → 遮挡者隐藏）；
// 红徽标在表内（亲族 absolute → 保留）；橙色 relative 负 margin 块压在
// 表上（非亲族、非 fixed → 泛化相交规则隐藏）
const wideCells = (bg) =>
  `<td style="width: 100px; height: 40px; border: 1px solid rgb(120, 120, 120); background: ${bg}">cell</td>`.repeat(28);
const SNAPSHOT_WIDE = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>超宽</title><base data-u2m-base="1" href="http://127.0.0.1:9/dead">
<style>
  html { overflow-x: auto; }
  body { overflow-x: hidden; margin: 0; }
  .wrap { overflow-x: auto; max-width: 640px; }
</style></head><body>
<h1 data-idx="1">超宽模块测试</h1>
<p data-idx="2">正文段落。</p>
<div style="position: fixed; top: 0; left: 0; width: 40px; height: 100%; background: rgb(255, 0, 255); z-index: 9999"></div>
<div style="position: fixed; top: 0; right: 0; width: 40px; height: 100%; background: rgb(255, 0, 255); z-index: 9999"></div>
<div class="wrap" data-idx="91">
<table data-idx="92" style="width: 2800px; border-collapse: collapse; background: rgb(255, 255, 255)">
<tr>${wideCells('rgb(200, 220, 240)')}</tr>
<tr>${wideCells('rgb(225, 235, 250)')}</tr>
<tr>${wideCells('rgb(200, 220, 240)')}</tr>
<tr><td colspan="28" style="height: 40px; border: 1px solid rgb(120, 120, 120); background: rgb(225, 235, 250)"><span data-idx="95" style="position: absolute; top: 200px; left: 300px; width: 60px; height: 60px; background: rgb(255, 0, 0); z-index: 9999"></span></td></tr>
</table>
</div>
<div data-idx="96" style="position: relative; margin-top: -120px; height: 60px; background: rgb(255, 165, 0); z-index: 50"></div>
<p data-idx="60">结尾段落。</p>
</body></html>`;

test('screenshot_trans.mjs: 超宽表格横向 reveal 截全 + 遮挡者隐藏 + 亲族保留', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('wide', {
    snapshot: SNAPSHOT_WIDE,
    skeleton: [{ trans2img: [91, 92] }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  try {
    const r = await runScript(process.execPath, [script, '--url', LIVE_URL], {
      env: { U2M_WORKING_ROOT: tmpRoot },
      timeoutMs: 120000,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'ok');
    assert.equal(out.count, 2, '链上 91、92 各截一张');
    assert.equal(out.source, 'snapshot', '死端口 → 快照兜底');

    const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
    assert.deepEqual(resolved, [{ trans2img: 'assets/trans/92.webp' }],
      '表格 2800px 宽于 wrap 640px → 择优选 92');

    const s = await pixelStats(path.join(assetsDir, 'trans', '92.webp'), [
      { name: 'beyondDensity', kind: 'density', rect: [2600, 0, 99999, 99999] },
      { name: 'magenta', kind: 'count', rgb: [255, 0, 255] },
      { name: 'red', kind: 'count', rgb: [255, 0, 0] },
      { name: 'orange', kind: 'count', rgb: [255, 165, 0] },
    ]);
    assert.equal(s.width, 5600, `2800 CSS × 2 应截全: ${s.width}`);
    assert.ok(s.beyondDensity > 0.01, `超视口带（x≥2600 设备px）内容密度>1%: ${s.beyondDensity}`);
    assert.equal(s.magenta, 0, `非亲族 fixed 导航应隐藏: ${s.magenta}`);
    assert.ok(s.red > 1000, `亲族红徽标应保留: ${s.red}`);
    assert.equal(s.orange, 0, `relative 负 margin 重叠块应隐藏: ${s.orange}`);
  } finally {
    await closePixelStats();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 新测试 FAIL（旧测试仍 PASS）——修复前 wrap 裁剪使超视口带空白（`beyondDensity ≈ 0`）、品红/橙色像素 > 0。注意 `assert.equal(s.width, 5600)` 单独看可能通过（布局盒本就全宽，缺的是像素，见 spec §1）——失败信号来自其余断言。

- [ ] **Step 3: 实现三段手术**

`script/lib/page-reveal-hidden.js` 整文件替换为：

```js
/**
 * 步骤 8 截图前逐 id 三段手术（spec §3.2-§3.4）。在浏览器 evaluate 中执行。
 * trans2img 模块可能处于折叠态（手风琴收起等）：步骤 2 只在清洗版折叠隐藏
 * 子树，带样式版保真——折叠内容合法流到步骤 7 并可被标 trans2img；而页 A
 * （快照，站点 CSS 已内联）与页 B（live，站点自身收起态）都把它渲染为
 * 隐藏：display:none（自身或祖先）盒为 null、max-height:0 盒高为 0，
 * el.screenshot() 自动等可见会挂到超时；更隐蔽的是被塌缩祖先裁剪的模块
 * ——自身盒正常但像素被裁空，不展开就截是空白图。
 * 对给定 data-idx 的元素**无条件**自元素向 body 逐级扫一遍，**只覆写
 * 正在隐藏的属性**（行内 !important）——不能以元素自身盒作前置守卫：被
 * 塌缩祖先裁剪/visibility 隐藏的模块盒正常但像素全空，守卫会放行出空白图。
 * 三段（执行顺序）：
 *   1) 纵向强制展开（现状，spec §3.2）：自元素向 body（不含 body/html），
 *      只动正在隐藏的属性：
 *      - computed display:none → block（折叠包装几乎都是普通块；模块内部
 *        flex/grid 在更深层、不在覆写之列。若站点开合态本就是 flex/grid，
 *        截图按块堆叠降级——比截不出图强）
 *      - visibility:hidden|collapse → visible；opacity:0 → 1
 *      - HTML hidden 属性 → 移除（UA 规则打不过行内 !important）
 *      - max-height:0 → none
 *      - height:0（目标自身被压扁）→ auto + overflow:visible
 *      - 塌缩裁剪者：overflowY:hidden 且 clientHeight===0 且 scrollHeight>0
 *        → max-height:none + height:auto + overflow:visible（子代像素被裁空
 *        的元凶，computed height 可能报 auto、靠 clientHeight 才抓得住）
 *   2) 横向裁剪 reveal（spec §3.3）：自元素**向 html 逐级**（含 body/html
 *      ——真实盒裁剪最常在这两层，html 设 overflow-x:auto 时 body 的
 *      overflow-x:hidden 不上浮为视口裁剪而按普通盒裁剪），对确实在横向
 *      裁剪的祖先（overflow-x ∈ {hidden,clip,auto,scroll} 且
 *      clientWidth < scrollWidth）覆写 overflow:visible——简写一次覆写双轴，
 *      绕开规范把 visible+hidden 强制计算回 auto；本就不裁的零改动。
 *      captureBeyondViewport 救不了被盒裁掉的内容（Chromium 根本不绘制）。
 *   3) 遮挡者隐藏（spec §3.4）：body 下非亲族元素（双向 contains 排除——
 *      模块内的 fixed 徽标/吸顶表头是亲族，保留）：fixed/sticky 一律
 *      visibility:hidden（视口家具永远不是模块内容，顺带消灭
 *      captureBeyondViewport 的 fixed 重复绘制伪影）；其余一切定位形态
 *      （absolute/relative/transform/负 margin/浮动）与目标盒真实相交即
 *      隐藏（矩形判定）。选 visibility 而非 opacity：离散无过渡、不影响
 *      布局；父 hidden 子显式 visible 会穿透，可见后代一并覆写。
 *      不恢复——导航对同页后续所有截图同样该藏。跳过
 *      SCRIPT/STYLE/NOSCRIPT/TEMPLATE/LINK/META 控制成本。
 * 手术是截图前的渲染态修改：不动 tag/children/textContent，元素签名不受
 * 影响（签名在手术之前计算）。与分类层（page-exclude-noncontent.js）幂等
 * 共存：同写 visibility:hidden，重复覆写无冲突；已 hidden 的元素直接跳过。
 * 返回 {found, touched, wideTouched, occluders, box, boxless}——touched 为
 * 纵向覆写处数，wideTouched 为横向覆写处数，occluders 为隐藏的遮挡者数
 * （均仅供 U2M_DEBUG）；box 为手术后量得的 CSS px 尺寸（宽高均 >0 即可
 * 截图）；boxless=true 标记目标自身为 display:contents 透明包装——规范上
 * 永不生成盒（rect 恒 0×0，与隐藏无关、覆写救不了），调用方应跳过该 id，
 * 视觉由链上其余 id 承载。
 */
function __u2mRevealHidden(id) {
  var el = document.querySelector('[data-idx="' + id + '"]');
  if (!el) return { found: false, touched: 0, wideTouched: 0, occluders: 0, box: null, boxless: false };

  function boxOf(e) {
    var r = e.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  // 1) 纵向强制展开（到 body 为止，不含 body/html）
  var touched = 0;
  for (var node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
    var cs = getComputedStyle(node);
    if (cs.display === 'none') { node.style.setProperty('display', 'block', 'important'); touched++; }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
      node.style.setProperty('visibility', 'visible', 'important'); touched++;
    }
    if (parseFloat(cs.opacity) === 0) { node.style.setProperty('opacity', '1', 'important'); touched++; }
    if (node.hasAttribute('hidden')) { node.removeAttribute('hidden'); touched++; }
    if (parseFloat(cs.maxHeight) === 0) { node.style.setProperty('max-height', 'none', 'important'); touched++; }
    // 目标自身被压扁：height:0 时子孙被裁（overflow:hidden）或溢出压扁
    if (node === el && parseFloat(cs.height) === 0) {
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
    // 塌缩裁剪者：盒高 0 却装着内容（子代盒正常但像素全被裁空）。
    // computed height 可能是 auto（flex-basis/min-height 压扁），靠
    // clientHeight 抓；只动确在裁剪的（scrollHeight>0）
    if (cs.overflowY === 'hidden' && node.clientHeight === 0 && node.scrollHeight > 0) {
      node.style.setProperty('max-height', 'none', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('overflow', 'visible', 'important');
      touched++;
    }
  }

  // 2) 横向裁剪 reveal（到 html，含 body/html）
  var wideTouched = 0;
  for (var anc = el; anc && anc.nodeType === 1; anc = anc.parentElement) {
    var ox = getComputedStyle(anc).overflowX;
    if ((ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll')
        && anc.clientWidth < anc.scrollWidth) {
      anc.style.setProperty('overflow', 'visible', 'important');
      wideTouched++;
    }
  }

  // display:contents：透明包装永不生成盒（rect 恒 0×0），非隐藏所致
  var boxless = getComputedStyle(el).display === 'contents';

  // 3) 遮挡者隐藏（boxless 目标无盒可被遮挡，跳过）
  var occluders = 0;
  if (!boxless) {
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1 };
    var tb = el.getBoundingClientRect();
    var cand = document.body.querySelectorAll('*');
    for (var i = 0; i < cand.length; i++) {
      var o = cand[i];
      if (SKIP[o.tagName]) continue;
      if (o === el || o.contains(el) || el.contains(o)) continue; // 亲族保留
      var ocs = getComputedStyle(o);
      if (ocs.visibility === 'hidden') continue; // 已藏（含分类层覆写）幂等跳过
      var hide = ocs.position === 'fixed' || ocs.position === 'sticky';
      if (!hide) {
        var r = o.getBoundingClientRect();
        hide = r.width > 0 && r.height > 0
          && r.left < tb.right && tb.left < r.right
          && r.top < tb.bottom && tb.top < r.bottom;
      }
      if (hide) {
        o.style.setProperty('visibility', 'hidden', 'important');
        // 父 hidden 子显式 visible 会穿透——可见后代一并覆写
        var kids = o.querySelectorAll('*');
        for (var k = 0; k < kids.length; k++) {
          if (getComputedStyle(kids[k]).visibility === 'visible') {
            kids[k].style.setProperty('visibility', 'hidden', 'important');
          }
        }
        occluders++;
      }
    }
  }

  return { found: true, touched: touched, wideTouched: wideTouched, occluders: occluders, box: boxOf(el), boxless: boxless };
}
```

- [ ] **Step 4: 运行新测试确认通过**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 全部 PASS（新测试的 5 个像素断言 + 旧测试无回归——旧夹具不触发横向/遮挡路径）。

- [ ] **Step 5: 全文件回归**

Run: `node --test test/unit/`
Expected: 全部 PASS。

- [ ] **Step 6: 调用侧 debug 行**

`script/screenshot_trans.mjs` 截图循环内，紧跟现有 `if (rev.touched > 0) { debug(...); }` 块之后追加：

```js
        if (rev.wideTouched > 0) {
          debug(`trans2img ${id} 横向裁剪 reveal（${srcLabel(page)}，覆写 ${rev.wideTouched} 处）`);
        }
        if (rev.occluders > 0) {
          debug(`trans2img ${id} 遮挡者隐藏（${srcLabel(page)}，${rev.occluders} 个）`);
        }
```

（`srcLabel` 在该循环之前已定义，无需移动。）

Run: `U2M_DEBUG=1 node script/screenshot_trans.mjs --url http://127.0.0.1:9/nonexistent`
Expected: stdout 单行 error JSON（exit 1，缺前置产物）——确认参数处理未被破坏即可（本地无夹具目录时在"找不到 1_snapshot"处终止，不影响验证 debug 行语法）。

- [ ] **Step 7: 提交**

```bash
git add script/lib/page-reveal-hidden.js script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs
git commit -m "feat: 步骤 8 三段手术——横向裁剪 reveal 解盒级 overflow 裁剪 + 遮挡者隐藏泛化全定位形态

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: page-exclude-noncontent.js 分类层共享脚本 + 语义单测

**Files:**
- Create: `script/lib/page-exclude-noncontent.js`
- Test: `test/integration/page-exclude-noncontent.test.mjs`

**Interfaces:**
- Consumes: 无。
- Produces: `__u2mExcludeNonContent(keepIds, deleteIds) → { hidden: number, kept: number }`（`script/lib/page-exclude-noncontent.js`）。`keepIds`/`deleteIds` 为正整数 id 数组；`kept` = keep 集在页内命中的元素数，`hidden` = 实际隐藏元素数。Task 4 的调用侧依赖此签名。

- [ ] **Step 1: 写失败的测试**

创建 `test/integration/page-exclude-noncontent.test.mjs`：

```js
// 分类层语义单测（spec §3.1 / §5）：真实浏览器 setContent + 注入共享脚本，
// 直接断言保护规则矩阵——keep 自身/祖先/子孙保、非内容藏、delete 在 keep
// 子树内藏、delete 为 keep 祖先时保优先、子代显式 visible 穿透一并覆写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-exclude-noncontent.js');

test('page-exclude-noncontent.js: 文件存在且包含 __u2mExcludeNonContent 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mExcludeNonContent'), '应定义 __u2mExcludeNonContent');
});

test('page-exclude-noncontent.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})([1], [])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

// 矩阵夹具：
//   #1 keep 标题（子孙 #2 保、#8 delete 在子树内→藏）
//   #3 非内容侧栏（→藏），内含 #9 显式 visibility:visible（穿透→一并藏）
//   #4 非内容包装（→藏），内含 #5 delete（→藏）
//   #6 delete 但同时是 keep #7 的祖先（保优先→保），#7 keep（→保）
const MATRIX_HTML = `<!DOCTYPE html><html><body>
<div data-idx="1" id="title">标题 <span data-idx="2" id="inner">内文</span> <span data-idx="8" id="del-inside">子树噪音</span></div>
<div data-idx="3" id="sidebar">侧栏 <span data-idx="9" id="penetrator" style="visibility: visible">穿透</span></div>
<div data-idx="4" id="outer">包装 <span data-idx="5" id="del-noise">噪音</span></div>
<div data-idx="6" id="del-ancestor">容器 <span data-idx="7" id="kept-child">正文</span></div>
</body></html>`;

test('__u2mExcludeNonContent: 保护规则矩阵（keep/祖先/子孙/delete/保优先/穿透）', async () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(MATRIX_HTML);
    const r = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    // 藏：#3 #4 #5 #8 #9（#9 未打标不计入 hidden 计数，但穿透覆写生效）
    assert.deepEqual(r, { hidden: 4, kept: 2 },
      `隐藏 #3/#4/#5/#8，keep 命中 #1/#7: ${JSON.stringify(r)}`);
    const vis = await page.evaluate(() => ({
      title: getComputedStyle(document.getElementById('title')).visibility,
      inner: getComputedStyle(document.getElementById('inner')).visibility,
      sidebar: getComputedStyle(document.getElementById('sidebar')).visibility,
      penetrator: getComputedStyle(document.getElementById('penetrator')).visibility,
      outer: getComputedStyle(document.getElementById('outer')).visibility,
      delNoise: getComputedStyle(document.getElementById('del-noise')).visibility,
      delInside: getComputedStyle(document.getElementById('del-inside')).visibility,
      delAncestor: getComputedStyle(document.getElementById('del-ancestor')).visibility,
      keptChild: getComputedStyle(document.getElementById('kept-child')).visibility,
    }));
    assert.equal(vis.title, 'visible', 'keep 自身保');
    assert.equal(vis.inner, 'visible', 'keep 子孙保');
    assert.equal(vis.sidebar, 'hidden', '非内容藏');
    assert.equal(vis.penetrator, 'hidden', '子代显式 visible 穿透一并覆写');
    assert.equal(vis.outer, 'hidden', '非内容包装藏');
    assert.equal(vis.delNoise, 'hidden', 'delete 噪音藏');
    assert.equal(vis.delInside, 'hidden', 'delete 在 keep 子树内也藏');
    assert.equal(vis.delAncestor, 'visible', 'delete 为 keep 祖先时保优先');
    assert.equal(vis.keptChild, 'visible', 'keep 命中保');
  } finally {
    await browser.close();
  }
});

test('__u2mExcludeNonContent: 幂等——重复执行零额外副作用', async () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(MATRIX_HTML);
    const r1 = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    const r2 = await page.evaluate(`(${src})([1, 7], [5, 6, 8])`);
    assert.deepEqual(r1, r2, '两次执行结果一致（重复覆写无副作用）');
  } finally {
    await browser.close();
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/integration/page-exclude-noncontent.test.mjs`
Expected: FAIL——文件不存在（`ENOENT`）。

- [ ] **Step 3: 实现共享脚本**

创建 `script/lib/page-exclude-noncontent.js`：

```js
/**
 * 步骤 8 分类层：非文章内容元素页面级排除（spec §3.1，双层第一层）。
 * 在浏览器 evaluate 中执行，每页一次（页 A gotoSettled 后、页 B prepare
 * 重标记 + 签名计算之后、截图循环之前）——visibility 不动
 * tag/children/textContent，签名不受影响；零重排，模块位置与 boundingBox
 * 择优不受影响。
 * 事实源是步骤 3 的 LLM 分类 + 步骤 7 的 trans2img 标记：
 *   keep = titleIds ∪ descriptionIds ∪ standaloneIds ∪ listFlowIds
 *          ∪ trans2img id 全集（调用侧拼好传入）
 *   隐藏 = 页内 data-idx 全集 − keep − keep 的祖先 − keep 的子孙
 *          ∪ listFlowDeleteIds（LLM 明判的菜单/导航/广告/推荐噪音，
 *          keep 子树内的也藏——步骤 7 是在噪音已删的 6_article.html 上
 *          标记模块的，截图应还原 LLM 所见的模块形态）
 * 保护规则：
 *   - keep 的子孙不藏：模块/正文内部元素是模块视觉本身，naive 补集会把
 *     模块内部挖空；
 *   - keep 的祖先是容器与背景，藏了就毁模块；
 *   - 保优先：任何隐藏候选（含 delete id）与 keep 或 keep 祖先重叠时一律
 *     不藏——步骤 3 理论上可产出 delete id 是 keep 祖先的坏分类。
 * 落地手段 visibility:hidden !important：与 DOM 删除像素等价、零重排、
 * 页 A（无 JS 的 file://）同样适用。keep 穿透按构造封闭（被藏元素子树内
 * 不可能有 keep 元素）；子代显式 visibility:visible 规则的穿透与几何层
 * （page-reveal-hidden.js 遮挡者段）同式处理——可见后代一并覆写。
 * 与几何层幂等共存：同写 visibility:hidden，重复覆写无冲突。
 * 返回 {hidden, kept}——hidden 为实际隐藏的打标元素数，kept 为 keep 集
 * 在页内命中的元素数（A/B 结构漂移时 kept < keepIds.length，可观测）。
 */
function __u2mExcludeNonContent(keepIds, deleteIds) {
  var keep = {};
  var del = {};
  for (var i = 0; i < keepIds.length; i++) keep[keepIds[i]] = true;
  for (var j = 0; j < deleteIds.length; j++) del[deleteIds[j]] = true;

  var tagged = document.querySelectorAll('[data-idx]');

  // keep 命中 + 祖先集（含未打标的 body/html——不在 tagged 内本就非候选）+ 子孙集
  var keepEls = [];
  var ancSet = new Set();
  var subSet = new Set();
  for (var t = 0; t < tagged.length; t++) {
    var e = tagged[t];
    if (!keep[parseInt(e.getAttribute('data-idx'), 10)]) continue;
    keepEls.push(e);
    for (var a = e.parentElement; a; a = a.parentElement) ancSet.add(a);
    var desc = e.querySelectorAll('*');
    for (var d = 0; d < desc.length; d++) subSet.add(desc[d]);
  }

  var hidden = 0;
  for (var u = 0; u < tagged.length; u++) {
    var el = tagged[u];
    var id = parseInt(el.getAttribute('data-idx'), 10);
    if (keep[id]) continue;                    // keep 自身
    if (ancSet.has(el)) continue;              // keep 祖先——保优先（delete 也不例外）
    if (!del[id] && subSet.has(el)) continue;  // keep 子孙保护；delete 噪音例外
    el.style.setProperty('visibility', 'hidden', 'important');
    // 子代显式 visible 穿透：可见后代一并覆写（未打标子代不在 hidden 计数内）
    var kids = el.querySelectorAll('*');
    for (var k = 0; k < kids.length; k++) {
      if (getComputedStyle(kids[k]).visibility === 'visible') {
        kids[k].style.setProperty('visibility', 'hidden', 'important');
      }
    }
    hidden++;
  }
  return { hidden: hidden, kept: keepEls.length };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/integration/page-exclude-noncontent.test.mjs`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add script/lib/page-exclude-noncontent.js test/integration/page-exclude-noncontent.test.mjs
git commit -m "feat: 步骤 8 分类层共享脚本——keep/祖先/子孙保护 + listFlowDeleteIds 并入 + 保优先

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: screenshot_trans.mjs 接线 + 存量夹具补 3_key_ids.json + 分类层 CLI 断言 + 文档同步

**Files:**
- Modify: `script/screenshot_trans.mjs`（前置检查、keep 拼集、分类层执行、头注）
- Modify: `test/unit/screenshot-trans.test.mjs`（setupTmp 加 keyIds 参数、各夹具补 key_ids、新断言、缺 3_key_ids 测试）
- Modify: `CLAUDE.md`（管线顺序段步骤 8 括注）

**Interfaces:**
- Consumes: Task 1 `pixelStats`；Task 2 `__u2mRevealHidden` 新返回字段；Task 3 `__u2mExcludeNonContent(keepIds, deleteIds) → {hidden, kept}`；`readSharedScript`（`script/lib/placeholder.mjs`，既有）。
- Produces: 步骤 8 新增前置输入 `3_key_ids.json`（缺失 → error，reason 含"步骤 3"）。stdout 契约字段不变。

- [ ] **Step 1: 写失败的测试**

1. `test/unit/screenshot-trans.test.mjs` 的 `setupTmp` 改造（含默认 KEY_IDS；`keyIds: null` 表示不写文件）：

```js
// 步骤 3 产物默认值：与基础 SNAPSHOT 的正文对应（标题 1、流 2/20）。
// 其余夹具按各自快照传覆盖值；trans2img id 由 CLI 自行并入 keep 集。
const KEY_IDS = { titleIds: [1], descriptionIds: [], standaloneIds: [], listFlowIds: [2, 20], listFlowDeleteIds: [] };

function setupTmp(name, { snapshot = SNAPSHOT, skeleton = SKELETON, longText = LONG_TEXT, keyIds = KEY_IDS } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-sstrans-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(LIVE_URL));
  const assetsDir = path.join(urlDir, 'assets');
  fs.mkdirSync(urlDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  if (snapshot !== null) fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);
  if (skeleton !== null) fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), JSON.stringify(skeleton));
  if (longText !== null) fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify(longText));
  if (keyIds !== null) fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(keyIds));
  return { tmpRoot, urlDir, assetsDir };
}
```

2. 各既有夹具调用点补 keyIds（保持既有断言不变）：

```js
// INNER_WIDER / TIE 测试：
setupTmp('innerwider', { snapshot: SNAPSHOT_INNER_WIDER, skeleton: [{ trans2img: [30, 31] }],
  keyIds: { titleIds: [], descriptionIds: [], standaloneIds: [], listFlowIds: [], listFlowDeleteIds: [] } });
setupTmp('tie', { snapshot: SNAPSHOT_TIE, skeleton: [{ trans2img: [40, 41] }],
  keyIds: { titleIds: [], descriptionIds: [], standaloneIds: [], listFlowIds: [], listFlowDeleteIds: [] } });
// ACCORDION / MAXHEIGHT / CONTENTS（含 contents-only）测试：
keyIds: { titleIds: [1], descriptionIds: [], standaloneIds: [], listFlowIds: [60], listFlowDeleteIds: [] }
// WIDE 测试（Task 2 追加的）：
keyIds: { titleIds: [1], descriptionIds: [], standaloneIds: [], listFlowIds: [2, 60], listFlowDeleteIds: [98] }
```

（默认 KEY_IDS 覆盖基础 SNAPSHOT 与 code/imgs/mix 等用例，无需逐个改。）

3. SNAPSHOT_WIDE 追加分类层元素——在 `<p data-idx="2">正文段落。</p>` 之后插一行侧栏，在表格最后一行 `<tr>` 之前插青色广告行：

```js
<div data-idx="97" style="position: absolute; top: 160px; right: 0; width: 120px; height: 400px; background: rgb(75, 0, 130); z-index: 100"></div>
```

```html
<tr><td colspan="28" style="height: 40px; border: 1px solid rgb(120, 120, 120); background: rgb(200, 220, 240)"><div data-idx="98" style="height: 40px; background: rgb(0, 255, 255)">广告位</div></td></tr>
```

4. WIDE 测试的 pixelStats 查询追加两项断言：

```js
    const s = await pixelStats(path.join(assetsDir, 'trans', '92.webp'), [
      // ……既有四项不动……
      { name: 'purple', kind: 'count', rgb: [75, 0, 130] },
      { name: 'cyan', kind: 'count', rgb: [0, 255, 255] },
    ]);
    // ……既有断言不动，追加：
    assert.equal(s.purple, 0, `非内容侧栏（双层共同路径）应隐藏: ${s.purple}`);
    assert.equal(s.cyan, 0, `keep 子树内 delete 噪音（分类层独有路径）应隐藏: ${s.cyan}`);
```

5. 新增缺前置测试（追加到"缺前置产物时报 error"测试内，作为第四段）：

```js
  // 缺步骤 3（3_key_ids.json）
  const noKey = setupTmp('nokey', { keyIds: null });
  const r4 = await runScript(process.execPath, [script, '--url', LIVE_URL], {
    env: { U2M_WORKING_ROOT: noKey.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r4.code, 1);
  assert.ok(JSON.parse(r4.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKey.tmpRoot, { recursive: true, force: true });
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: FAIL 恰好三处——WIDE 测试的 `purple`/`cyan` 断言（分类层未接线，侧栏与子树内 delete 噪音仍在截图中）与"缺步骤 3"用例（CLI 尚不检查 `3_key_ids.json`，跑完整流程 code=0）。存量用例此时仍 PASS（key_ids 文件已写出但 CLI 未读取）——这就是接线前的预期状态。

- [ ] **Step 3: 实现接线**

`script/screenshot_trans.mjs` 四处修改：

(a) 头注输入清单与第三轮描述同步——"读 7_skeleton.json + 1_snapshot.html + 2_long_text.json"改为"读 7_skeleton.json + 1_snapshot.html + 2_long_text.json + 3_key_ids.json"；第三轮"截图（live 重渲染 + 严校验 + 快照兜底）"描述句"折叠模块……强制展开"之后、"首选页盒无效或截图失败"之前，插入一句：

```
 *      截图前双层排除：分类层 page-exclude-noncontent.js 每页一次（keep
 *      = titleIds∪descriptionIds∪standaloneIds∪listFlowIds∪trans2img id，
 *      隐藏集 = id 全集 − keep − keep 祖先 − keep 子孙，并入
 *      listFlowDeleteIds，保优先；visibility:hidden 零重排），几何层
 *      page-reveal-hidden.js 逐 id 三段（纵向展开 + 横向裁剪 reveal +
 *      非亲族遮挡者隐藏——fixed/sticky 一律、其余盒相交即藏，亲族保留）；
```

(b) 前置检查（紧跟 `2_long_text.json` 检查之后）：

```js
  const keyIdsPath = path.join(dir, '3_key_ids.json');
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }
  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
```

(c) `transIds` 定义之后（`const transIds = [...new Set(transEntries.flat())];` 紧后）拼 keep 集：

```js
  // 分类层 keep 集（spec §3.1）：四类正文 id ∪ trans2img id（截图目标必须保）
  const keepIds = [...new Set([
    ...(keyIds.titleIds || []),
    ...(keyIds.descriptionIds || []),
    ...(keyIds.standaloneIds || []),
    ...(keyIds.listFlowIds || []),
    ...transIds,
  ])];
  const noiseIds = Array.isArray(keyIds.listFlowDeleteIds) ? keyIds.listFlowDeleteIds : [];
```

共享脚本读取区追加：

```js
  const excludeFn = await readSharedScript('page-exclude-noncontent.js');
```

(d) 分类层执行——`const srcLabel = (pg) => ...` 定义行之后、截图循环之前：

```js
    // ── 分类层：非文章内容元素页面级排除（双层第一层，spec §3.1）──
    // 签名计算之后、截图循环之前执行（visibility 不动 tag/children/
    // textContent，签名不受影响；零重排，boundingBox 择优不受影响）
    for (const page of [pageA, pageB]) {
      if (!page) continue;
      const ex = await page.evaluate(`(${excludeFn})(${JSON.stringify(keepIds)}, ${JSON.stringify(noiseIds)})`);
      debug(`分类层排除（${srcLabel(page)}）: 隐藏 ${ex.hidden} / keep 命中 ${ex.kept}`);
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: 全部 PASS（含新 purple/cyan = 0、缺步骤 3 error、全部存量用例）。

- [ ] **Step 5: CLAUDE.md 同步**

`CLAUDE.md` 管线顺序段步骤 8 括注中，把这句：

```
每 id 截图前跑共享 `page-reveal-hidden.js` 强制展开，自元素向 body 只覆写正在隐藏的属性——display:none→block、visibility、opacity、max-height/height 塌缩、`[hidden]`——可见时零改动、签名在前不受影响；
```

替换为：

```
截图前双层排除 + 逐 id 三段手术——分类层 `page-exclude-noncontent.js` 每页一次（keep = titleIds∪descriptionIds∪standaloneIds∪listFlowIds∪trans2img id，隐藏集 = id 全集 − keep − keep 祖先 − keep 子孙，并入 listFlowDeleteIds，保优先，`visibility:hidden` 零重排），几何层 `page-reveal-hidden.js` 逐 id 三段：纵向强制展开（display:none→block、visibility、opacity、`[hidden]`、max-height/height 塌缩）、横向裁剪 reveal（祖先链 overflow-x 裁剪且 clientWidth<scrollWidth → overflow:visible，走到 html 含 body/html）、非亲族遮挡者隐藏（fixed/sticky 一律、其余盒相交即 `visibility:hidden`，可见后代一并覆写，亲族保留）；
```

- [ ] **Step 6: 全量回归**

Run: `pnpm test:all`
Expected: 单测 + 集成全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs CLAUDE.md
git commit -m "feat: 步骤 8 接线双层排除——读 3_key_ids 拼 keep 集、两页分类层执行 + 文档同步

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 真实 URL 冒烟记录（主会话执行，非子智能体任务）

**Files:**
- Modify: `test/smoke/SMOKE.md`

**Interfaces:**
- Consumes: 已完成的全管线（步骤 0-8）。需要网络与 chromium。
- Produces: SMOKE.md 中本特性的冒烟记录（通过/不通过 + 证据）。

- [ ] **Step 1: 冒烟执行**

按 `test/smoke/SMOKE.md` 既有流程对 openai 文档页（spec spike 所用页面）跑步骤 1 → 8（`U2M_DEBUG=1`），检查：
1. trans 截图超视口带有真实内容（对照修复前的空白）；
2. 截图无 fixed 导航/悬浮元素像素；
3. stderr 出现 `横向裁剪 reveal`、`遮挡者隐藏`、`分类层排除` debug 行，数值非零。

- [ ] **Step 2: 记录**

把场景、命令、判定结果追加到 `test/smoke/SMOKE.md`（沿用既有记录格式）。若冒烟发现问题，回到对应 Task 修复后重跑，不得带着失败记录收尾。

- [ ] **Step 3: 提交**

```bash
git add test/smoke/SMOKE.md
git commit -m "test: trans2img 双层排除 + 三段手术真实 URL 冒烟记录

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：§3.1 分类层 → Task 3+4；§3.2 纵向 → Task 2 保留段；§3.3 横向 → Task 2；§3.4 遮挡者泛化 → Task 2；§3.5 返回值/调用侧 → Task 2 Step 6 + Task 4；§4 不变量 → Global Constraints + 各头注；§5 断言 1-6 → Task 2（1/2/3/4/6）+ Task 4（5 的 purple/cyan）；§6 文档同步 → Task 2（page-reveal-hidden 头注随整文件替换）、Task 3（新文件头注）、Task 4（screenshot_trans 头注 + CLAUDE.md；SKILL.md 按 spec 无需改动）；§7 冒烟 → Task 5。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤带完整代码。
3. **类型一致性**：`pixelStats(imgPath, queries)`（Task 1 定义，Task 2/4 使用同签名）；`__u2mRevealHidden` 返回字段六项（Task 2 定义，Step 6 debug 使用 `wideTouched`/`occluders`）；`__u2mExcludeNonContent(keepIds, deleteIds) → {hidden, kept}`（Task 3 定义，Task 4 调用一致）；keep 集变量名 `keepIds`/`noiseIds` 在 Task 4 内部自洽。
