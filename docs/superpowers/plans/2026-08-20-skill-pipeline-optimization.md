# SKILL 管线优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 9 子步骤管线重构为 6 步管线（步骤 0-5），新增合并快照、结构清洗、LLM 关键 ID 识别、分块、LLM 转化。

**Architecture:** 薄壳入口 + lib/ 编排模块模式。步骤 1 共享单个浏览器实例，4 个 lib/ 模块按序执行。步骤 2/4 为独立 CLI，使用 Playwright 打开快照文件执行页面内函数。步骤 3/5 为 LLM 步骤（SKILL.md 指导）。所有 CLI 遵循单行 JSON 输出契约。

**Tech Stack:** Node.js ≥20, Playwright (chromium), node:test + node:assert/strict

**Spec:** `docs/superpowers/specs/2026-08-20-skill-pipeline-optimization-design.md`

## Global Constraints

- 每个 CLI 必须 `#!/usr/bin/env node`，stdout 恰好一行 JSON，日志走 stderr
- 退出码：0=成功，1=错误，2=usage_error
- `emit()` 延迟 `process.exit`：浏览器/viewer 必须在 emit 之前关闭
- `parseArgs` 返回 null 后必须立即 `return`（防止打出第二行 JSON）
- 共享页面脚本（`script/lib/page-*.js`）是普通非模块文件，用 `readSharedScript` 加载
- 注释和测试名使用简体中文
- 测试使用 `node:test` + `node:assert/strict`，集成测试用 `runScript` 子进程

## File Structure

### 新建文件

| 路径 | 职责 |
|---|---|
| `script/snapshot.mjs` | 步骤 1 薄壳入口：启动浏览器 → 调用 4 个 lib/ 模块 → emit |
| `script/lib/snapshot-login.mjs` | 步骤 1 登录阶段：goto + 六信号检测 + Screencast |
| `script/lib/snapshot-scroll.mjs` | 步骤 1 滚动阶段：渐进滚动 + DOM 稳定 |
| `script/lib/snapshot-detect.mjs` | 步骤 1 检测阶段：虚拟列表检测 |
| `script/lib/snapshot-capture.mjs` | 步骤 1 快照阶段：evaluate page-prepare → 写盘 |
| `script/lib/page-clean-snapshot.js` | 步骤 2 页面内清洗函数 |
| `script/clean_snapshot.mjs` | 步骤 2 CLI：打开快照 → 清洗 → 写盘 |
| `script/lib/page-chunker.js` | 步骤 4 页面内分块函数 |
| `script/chunker.mjs` | 步骤 4 CLI：打开快照 → 分块 → 写盘 |
| `test/unit/clean-snapshot.test.mjs` | 步骤 2 清洗规则单测 |
| `test/unit/chunker.test.mjs` | 步骤 4 分块逻辑单测 |
| `test/unit/snapshot.test.mjs` | 步骤 1 流程编排单测 |
| `test/integration/snapshot-integration.test.mjs` | 步骤 1 集成测试 |
| `test/fixtures/article-1.html` | 测试夹具（从 .temp/ 复制） |
| `test/fixtures/article-2.html` | 测试夹具（从 .temp/ 复制） |

### 修改文件

| 路径 | 变更 |
|---|---|
| `script/lib/env.mjs` | 添加 `stepsDir` 到 `ensureUrlDirs` 返回值 |
| `SKILL.md` | 重写步骤为 0-5 新管线 |
| `CLAUDE.md` | 更新架构描述和文档地图 |

### 删除文件/目录

| 路径 | 原因 |
|---|---|
| `script/pylib/` | Python 空目录残留 |
| `script/login_url.mjs` | 逻辑迁入 `lib/snapshot-login.mjs` |
| `script/detect_page.mjs` | 逻辑迁入 `lib/snapshot-detect.mjs` |
| `script/capture_snapshot.mjs` | 逻辑迁入 `lib/snapshot-capture.mjs` |
| `test/__pycache__/` | pytest 缓存残留 |
| `.pytest_cache/` | pytest 缓存残留 |
| `.venv/` | Python 虚拟环境残留 |

### 修改文件（Python 清理）

| 路径 | 变更 |
|---|---|
| `script/lib/env.mjs:17` | 删注释 "Node/Python 必须一致" |
| `script/lib/env.mjs:29` | 删注释 "双工作流子目录随 Python 运行时移除" |
| `test/smoke/SMOKE.md` | 更新 Python 命令为 node 命令 |
| `.gitignore` | 删除 "# Python" 段落 |
| `docs/design/url-to-markdown-design.md` | 加顶部 ⚠️ 过时警告 |

---

## Task 1: Python 残留清理

**Files:**
- Delete: `script/pylib/`, `test/__pycache__/`, `.pytest_cache/`, `.venv/`
- Modify: `script/lib/env.mjs`, `test/smoke/SMOKE.md`, `.gitignore`, `docs/design/url-to-markdown-design.md`

**Interfaces:**
- Produces: 干净的代码库，无 Python 残留引用

- [ ] **Step 1: 删除磁盘残留**

```bash
rm -rf script/pylib/ test/__pycache__/ .pytest_cache/ .venv/
```

- [ ] **Step 2: 清理 env.mjs 过时注释**

打开 `script/lib/env.mjs`，找到并修改：

第 17 行附近，将：
```js
/** URL→目录名：非 [A-Za-z0-9.-] → _；>120 截断 + sha256(URL) 前 8 hex。Node/Python 必须一致。 */
```
改为：
```js
/** URL→目录名：非 [A-Za-z0-9.-] → _；>120 截断 + sha256(URL) 前 8 hex。 */
```

