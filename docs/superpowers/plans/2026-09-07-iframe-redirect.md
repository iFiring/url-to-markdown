# 内嵌 iframe 页面重定向转换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「壳页 + 占优内容 iframe」页面在步骤 1 重定向到 frame 真实 URL 做一等转换，配套 `redirected_` 特殊目录、`redirect_to.yaml` marker、步骤 0 瘦身与步骤 1 参数产出。

**Architecture:** snapshot.mjs 在登录+滚动后插「重定向门」——检测模块（共享页面脚本 `page-detect-iframe.js` 判定规则 + `lib/snapshot-redirect.mjs` 编排测量与跳转）命中则 `snapshotLogin`（内含 gotoSettled + 登录检测复跑）跳到目标页原生续跑全管线；快照成功后写 marker；`urlDir()` 经 marker 一次 `existsSync` 间接定位 `redirected_<原名>` 目录，步骤 2-9 接口零变化。

**Tech Stack:** Node ≥20 ESM、Playwright 1.62（chromium）、node --test、bash（init.sh）。

**Spec:** `docs/superpowers/specs/2026-09-07-iframe-redirect-design.md`（本计划从 spec 出发，执行者两者都读）

## Global Constraints

- 每个 CLI（含 init.sh）stdout **恰好一行 JSON**，失败路径也不例外；日志走 stderr；退出码 0/1/2（usage_error=2）
- **emit 延迟退出陷阱**：`emit()`/`usage()` 同步返回、在写回调里 `process.exit`——调用后不得继续执行任何会输出或崩溃的代码
- 共享页面脚本约定：`script/lib/page-*.js` 是普通非模块文件、恰好一个具名 `function __u2mXxx(...)`；Node 侧以**文本**读入注入：`page.evaluate(`(${src})(${JSON.stringify(cfg)})`)`
- lib/ 阶段模块**不 emit**——抛异常（`err.reason`）或返回值，由 snapshot.mjs 统一 emit
- 浏览器/viewer 一律在最终 emit **之前**关闭
- 重定向门常量（spec §4）：`MIN_FRAME_TEXT=500`、`TEXT_RATIO=3`、`MIN_BOX=200`、`MAX_HOPS=2`、`DEGENERATE_RATIO=0.5`
- 正文测量统一口径（唯一副本在 snapshot-redirect.mjs）：`innerText.replace(/\s+/g,' ').trim().length`
- 测试隔离：一律用 `U2M_WORKING_ROOT` 指向 mkdtemp 临时目录；真实 URL 冒烟只在 Task 8

---

### Task 1: env 命名与 marker（redirectedDirName / urlDir 间接 / marker 读写）

**Files:**
- Modify: `script/lib/env.mjs`（在 `urlDir` 之后追加；`urlToDirName`/`ensureUrlDirs` 改动见步骤）
- Test: `test/unit/env-redirect.test.mjs`（新建）

**Interfaces:**
- Consumes: 现有 `urlToDirName(url)`、`workingRoot()`
- Produces（后续任务依赖的精确签名）:
  - `redirectedDirName(url: string): string`
  - `redirectMarkerPath(url: string): string` — `working/redirected_<名>/redirect_to.yaml` 绝对路径
  - `hasRedirectMarker(url: string): boolean`
  - `writeRedirectMarker(url: string, to: string): void`
  - `clearRedirectMarker(url: string): void` — 不存在时静默
  - `urlDir(url)` 行为变更：marker 存在 → `redirected_<名>` 目录；否则原名目录
  - `ensureUrlDirs(url, dirName?)` — 第二参数覆写目录名（步骤 1 在 marker 写入前显式指定用）；不传时按 `urlToDirName(url)`（**不含** marker 间接——步骤 1 之外的调用方在步骤 1 成功后走 `urlDir` 的间接结果……注意：见步骤 3 的实现，间接统一放 `urlDir`，`ensureUrlDirs` 覆写参数优先）

- [ ] **Step 1: 写失败测试**

```js
// test/unit/env-redirect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  redirectedDirName, redirectMarkerPath, hasRedirectMarker,
  writeRedirectMarker, clearRedirectMarker, urlDir, urlToDirName,
} from '../../script/lib/env.mjs';
import crypto from 'node:crypto';

let tmp;
test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-env-redirect-'));
  process.env.U2M_WORKING_ROOT = tmp;
});
test.after(() => {
  delete process.env.U2M_WORKING_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const URL = 'https://mmh1.top/article#/ai-article/skill';

test('redirectedDirName: redirected_ 前缀 + 与 urlToDirName 同款净化', () => {
  assert.equal(redirectedDirName('https://example.com/a?b=1'), 'redirected_example.com_a_b_1');
  assert.equal(
    redirectedDirName(URL),
    'redirected_' + urlToDirName(URL),
    '短 URL：前缀直接拼 urlToDirName 结果',
  );
});

test('redirectedDirName: 超 120 字符截断 + sha256("redirected_"+url) 前 8 位', () => {
  const longUrl = 'https://example.com/' + 'x'.repeat(200);
  const name = redirectedDirName(longUrl);
  assert.ok(name.length <= 128, '120 + 8 hex');
  assert.ok(name.startsWith('redirected_'));
  const expectHash = crypto.createHash('sha256').update('redirected_' + longUrl, 'utf8').digest('hex').slice(0, 8);
  assert.ok(name.endsWith(expectHash));
});

test('marker: 写入/存在/删除生命周期；删除不存在不报错；内容损坏不影响定位', () => {
  assert.equal(hasRedirectMarker(URL), false, '初始无 marker');
  writeRedirectMarker(URL, 'https://mmh1.top/article/skill.html');
  assert.equal(hasRedirectMarker(URL), true);
  assert.equal(
    fs.readFileSync(redirectMarkerPath(URL), 'utf8'),
    'to: https://mmh1.top/article/skill.html\n',
  );
  // 定位只依赖存在性，不解析内容——marker 内容损坏仍生效（spec §7）
  fs.writeFileSync(redirectMarkerPath(URL), '!!!garbage!!!\n', 'utf8');
  assert.equal(hasRedirectMarker(URL), true);
  assert.equal(urlDir(URL), path.join(tmp, redirectedDirName(URL)));
  clearRedirectMarker(URL);
  assert.equal(hasRedirectMarker(URL), false);
  clearRedirectMarker(URL); // 再删不报错
});

test('urlDir: marker 存在 → redirected 目录；不存在 → 原名目录；目录在但无 marker → 原名', () => {
  const plain = path.join(tmp, urlToDirName(URL));
  assert.equal(urlDir(URL), plain, '无 marker 时现状行为');
  // 目录存在但无 marker = 陈旧残留 → 仍走原名
  fs.mkdirSync(path.join(tmp, redirectedDirName(URL)), { recursive: true });
  assert.equal(urlDir(URL), plain, '陈旧 redirected 目录不影响定位');
  writeRedirectMarker(URL, 'https://mmh1.top/article/skill.html');
  assert.equal(urlDir(URL), path.join(tmp, redirectedDirName(URL)));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/env-redirect.test.mjs`
Expected: FAIL——`redirectedDirName` 等导出不存在（SyntaxError: The requested module does not provide an export）

- [ ] **Step 3: 实现**

`script/lib/env.mjs` 追加（放在 `urlDir` 定义之前，`urlDir` 本体替换）：

```js
/** 重定向特殊目录名：redirected_ + 与 urlToDirName 同款净化；>120 截断 + sha256('redirected_'+url) 前 8 位。 */
export function redirectedDirName(url) {
  const prefixed = 'redirected_' + url.replace(/^https?:\/\//i, '').replace(/[^A-Za-z0-9.-]/g, '_');
  if (prefixed.length <= 120) return prefixed;
  const hash = crypto.createHash('sha256').update('redirected_' + url, 'utf8').digest('hex').slice(0, 8);
  return prefixed.slice(0, 120) + hash;
}

/** marker 文件：working/redirected_<名>/redirect_to.yaml。定位只依赖存在性，内容纯诊断。 */
export function redirectMarkerPath(url) {
  return path.join(workingRoot(), redirectedDirName(url), 'redirect_to.yaml');
}

export function hasRedirectMarker(url) {
  return fs.existsSync(redirectMarkerPath(url));
}

/** 快照成功后写入（唯一写者 snapshot.mjs）。 */
export function writeRedirectMarker(url, to) {
  const file = redirectMarkerPath(url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `to: ${to}\n`, 'utf8');
}

/** 步骤 1 检测未命中时清理 stale marker；不存在则静默。 */
export function clearRedirectMarker(url) {
  try { fs.unlinkSync(redirectMarkerPath(url)); } catch { /* 不存在即无操作 */ }
}
```

`urlDir` 替换为：

```js
export function urlDir(url) {
  const name = hasRedirectMarker(url) ? redirectedDirName(url) : urlToDirName(url);
  return path.join(workingRoot(), name);
}
```

`ensureUrlDirs` 加覆写参数（其余行不变）：

```js
export function ensureUrlDirs(url, dirName) {
  const dir = path.join(workingRoot(), dirName || urlToDirName(url));
  // ……assets/images/trans 创建逻辑保持原样
```

- [ ] **Step 4: 跑测试确认通过 + 现有单测回归**

Run: `node --test test/unit/env-redirect.test.mjs && pnpm test`
Expected: 全部 PASS（无 marker 时 urlDir/ensureUrlDirs 行为与现状完全一致）

- [ ] **Step 5: Commit**

```bash
git add script/lib/env.mjs test/unit/env-redirect.test.mjs
git commit -m "feat(env): redirected_ 目录名 + redirect_to.yaml marker + urlDir 指针间接"
```

---

### Task 2: 重定向检测模块（page-detect-iframe.js + snapshot-redirect.mjs）

**Files:**
- Create: `script/lib/page-detect-iframe.js`
- Create: `script/lib/snapshot-redirect.mjs`（本任务只实现 `snapshotRedirectDetect`；`runRedirectGate` 在 Task 3 加）
- Create: `test/fixtures/redirect-content.html`、`test/fixtures/redirect-shell-dyn.html`、`test/fixtures/redirect-busy-main.html`
- Test: `test/integration/redirect-detect.test.mjs`（新建）

**Interfaces:**
- Consumes: `readSharedScript(name)`（placeholder.mjs）
- Produces:
  - `snapshotRedirectDetect(page: Page, opts?: {log?: Function}) => Promise<{redirect: {url: string, frameText: number} | null, mainText: number}>`
  - 页面脚本 `__u2mDetectContentFrame(cfg)`：cfg = `{mainText, frameTexts: {[absoluteSrc]: number}}`，返回 `{redirect: {url, frameText} | null}`——判定规则唯一事实源
  - Task 3 将在同模块追加 `runRedirectGate(page, url, opts)`

- [ ] **Step 1: 建夹具**