第 29 行附近，将：
```js
/** 拍平的产物目录：working/<url-dir>/ 直接放 sketch.md/assets/…（双工作流子目录随 Python 运行时移除）。 */
```
改为：
```js
/** 拍平的产物目录：working/<url-dir>/ 直接放 sketch.md/assets/…。 */
```

- [ ] **Step 3: 更新 SMOKE.md**

打开 `test/smoke/SMOKE.md`，将所有 `uv run python script/clear_trans_html.py` 替换为 `node script/clear_trans_html.mjs`。将 "Python 稿仅 1.9KB" 等历史描述标注为已废弃或删除。

- [ ] **Step 4: 清理 .gitignore**

打开 `.gitignore`，删除整个 "# Python" 段落（包含 `__pycache__/`、`.venv/`、`.pytest_cache/`、`uv.lock` 等规则的区块）。

- [ ] **Step 5: 给旧设计文档加过时警告**

在 `docs/design/url-to-markdown-design.md` 文件顶部（第一行之前）插入：

```markdown
> ⚠️ **过时警告**：本文档描述的双运行时架构（Node + Python）已于 commit 50888c3 移除 Python 运行时。当前权威设计以 `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md` 和 `docs/superpowers/specs/2026-08-20-skill-pipeline-optimization-design.md` 为准。

```

- [ ] **Step 6: 验证测试通过**

Run: `pnpm test`
Expected: 所有现有单测通过

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: remove Python residuals and stale references