`test/fixtures/redirect-content.html`（正文经脚本撑到 ~2300 字符，检测在渲染后测量）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>重定向内容页</title></head>
<body>
<main>
  <h1>内容页主标题</h1>
  <p id="fill"></p>
  <p>内容页固定尾部段落，保证即使脚本失效也有基础结构。</p>
</main>
<script>document.getElementById('fill').textContent = '重定向内容页的正文句子，用于撑起足够的文本量。'.repeat(100);</script>
</body>
</html>
```

`test/fixtures/redirect-shell-dyn.html`（壳页；iframe 目标由 `?to=` 查询参数注入——同一夹具服务同源与跨域两种测试）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>动态壳页</title></head>
<body>
<div id="shell">Loading…</div>
<iframe id="frame" width="800" height="600"></iframe>
<script>
  const to = new URLSearchParams(location.search).get('to');
  if (to) document.getElementById('frame').src = to;
</script>
</body>
</html>
```

`test/fixtures/redirect-busy-main.html`（主文档充实 + frame 不达标 + srcdoc iframe——三重反例）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>主文档充实页</title></head>
<body>
<main>
  <h1>主文档自身内容充足</h1>
  <p id="fill"></p>
</main>
<iframe src="/iframe-body.html" width="800" height="600"></iframe>
<iframe srcdoc="<p>srcdoc 内容</p>" width="800" height="600"></iframe>
<script>document.getElementById('fill').textContent = '主文档充实页的正文句子，用于撑起主文档文本量。'.repeat(40);</script>
</body>
</html>
```

（`iframe-body.html` 现存正文 ~250 字符 < `MIN_FRAME_TEXT=500`；srcdoc 无 http(s) src 非候选。）

- [ ] **Step 2: 写失败测试**

```js
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/integration/redirect-detect.test.mjs`
Expected: FAIL——`snapshot-redirect.mjs` 不存在（module not found）

- [ ] **Step 4: 实现**

`script/lib/page-detect-iframe.js`（判定规则唯一事实源；同步函数）：

```js
function __u2mDetectContentFrame(cfg) {
  cfg = cfg || {};
  const MIN_FRAME_TEXT = cfg.minFrameText ?? 500; // frame 正文下限
  const TEXT_RATIO = cfg.textRatio ?? 3;          // frame 须 ≥ 比例 × 主文档正文
  const MIN_BOX = cfg.minBox ?? 200;              // iframe 可视盒下限（px）
  const mainText = cfg.mainText || 0;
  const frameTexts = cfg.frameTexts || {};
  const hereUrl = location.href.split('#')[0];
  let best = null;
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    const src = (f.src || '').split('#')[0];
    if (!/^https?:/i.test(src) || src === hereUrl) continue; // 可导航（排除 srcdoc/about:blank/自嵌套）
    const r = f.getBoundingClientRect();
    if (r.width < MIN_BOX || r.height < MIN_BOX) continue;   // 可见（排除隐藏工具 iframe）
    const textLen = frameTexts[src];
    if (typeof textLen !== 'number' || textLen < MIN_FRAME_TEXT) continue; // 内容量
    if (textLen < TEXT_RATIO * mainText) continue;            // 占优
    if (!best || textLen > best.frameText) best = { url: src, frameText: textLen };
  }
  return { redirect: best };
}
```

`script/lib/snapshot-redirect.mjs`：

```js
// script/lib/snapshot-redirect.mjs
// 步骤 1 重定向门：占优内容 iframe 检测 + 跳转编排（runRedirectGate 见下任务）。
// 测量（正文长度归一化口径）唯一副本在本模块；判定规则唯一事实源在 page-detect-iframe.js。
import { readSharedScript } from './placeholder.mjs';

const MIN_FRAME_TEXT = 500;
const TEXT_RATIO = 3;
const MIN_BOX = 200;
export const MAX_HOPS = 2;
export const DEGENERATE_RATIO = 0.5;

const measureTextLen = async (target) => target.evaluate(() => {
  const t = document.body && document.body.innerText ? document.body.innerText : '';
  return t.replace(/\s+/g, ' ').trim().length;
});

/**
 * 占优内容 iframe 检测。在当前页面（主文档）上执行。
 * @param {import('playwright').Page} page
 * @param {{log?: Function}} opts
 * @returns {Promise<{redirect: {url: string, frameText: number} | null, mainText: number}>}
 */