- Delete script/pylib/, test/__pycache__/, .pytest_cache/, .venv/
- Remove Python-related comments from env.mjs
- Update SMOKE.md Python commands to node commands
- Remove Python section from .gitignore
- Add deprecation warning to old design doc"
```

---

## Task 2: 测试夹具 + env.mjs stepsDir

**Files:**
- Create: `test/fixtures/article-1.html`, `test/fixtures/article-2.html`
- Modify: `script/lib/env.mjs`
- Test: `test/unit/env.test.mjs`（已有，需扩展）

**Interfaces:**
- Produces: `ensureUrlDirs(url)` 返回值新增 `stepsDir: string`
- Produces: `test/fixtures/article-1.html`, `test/fixtures/article-2.html` 测试素材

- [ ] **Step 1: 复制测试夹具**

```bash
cp .temp/article-example-1.html test/fixtures/article-1.html
cp .temp/article-example-2.html test/fixtures/article-2.html
```

- [ ] **Step 2: 扩展 env.mjs 的 ensureUrlDirs**

打开 `script/lib/env.mjs`，修改 `ensureUrlDirs` 函数：

```js
export function ensureUrlDirs(url) {
  const dir = urlDir(url);
  const assets = path.join(dir, 'assets');
  const draft = path.join(assets, 'draft');
  const complex = path.join(assets, 'complex');
  const images = path.join(assets, 'images');
  const steps = path.join(dir, 'steps');
  for (const d of [dir, assets, draft, complex, images, steps]) fs.mkdirSync(d, { recursive: true });
  return { urlDir: dir, wf: dir, assets, draft, complex, images, steps, manifest: path.join(dir, 'manifest.json') };
}
```

变更：新增 `const steps = path.join(dir, 'steps')`，在 `for` 循环中加入 `steps`，返回值加入 `steps`。

- [ ] **Step 3: 写 stepsDir 单测**

在 `test/unit/env.test.mjs` 中添加测试：

```js
test('ensureUrlDirs: 创建 steps/ 目录并返回 stepsDir', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-env-'));
  process.env.U2M_WORKING_ROOT = tmpDir;
  try {
    const dirs = ensureUrlDirs('https://example.com/article');
    assert.ok(dirs.steps, 'steps 字段应存在');
    assert.ok(dirs.steps.endsWith('/steps') || dirs.steps.endsWith('\\steps'));
    assert.ok(fs.existsSync(dirs.steps), 'steps/ 目录应已创建');
  } finally {
    delete process.env.U2M_WORKING_ROOT;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: 运行测试**

Run: `node --test test/unit/env.test.mjs`
Expected: 新增测试通过

- [ ] **Step 5: 提交**

```bash
git add test/fixtures/article-1.html test/fixtures/article-2.html script/lib/env.mjs test/unit/env.test.mjs
git commit -m "feat: add stepsDir to ensureUrlDirs and test fixtures

- Add steps/ directory to working dir structure
- Copy article-example-1/2.html as test fixtures"
```

---

## Task 3: 页面清洗函数 page-clean-snapshot.js

**Files:**
- Create: `script/lib/page-clean-snapshot.js`
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: 无（纯页面内函数）
- Produces: `function __u2mCleanSnapshot(cfg)` → `{html, longTextCount}` — 返回清洗后 HTML 和占位符计数

- [ ] **Step 1: 写失败测试**

创建 `test/unit/clean-snapshot.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-clean-snapshot.js');

function runInBrowser(html, fnSrc) {
  // 用 node 模拟浏览器环境：使用 jsdom 或直接字符串处理验证
  // 这里验证函数源码是否合法
  const wrapped = `(${fnSrc})()`;
  // 基础语法检查
  assert.doesNotThrow(() => new Function('return ' + wrapped), '页面函数应为合法 JS');
}

test('page-clean-snapshot.js: 文件存在且包含 __u2mCleanSnapshot 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mCleanSnapshot'), '应定义 __u2mCleanSnapshot');
});

test('page-clean-snapshot.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现页面清洗函数**

创建 `script/lib/page-clean-snapshot.js`：

```js
/**
 * 步骤 2 页面内清洗函数。在浏览器 evaluate 中执行。
 * 保留 DOM 结构 + data-idx + class，剥尽样式、SVG 内容、长文本占位。
 */
function __u2mCleanSnapshot(cfg) {
  cfg = cfg || {};
  var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16;

  // 1. 删除所有 style 属性
  var styled = document.querySelectorAll('[style]');
  for (var i = 0; i < styled.length; i++) {
    styled[i].removeAttribute('style');
  }

  // 2. 删除所有 <style> 标签
  var styles = document.querySelectorAll('style');
  for (var i = styles.length - 1; i >= 0; i--) {
    styles[i].parentNode.removeChild(styles[i]);
  }

  // 3. 删除所有 <link rel="stylesheet"> 标签
  var links = document.querySelectorAll('link[rel="stylesheet"]');
  for (var i = links.length - 1; i >= 0; i--) {
    links[i].parentNode.removeChild(links[i]);
  }

  // 4. 删除 <base> 标签
  var bases = document.querySelectorAll('base');
  for (var i = bases.length - 1; i >= 0; i--) {
    bases[i].parentNode.removeChild(bases[i]);
  }

  // 5. 清空 SVG：删除所有属性和子元素，仅保留空 <svg></svg>
  var svgs = document.querySelectorAll('svg');
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    // 删除所有属性
    while (svg.attributes.length > 0) {
      svg.removeAttribute(svg.attributes[0].name);
    }
    // 删除所有子元素
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  }

  // 6. 长文本占位：textContent.length > MIN_CHARS → {{LONG_TEXT_k|N_CHARS}}
  var k = 0;
  var walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  var textNodes = [];
  var node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }
  for (var i = 0; i < textNodes.length; i++) {
    var tn = textNodes[i];
    var text = tn.textContent;
    if (text.length > MIN_CHARS) {
      k++;
      tn.textContent = '{{LONG_TEXT_' + k + '|' + text.length + '_CHARS}}';
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    longTextCount: k
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat: add page-clean-snapshot.js for step 2 structural cleaning

Cleaning rules: strip style attrs/tags/links, remove <base>,
empty SVGs, replace long text (>16 chars) with {{LONG_TEXT_k|N_CHARS}} placeholders.
Preserves data-idx and class attributes."
```

---

## Task 4: snapshot-login.mjs 模块

**Files:**
- Create: `script/lib/snapshot-login.mjs`

**Interfaces:**
- Consumes: `needsLogin` from `detector.mjs`, `startScreencastViewer` from `screencast.mjs`, `readStorageState`/`writeStorageState`/`mergeStorageState` from `browser.mjs`
- Produces: `async function snapshotLogin(page, url, opts)` → `{needsLogin: boolean}` — opts: `{timeout, storageStatePath, log}`

- [ ] **Step 1: 实现 snapshot-login.mjs**

创建 `script/lib/snapshot-login.mjs`：

```js
// script/lib/snapshot-login.mjs
// 步骤 1 登录阶段：goto URL → 六信号检测 → Screencast viewer（如需登录）
import { needsLogin as detectLogin } from './detector.mjs';
import { startScreencastViewer } from './screencast.mjs';
import { readStorageState, writeStorageState, mergeStorageState } from './browser.mjs';

/**
 * 登录检测 + Screencast 人工登录。
 * @param {import('playwright').Page} page - 已创建的页面（浏览器由 snapshot.mjs 管理）
 * @param {string} url - 目标 URL
 * @param {{timeout?: number, storageStatePath?: string, log?: Function}} opts
 * @returns {Promise<{needsLogin: boolean}>}
 * @throws {Error} reason='login_timeout' | 'login_aborted' | 其他错误
 */
export async function snapshotLogin(page, url, opts = {}) {
  const { timeout = 300000, storageStatePath: ssPath, log = () => {} } = opts;

  // 检测是否需要登录
  const result = await detectLogin(page, page.context(), url);
  if (!result.needsLogin) {
    // 已登录：刷新 storageState
    if (ssPath) {
      const base = await readStorageState(ssPath);
      const fresh = await page.context().storageState();
      await writeStorageState(ssPath, mergeStorageState(base, fresh));
    }
    log('检测为已登录');
    return { needsLogin: false };
  }

  log('判定需要登录，进入 Screencast 登录模式');

  // 未登录：启动 Screencast viewer 等待人工登录
  return new Promise((resolve, reject) => {
    let settled = false;
    let viewer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      resolve(result);
    };
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      const err = new Error(reason);
      err.reason = reason;
      reject(err);
    };

    const timer = setTimeout(() => fail('login_timeout'), timeout);
    timer.unref?.();

    startScreencastViewer({
      page,
      onLoginDone: async (ws) => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500 });
          if (!recheck.needsLogin) {
            if (ssPath) {
              const base = await readStorageState(ssPath);
              const fresh = await page.context().storageState();
              await writeStorageState(ssPath, mergeStorageState(base, fresh));
            }
            finish({ needsLogin: true });
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500 });
          if (!recheck.needsLogin) {
            if (ssPath) {
              const base = await readStorageState(ssPath);
              const fresh = await page.context().storageState();
              await writeStorageState(ssPath, mergeStorageState(base, fresh));
            }
            finish({ needsLogin: true });
          } else {
            fail('login_aborted');
          }
        } catch { fail('login_aborted'); }
      },
      log,
    }).then((v) => {
      viewer = v;
      log(`[snapshot] viewer: ${v.url}`);
    }).catch((e) => fail(e.message));
  });
}
```

- [ ] **Step 2: 验证模块可导入**

Run: `node -e "import('./script/lib/snapshot-login.mjs').then(m => console.log(typeof m.snapshotLogin))"`
Expected: 输出 `function`

- [ ] **Step 3: 提交**

```bash
git add script/lib/snapshot-login.mjs
git commit -m "feat: add snapshot-login.mjs module