export async function snapshotRedirectDetect(page, opts = {}) {
  const { log = () => {} } = opts;
  const pageDetect = await readSharedScript('page-detect-iframe.js');

  // 逐 frame 测正文（Playwright 经 CDP，跨域 frame 同样可测；导航中的 frame 跳过）
  const frameTexts = {};
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try { frameTexts[f.url().split('#')[0]] = await measureTextLen(f); }
    catch { /* frame 正在导航/已销毁 */ }
  }
  const mainText = await measureTextLen(page);

  const cfg = { mainText, frameTexts, minFrameText: MIN_FRAME_TEXT, textRatio: TEXT_RATIO, minBox: MIN_BOX };
  const { redirect } = await page.evaluate(`(${pageDetect})(${JSON.stringify(cfg)})`);
  if (redirect) log(`重定向门命中: ${redirect.url}（frame ${redirect.frameText} vs 主文档 ${mainText}）`);
  else log('重定向门未命中');
  return { redirect, mainText };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/integration/redirect-detect.test.mjs`
Expected: 4 个测试全 PASS

- [ ] **Step 6: Commit**

```bash
git add script/lib/page-detect-iframe.js script/lib/snapshot-redirect.mjs test/fixtures/redirect-content.html test/fixtures/redirect-shell-dyn.html test/fixtures/redirect-busy-main.html test/integration/redirect-detect.test.mjs
git commit -m "feat(redirect): 占优内容 iframe 检测——页面脚本判定规则 + Node 编排测量（同源/跨域）"
```

---

### Task 3: snapshot.mjs 接线重定向门（跳转/登录复跑/滚动/marker/emit 四字段）

**Files:**
- Modify: `script/snapshot.mjs`（main 流程 76-112 行区域 + 头部注释）
- Modify: `script/lib/snapshot-redirect.mjs`（追加 `runRedirectGate`）
- Test: `test/integration/redirect-pipeline.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `redirectedDirName`/`ensureUrlDirs(url, dirName)`/`writeRedirectMarker`/`clearRedirectMarker`；Task 2 的 `snapshotRedirectDetect`；现有 `snapshotLogin`（自带 gotoSettled + 登录检测，跳转复用它）、`snapshotScroll`、`gotoSettled`
- Produces:
  - `runRedirectGate(page: Page, url: string, opts: {timeout: number, storageStatePath?: string, scrollRounds: number, log?: Function}) => Promise<{redirected: boolean, to: string | null}>`——Task 5 的测试直接跑 snapshot.mjs，不直接调它，但签名保持此形状
  - snapshot.mjs ok emit 增字段：`skill-root`、`url-name`、`url-working-path`、`redirect: {to, urlName} | null`

- [ ] **Step 1: 写失败测试**

```js
// test/integration/redirect-pipeline.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName, redirectedDirName, writeRedirectMarker } from '../../script/lib/env.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
const cleanScript = path.resolve('script/clean_snapshot.mjs');
let server;
let tmpRoot;

before(async () => {
  server = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-redirect-'));
});
after(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const runSnapshot = (url, extraEnv = {}) => runScript(process.execPath, [snapshotScript, '--url', url], {
  env: { U2M_WORKING_ROOT: tmpRoot, ...extraEnv },
  timeoutMs: 90000,
});

test('壳页+占优 iframe → redirected_ 目录快照 + emit 四字段 + marker + 步骤 2 交接', async () => {
  const url = `${server.url}/redirect-shell-dyn.html?to=/redirect-content.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out['url-name'], redirectedDirName(url), 'url-name 应为 redirected_ 特殊名');
  assert.equal(out['url-working-path'], path.join(tmpRoot, redirectedDirName(url)));
  assert.equal(path.resolve(out['skill-root']), path.resolve('.'));
  assert.equal(out.redirect.to, `${server.url}/redirect-content.html`);
  assert.equal(out.redirect.urlName, redirectedDirName(url));

  const snapFile = path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html');
  assert.ok(fs.existsSync(snapFile), '快照应在 redirected_ 目录');
  const html = fs.readFileSync(snapFile, 'utf8');
  assert.ok(html.includes('内容页主标题'), '快照应为内容页');
  assert.ok(!html.includes('<iframe'), '内容页不应残留 iframe 元素');
  assert.ok(!fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')), '原名目录不应有快照');

  const marker = path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml');
  assert.ok(fs.existsSync(marker));
  assert.equal(fs.readFileSync(marker, 'utf8'), `to: ${server.url}/redirect-content.html\n`);

  // 步骤 2 交接：仍用原 URL 调用，产物应落在 redirected_ 目录
  const c = await runScript(process.execPath, [cleanScript, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 90000,
  });
  assert.equal(c.code, 0, `stderr: ${c.stderr}`);
  assert.ok(fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '2_clean_snapshot.html')), '步骤 2 应经 marker 定位 redirected_ 目录');
});

test('普通页 → redirect:null + 原名目录 + 无 marker', async () => {
  const url = `${server.url}/static-article.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect, null);
  assert.equal(out['url-name'], urlToDirName(url));
  assert.ok(fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')));
});

test('stale marker：普通页运行后被清除', async () => {
  const url = `${server.url}/static-article.html`;
  writeRedirectMarker(url, 'https://stale.example.com/x.html');
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')), '未命中应删 stale marker');
});

test('重定向后虚拟列表 → error 不写 marker 不建 redirected 目录', async () => {
  const url = `${server.url}/redirect-shell-dyn.html?to=/redirect-content-vlist.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).reason, 'virtual_list');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')), '失败不写 marker');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html')), '失败无快照');
});
```

并建虚拟列表内容页 `test/fixtures/redirect-content-vlist.html`（初始渲染 30 条 ≈700 字符过检测门槛；滚动时窗口化回收顶部 → 虚拟列表检测命中）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>虚拟列表内容页</title></head>
<body>
<div id="list"></div>
<script>
  const items = Array.from({ length: 500 }, (_, i) => `VLIST 条目 ${String(i).padStart(3, '0')} ` + '窗口化内容句。'.repeat(4));
  const list = document.getElementById('list');
  document.body.style.height = (items.length * 50) + 'px';
  const render = () => {
    const top = Math.max(0, Math.floor(scrollY / 50) - 5);
    list.innerHTML = items.slice(top, top + 30).map((t) => `<p>${t}</p>`).join('');
  };
  addEventListener('scroll', render);
  render();
</script>
</body>
</html>
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/integration/redirect-pipeline.test.mjs`
Expected: FAIL——第一个测试 `url-name` 为原名、`out.redirect` 为 undefined（snapshot.mjs 尚无重定向门与新字段）

- [ ] **Step 3: 实现 runRedirectGate（追加到 snapshot-redirect.mjs）**

文件头 import 区补：