Login detection + Screencast viewer for shared browser context.
Exports snapshotLogin(page, url, opts) → {needsLogin}."
```

---

## Task 5: snapshot-scroll.mjs + snapshot-detect.mjs

**Files:**
- Create: `script/lib/snapshot-scroll.mjs`, `script/lib/snapshot-detect.mjs`

**Interfaces:**
- Consumes: `readSharedScript` from `placeholder.mjs`（detect 模块用）
- Produces: `async function snapshotScroll(page, opts)` → void
- Produces: `async function snapshotDetect(page)` → void（虚拟列表时 throw `{reason: 'virtual_list'}`）

- [ ] **Step 1: 实现 snapshot-scroll.mjs**

创建 `script/lib/snapshot-scroll.mjs`：

```js
// script/lib/snapshot-scroll.mjs
// 步骤 1 滚动阶段：渐进滚动 + DOM 稳定等待

/**
 * 渐进滚动到底再回顶（触发懒加载）+ DOM 稳定等待。
 * 滚动参数必须与 page-detect.js 的 scrollIters/scrollWait 一致（scroll-params 单测守护）。
 * @param {import('playwright').Page} page
 * @param {{scrollRounds?: number}} opts
 */
export async function snapshotScroll(page, opts = {}) {
  const { scrollRounds = 60 } = opts;

  // 渐进滚动
  await page.evaluate(async (rounds) => {
    let last = -1;
    for (let i = 0; i < rounds; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  }, scrollRounds);

  // DOM 稳定：节点数连续 1s 不变
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < 15000) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= 1000) break;
    await page.waitForTimeout(200);
  }
}
```

- [ ] **Step 2: 实现 snapshot-detect.mjs**

创建 `script/lib/snapshot-detect.mjs`：

```js
// script/lib/snapshot-detect.mjs
// 步骤 1 检测阶段：虚拟列表检测（复用滚动后页面状态）
import { readSharedScript } from './placeholder.mjs';

/**
 * 虚拟列表检测。复用步骤 1 滚动后的页面状态。
 * @param {import('playwright').Page} page
 * @throws {Error} reason='virtual_list' 当检测到虚拟列表时
 */
export async function snapshotDetect(page) {
  const pageDetect = await readSharedScript('page-detect.js');
  const result = await page.evaluate(`(${pageDetect})()`);
  if (result.isVirtualList) {
    const err = new Error('virtual_list');
    err.reason = 'virtual_list';
    throw err;
  }
}
```

- [ ] **Step 3: 验证模块可导入**

Run: `node -e "Promise.all([import('./script/lib/snapshot-scroll.mjs'), import('./script/lib/snapshot-detect.mjs')]).then(([s,d]) => console.log(typeof s.snapshotScroll, typeof d.snapshotDetect))"`
Expected: 输出 `function function`

- [ ] **Step 4: 提交**

```bash
git add script/lib/snapshot-scroll.mjs script/lib/snapshot-detect.mjs
git commit -m "feat: add snapshot-scroll.mjs and snapshot-detect.mjs

scroll: progressive scroll + DOM stable wait
detect: virtual list detection reusing scrolled page state"
```

---

## Task 6: snapshot-capture.mjs 模块

**Files:**
- Create: `script/lib/snapshot-capture.mjs`

**Interfaces:**
- Consumes: `readSharedScript` from `placeholder.mjs`
- Produces: `async function snapshotCapture(page, opts)` → `{snapshotPath: string, elements: number}`

- [ ] **Step 1: 实现 snapshot-capture.mjs**

创建 `script/lib/snapshot-capture.mjs`：

```js
// script/lib/snapshot-capture.mjs
// 步骤 1 快照阶段：注入 page-prepare.js → evaluate → 写盘
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSharedScript } from './placeholder.mjs';

/**
 * 全保真快照抓取。evaluate __u2mPrepareBody 后序列化 DOM。
 * @param {import('playwright').Page} page
 * @param {{stepsDir: string, log?: Function}} opts
 * @returns {Promise<{snapshotPath: string, elements: number}>}
 */
export async function snapshotCapture(page, opts = {}) {
  const { stepsDir, log = () => {} } = opts;

  const pagePrepare = await readSharedScript('page-prepare.js');

  // 注入并执行 page-prepare（iframe 合并 + CSS 内联 + 剥 JS + data-idx）
  await page.evaluate(`(${pagePrepare})()`);

  // 取全保真快照
  const snapshot = await page.evaluate(() => document.documentElement.outerHTML);

  // 统计 data-idx 数量
  const elements = (snapshot.match(/data-idx="\d+"/g) || []).length;

  // 写盘
  await fs.mkdir(stepsDir, { recursive: true });
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');
  await fs.writeFile(snapshotPath, '<!DOCTYPE html>\n' + snapshot, 'utf8');

  log(`快照已保存: ${snapshotPath} (${elements} 个标记元素)`);

  return { snapshotPath, elements };
}
```

- [ ] **Step 2: 验证模块可导入**

Run: `node -e "import('./script/lib/snapshot-capture.mjs').then(m => console.log(typeof m.snapshotCapture))"`
Expected: 输出 `function`

- [ ] **Step 3: 提交**

```bash
git add script/lib/snapshot-capture.mjs
git commit -m "feat: add snapshot-capture.mjs module

Evaluates __u2mPrepareBody and serializes full-fidelity snapshot
to steps/1_snapshot.html."
```

---

## Task 7: snapshot.mjs 薄壳入口

**Files:**
- Create: `script/snapshot.mjs`
- Test: `test/unit/snapshot.test.mjs`

**Interfaces:**
- Consumes: `snapshotLogin`, `snapshotScroll`, `snapshotDetect`, `snapshotCapture` from lib/ 模块
- Consumes: `openPage`, `readStorageState`, `writeStorageState`, `mergeStorageState` from `browser.mjs`
- Consumes: `emit`, `emitError`, `usage`, `log` from `contract.mjs`
- Consumes: `storageStatePath`, `workingRoot`, `urlToDirName`, `ensureUrlDirs` from `env.mjs`
- Consumes: `readSharedScript` from `placeholder.mjs`
- Produces: CLI `node script/snapshot.mjs <url> [--timeout ms] [--scroll-rounds n]`
- 输出: `steps/1_snapshot.html`

- [ ] **Step 1: 写失败测试（参数校验）**

创建 `test/unit/snapshot.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import path from 'node:path';