```js
import { snapshotLogin } from './snapshot-login.mjs';
import { snapshotScroll } from './snapshot-scroll.mjs';
import { gotoSettled } from './browser.mjs';
```

追加导出：

```js
/**
 * 重定向门编排：检测 → 命中则跳转目标页（snapshotLogin 内含 gotoSettled +
 * 登录检测复跑，跨域登录墙时 viewer 开在内容页）→ 退化守卫 → 重新滚动。
 * 嵌套占优 iframe 递归，总跳数上限 MAX_HOPS。
 * @returns {Promise<{redirected: boolean, to: string | null}>} to = 最终目标 URL
 */
export async function runRedirectGate(page, url, opts = {}) {
  const { timeout, storageStatePath: ssPath, scrollRounds, log = () => {} } = opts;
  let redirected = null;
  let currentUrl = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const detect = await snapshotRedirectDetect(page, { log });
    if (!detect.redirect) break;
    const prevUrl = currentUrl;

    await snapshotLogin(page, detect.redirect.url, { timeout, storageStatePath: ssPath, log });

    // 退化守卫：目标页独立打开渲染不出内容（如 window.top 检测站）→ 回上一页走现状路径
    const targetText = await measureTextLen(page);
    if (targetText < DEGENERATE_RATIO * detect.redirect.frameText) {
      log(`重定向目标正文退化（${targetText} < ${Math.round(DEGENERATE_RATIO * detect.redirect.frameText)}），回退 ${prevUrl}`);
      await gotoSettled(page, prevUrl, log);
      await snapshotScroll(page, { scrollRounds, log });
      break; // redirected 保持上一次成功跳转（首跳退化则为 null）
    }

    redirected = detect.redirect;
    currentUrl = detect.redirect.url;
    await snapshotScroll(page, { scrollRounds, log });
  }
  return { redirected: !!redirected, to: redirected ? redirected.url : null };
}
```

- [ ] **Step 4: 改 snapshot.mjs 主流程**

文件头 import 区补（现有 import 不动）：

```js
import { projectRoot, urlToDirName, redirectedDirName, ensureUrlDirs, writeRedirectMarker, clearRedirectMarker } from './lib/env.mjs';
import { runRedirectGate } from './lib/snapshot-redirect.mjs';
```

（`storageStatePath` 已在原 import 里；`ensureUrlDirs` 原本就 import——合并进同一行。）

main() 中原 76-78 行：

```js
  const ssPath = storageStatePath();
  const dirs = ensureUrlDirs(url);
  debug(`url-dir: ${dirs.urlDir}；storageState ${fsSync.existsSync(ssPath) ? '已注入' : '不存在'}；timeout=${timeout}ms scroll-rounds=${scrollRounds}`);
```

改为（目录创建推迟到重定向决策后）：

```js
  const ssPath = storageStatePath();
  debug(`storageState ${fsSync.existsSync(ssPath) ? '已注入' : '不存在'}；timeout=${timeout}ms scroll-rounds=${scrollRounds}`);
```

原 99-112 行四阶段 + emit 改为：

```js
    await timed('登录阶段', () => snapshotLogin(page, url, { timeout, storageStatePath: ssPath, log }));
    await timed('滚动阶段', () => snapshotScroll(page, { scrollRounds, log: debug }));
    const gate = await timed('重定向门', () =>
      runRedirectGate(page, url, { timeout, storageStatePath: ssPath, scrollRounds, log: debug }));
    await timed('检测阶段', () => snapshotDetect(page, { log: debug }));

    // 目录创建在重定向决策后：redirected 页用特殊名（marker 尚未写入，显式指定）
    const dirName = gate.redirected ? redirectedDirName(url) : urlToDirName(url);
    const dirs = ensureUrlDirs(url, dirName);
    const result = await timed('快照阶段', () => snapshotCapture(page, { outDir: dirs.urlDir, log }));

    // marker 生命周期：快照成功后写入；未命中清除 stale（spec §5.2）
    if (gate.redirected) writeRedirectMarker(url, gate.to);
    else clearRedirectMarker(url);

    // 先关浏览器再 emit
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: result.snapshotPath,
      elements: result.elements,
      'skill-root': projectRoot(),
      'url-name': dirName,
      'url-working-path': dirs.urlDir,
      redirect: gate.redirected ? { to: gate.to, urlName: dirName } : null,
    });
```

文件头部注释（32-36 行 stdout 说明段）改为：

```
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","snapshot":"...","elements":N,"skill-root":"...",
 *    "url-name":"...","url-working-path":"...","redirect":{...}|null} → 退出码 0
 *   {"status":"error","reason":"virtual_list"}  虚拟列表，未写快照 → 1
 *   {"status":"error","reason":"login_timeout"|"login_aborted"|...} → 1
 *
 * 重定向门：登录+滚动后检测「占优内容 iframe」（同源/跨域，见
 * lib/snapshot-redirect.mjs），命中则跳转目标页原生续跑；快照成功后写
 * redirect_to.yaml marker，urlDir() 据此把步骤 2-9 定位到 redirected_ 目录。
```

并把头注「四阶段」措辞改为「五阶段（登录 → 滚动 → 重定向门 → 虚拟列表检测 → 快照）」。

- [ ] **Step 5: 跑测试确认通过 + 快照集成回归**

Run: `node --test test/integration/redirect-pipeline.test.mjs test/integration/snapshot-integration.test.mjs test/integration/redirect-detect.test.mjs`
Expected: 全 PASS（现有快照集成测试不受影响——static-article 等无占优 iframe）

- [ ] **Step 6: Commit**

```bash
git add script/snapshot.mjs script/lib/snapshot-redirect.mjs test/integration/redirect-pipeline.test.mjs test/fixtures/redirect-content-vlist.html
git commit -m "feat(snapshot): 重定向门接线——跳转/登录复跑/退化守卫/marker 生命周期 + emit 核心参数四字段"
```

---

### Task 4: 退化守卫与嵌套上限（独立打开退化回退 + 两跳嵌套 + 跨域全管线）

**Files:**
- Create: `test/fixtures/redirect-degenerate.html`、`test/fixtures/redirect-content-outer.html`
- Test: `test/integration/redirect-edge.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 3 的 snapshot.mjs 全管线行为（不直接调模块）
- Produces: 无新接口——行为覆盖：退化回退（redirect:null + 原名目录 + 无 marker）、嵌套两跳（to = 最内层）、跨域全管线

- [ ] **Step 1: 建夹具**

`test/fixtures/redirect-degenerate.html`（仅嵌入时可见——顶层打开即 display:none，innerText 为 0）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>仅嵌入可见</title></head>
<body>
<div id="app">
  <h1>嵌入态内容标题</h1>
  <p id="fill"></p>
</div>
<script>
  document.getElementById('fill').textContent = '嵌入态正文句子，撑起检测所需的文本量。'.repeat(60);
  if (window.self === window.top) document.getElementById('app').style.display = 'none';
</script>
</body>
</html>
```

`test/fixtures/redirect-content-outer.html`（外层内容页：自身 ~630 字符过 hop1 门槛，又嵌 redirect-content.html ~2300 字符过 hop2 的 3× 比例）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>外层内容页</title></head>
<body>
<main>
  <h1>外层内容页标题</h1>
  <p id="fill"></p>
</main>
<iframe src="/redirect-content.html" width="800" height="600"></iframe>
<script>document.getElementById('fill').textContent = '外层内容页正文句子，撑起跳转所需的文本量。'.repeat(30);</script>
</body>
</html>
```

- [ ] **Step 2: 写失败/验证测试**

```js
// test/integration/redirect-edge.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName, redirectedDirName } from '../../script/lib/env.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
let serverA; let serverB; let tmpRoot;

before(async () => {
  serverA = await startFixtureServer();
  serverB = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-redirect-edge-'));
});
after(() => {
  serverA?.close();
  serverB?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const runSnapshot = (url) => runScript(process.execPath, [snapshotScript, '--url', url], {
  env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 90000,
});

test('退化守卫：目标页顶层打开渲染空 → 回退原页现状路径，不写 marker', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=/redirect-degenerate.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect, null, '退化应回退为未重定向');
  assert.equal(out['url-name'], urlToDirName(url), '产物落原名目录');
  assert.ok(fs.existsSync(path.join(tmpRoot, urlToDirName(url), '1_snapshot.html')), '回退后仍应产出原页快照');
  assert.ok(!fs.existsSync(path.join(tmpRoot, redirectedDirName(url), 'redirect_to.yaml')));
});

test('嵌套两跳：壳 → 外层 → 内容，to = 最内层', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=/redirect-content-outer.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect.to, `${serverA.url}/redirect-content.html`, '两跳后应停在最内层');
  const html = fs.readFileSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html'), 'utf8');
  assert.ok(html.includes('内容页主标题'), '快照应是最内层内容页');
});

test('跨域全管线：壳(A) → 内容(B)', async () => {
  const url = `${serverA.url}/redirect-shell-dyn.html?to=${serverB.url}/redirect-content.html`;
  const r = await runSnapshot(url);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.redirect.to, `${serverB.url}/redirect-content.html`);
  assert.ok(fs.existsSync(path.join(tmpRoot, redirectedDirName(url), '1_snapshot.html')));
});
```

- [ ] **Step 3: 跑测试确认通过（Task 3 已实现守卫与循环——本任务是行为锁定；若失败按失败信息修 snapshot-redirect.mjs）**

Run: `node --test test/integration/redirect-edge.test.mjs`
Expected: 3 个测试全 PASS。若退化守卫测试失败，优先检查：检测时 frame 内 innerText 是否 ≥500（嵌入态）、回退后 `gotoSettled(prevUrl)` 是否被快照阶段前的 vlist 检测误杀

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/redirect-degenerate.html test/fixtures/redirect-content-outer.html test/integration/redirect-edge.test.mjs
git commit -m "test(redirect): 退化守卫回退 + 嵌套两跳 + 跨域全管线行为锁定"
```

---

### Task 5: init.sh 瘦身（去 --url 与核心参数产出）+ init 测试更新