const script = path.resolve('script/snapshot.mjs');

test('snapshot.mjs: 无参数时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --timeout 缺值时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [script, 'https://example.com', '--timeout']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('snapshot.mjs: --scroll-rounds 非数字时报 usage_error', async () => {
  const r = await runScript(process.execPath, [script, 'https://example.com', '--scroll-rounds', 'abc']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/unit/snapshot.test.mjs`
Expected: FAIL（脚本不存在）

- [ ] **Step 3: 实现 snapshot.mjs**

创建 `script/snapshot.mjs`：

```js
#!/usr/bin/env node
// snapshot.mjs <url> [--timeout 300000] [--scroll-rounds 60]
// 步骤 1：合并登录、滚动、虚拟列表检测、快照下载。共享单个浏览器实例。
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath, ensureUrlDirs } from './lib/env.mjs';
import { proxyLaunchOptions, readStorageState, writeStorageState, mergeStorageState, EMPTY_STATE } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { snapshotLogin } from './lib/snapshot-login.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { snapshotDetect } from './lib/snapshot-detect.mjs';
import { snapshotCapture } from './lib/snapshot-capture.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: snapshot.mjs <url> [--timeout ms] [--scroll-rounds n]');

  const timeout = Number(args.timeout ?? 300000);
  const scrollRounds = Number(args['scroll-rounds'] ?? 60);
  if (!Number.isFinite(timeout)) { usage(`--timeout 须为数字，收到 ${args.timeout}`); return; }
  if (!Number.isFinite(scrollRounds)) { usage(`--scroll-rounds 须为数字，收到 ${args['scroll-rounds']}`); return; }

  const ssPath = storageStatePath();
  const dirs = ensureUrlDirs(url);

  // 加载 initScript
  const pageInit = await readSharedScript('page-init.js');

  // 启动浏览器（共享上下文）
  const browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
  const ctxOpts = { viewport: { width: 1280, height: 3000 }, bypassCSP: true };
  if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
  const context = await browser.newContext(ctxOpts);
  await context.route('**/*', (route) =>
    route.request().resourceType() === 'media' ? route.abort() : route.continue());
  await context.addInitScript({ content: pageInit });
  const page = await context.newPage();

  try {
    await snapshotLogin(page, url, { timeout, storageStatePath: ssPath, log });
    await snapshotScroll(page, { scrollRounds });
    await snapshotDetect(page);
    const result = await snapshotCapture(page, { stepsDir: dirs.steps, log });

    // 先关浏览器再 emit
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: result.snapshotPath,
      elements: result.elements,
    });
  } catch (e) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    emitError(e.reason || e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 4: 运行单测**

Run: `node --test test/unit/snapshot.test.mjs`
Expected: PASS（参数校验测试通过）

- [ ] **Step 5: 提交**

```bash
git add script/snapshot.mjs test/unit/snapshot.test.mjs
git commit -m "feat: add snapshot.mjs entry point for step 1

Shared browser context across login → scroll → detect → capture.
Parameter validation tests included."
```

---

## Task 8: snapshot.mjs 集成测试

**Files:**
- Create: `test/integration/snapshot-integration.test.mjs`

**Interfaces:**
- Consumes: `script/snapshot.mjs`
- Consumes: `test/fixtures/static-article.html`（已有夹具）
- Consumes: `test/fixtures/virtual-list.html`（已有夹具）
- Consumes: `test/helpers/fixture-server.mjs`, `test/helpers/run-script.mjs`

- [ ] **Step 1: 写集成测试**

创建 `test/integration/snapshot-integration.test.mjs`：

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const script = path.resolve('script/snapshot.mjs');
let server;
let tmpRoot;

before(async () => {
  server = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-snapshot-'));
});

after(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('snapshot.mjs: 静态文章页 → ok + 1_snapshot.html', async () => {
  const url = `http://127.0.0.1:${server.port}/static-article.html`;
  const r = await runScript(process.execPath, [script, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.elements > 0, '应有标记元素');
  assert.ok(fs.existsSync(out.snapshot), '1_snapshot.html 应存在');

  // 验证快照内容
  const html = fs.readFileSync(out.snapshot, 'utf8');
  assert.ok(html.includes('data-idx'), '应含 data-idx');
  assert.ok(!html.includes('<script'), '不应含 script 标签');
});

test('snapshot.mjs: 虚拟列表页 → error + virtual_list', async () => {
  const url = `http://127.0.0.1:${server.port}/virtual-list.html`;
  const r = await runScript(process.execPath, [script, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.equal(out.reason, 'virtual_list');
});
```

- [ ] **Step 2: 运行集成测试**

Run: `node --test test/integration/snapshot-integration.test.mjs`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add test/integration/snapshot-integration.test.mjs
git commit -m "test: add snapshot.mjs integration tests

Covers static article (ok path) and virtual list (error path)."
```

---

## Task 9: clean_snapshot.mjs CLI

**Files:**
- Create: `script/clean_snapshot.mjs`
- Modify: `test/unit/clean-snapshot.test.mjs`（扩展集成级测试）

**Interfaces:**
- Consumes: `emit`, `emitError`, `usage`, `log` from `contract.mjs`
- Consumes: `workingRoot`, `urlToDirName` from `env.mjs`
- Consumes: `chromium` from `playwright`
- Consumes: `readSharedScript` from `placeholder.mjs`
- Produces: CLI `node script/clean_snapshot.mjs <url-dir>`
- 输出: `steps/2_clean_snapshot.html`

- [ ] **Step 1: 扩展单测（集成级）**

在 `test/unit/clean-snapshot.test.mjs` 中添加：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';

// ... 保留现有测试 ...

test('clean_snapshot.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('clean_snapshot.mjs: 对 article-1 快照执行清洗', async () => {
  // 准备临时目录，手动放入一个测试快照
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-'));
  const urlDir = path.join(tmpRoot, 'test-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  // 用 article-1.html 作为模拟快照
  const fixture = fs.readFileSync(path.resolve('test/fixtures/article-1.html'), 'utf8');
  fs.writeFileSync(path.join(stepsDir, '1_snapshot.html'), fixture);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  // 验证清洗结果
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  assert.ok(!cleaned.includes('style='), '不应含 style 属性');
  assert.ok(!cleaned.includes('<style'), '不应含 <style> 标签');
  assert.ok(cleaned.includes('LONG_TEXT'), '应含长文本占位符');
  assert.ok(!cleaned.match(/<svg[^>]+[a-z-]+=/i), 'SVG 不应有属性');

  // 清理
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 新增测试 FAIL（脚本不存在）

- [ ] **Step 3: 实现 clean_snapshot.mjs**

创建 `script/clean_snapshot.mjs`：

```js
#!/usr/bin/env node
// clean_snapshot.mjs <url-dir>
// 步骤 2：结构清洗。打开 1_snapshot.html，剥尽样式/SVG 内容，长文本占位。
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { workingRoot } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function resolveUrlDir(arg) {
  if (!arg) return null;
  if (path.isAbsolute(arg)) return arg;  // 绝对路径直接使用（测试隔离用）
  return path.join(workingRoot(), arg);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: clean_snapshot.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    // 打开快照文件
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });

    // 执行清洗
    const result = await page.evaluate(`(${pageCleanFn})()`);

    // 写盘
    const cleanedPath = path.join(stepsDir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, result.html, 'utf8');
    log(`清洗完成: ${cleanedPath} (${result.longTextCount} 个长文本占位符)`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      cleanedSnapshot: cleanedPath,
      longTextCount: result.longTextCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 4: 运行测试**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs
git commit -m "feat: add clean_snapshot.mjs CLI for step 2

Opens 1_snapshot.html in Playwright, applies page-clean-snapshot.js
cleaning rules, writes 2_clean_snapshot.html."
```

---

## Task 10: page-chunker.js 页面分块函数

**Files:**
- Create: `script/lib/page-chunker.js`
- Test: `test/unit/chunker.test.mjs`

**Interfaces:**
- Consumes: 无（纯页面内函数）
- Produces: `function __u2mChunk(cfg)` → `{chunks: Array}` — 分块列表

- [ ] **Step 1: 写失败测试**

创建 `test/unit/chunker.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-chunker.js');

test('page-chunker.js: 文件存在且包含 __u2mChunk 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mChunk'), '应定义 __u2mChunk');
});

test('page-chunker.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-chunker.js: 包含 PHRASING_TAGS 和 FLOW_TAGS 分类', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('PHRASING_TAGS') || src.includes('phrasingTags'), '应定义短语内容标签集');
  assert.ok(src.includes('FLOW_TAGS') || src.includes('flowTags'), '应定义流式内容标签集');
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/unit/chunker.test.mjs`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现页面分块函数**

创建 `script/lib/page-chunker.js`：

```js
/**
 * 步骤 4 页面内分块函数。在浏览器 evaluate 中执行。
 * 基于 key_ids 定位列表流，对子元素进行 Phrasing/Flow/MultiLayer 分类。
 * 对 MultiLayer 块计算 computed style 并内联。
 */
function __u2mChunk(cfg) {
  cfg = cfg || {};
  var keyIds = cfg.keyIds || {};
  var titleIds = keyIds.titleIds || [];
  var descriptionIds = keyIds.descriptionIds || [];
  var listFlowIds = keyIds.listFlowIds || [];

  // HTML 标准 Phrasing content 标签（行内元素）
  var PHRASING_TAGS = new Set([
    'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA',
    'DFN', 'EM', 'I', 'IMG', 'INPUT', 'KBD', 'LABEL', 'MAP', 'MARK',
    'METER', 'OBJECT', 'OUTPUT', 'PICTURE', 'PROGRESS', 'Q', 'RUBY',
    'S', 'SAMP', 'SELECT', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP',
    'TEXTAREA', 'TIME', 'U', 'VAR', 'WBR'
  ]);

  // HTML 标准 Flow content 标签（块级元素）
  var FLOW_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG',
    'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'UL'
  ]);

  function isPhrasing(el) {
    return PHRASING_TAGS.has(el.tagName);
  }

  function hasNestedFlow(el) {
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      if (FLOW_TAGS.has(children[i].tagName)) return true;
    }
    return false;
  }

  /** 对元素及其子树计算并内联 computed style */
  function inlineComputedStyles(el) {
    var computed = window.getComputedStyle(el);
    var styleStr = '';
    for (var i = 0; i < computed.length; i++) {
      var prop = computed[i];
      styleStr += prop + ':' + computed.getPropertyValue(prop) + ';';
    }
    el.setAttribute('style', styleStr);
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      inlineComputedStyles(children[i]);
    }
  }

  var chunks = [];
  var id = 0;

  // 处理标题块
  titleIds.forEach(function (uid) {
    var el = document.querySelector('[data-idx="' + uid + '"]');
    if (!el) return;
    id++;
    chunks.push({
      id: id,
      type: 'phrasing',
      dataU2mId: uid,
      html: el.outerHTML,
      needsLLM: false,
    });
  });

  // 处理说明块
  descriptionIds.forEach(function (uid) {
    var el = document.querySelector('[data-idx="' + uid + '"]');
    if (!el) return;
    id++;
    chunks.push({
      id: id,
      type: 'phrasing',
      dataU2mId: uid,
      html: el.outerHTML,
      needsLLM: false,
    });
  });

  // 处理列表流
  listFlowIds.forEach(function (uid) {
    var parent = document.querySelector('[data-idx="' + uid + '"]');
    if (!parent) return;
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      id++;

      if (isPhrasing(child)) {
        // 纯 Phrasing 内容
        chunks.push({
          id: id,
          type: 'phrasing',
          dataU2mId: parseInt(child.getAttribute('data-idx') || '0', 10),
          html: child.outerHTML,
          needsLLM: false,
        });
      } else if (hasNestedFlow(child)) {
        // Multi-layer Flow 内容：计算并内联样式
        var clone = child.cloneNode(true);
        inlineComputedStyles(clone);
        chunks.push({
          id: id,
          type: 'multiLayer',
          dataU2mId: parseInt(child.getAttribute('data-idx') || '0', 10),
          html: child.outerHTML,
          styledHtml: clone.outerHTML,
          needsLLM: true,
        });
      } else {
        // 单层 Flow 内容
        chunks.push({
          id: id,
          type: 'flow',
          dataU2mId: parseInt(child.getAttribute('data-idx') || '0', 10),
          html: child.outerHTML,
          needsLLM: false,
        });
      }
    }
  });

  return { chunks: chunks };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `node --test test/unit/chunker.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/lib/page-chunker.js test/unit/chunker.test.mjs
git commit -m "feat: add page-chunker.js for step 4 content chunking

Classifies children into phrasing/flow/multiLayer based on HTML standard.
Computes and inlines styles for multiLayer chunks."
```

---

## Task 11: chunker.mjs CLI

**Files:**
- Create: `script/chunker.mjs`
- Modify: `test/unit/chunker.test.mjs`（扩展集成级测试）

**Interfaces:**
- Consumes: `emit`, `emitError`, `usage`, `log` from `contract.mjs`
- Consumes: `workingRoot` from `env.mjs`
- Consumes: `chromium` from `playwright`
- Consumes: `readSharedScript` from `placeholder.mjs`
- Produces: CLI `node script/chunker.mjs <url-dir>`
- 输出: `steps/4_chunk_list.json`

- [ ] **Step 1: 扩展单测**

在 `test/unit/chunker.test.mjs` 中添加集成测试：

```js
// ... 保留现有测试，在文件顶部的 import 区域添加 runScript 和 os ...

test('chunker.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/chunker.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('chunker.mjs: 对 article-1 执行分块', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chunk-'));
  const urlDir = path.join(tmpRoot, 'test-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  // 放入快照和 key_ids
  const fixture = fs.readFileSync(path.resolve('test/fixtures/article-1.html'), 'utf8');
  fs.writeFileSync(path.join(stepsDir, '1_snapshot.html'), fixture);

  // 模拟步骤 3 产物（手动指定 ID，基于实际夹具内容）
  const keyIds = { titleIds: [], descriptionIds: [], listFlowIds: [1] };
  fs.writeFileSync(path.join(stepsDir, '3_key_ids.json'), JSON.stringify(keyIds));

  const script = path.resolve('script/chunker.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(Array.isArray(out.chunks), '应返回 chunks 数组');
  assert.ok(fs.existsSync(out.chunkList), '4_chunk_list.json 应存在');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node --test test/unit/chunker.test.mjs`
Expected: 新增集成测试 FAIL

- [ ] **Step 3: 实现 chunker.mjs**

创建 `script/chunker.mjs`：

```js
#!/usr/bin/env node
// chunker.mjs <url-dir>
// 步骤 4：分块。读 3_key_ids.json + 1_snapshot.html，按 Phrasing/Flow/MultiLayer 分块。
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { workingRoot } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function resolveUrlDir(arg) {
  if (!arg) return null;
  if (path.isAbsolute(arg)) return arg;
  return path.join(workingRoot(), arg);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: chunker.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const stepsDir = path.join(urlDir, 'steps');
  const snapshotPath = path.join(stepsDir, '1_snapshot.html');
  const keyIdsPath = path.join(stepsDir, '3_key_ids.json');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  if (!fs.existsSync(keyIdsPath)) {
    return emitError(`找不到 ${keyIdsPath}，请先运行步骤 3`);
  }

  const keyIds = JSON.parse(await fsPromises.readFile(keyIdsPath, 'utf8'));
  const pageChunkFn = await readSharedScript('page-chunker.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await browser.newContext({ bypassCSP: true });
    const page = await context.newPage();

    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });

    // 执行分块
    const result = await page.evaluate(
      `(${pageChunkFn})(${JSON.stringify({ keyIds })})`
    );

    // 写盘
    const chunkListPath = path.join(stepsDir, '4_chunk_list.json');
    await fsPromises.writeFile(chunkListPath, JSON.stringify(result, null, 2), 'utf8');

    const llmCount = result.chunks.filter((c) => c.needsLLM).length;
    log(`分块完成: ${result.chunks.length} 块, ${llmCount} 块需要 LLM 转化`);

    // 先关浏览器再 emit
    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      chunkList: chunkListPath,
      totalChunks: result.chunks.length,
      llmChunks: llmCount,
      chunks: result.chunks,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 4: 运行测试**

Run: `node --test test/unit/chunker.test.mjs`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add script/chunker.mjs test/unit/chunker.test.mjs
git commit -m "feat: add chunker.mjs CLI for step 4

Opens 1_snapshot.html, reads 3_key_ids.json, classifies content
into phrasing/flow/multiLayer chunks with computed styles."
```

---

## Task 12: SKILL.md 更新步骤 3 和步骤 5

**Files:**
- Modify: `SKILL.md`

**Interfaces:**
- 无代码变更——为 LLM 步骤 3 和步骤 5 编写指导文档

- [ ] **Step 1: 重写 SKILL.md 步骤部分**

用新的 6 步管线替换现有步骤 0-5。保留 frontmatter、"何时使用/不使用"、"常见错误处理表"等段落，仅替换步骤段落。

新的步骤段落结构：

```markdown
## 操作手册

### 步骤 0：环境自检
（不变）

### 步骤 1：快照下载
（描述 snapshot.mjs 的用法、参数、status 分支）

### 步骤 2：结构清洗
（描述 clean_snapshot.mjs 的用法、参数、status 分支）

### 步骤 3：关键 ID 识别（LLM 步骤）

读取 `steps/2_clean_snapshot.html`。

你的任务：仅根据 DOM 结构（元素层级、标签类型、嵌套深度）和 `{{LONG_TEXT_k|N_CHARS}}` 占位符分布，找到：

1. **标题分块**的 `data-idx`（文章主标题）
2. **说明分块**的 `data-idx`（描述、作者、日期等元数据）
3. **列表流**的父组件 `data-idx`（文章主体区域，可能多个）

约束：
- 不读语义内容（文本已被占位）
- `listFlowIds` 是列表流最外层父元素的 data-idx
- 不选 `<body>` 或 `<html>`

将结果写入 `steps/3_key_ids.json`：
```json
{
  "titleIds": [42],
  "descriptionIds": [43, 44],
  "listFlowIds": [10, 88]
}
```

### 步骤 4：分块
（描述 chunker.mjs 的用法、参数、status 分支）

### 步骤 5：多层块转化（LLM 步骤）

读取 `steps/4_chunk_list.json`，筛选 `needsLLM: true` 的块。

你的任务：对每个 `multiLayer` 块，基于 `styledHtml`（带完整内联样式的 HTML）进行转化：

- **转化为 Phrasing 内容**：将复杂嵌套结构扁平化为简洁的行内文本描述（保留语义、丢失布局）
- **转化为 SVG 图片**：对于图表、数据可视化、复杂布局等无法用文本表达的内容，生成语义等价的 SVG

约束：
- 优先转化为 Phrasing——只有图表/可视化/纯布局类内容才转 SVG
- SVG 转化：生成自包含 SVG（含 xmlns、viewBox），不依赖外部资源
- 每个块的转化独立进行，不跨块引用

将结果写入 `steps/5_llm_chunk_list.json`：
```json
{
  "chunks": [
    {
      "id": 3,
      "originalType": "multiLayer",
      "resultType": "phrasing",
      "content": "扁平化后的文本描述..."
    }
  ]
}
```
```

- [ ] **Step 2: 提交**

```bash
git add SKILL.md
git commit -m "docs: rewrite SKILL.md with new 6-step pipeline (0, 1-5)

Steps 3 and 5 are LLM steps with detailed guidance.
Steps 6-9 (old 2-5) deferred to future iteration."
```

---

## Task 13: 删除旧脚本 + CLAUDE.md 更新

**Files:**
- Delete: `script/login_url.mjs`, `script/detect_page.mjs`, `script/capture_snapshot.mjs`
- Modify: `CLAUDE.md`

**Interfaces:**
- 无新代码——删除已被 lib/ 模块替代的旧 CLI

- [ ] **Step 1: 删除旧脚本**

```bash
git rm script/login_url.mjs script/detect_page.mjs script/capture_snapshot.mjs
```

- [ ] **Step 2: 更新旧脚本对应的集成测试**

检查以下测试文件是否引用已删除的脚本，更新引用为新的 `snapshot.mjs`：

- `test/integration/login.test.mjs` → 更新脚本路径或删除（已被 `snapshot-integration.test.mjs` 覆盖）
- `test/integration/detect-page.test.mjs` → 同上
- `test/integration/capture-snapshot.test.mjs` → 同上

- [ ] **Step 3: 更新 CLAUDE.md**

更新 CLAUDE.md 中的架构描述，反映新的 6 步管线：

- 更新"管线顺序"段落
- 更新"分派类型与 manifest"段落（标记为后续步骤 6-9 的内容）
- 更新"文档地图"段落

- [ ] **Step 4: 运行全量测试**

Run: `pnpm test:all`
Expected: 所有测试通过

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: remove old CLI scripts and update CLAUDE.md

- Delete login_url.mjs, detect_page.mjs, capture_snapshot.mjs
  (logic migrated to lib/snapshot-*.mjs modules)
- Update integration tests to use snapshot.mjs
- Update CLAUDE.md architecture description"
```

---

## Task 14: 端到端验证

**Files:**
- 无新文件——全流程验证

- [ ] **Step 1: 运行全量单测**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 2: 运行全量集成测试**

Run: `pnpm run test:integration`
Expected: 全部 PASS（需要 chromium 已安装）

- [ ] **Step 3: 手动验证步骤 1-4 管线**

使用测试夹具手动跑一遍管线：

```bash
# 步骤 1
node script/snapshot.mjs "file://$(pwd)/test/fixtures/article-1.html"

# 步骤 2（用上一步输出的 url-dir）
node script/clean_snapshot.mjs <url-dir>

# 步骤 3：手动读 2_clean_snapshot.html，写 3_key_ids.json

# 步骤 4
node script/chunker.mjs <url-dir>
```

验证每步输出符合预期 JSON 格式。

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "test: end-to-end pipeline verification for steps 1-4"
```