**Files:**
- Modify: `script/init.sh`（头部注释 1-7 行、参数段 16-26 行、核心参数段 142-151 行、输出段 153-155 行）
- Modify: `test/integration/init.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: init.sh 契约——`bash init.sh`（**无参数**，任何参数 → usage_error 退出 2）；stdout ok 恰 `{"status":"ok","skill-root":"…","node":"…","pm":"…","chromium":true}`；**不再创建任何 URL 目录**

- [ ] **Step 1: 改测试（先红）**

`test/integration/init.test.mjs` 修改：

1. 删除顶部 `const URL = ...` 与 `const URL_NAME = ...` 两行
2. 第一个测试改为：

```js
test('init.sh: 无参数输出 ok JSON（环境信息）且不创建工作目录', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 280000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'stdout 恰一行');
  const json = JSON.parse(lines[0]);
  assert.equal(json.status, 'ok');
  assert.equal(json['skill-root'], path.resolve('.'));
  assert.ok(!('url-name' in json), 'url-name 改由步骤 1 产出');
  assert.ok(!('url-working-path' in json), 'url-working-path 改由步骤 1 产出');
  assert.ok(json.node);
  assert.ok(['pnpm', 'yarn', 'npm'].includes(json.pm));
  assert.equal(json.chromium, true);
  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'init 不再创建任何 URL 目录');
});
```

3. 幂等测试 / pnpm 自愈测试 / 五个字体测试：所有 `runScript('bash', [path.resolve('script/init.sh'), '--url', URL], …)` 改为 `runScript('bash', [path.resolve('script/init.sh')], …)`
4. usage 测试改为：

```js
test('init.sh: 传任何参数（含 --url）输出 usage_error 退出 2', async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh'), '--url', 'https://example.com/']);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/integration/init.test.mjs`
Expected: FAIL——第一个测试：json 里仍有 url-name / tmpRoot 下有目录；usage 测试：--url 仍被接受返回 0

- [ ] **Step 3: 实现**

`script/init.sh`：

头部注释（1-7 行）改为：

```bash
#!/usr/bin/env bash
# init.sh —— 步骤 0：初始化执行环境（node/pnpm/chromium/字体）。纯环境自检，
# 不产出任何 URL 相关参数（skill-root/url-name/url-working-path 由步骤 1 的
# snapshot.mjs 输出）。stdout 有且仅有一行 JSON；日志/警告走 stderr。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```

参数段（原 16-26 行整段）替换为：

```bash
# ── 0. 参数：不接受任何参数 ─────────────────────────────────────
if [ $# -gt 0 ]; then
  die_usage "未知参数: $1（用法: init.sh，无参数）"
fi
```

核心参数段（原 142-151 行整段）删除。

输出段（原 153-155 行）改为：

```bash
# ── 输出 ─────────────────────────────────────────────────────
printf '{"status":"ok","skill-root":"%s","node":"%s","pm":"%s","chromium":%s}\n' \
  "$ROOT" "$NODE_VER" "$PM" "$CHROMIUM_OK"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/integration/init.test.mjs`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add script/init.sh test/integration/init.test.mjs
git commit -m "feat(init): 步骤 0 瘦身为纯环境自检——去 --url 与核心参数产出（移交步骤 1）"
```

---

### Task 6: 文档同步（SKILL.md / CLAUDE.md / README / SMOKE）

**Files:**
- Modify: `SKILL.md`（核心参数 19-43、步骤 0 段 47-66、步骤 1 段 68-83、步骤 3/7 中 `<url-working-path>` 来源）
- Modify: `CLAUDE.md`（常用命令、管线顺序步骤 0/1 描述、工作目录段）
- Modify: `README.md`（凡提及步骤 0 输出三参数 / 步骤 1 阶段数 / 工作目录规则处）
- Modify: `test/smoke/SMOKE.md`（追加 mmh1 冒烟场景）

**Interfaces:**
- Consumes: Task 3 的 emit 字段形状、Task 1 的目录规则
- Produces: 文档与实现一致（agent 依据 SKILL.md 决策表分支——这是产品契约的一部分）

- [ ] **Step 1: SKILL.md**

1. 「核心参数」段（19-24 行）改为：

```markdown
## 核心参数

- `<url>`：指用户给定的完整 URL；所有 CLI 的必填参数
- `<skill-root>`：本技能 SKILL.md 所在目录（**绝对路径**）；由步骤 1 输出（规范化）
- `<url-name>`：当前 URL 的专属目录名，由步骤 1 输出；`replace(/[^A-Za-z0-9.-]/g, '_')` 生成（剥去 `http(s)://` 前缀）。**内嵌占优内容 iframe 的页面为特殊名 `redirected_<原名>`**（管线已自动重定向到 frame 真实 URL 转换）
- `<url-working-path>`：当前 URL 的专属目录 `<skill-root>/working/<url-name>`；由步骤 1 输出；其后产物都存放在此目录下
```

2. 目录结构图（34-42 行）`<url-name>/` 行下补一行注释 `redirected_<url-name>/  # iframe 重定向页的专属目录（内含 redirect_to.yaml 标记）`
3. 步骤 0 段（47-66 行）改为：

```markdown
### 步骤 0 · 初始化执行环境

```bash
bash <skill-root>/script/init.sh
```

| stdout.status | 动作 |
|---|---|
| `ok` | 环境就绪，进入步骤 1 |
| `error` | **终止全部流程**，把 `stdout.reason` 反馈给用户 |

纯环境自检（node/pnpm/chromium/字体），不产出 URL 相关参数。**stdout.status=ok 结构示例**
```json
{ "status": "ok", "skill-root": "/root/path/to/skill", "node": "20.x", "pm": "pnpm", "chromium": true }
```
```

4. 步骤 1 段：命令行说明后补一段「单条命令依次完成登录检测、渐进滚动、**重定向门**（占优内容 iframe → 自动跳转 frame 真实 URL 续跑）、虚拟列表检测、全保真快照抓取」；ok 示例补四字段：

```json
{
  "status": "ok",
  "snapshot": "/path/1_snapshot.html",
  "elements": 123,
  "skill-root": "/root/path/to/skill",
  "url-name": "redirected_mmh1.top_article__ai-article_skill",
  "url-working-path": "/root/path/to/skill/working/redirected_mmh1.top_article__ai-article_skill",
  "redirect": { "to": "https://mmh1.top/article/skill.html", "urlName": "redirected_mmh1.top_article__ai-article_skill" }
}
```

   并在 ok 动作行补注：`redirect` 字段仅信息通报（管线内部已消化），步骤 2 起仍以原始 `<url>` 调用各脚本；`<url-name>`/`<url-working-path>` 以本行 stdout 为准（重定向页是特殊名）
5. 步骤 3（112-119 行）与步骤 7（166-173 行）中「当前工作路径(<url-working-path>)」处各补一句：路径取步骤 1 stdout 的 `url-working-path`（重定向页为 `redirected_` 特殊名目录）

- [ ] **Step 2: CLAUDE.md**

1. 「常用命令」块首行 `bash script/init.sh --url <url>` 改为 `bash script/init.sh`
2. 「本仓库是什么」段不变；「管线顺序」步骤 0 描述改为「`init.sh` 纯环境自检（node/pnpm/chromium/字体，修复逻辑不变），不再输出核心参数」；步骤 1 描述在「登录检测 → 渐进滚动」后插入「→ **重定向门**（`snapshot-redirect.mjs`：占优内容 iframe 检测——共享 `page-detect-iframe.js` 判定规则（可导航 http(s)/可见 ≥200px/正文 ≥500 且 ≥3× 主文档，多帧取最长，嵌套 ≤2 跳）；命中则 `snapshotLogin` 跳转目标页（登录检测复跑，跨域登录墙 viewer 开在内容页）+ 退化守卫（目标页正文 <50% 回退原页）+ 重新滚动；快照成功后写 `redirected_<原名>/redirect_to.yaml` marker，未命中清 stale）」
3. 「工作目录」段补：「占优内容 iframe 页面（步骤 1 重定向门判定）的专属目录为 `redirected_<原名>`，目录内 `redirect_to.yaml`（内容 `to: <目标URL>`）是定位 marker——`urlDir()` 一次 existsSync 间接，步骤 2-9 无感知」
4. 「snapshot.mjs 单入口 + lib/ 模块」段把「四个 lib 模块」改为「五个阶段模块」（+snapshot-redirect.mjs）

- [ ] **Step 3: README.md**

通读（`grep -n "init.sh\|步骤 0\|url-name\|四阶段" README.md` 定位），把步骤 0 输出三参数、阶段数、工作目录规则的描述改为与上述一致；进度表加一行「iframe 重定向转换（2026-09-07 spec）」。

- [ ] **Step 4: SMOKE.md**

`test/smoke/SMOKE.md` 追加场景（真实 URL，手动执行）：

```markdown
### 场景 N：内嵌 iframe 壳页（重定向门）

- URL 1: https://mmh1.top/article#/ai-article/skill
- URL 2: https://mmh1.top/article#/ai-article/prompt-cache
- 预期：步骤 1 emit `redirect.to` 为 …/article/{skill,prompt-cache}.html；工作目录为 redirected_ 前缀名；9_markdown.md 为完整文章
- 注意：按记忆规约，收尾前用最终代码重跑全管线再记录结论
```

- [ ] **Step 5: 全量回归**

Run: `pnpm test:all`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add SKILL.md CLAUDE.md README.md test/smoke/SMOKE.md
git commit -m "docs(skill): 步骤 0 瘦身 + 步骤 1 重定向门与核心参数产出同步全部文档"
```

---

### Task 7: 全量回归与真实冒烟

**Files:**
- 无新文件——验证任务

- [ ] **Step 1: 全量测试**

Run: `pnpm test:all`
Expected: 单测 + 集成全 PASS。重点回归：`snapshot-integration`（现有 iframe 合并测试——`iframe-content.html` 的 frame 正文 ~250 < 500 不触发重定向，仍走合并）、`clean-snapshot`、`login-*`

- [ ] **Step 2: 真实冒烟（需网络）**

```bash
U2M_WORKING_ROOT=$(mktemp -d) node script/snapshot.mjs --url 'https://mmh1.top/article#/ai-article/skill'
```

Expected: exit 0；stdout `redirect.to` = `https://mmh1.top/article/skill.html`；`url-name` = `redirected_mmh1.top_article__ai-article_skill`；`1_snapshot.html` 含「Skill 进化」正文、无 `<iframe>`

（网络不可用时跳过并在完成汇报中如实注明；SMOKE.md 记录以本次实际结果为准）

- [ ] **Step 3: 汇报**

向用户汇报：测试结果（含跳过项）、冒烟输出关键字段、剩余已知边界（spec §9 非目标清单）

---

## Self-Review 记录

- **Spec 覆盖**：§3 时序→Task 3；§4 判定规则→Task 2（常量/跨域/多帧/嵌套上限）；§5 命名与 marker→Task 1+3（写入/删除时机、陈旧语义）；§6 契约→Task 3（emit）+Task 5（init）+Task 6（文档，含 CLAUDE.md/README）；§7 回退→Task 3（vlist 失败不写 marker）+Task 4（退化/嵌套/跨域登录墙复跑逻辑在 runRedirectGate）；§8 测试→Task 1-5 各测试 + Task 7 冒烟。无缺口
- **占位符**：无 TBD/TODO；所有代码块完整可落盘
- **类型一致性**：`snapshotRedirectDetect` 返回 `{redirect:{url,frameText}|null, mainText}`（Task 2 定义、Task 3 的 runRedirectGate 消费一致）；`runRedirectGate` 返回 `{redirected, to}`（Task 3 定义、emit 使用一致）；`ensureUrlDirs(url, dirName)`（Task 1 定义、Task 3 调用一致）；marker 路径/内容格式两个任务一致（`to: <url>\n`）
