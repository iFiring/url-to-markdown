# LLM 驱动分类与清洗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用"登录后一次性抓全保真快照 + LLM 列表流逐块方案"替换 `page-classify.js` 的硬编码启发式分类，后续所有清洗/渲染都在快照上工作。

**Architecture:** 登录 + 充分滚动后，`capture_snapshot.mjs`（Node-only）跑共享 `page-prepare.js`（合并 iframe / 内联外部 CSS / 剥 JS / 注 `<base>` / 打 `data-u2m-id`）→ 序列化全保真 `snapshot.html`，再跑共享 `page-derive.js`（长文本占位 / 信号样式内联）→ 派生 `classify/classify_input.html`。agent 读精简版写 `classify_plan.json`（列表流选择器 + 逐块 `action`）。`clear_trans_html.mjs`/`.py` 双侧 `setContent(snapshot.html)` 加载同一快照 → `applyClassifyPlan`/`apply_classify_plan` 删列表流外兄弟 + 按 `action` 逐块分派（复用既有 screenshot/svg/latex 分支 + 新 `code_block`/`block_screenshot`）。消除"各步骤重开页 + id 匹配"脆弱不变量。

**Tech Stack:** Node 20+ / `node --test`；Python 3.11+ / pytest；Playwright 1.62（chromium）；@mozilla/readability + turndown（Node）、readability-lxml + markdownify（Python）；既有 `script/lib/contract.mjs` 一行 JSON 契约。

**Spec:** `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md`

## Global Constraints

- **一行 JSON 契约**：每个 CLI（含新增 `capture_snapshot.mjs`）向 stdout 输出**恰好一行 JSON**，失败路径也不例外；日志走 stderr；退出码 0/1/2（usage_error=2）。`emit()` 先写行、在写回调用 `process.exit`——它本身同步返回，故 `usage()`/`emit()` 之后不得继续执行（用 `return usage(...)` 防护）。
- **共享页面脚本唯一事实源**：`script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2m…(...)`，双运行度当**文本**读入注入：Node `readSharedScript(name)` + `page.evaluate(\`(${src})()\`)`；Python `read_shared_script(name)` + `page.evaluate(f"({src})()")`。**严禁把分类/清洗/派生逻辑分叉进 `.py` 或 `.mjs`**。新文件 `page-prepare.js` / `page-derive.js` 须以 `function __u2m` 开头（`test/integration/placeholder.test.mjs` 的约定断言）。
- **Playwright 1.62 evaluate 语义**：字符串表达式只有完整表达式形式可用 `page.evaluate(\`(${src})()\`)`；需元素实参走 `callOnElement`/`_call_on_element` 适配器（先 eval `'(' + src + ')'` 再把元素句柄作实参调用）。改任一侧镜像另一侧。
- **Python 同步 Playwright greenlet 线程绑定**：禁止从其他 OS 线程访问 page/context；screenshot/图片下载串行，不引入 ThreadPoolExecutor。
- **双工作流镜像**：`urlToDirName`/`url_to_dir_name` 对同一 URL 产出字节级一致目录名；`manifest.json` 结构 `{version:1, items:[{id,type,status,draft?,final?}]}` 一致；complex-elements 夹具两运行时产出同 type 向量。
- **工作目录**：`working/<url-dir>/{node_workflow|python_workflow}/`；`U2M_WORKING_ROOT` 覆盖根（测试隔离用它）。`working/cookies/storage_state.json` 是唯一登录态，仅 `login_url.mjs` 写、其余只读。
- **浏览器先于 emit 关闭**：emit 内 `process.exit`，顺序反了留孤儿 chromium。
- **环境**：node ≥20、python ≥3.11、pnpm > yarn > npm、uv。无 linter。测试以子进程启动真实 CLI、对接随机端口夹具服务器。

---

## File Structure

**新建：**
- `script/lib/page-prepare.js` — `__u2mPrepareBody(cfg)`：合并 iframe / 内联外部 CSS / 剥 JS·noscript·template·on* / 剥复制按钮 / 注 `<base>` / 打 `data-u2m-id`。吸收 `page-merge.js`。
- `script/lib/page-derive.js` — `__u2mDeriveClassifyInput(cfg)`：长文本→`{{T<k}}` / 剥 `<style>`·`<link>` / 白名单信号样式内联 / 返回 `document.body.outerHTML`。
- `script/capture_snapshot.mjs` — Node-only CLI：开页→滚动稳定→跑 prepare→取 snapshot→跑 derive→写两份产物→emit 一行 JSON。
- `script/lib/fewshot/` — 手写少样本对 `<name>.html` + `<name>.json`（v2 schema）。
- 测试夹具：`test/fixtures/classify-article.html`（含 script/style/同源 link/video/onerror/copy-btn/iframe/code-block，供 capture/prepare/derive/clear 全链路断言）。

**修改：**
- `script/lib/placeholder.mjs` — 新增 `applyClassifyPlan(frame, ctx, plan)` + `code_block`/`block_screenshot` 分支；`processSpecialElements` 不再被调用（保留函数体待实施期删）。
- `script/pylib/placeholder.py` — 镜像 `apply_classify_plan(page, ctx, plan)`。
- `script/clear_trans_html.mjs` — main 流改 `setContent(snapshot.html)` + 读 plan + `applyClassifyPlan`；移除 `progressiveScroll`/`waitForDomStable`/`page-merge`/`processSpecialElements` 调用。
- `script/clear_trans_html.py` — 镜像。
- `SKILL.md` — 新增步骤 1.6/1.8，步骤 2 改消费快照+plan；步骤 1.5 路由表 `scrollable → 步骤 1.6`。
- `CLAUDE.md` — 管线、快照双产物、分派表、镜像、文档地图。

**废弃（删除）：**
- `script/lib/page-classify.js`、`script/lib/page-merge.js`、`script/prepare_classify.mjs`（不存在则跳过）。

---

### Task 1: 共享 `page-prepare.js` + `page-derive.js` + `capture_snapshot.mjs`（Node CLI）

**Files:**
- Create: `script/lib/page-prepare.js`
- Create: `script/lib/page-derive.js`
- Create: `script/capture_snapshot.mjs`
- Create: `test/fixtures/classify-article.html`
- Create: `test/fixtures/style.css`
- Test: `test/integration/capture-snapshot.test.mjs`

**Interfaces:**
- Consumes: `script/lib/contract.mjs`（`emit`/`emitError`/`usage`/`log`）、`script/lib/env.mjs`（`storageStatePath`/`urlToDirName`/`workingRoot`）、`script/lib/browser.mjs`（`openPage`）、`script/lib/placeholder.mjs`（`readSharedScript`）。
- Produces: `capture_snapshot.mjs` 写 `working/<url-dir>/snapshot.html` 与 `working/<url-dir>/classify/classify_input.html`，emit `{status:"ok"|"too_large"|"error", snapshot?, classifyInput?, elements?, tokenEstimate?, warnings?, reason?}`。后续任务 3/4 读这两份产物。

**参考形状**（`detect_page.mjs` 的模板，新 CLI 必须镜像）：
```js
#!/usr/bin/env node
// capture_snapshot.mjs <url> [--timeout 120000] —— 抓全保真快照 + 派生精简版
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath, workingRoot, urlToDirName } from './lib/env.mjs';
import { openPage } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

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
```

- [ ] **Step 1: 写夹具 `test/fixtures/classify-article.html`**

```html
<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>Classify Article</title>
  <link rel="stylesheet" href="/style.css">
  <style>.from-style{color:red}</style>
</head><body>
  <nav class="sidebar">侧栏噪声</nav>
  <main data-u2m-listflow>
    <article>
      <h1>标题在列表流内</h1>
      <p>这是一段足够长的正文文本用于触发长文本占位阈值它必须超过四十个字符所以这里继续写下去直到达标为止。</p>
      <pre class="hljs" data-lang="python"><code>def hello():\n    print("hi")</code></pre>
      <div class="chart" style="width:400px;height:300px"><canvas></canvas></div>
      <svg width="200" height="100"><rect width="100" height="50"/></svg>
      <button class="copy-btn">Copy</button>
    </article>
  </main>
  <script>document.body.dataset.ran='yes'</script>
  <iframe src="/iframe-body.html"></iframe>
</body></html>
```

`test/fixtures/style.css`：
```css
body { background: #fff; }
.chart { border: 1px solid #000; }
```
（若 `test/fixtures/iframe-body.html` 已存在则复用；否则加一个最小 `<body>iframe content</body>`。）

- [ ] **Step 2: 写失败测试 `test/integration/capture-snapshot.test.mjs`**

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx, root;
before(async () => { fx = await startFixtureServer(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-cap-')); });
after(async () => { await fx.close(); });

const run = (page) => runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs'), `${fx.url}/${page}`],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const dir = (page) => path.join(root, urlToDirName(`${fx.url}/${page}`));

test('capture: ok 路径写两份产物 + emit 一行 JSON', async () => {
  const r = await run('classify-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.match(json.snapshot, /snapshot\.html$/);
  assert.match(json.classifyInput, /classify_input\.html$/);
  assert.ok(json.elements > 0);
  assert.ok(json.tokenEstimate > 0);
  // stdout 恰一行
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);

  const snap = await fs.readFile(path.join(dir('classify-article.html'), 'snapshot.html'), 'utf8');
  // 全保真：script 已剥
  assert.doesNotMatch(snap, /<script[\s>]/);
  // 外部 CSS 已内联成 <style data-u2m-inlined>，<link rel=stylesheet> 已移除
  assert.match(snap, /<style data-u2m-inlined=/);
  assert.doesNotMatch(snap, /<link[^>]*rel=["']stylesheet["']/);
  // 既有 <style> 保留
  assert.match(snap, /\.from-style\{color:red\}/);
  // base 已注入
  assert.match(snap, /<base href=/);
  // data-u2m-id 落在候选（article/pre/svg/chart）但不在叶子 p/h1
  assert.match(snap, /data-u2m-id="\d+"/);
  // on* 事件属性已剥
  assert.doesNotMatch(snap, /\son\w+=/);
  // copy-btn 已剥
  assert.doesNotMatch(snap, /copy-btn/);
  // video/img inline style 保留（snapshot 含元素 inline style）

  const ci = await fs.readFile(path.join(dir('classify-article.html'), 'classify/classify_input.html'), 'utf8');
  // 长文本已占位
  assert.match(ci, /\{\{T\d+\}\}/);
  // 代码块文本也占位
  assert.match(ci, /data-lang="python"/);
  // <style> 已剥
  assert.doesNotMatch(ci, /<style[\s>]/);
  // id 与 snapshot 同源：抽 snapshot 的 id 集 ⊇ classify 的 id 集
  const snapIds = new Set([...snap.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  const ciIds = new Set([...ci.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  for (const id of ciIds) assert.ok(snapIds.has(id), `id ${id} 在 classify 但不在 snapshot`);
});

test('capture: usage_error 无参退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test test/integration/capture-snapshot.test.mjs`
Expected: FAIL（`capture_snapshot.mjs` 不存在，`runScript` 报 ENOENT 或非零退出）。

- [ ] **Step 4: 实现 `script/lib/page-prepare.js`**

```js
function __u2mPrepareBody(cfg) {
  cfg = cfg || {};
  const ID_SELECTORS = 'div,section,article,aside,nav,header,footer,main,figure,table,thead,tbody,tr,canvas,svg,video,iframe,picture,ul,ol,li,dl,pre,blockquote,details,[role],[data-chart],.chart,.echarts,.highcharts,.MathJax,.MathJax_Display,.katex,.katex-display';
  const LEAF = new Set(['p','span','a','code','em','strong','h1','h2','h3','h4','h5','h6','td','th']);

  // 1. 合并同源内容 iframe（吸收 __u2mMergeIframes，阈值 500）
  const textLen = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\s+/g,' ').trim().length;
  if (textLen < 500) {
    for (let r = 0; r < 5; r++) {
      const frames = Array.from(document.querySelectorAll('iframe')).filter((f) => {
        try { return f.contentDocument && f.contentDocument.body; } catch (e) { return false; }
      });
      if (!frames.length) break;
      for (const f of frames) {
        const host = document.createElement('div');
        for (const n of Array.from(f.contentDocument.body.childNodes)) host.appendChild(document.adoptNode(n));
        f.replaceWith(host);
      }
    }
  }

  // 2. 内联外部 CSS（同步：仅处理同源/CORS 开放；fetch 失败保留 <link>）
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  const cssChunks = [];
  const fallbackLinks = [];
  for (const l of links) {
    try {
      const res = await fetch(l.href);
      if (!res.ok) throw new Error('http ' + res.status);
      cssChunks.push(await res.text());
    } catch (e) {
      fallbackLinks.push(l); // 保留兜底
    }
  }
  if (cssChunks.length) {
    const s = document.createElement('style');
    s.setAttribute('data-u2m-inlined', '1');
    s.textContent = cssChunks.join('\n');
    document.head.appendChild(s);
  }
  for (const l of links) if (!fallbackLinks.includes(l)) l.remove();

  // 3. 剥尽 JS 与噪声标签 + on* 事件属性
  document.querySelectorAll('script,noscript,template').forEach((e) => e.remove());
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });

  // 4. 剥叶子噪声（复制按钮）
  document.querySelectorAll('.copy,.copy-btn,button[aria-label*="copy" i]').forEach((e) => e.remove());

  // 5. 注入 <base href=origin>
  if (!document.querySelector('base[data-u2m-base]')) {
    const b = document.createElement('base');
    b.setAttribute('data-u2m-base', '1');
    b.href = location.origin;
    document.head.prepend(b);
  }

  // 6. 打 data-u2m-id（文档序递增，仅候选；叶子文本不打）
  let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode();
  while (el) {
    if (el.matches(ID_SELECTORS) && !el.closest('[data-u2m-id]')) {
      el.setAttribute('data-u2m-id', String(++n));
    }
    el = walker.nextNode();
  }
  return true;
}
```
注意：函数体含 `await fetch(...)`，需声明为 `async function __u2mPrepareBody(cfg)`。约定测试只校验文件以 `function __u2m` 开头（`async function` 也以 `function` 关键字结尾于首 token？—— 实际 `async function __u2mPrepareBody` 的正则 `/^function __u2m/` 不匹配 `async function`）。**因此不得加 `async`**。改用 `.then` 链或同步 XHR。**用同步 `XMLHttpRequest` 取 CSS**（页面 context 内同步请求同源资源可用；CORS 开放的跨源亦可；失败保留 `<link>`）：

```js
function __u2mPrepareBody(cfg) {
  cfg = cfg || {};
  const ID_SELECTORS = '...同上...';
  // 1. 合并 iframe（同上）
  // 2. 内联外部 CSS（同步 XHR）
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  const cssChunks = [];
  const keep = [];
  for (const l of links) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', l.href, false); // 同步
      x.send();
      if (x.status >= 200 && x.status < 300) cssChunks.push(x.responseText);
      else keep.push(l);
    } catch (e) { keep.push(l); }
  }
  if (cssChunks.length) {
    const s = document.createElement('style'); s.setAttribute('data-u2m-inlined','1');
    s.textContent = cssChunks.join('\n'); document.head.appendChild(s);
  }
  for (const l of links) if (!keep.includes(l)) l.remove();
  // 3-6 同上（剥 script/on*、剥 copy、注 base、打 id）
  return true;
}
```

- [ ] **Step 5: 实现 `script/lib/page-derive.js`**

```js
function __u2mDeriveClassifyInput(cfg) {
  cfg = cfg || {};
  const N = cfg.placeholderMinChars || 40;
  const SIGNAL = /^(position|display|float|clear|visibility|overflow|border|border-radius|background|background-color|box-shadow|width|height|min-width|min-height|max-width|max-height|transform|z-index|flex|flex-direction|flex-wrap|justify-content|align-items|align-content|grid|grid-template|gap|gap)$/;
  // 1. 长文本占位（含代码）
  let k = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent && node.textContent.trim().length > N) {
      node.textContent = '{{T' + (++k) + '}}';
    }
    node = walker.nextNode();
  }
  // 2. 剥 <style>/<link rel=stylesheet>/<noscript>/<template>
  document.querySelectorAll('style,link[rel~="stylesheet"],noscript,template').forEach((e) => e.remove());
  // 3. 白名单信号样式内联（仅信号属性，剥非信号 inline style）
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    const keep = {};
    for (let i = 0; i < cs.length; i++) {
      const prop = cs.item(i);
      if (SIGNAL.test(prop)) keep[prop] = cs.getPropertyValue(prop);
    }
    el.removeAttribute('style');
    const parts = Object.entries(keep).map(([p,v]) => `${p}:${v}`);
    if (parts.length) el.setAttribute('style', parts.join(';'));
  });
  return document.body.outerHTML;
}
```
**注意 `color/font/text-*` 不在 `SIGNAL` 正则内 → 不内联**。约定测试要求文件以 `function __u2m` 开头——此处无 `async`，满足。

- [ ] **Step 6: 实现 `script/capture_snapshot.mjs`（main 流）**

```js
async function progressiveScroll(page) {
  await page.evaluate(async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {            // 与 page-detect.js scrollIters 一致
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));   // 与 scrollWait 一致
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  });
}
async function waitForDomStable(page, { stableMs = 1000, maxMs = 15000 } = {}) {
  const t0 = Date.now(); let last = -1; let lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= stableMs) return;
    await page.waitForTimeout(200);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: capture_snapshot.mjs <url> [--timeout ms]');
  const timeoutMs = Number(args.timeout ?? 120000);
  const pageInit = await readSharedScript('page-init.js');
  const pagePrepare = await readSharedScript('page-prepare.js');
  const pageDerive = await readSharedScript('page-derive.js');

  const urlDir = path.join(workingRoot(), urlToDirName(url));
  const classifyDir = path.join(urlDir, 'classify');
  let s; let result;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    await progressiveScroll(s.page);
    await waitForDomStable(s.page);
    await s.page.evaluate(`(${pagePrepare})()`);
    const snapshot = await s.page.evaluate(() => document.documentElement.outerHTML);
    const classifyInput = await s.page.evaluate(`(${pageDerive})()`);
    const idCount = (snapshot.match(/data-u2m-id="\d+"/g) || []).length;
    const tokenEstimate = Math.round(classifyInput.length / 4);
    const warnings = [];
    // 跨源 CSS 兜底：检测保留的 <link rel=stylesheet>
    const keptLinks = (snapshot.match(/<link[^>]*rel=["']stylesheet["']/g) || []).length;
    if (keptLinks) warnings.push(`${keptLinks} 个外部 CSS fetch 失败，保留 <link> 兜底`);

    if (tokenEstimate > 80000) {
      await fs.mkdir(classifyDir, { recursive: true });
      result = { status: 'too_large', tokenEstimate, elements: idCount, reason: `token 估算 ${tokenEstimate} 超预算，走分区模式` };
    } else {
      await fs.mkdir(classifyDir, { recursive: true });
      await fs.writeFile(path.join(urlDir, 'snapshot.html'), snapshot, 'utf8');
      await fs.writeFile(path.join(classifyDir, 'classify_input.html'), classifyInput, 'utf8');
      result = { status: 'ok', snapshot: path.join(urlDir, 'snapshot.html'), classifyInput: path.join(classifyDir, 'classify_input.html'), elements: idCount, tokenEstimate, warnings };
    }
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {});
  emit(result, 0);
}
main().catch((e) => emitError(e.message, 1));
```
（`parseArgs` 见本任务 Interfaces 处的参考形状，置于 `main` 之前。）

- [ ] **Step 7: 运行测试，确认通过**

Run: `node --test test/integration/capture-snapshot.test.mjs`
Expected: PASS（两个用例）。若 `openPage` 因 `storage_state.json` 不存在抛错，则在测试 `before` 里写一个空 `{"cookies":[],"origins":[]}` 到 `working/cookies/storage_state.json`（mirror `detect-page.test.mjs` 的做法；若该测试无此处理则 `openPage` 已容忍缺失——以实际行为为准）。

- [ ] **Step 8: 运行既有 placeholder 约定测试，确认新文件合规**

Run: `node --test test/integration/placeholder.test.mjs`
Expected: PASS（断言 `page-prepare.js`/`page-derive.js` 以 `function __u2m` 开头）。

- [ ] **Step 9: 提交**

```bash
git add script/lib/page-prepare.js script/lib/page-derive.js script/capture_snapshot.mjs \
        test/fixtures/classify-article.html test/fixtures/style.css \
        test/integration/capture-snapshot.test.mjs
git commit -m "feat(capture): page-prepare/derive + capture_snapshot.mjs（TDD 绿）"
```

---

### Task 2: `classify_plan.json` v2 schema + 少样本集 + 契约测试

**Files:**
- Create: `script/lib/fewshot/nested-text-wrapper.html` + `.json`
- Create: `script/lib/fewshot/sidebar-ads-nav.html` + `.json`
- Create: `script/lib/fewshot/title-in-listflow.html` + `.json`
- Create: `script/lib/fewshot/code-block.html` + `.json`
- Create: `script/lib/fewshot/chart-card-grid.html` + `.json`
- Create: `test/unit/fewshot.test.mjs`
- Create: `test/integration/test_fewshot.py`

**Interfaces:**
- Consumes: 无（纯数据）。
- Produces: v2 schema 契约——`{version:2, mode:"whole"|"region", listFlowSelector:string, blocks:[{id:int, action:enum, blockOf?:int}]}`，`action ∈ {keep,delete,code_block,screenshot,passthrough_svg,svg_convert,latex,block_screenshot}`。任务 3/4 的 `applyClassifyPlan`/`apply_classify_plan` 与 SKILL.md 步骤 1.8 读这些少样本。

- [ ] **Step 1: 写少样本对（每对 `.html` 片段 + `.json` plan）**

`script/lib/fewshot/nested-text-wrapper.html`（片段，含 `data-u2m-id`）：
```html
<main><article data-u2m-id="1"><div><div><p>长正文占位 {{T1}}</p></div></div></article></main>
```
`nested-text-wrapper.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 1, "action": "keep" } ] }
```

`sidebar-ads-nav.html`：
```html
<nav class="sidebar" data-u2m-id="1">广告</nav>
<main><article data-u2m-id="2"><p>{{T1}}</p></article></main>
```
`sidebar-ads-nav.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "keep" } ] }
```
（侧栏 id 1 不在 blocks——它属列表流外，由 clear_trans 删兄弟。）

`title-in-listflow.html`：
```html
<main><article data-u2m-id="1"><h1>标题</h1><p>{{T1}}</p></article></main>
```
`title-in-listflow.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 1, "action": "keep" } ] }
```

`code-block.html`：
```html
<main><article data-u2m-id="1"><pre class="hljs" data-lang="python" data-u2m-id="2"><code>{{T1}}</code></pre></article></main>
```
`code-block.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "code_block" } ] }
```

`chart-card-grid.html`：
```html
<main><article data-u2m-id="1"><div class="chart" data-u2m-id="2"><canvas></canvas></div></article></main>
```
`chart-card-grid.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "block_screenshot", "blockOf": 2 } ] }
```

- [ ] **Step 2: 写失败测试 `test/unit/fewshot.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const FEWSHOT = path.resolve('script/lib/fewshot');
const ACTIONS = new Set(['keep','delete','code_block','screenshot','passthrough_svg','svg_convert','latex','block_screenshot']);

test('fewshot: 每对 .html/.json 合 v2 schema 且 blocks id ⊆ 输入 id 集', async () => {
  const files = await fs.readdir(FEWSHOT);
  const names = new Set(files.filter(f => f.endsWith('.html')).map(f => f.slice(0, -5)));
  for (const name of names) {
    const html = await fs.readFile(path.join(FEWSHOT, `${name}.html`), 'utf8');
    const plan = JSON.parse(await fs.readFile(path.join(FEWSHOT, `${name}.json`), 'utf8'));
    assert.equal(plan.version, 2, `${name}: version`);
    assert.ok(['whole','region'].includes(plan.mode), `${name}: mode`);
    assert.ok(typeof plan.listFlowSelector === 'string' && plan.listFlowSelector, `${name}: listFlowSelector`);
    const htmlIds = new Set([...html.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
    assert.ok(plan.blocks.length, `${name}: blocks 非空`);
    for (const b of plan.blocks) {
      assert.ok(Number.isInteger(b.id), `${name}: id int`);
      assert.ok(ACTIONS.has(b.action), `${name}: action ${b.action}`);
      assert.ok(htmlIds.has(String(b.id)), `${name}: id ${b.id} 不在输入`);
      if (b.action === 'block_screenshot') assert.ok(Number.isInteger(b.blockOf ?? b.id), `${name}: blockOf int`);
    }
  }
});
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `node --test test/unit/fewshot.test.mjs`
Expected: PASS（少样本已写好，此测试是契约守护，写完即绿；若先跑则因目录不存在 FAIL，写完少样本后重跑转绿）。

- [ ] **Step 4: 写 Python 镜像契约测试 `test/integration/test_fewshot.py`**

```python
import json, re
from pathlib import Path
import pytest
FEWSHOT = Path(__file__).resolve().parent.parent.parent / "script" / "lib" / "fewshot"
ACTIONS = {"keep","delete","code_block","screenshot","passthrough_svg","svg_convert","latex","block_screenshot"}

def test_fewshot_schema():
    names = {f.stem for f in FEWSHOT.glob("*.html")}
    assert names, "fewshot 目录为空"
    for name in names:
        html = (FEWSHOT / f"{name}.html").read_text(encoding="utf-8")
        plan = json.loads((FEWSHOT / f"{name}.json").read_text(encoding="utf-8"))
        assert plan["version"] == 2
        assert plan["mode"] in ("whole","region")
        assert plan["listFlowSelector"]
        html_ids = set(re.findall(r'data-u2m-id="(\d+)"', html))
        assert plan["blocks"]
        for b in plan["blocks"]:
            assert isinstance(b["id"], int)
            assert b["action"] in ACTIONS
            assert str(b["id"]) in html_ids
            if b["action"] == "block_screenshot":
                assert isinstance(b.get("blockOf", b["id"]), int)
```
Run: `uv run pytest test/integration/test_fewshot.py`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add script/lib/fewshot test/unit/fewshot.test.mjs test/integration/test_fewshot.py
git commit -m "feat(fewshot): v2 schema 少样本对 + 契约测试（双侧）"
```

---

### Task 3: `applyClassifyPlan`（Node）+ `clear_trans_html.mjs` 改造

**Files:**
- Modify: `script/lib/placeholder.mjs`（新增 `applyClassifyPlan` + `code_block`/`block_screenshot` 分支）
- Modify: `script/clear_trans_html.mjs`（main 流改 `setContent` + 读 plan + `applyClassifyPlan`；移除 scroll/merge/processSpecialElements 调用）
- Modify: `test/integration/clear-node.test.mjs`（complex-elements 用例改为：先 capture_snapshot、再手写 plan、再 clear_trans）
- Test: `test/integration/clear-node.test.mjs`

**Interfaces:**
- Consumes: 任务 1 的 `snapshot.html`、任务 2 的 v2 schema。`placeholder.mjs` 既有 `makeCtx`/`processMermaid`/`processImages`/`writeManifest`/`callOnElement`/`replaceWithHtml` 不变。
- Produces: `applyClassifyPlan(frame, ctx, plan)`——签名 `(frame, ctx, plan) => Promise<number>`，消费 v2 plan，按 `action` 逐块分派，写 manifest entries。`clear_trans_html.mjs` 读 `working/<url-dir>/snapshot.html` + `working/<url-dir>/classify/classify_plan.json`。

**既有参考**（`placeholder.mjs` `processSpecialElements` 的 svg_convert 分支，新 applyClassifyPlan 复用同形）：
```js
const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
const rel = (ext) => `assets/complex/${id}.${ext}`;
// screenshot: replaceWithHtml(frame, h, `<img src="${rel('png')}" alt="${id}" data-u2m-asset="1">`); ctx.entries.push({id,type,final:rel('png'),status:'done'});
// svg_convert: callOnElement(h, inline) → 写 draft; replaceWithHtml(frame, h, `<p>{{${id}}}</p>`); ctx.entries.push({id,type,draft:`assets/draft/${id}.html`,status:'pending'});
```

- [ ] **Step 1: 写失败测试——更新 `test/integration/clear-node.test.mjs` 的 complex-elements 用例**

在文件顶部加 helper（先 capture 再 clear）：
```js
import { runScript as runCap } from '../helpers/run-script.mjs'; // 复用
const capture = (page, root) => runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs'), `${fx.url}/${page}`], { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const writePlan = (root, page, plan) => fs.writeFile(
  path.join(root, urlToDirName(`${fx.url}/${page}`), 'classify', 'classify_plan.json'),
  JSON.stringify(plan), 'utf8');
const runClear = (page, root) => runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs'), `${fx.url}/${page}`], { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000);
```

替换 `complex-elements: 全分派端到端` 用例为：
```js
test('complex-elements: plan 驱动端到端', async () => {
  await capture('complex-elements.html', root);
  // 复杂元素 fixture 的块 id 由 capture 注入；先用 capture 跑一次取 id→type 映射，
  // 再手写 plan。为确定性，fixture 各特殊元素已带可识别属性，按 snapshot.html 的 id 顺序手写。
  // （实施期：先跑 capture 打印 snapshot.html，按实际 id 填 plan；测试固定该 plan。）
  const plan = require('./fixtures/complex-elements-plan.json'); // 见 Step 2
  await writePlan(root, 'complex-elements.html', plan);
  const r = await runClear('complex-elements.html', root);
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  const manifest = JSON.parse(await fs.readFile(path.join(wf('complex-elements.html'), 'assets/manifest.json'), 'utf8'));
  const types = manifest.items.map((i) => i.type).sort();
  assert.deepEqual(types, ['block_screenshot','latex','passthrough_svg','screenshot','screenshot','svg_convert','svg_convert']);
});
```
**说明**：complex-elements fixture 含 canvas、video（各 screenshot）、大 svg（passthrough_svg）、.chart 与 #viz（svg_convert）、katex（latex）、img（不在 plan，列表流外或 keep）。新 plan 把 `.chart`/`#viz` 仍标 `svg_convert`；若某块改标 `block_screenshot` 则类型向量相应变——**以 Step 2 实际 fixture 的 id 映射为准**。期望向量在 Step 2 落定后回填此断言。

- [ ] **Step 2: 生成 `test/fixtures/complex-elements-plan.json`**

先手动跑一次 capture（或读 fixture 源码标注的 `data-u2m-*`），确定各特殊元素的 `data-u2m-id`，写 plan：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "body > main",
  "blocks": [
    { "id": <canvas-id>, "action": "screenshot" },
    { "id": <video-id>, "action": "screenshot" },
    { "id": <svg-id>, "action": "passthrough_svg" },
    { "id": <chart-id>, "action": "svg_convert" },
    { "id": <viz-id>, "action": "svg_convert" },
    { "id": <katex-id>, "action": "latex" }
  ] }
```
（`<…-id>` 由实施者跑 `node script/capture_snapshot.mjs <fixture-url>` 后读 `snapshot.html` 的 `data-u2m-id` 填入；填后回填 Step 1 的期望向量。）

- [ ] **Step 3: 写 code_block 用例（追加到 clear-node.test.mjs）**

```js
test('code-block: plan 标 code_block → sketch 含语言围栏', async () => {
  await capture('classify-article.html', root);
  // classify-article.html 的 <pre data-lang="python"> 的 id 由 capture 决定；读 snapshot 取
  const snap = await fs.readFile(path.join(wf2('classify-article.html'), '..', 'snapshot.html'), 'utf8');
  const preId = snap.match(/<pre[^>]*data-u2m-id="(\d+)"/)[1];
  await writePlan(root, 'classify-article.html', {
    version: 2, mode: 'whole', listFlowSelector: 'main > article',
    blocks: [ { id: Number(preId), action: 'code_block' } ]
  });
  const r = await runClear('classify-article.html', root);
  assert.equal(r.code, 0, r.stderr);
  const md = await fs.readFile(path.join(wf('classify-article.html'), 'sketch.md'), 'utf8');
  assert.match(md, /```python[\s\S]*def hello/);
  // 不进 manifest
  const man = JSON.parse(await fs.readFile(path.join(wf('classify-article.html'), 'assets/manifest.json'), 'utf8'));
  assert.ok(!man.items.some((i) => i.type === 'code_block'));
});
```
（`wf2` = url-dir 上一级（`path.join(root, urlToDirName(...))`），区别于 `wf`（含 `node_workflow`）。）

- [ ] **Step 4: 运行测试，确认失败**

Run: `node --test test/integration/clear-node.test.mjs`
Expected: FAIL（`applyClassifyPlan` 未实现 / clear_trans 仍走旧流程）。

- [ ] **Step 5: 实现 `applyClassifyPlan`（`script/lib/placeholder.mjs`，追加导出）**

```js
export async function applyClassifyPlan(frame, ctx, plan) {
  validatePlan(plan); // 见下
  const listFlow = await frame.$(plan.listFlowSelector);
  if (!listFlow) throw new Error(`listFlowSelector 未命中: ${plan.listFlowSelector}`);
  // 1. 删列表流子树外的兄弟节点
  await frame.evaluate((sel) => {
    const lf = document.querySelector(sel);
    if (!lf || !lf.parentElement) return;
    const parent = lf.parentElement;
    for (const sib of Array.from(parent.children)) if (sib !== lf) sib.remove();
  }, plan.listFlowSelector);

  const inline = await readSharedScript('page-inline.js');
  let processed = 0;
  for (const b of plan.blocks) {
    const h = await frame.$(`[data-u2m-id="${b.id}"]`);
    if (!h) { ctx.warnings.push(`id 漂移: ${b.id} 跳过`); continue; }
    try {
      if (b.action === 'keep') { /* 不动 */ }
      else if (b.action === 'delete') { await h.evaluate((el) => el.remove()); }
      else if (b.action === 'code_block') {
        const text = await h.evaluate((el) => el.textContent);
        const lang = await h.evaluate((el) => el.getAttribute('data-lang')
          || (el.className.match(/(?:^|\s)(?:language-|lang-)(\w+)/) || [,''])[1]
          || (el.querySelector('code[class*="language-"]')?.className.match(/language-(\w+)/) || [,''])[1]
          || '');
        const cid = `CODE_${++ctx.counters.complex}`;
        await replaceWithHtml(frame, h, `<pre data-u2m-code><code class="language-${lang || ''}">${escapeHtml(text)}</code></pre>`);
        // 不进 manifest
      }
      else if (b.action === 'block_screenshot') {
        const target = await frame.$(`[data-u2m-id="${b.blockOf ?? b.id}"]`);
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.png`;
        await target.screenshot({ path: path.join(ctx.dirs.complex, `${id}.png`) });
        await replaceWithHtml(frame, h, `<img src="${rel}" alt="${id}" data-u2m-asset="1">`);
        ctx.entries.push({ id, type: 'block_screenshot', final: rel, status: 'done' });
      }
      else {
        // screenshot / passthrough_svg / svg_convert / latex —— 复用既有分支
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = (ext) => `assets/complex/${id}.${ext}`;
        if (b.action === 'screenshot') {
          await h.screenshot({ path: path.join(ctx.dirs.complex, `${id}.png`) });
          await replaceWithHtml(frame, h, `<img src="${rel('png')}" alt="${id}" data-u2m-asset="1">`);
          ctx.entries.push({ id, type: b.action, final: rel('png'), status: 'done' });
        } else if (b.action === 'passthrough_svg') {
          const svg = await h.evaluate((el) => el.outerHTML);
          await fs.writeFile(path.join(ctx.dirs.complex, `${id}.svg`), svg, 'utf8');
          await replaceWithHtml(frame, h, `<img src="${rel('svg')}" alt="${id}" data-u2m-asset="1">`);
          ctx.entries.push({ id, type: b.action, final: rel('svg'), status: 'done' });
        } else if (b.action === 'svg_convert') {
          const draftHtml = await callOnElement(h, inline);
          await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8');
          await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`);
          ctx.entries.push({ id, type: b.action, draft: `assets/draft/${id}.html`, status: 'pending' });
        } else if (b.action === 'latex') {
          const tex = await callOnElement(h, await readSharedScript('page-latex.js'));
          if (tex) { await replaceWithText(frame, h, `$$${tex}$$`); ctx.entries.push({ id, type: b.action, status: 'done' }); }
          else { const draftHtml = await callOnElement(h, inline); await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8'); await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`); ctx.entries.push({ id, type: b.action, draft: `assets/draft/${id}.html`, status: 'pending' }); }
        }
      }
      processed++;
    } catch (e) {
      ctx.warnings.push(`action ${b.action}(id=${b.id}) 失败: ${e.message}`);
      try { await h.evaluate((el) => el.removeAttribute('data-u2m-id')); } catch {}
    }
  }
  return processed;
}

function validatePlan(plan) {
  if (!plan || plan.version !== 2) throw new Error('plan.version 必须 = 2');
  if (typeof plan.listFlowSelector !== 'string' || !plan.listFlowSelector) throw new Error('plan.listFlowSelector 缺失');
  const ACTIONS = new Set(['keep','delete','code_block','screenshot','passthrough_svg','svg_convert','latex','block_screenshot']);
  for (const b of (plan.blocks || [])) {
    if (!Number.isInteger(b.id)) throw new Error(`block id 非法: ${JSON.stringify(b)}`);
    if (!ACTIONS.has(b.action)) throw new Error(`block action 非法: ${b.action}`);
    if (b.action === 'block_screenshot' && b.blockOf != null && !Number.isInteger(b.blockOf)) throw new Error('blockOf 非法');
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
```
**注意**：既有 `processSpecialElements` 的 screenshot 分支用 `replaceWithHtml(frame, h, \`<img...>\`)` 且 `h.screenshot`——applyClassifyPlan 的 screenshot 分支须用同形（`h.screenshot` 而非 `target.screenshot`，因 screenshot 对该块本身）。`block_screenshot` 用 `target`（`blockOf`）整块截图。实施时对照既有分支确认参数。

- [ ] **Step 6: 改造 `clear_trans_html.mjs` main 流**

替换 main 为（删除 `progressiveScroll`/`waitForDomStable`/`pageMerge`/`processSpecialElements`，新增 `setContent` + 读 plan + `applyClassifyPlan`）：
```js
async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--')) return usage('用法: clear_trans_html.mjs <url>');
  const dirs = ensureWorkflowDirs(url, 'node_workflow');
  const urlDir = path.dirname(dirs.wf);                       // working/<url-dir>
  const snapshotPath = path.join(urlDir, 'snapshot.html');
  const planPath = path.join(urlDir, 'classify', 'classify_plan.json');
  const pageClean = await readSharedScript('page-clean.js');

  let s; let result;
  try {
    if (!await fs.stat(snapshotPath).then(() => true).catch(() => false))
      return emitError(`snapshot.html 缺失，先跑步骤 1.6 capture_snapshot: ${snapshotPath}`, 1);
    const planText = await fs.readFile(planPath, 'utf8').catch(() => null);
    if (!planText) return emitError(`classify_plan.json 缺失，先跑步骤 1.8: ${planPath}`, 1);

    s = await openPage('about:blank', { viewport: { width: 1280, height: 3000 }, storageStatePath: storageStatePath(), log });
    const snapshot = await fs.readFile(snapshotPath, 'utf8');
    await s.page.setContent(snapshot, { waitUntil: 'domcontentloaded' });

    const ctx = makeCtx(dirs, { context: s.context, log });
    await processMermaid(s.page.mainFrame(), ctx);
    await applyClassifyPlan(s.page.mainFrame(), ctx, JSON.parse(planText));
    await processImages(s.page.mainFrame(), ctx);
    await s.page.evaluate(`(${pageClean})()`);

    await s.page.addScriptTag({ path: READABILITY_JS });
    const article = await s.page.evaluate(() => {
      const a = new Readability(document, { keepClasses: true }).parse();
      return a ? { title: a.title, content: a.content } : null;
    });
    let html = article ? article.content : await s.page.evaluate(() => document.body.innerHTML);
    for (const e of ctx.entries) if (e.final) html = html.split(new URL(e.final, url).href).join(e.final);

    const td = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx', bulletListMarker: '-' });
    td.use(gfm);
    const md = td.turndown(html).replace(/\\_/g, '_');
    await fs.writeFile(path.join(dirs.wf, 'sketch.md'), md, 'utf8');
    await writeManifest(dirs.manifest, ctx.entries);
    result = { status: 'ok', sketch: path.join(dirs.wf, 'sketch.md'), images: ctx.counters.img, complex: ctx.entries.length, warnings: ctx.warnings };
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {});
  emit(result, 0);
}
```
**注意**：`openPage('about:blank', ...)`——`openPage` 内部 `gotoWithRetry` 对 `about:blank` 须不报错；若 `openPage` 强制走 networkidle 重试，则改用裸 `chromium.launch` + `newContext({storageState, bypassCSP:true})` + `newPage()` + `setContent`（绕开 `openPage` 的 goto）。**实施时先试 `openPage('about:blank')`，若失败则改裸 launch**。route-abort `media` 与 `bypassCSP:true` 仍需保留。

- [ ] **Step 7: 运行测试，确认通过**

Run: `node --test test/integration/clear-node.test.mjs`
Expected: PASS（complex-elements plan 驱动 + code-block 围栏 + 不进 manifest）。若 `openPage('about:blank')` 失败，按 Step 6 注记改裸 launch 后重跑。

- [ ] **Step 8: 跑全量 Node 集成，确认无回归**

Run: `pnpm run test:integration`
Expected: 既有 `static-article`/`csp-article`/`lazy-load` 等用例需适配新流程（先 capture+plan 再 clear）——**这些用例会在本任务失败**，属预期；在 Step 7 通过的 complex-elements + code-block 用例之外，其余用例的适配作为本任务收尾：把每个 `run(page)` 用例改为 `capture → writePlan(手工 keep-only plan) → runClear`。手工 plan 对纯文本页只需 `{version:2,mode:"whole",listFlowSelector:"<该页主容器>",blocks:[{id:1,action:"keep"}]}`。

> **范围控制**：若既有用例过多，至少适配 `static-article.html`、`csp-article.html`、`lazy-load.html`、`nav-noise.html`、`mermaid.html`、`code-block.html` 六个核心夹具；其余记为已知失败、留待后续。在 commit message 列明已适配/未适配清单。

- [ ] **Step 9: 提交**

```bash
git add script/lib/placeholder.mjs script/clear_trans_html.mjs test/integration/clear-node.test.mjs test/fixtures/complex-elements-plan.json
git commit -m "feat(clear-node): applyClassifyPlan + setContent(snapshot) 改造（TDD 绿）"
```

---

### Task 4: `apply_classify_plan`（Python）+ `clear_trans_html.py` 改造（镜像）

**Files:**
- Modify: `script/pylib/placeholder.py`（新增 `apply_classify_plan` + `code_block`/`block_screenshot`）
- Modify: `script/clear_trans_html.py`（main 流改 `set_content` + 读 plan + `apply_classify_plan`；移除 `progressive_scroll`/`wait_for_dom_stable`/`page_merge`/`process_special_elements`）
- Modify: `test/integration/test_clear_py.py`（complex-elements 用例改为 capture→plan→clear）
- Test: `test/integration/test_clear_py.py`

**Interfaces:**
- Consumes: 任务 1 的 `snapshot.html`、任务 2 的 v2 schema。Python 侧 `placeholder.py` 既有 `make_ctx`/`process_mermaid`/`process_images`/`write_manifest`/`_call_on_element`/`_replace_with_html`/`_replace_with_text` 不变。
- Produces: `apply_classify_plan(page, ctx, plan)`——签名 `(page, ctx, plan) -> int`，镜像 Node `applyClassifyPlan`。`clear_trans_html.py` 读 `working/<url-dir>/snapshot.html` + `classify/classify_plan.json`。

**既有参考**（`placeholder.py` `process_special_elements` 的 svg_convert 分支）：
```python
elif etype == "svg_convert":
    draft = _call_on_element(h, inline)
    (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
    _replace_with_html(page, h, "<p>{{" + cid + "}}</p>")
    ctx["entries"].append({"id": cid, "type": etype, "draft": f"assets/draft/{cid}.html", "status": "pending"})
```

- [ ] **Step 1: 写失败测试——更新 `test/integration/test_clear_py.py` 的 complex-elements 用例**

```python
import json, subprocess, sys
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent.parent
CAP = REPO / "script" / "capture_snapshot.mjs"
CLR = REPO / "script" / "clear_trans_html.py"

def capture(tmp_working, url):
    return subprocess.run([sys.executable, str(CLR.parent / "capture_snapshot.mjs")],  # 注意 capture_snapshot 是 node CLI
                         capture_output=True, text=True, timeout=90, env={**os.environ, "U2M_WORKING_ROOT": str(tmp_working)})
# 正确：capture_snapshot.mjs 用 node 跑
def capture_node(tmp_working, url):
    env = {**os.environ, "U2M_WORKING_ROOT": str(tmp_working)}
    return subprocess.run([os.environ.get("NODE", "node"), str(REPO/"script"/"capture_snapshot.mjs"), url],
                          capture_output=True, text=True, timeout=90, env=env)

def test_complex_elements(fixture_server, tmp_working):
    url = f"{fixture_server}/complex-elements.html"
    r = capture_node(tmp_working, url); assert r.returncode == 0, r.stderr
    plan = json.loads((REPO / "test" / "fixtures" / "complex-elements-plan.json").read_text(encoding="utf-8"))
    plan_dir = tmp_working / url_to_dir_name(url) / "classify"
    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "classify_plan.json").write_text(json.dumps(plan), encoding="utf-8")
    r = run(tmp_working, url); assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout.strip()); assert payload["status"] == "ok"
    manifest = json.loads((wf(tmp_working, url) / "assets" / "manifest.json").read_text(encoding="utf-8"))
    types = sorted(i["type"] for i in manifest["items"])
    assert types == ["block_screenshot","latex","passthrough_svg","screenshot","screenshot","svg_convert","svg_convert"]
```
（期望向量须与任务 3 Step 1 回填的 Node 侧一致——镜像不变性。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `uv run pytest test/integration/test_clear_py.py::test_complex_elements`
Expected: FAIL（`apply_classify_plan` 未实现 / clear.py 仍旧流程）。

- [ ] **Step 3: 实现 `apply_classify_plan`（`script/pylib/placeholder.py`，追加）**

```python
def _validate_plan(plan):
    if not plan or plan.get("version") != 2:
        raise ValueError("plan.version 必须 = 2")
    if not plan.get("listFlowSelector"):
        raise ValueError("plan.listFlowSelector 缺失")
    actions = {"keep","delete","code_block","screenshot","passthrough_svg","svg_convert","latex","block_screenshot"}
    for b in plan.get("blocks", []):
        if not isinstance(b["id"], int): raise ValueError(f"block id 非法: {b}")
        if b["action"] not in actions: raise ValueError(f"block action 非法: {b['action']}")
        if b["action"] == "block_screenshot" and b.get("blockOf") is not None and not isinstance(b["blockOf"], int):
            raise ValueError("blockOf 非法")

def apply_classify_plan(page, ctx, plan):
    _validate_plan(plan)
    lf = page.query_selector(plan["listFlowSelector"])
    if not lf: raise ValueError(f"listFlowSelector 未命中: {plan['listFlowSelector']}")
    # 1. 删列表流子树外兄弟
    page.evaluate("(sel) => { const lf = document.querySelector(sel); if(!lf||!lf.parentElement) return; "
                  "for (const s of Array.from(lf.parentElement.children)) if (s !== lf) s.remove(); }", plan["listFlowSelector"])
    dirs = ctx["dirs"]; entries = ctx["entries"]; warnings = ctx["warnings"]
    inline = read_shared_script("page-inline.js")
    processed = 0
    for b in plan["blocks"]:
        h = page.query_selector(f'[data-u2m-id="{b["id"]}"]')
        if not h:
            warnings.append(f"id 漂移: {b['id']} 跳过"); continue
        try:
            action = b["action"]
            if action == "keep":
                pass
            elif action == "delete":
                h.evaluate("el => el.remove()")
            elif action == "code_block":
                text = h.evaluate("el => el.textContent")
                lang = h.evaluate("""el => el.getAttribute('data-lang')
                    || ((el.className.match(/(?:^|\\s)(?:language-|lang-)(\\w+)/)||[,''])[1])
                    || ((el.querySelector('code[class*=language-]')||{}).className||'').match(/language-(\\w+)/)
                    && ((el.querySelector('code[class*=language-]')||{}).className||'').match(/language-(\\w+)/)
                    ? ((el.querySelector('code[class*=language-]')||{}).className||'').match(/language-(\\w+)/)[1] : ''""") or ""
                cid = f"CODE_{ctx['counters']['complex'] + 1}"; ctx['counters']['complex'] += 1
                _replace_with_html(page, h, f'<pre data-u2m-code><code class="language-{lang}">{text}</code></pre>')
            else:
                cid = f"COMPLEX_DIV_{ctx['counters']['complex'] + 1}"; ctx['counters']['complex'] += 1
                if action == "block_screenshot":
                    target = page.query_selector(f'[data-u2m-id="{b.get("blockOf", b["id"])}"]')
                    target.screenshot(path=str(Path(dirs["complex"]) / f"{cid}.png"))
                    _replace_with_html(page, h, f'<img src="assets/complex/{cid}.png" alt="{cid}" data-u2m-asset="1">')
                    entries.append({"id": cid, "type": action, "final": f"assets/complex/{cid}.png", "status": "done"})
                elif action == "screenshot":
                    h.screenshot(path=str(Path(dirs["complex"]) / f"{cid}.png"))
                    _replace_with_html(page, h, f'<img src="assets/complex/{cid}.png" alt="{cid}" data-u2m-asset="1">')
                    entries.append({"id": cid, "type": action, "final": f"assets/complex/{cid}.png", "status": "done"})
                elif action == "passthrough_svg":
                    svg = h.evaluate("el => el.outerHTML")
                    (Path(dirs["complex"]) / f"{cid}.svg").write_text(svg, encoding="utf-8")
                    _replace_with_html(page, h, f'<img src="assets/complex/{cid}.svg" alt="{cid}" data-u2m-asset="1">')
                    entries.append({"id": cid, "type": action, "final": f"assets/complex/{cid}.svg", "status": "done"})
                elif action == "svg_convert":
                    draft = _call_on_element(h, inline)
                    (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                    _replace_with_html(page, h, f"<p>{{{{{cid}}}}}</p>")
                    entries.append({"id": cid, "type": action, "draft": f"assets/draft/{cid}.html", "status": "pending"})
                elif action == "latex":
                    tex = _call_on_element(h, read_shared_script("page-latex.js"))
                    if tex:
                        _replace_with_text(page, h, f"$${tex}$$")
                        entries.append({"id": cid, "type": action, "status": "done"})
                    else:
                        draft = _call_on_element(h, inline)
                        (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                        _replace_with_html(page, h, f"<p>{{{{{cid}}}}}</p>")
                        entries.append({"id": cid, "type": action, "draft": f"assets/draft/{cid}.html", "status": "pending"})
            processed += 1
        except Exception as e:
            warnings.append(f"action {action}(id={b['id']}) 失败: {e}")
            try: h.evaluate("el => el.removeAttribute('data-u2m-id')")
            except Exception: pass
    return processed
```
**注意**：`code_block` 的 `lang` evaluate 表达式较复杂——实施期可简化为只取 `data-lang` + class 正则两路，复杂三元先省略（Python 侧语言判定可与 Node 侧 `escapeHtml`/lang 提取逻辑对齐；若 Node 侧 Step 5 的 lang 提取已简化，Python 镜像同一逻辑）。

- [ ] **Step 4: 改造 `clear_trans_html.py` main 流**

替换 `main`（删除 `progressive_scroll`/`wait_for_dom_stable`/`page_merge`/`process_special_elements`，新增 `set_content` + 读 plan + `apply_classify_plan`）：
```python
def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        usage("用法: clear_trans_html.py <url>")
    url = sys.argv[1]
    dirs = env.ensure_workflow_dirs(url, "python_workflow")
    url_dir = Path(dirs["wf"]).parent
    snapshot_path = url_dir / "snapshot.html"
    plan_path = url_dir / "classify" / "classify_plan.json"
    if not snapshot_path.exists():
        emit({"status":"error","reason":f"snapshot.html 缺失，先跑步骤 1.6: {snapshot_path}"}, 1); return
    if not plan_path.exists():
        emit({"status":"error","reason":f"classify_plan.json 缺失，先跑步骤 1.8: {plan_path}"}, 1); return
    warnings = []
    page_clean = placeholder.read_shared_script("page-clean.js")
    session = open_page("about:blank", viewport={"width":1280,"height":3000},
                        storage_state_path=env.storage_state_path(), log=log_err)
    try:
        page = session.page
        page.set_content(snapshot_path.read_text(encoding="utf-8"), wait_until="domcontentloaded")
        ctx = placeholder.make_ctx(dirs, session.context, log_err)
        placeholder.process_mermaid(page, ctx)
        placeholder.apply_classify_plan(page, ctx, json.loads(plan_path.read_text(encoding="utf-8")))
        placeholder.process_images(page, ctx)
        page.evaluate(f"({page_clean})()")
        html = page.content()
        doc = Document(html, min_text_length=10)
        content = doc.summary(html_partial=True)
        if not content or len(content.strip()) < 20:
            warnings.append("readability-lxml 未能解析主体，回退 body 全文")
            content = page.evaluate("() => document.body.innerHTML")
        md = MarkdownConverter(heading_style="ATX", bullets="-", code_language_callback=code_language).convert(content)
        md = md.replace("\\_", "_").strip() + "\n"
        (dirs["wf"] / "sketch.md").write_text(md, encoding="utf-8")
        placeholder.write_manifest(dirs["manifest"], ctx["entries"])
        payload = {"status":"ok","sketch":str(dirs["wf"]/"sketch.md"),"images":ctx["counters"]["img"],
                   "complex":len(ctx["entries"]),"warnings":warnings+ctx["warnings"]}
    finally:
        try: session.close()
        except Exception: pass
    emit(payload, 0)
```
**注意**：`open_page("about:blank", ...)`——若 Python `open_page` 对 `about:blank` 的 goto 重试报错，改裸 `playwright.launch` + `new_context({storage_state=..., bypass_cSP=True})` + `new_page()` + `set_content`。route-abort media 仍需保留。

- [ ] **Step 5: 运行测试，确认通过**

Run: `uv run pytest test/integration/test_clear_py.py::test_complex_elements`
Expected: PASS。镜像不变性：manifest type 向量与 Node 侧（任务 3）一致。

- [ ] **Step 6: 适配既有 Python 用例（同任务 3 Step 8 范围控制）**

Run: `uv run pytest test/integration/test_clear_py.py`
Expected: complex-elements + 适配的核心夹具通过；其余记已知失败。

- [ ] **Step 7: 提交**

```bash
git add script/pylib/placeholder.py script/clear_trans_html.py test/integration/test_clear_py.py
git commit -m "feat(clear-py): apply_classify_plan + set_content(snapshot) 镜像（TDD 绿）"
```

---

### Task 5: 废弃 page-classify/page-merge + SKILL.md/CLAUDE.md 文档

**Files:**
- Delete: `script/lib/page-classify.js`、`script/lib/page-merge.js`（及若存在的 `script/prepare_classify.mjs`）
- Modify: `test/integration/placeholder.test.mjs`（约定测试若枚举具体文件名则更新；若 glob `page-*.js` 则自动覆盖新文件、不再覆盖已删文件）
- Modify: `SKILL.md`（新增步骤 1.6/1.8，步骤 2 改消费快照+plan，步骤 1.5 路由表）
- Modify: `CLAUDE.md`（管线、快照双产物、分派类型表、镜像、文档地图）

**Interfaces:**
- Consumes: 任务 1-4 的产物。
- Produces: SKILL.md 步骤 1.6（`capture_snapshot.mjs`）、1.8（agent 读 classify_input 写 plan）、步骤 2（消费 snapshot+plan）；CLAUDE.md 文档地图更新。

- [ ] **Step 1: 确认无调用方**

Run: `grep -rn "page-classify\|page-merge\|processSpecialElements\|process_special_elements\|prepare_classify" script/ test/`
Expected: 仅本次删除的文件自身 +（若有）注释/文档命中。`processSpecialElements`/`process_special_elements` 应已无调用方（任务 3/4 移除）。若有残留调用方，先修。

- [ ] **Step 2: 删除废弃文件**

```bash
git rm script/lib/page-classify.js script/lib/page-merge.js
# 若存在：git rm script/prepare_classify.mjs
```

- [ ] **Step 3: 更新 `test/integration/placeholder.test.mjs`（若枚举文件名）**

读该文件，若其断言列出了 `page-classify.js`/`page-merge.js`，从列表移除；`page-prepare.js`/`page-derive.js` 自动被 glob 覆盖。Run: `node --test test/integration/placeholder.test.mjs` → PASS。

- [ ] **Step 4: 更新 `SKILL.md`**

在步骤 1.5（约 line 47-59）之后、步骤 2（line 61）之前插入：

```markdown
### 步骤 1.6 · 抓取全保真快照

```bash
node <skill-root>/script/capture_snapshot.mjs <url> [--timeout 120000]
```

复用步骤 1 写好的登录态，充分滚动后抓取全保真 `snapshot.html`（DOM + 内联 CSS，剥尽 JS）并派生 `classify/classify_input.html`（长文本占位 + 信号样式，供步骤 1.8 LLM 读）。

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 1.8 |
| `too_large` | 走分区模式（见 spec §5.3）或缩白名单重跑 |
| `error` | 把 `reason` 反馈给用户并终止 |
```

再插入步骤 1.8：
```markdown
### 步骤 1.8 · LLM 分类（逐块方案）

读 `working/<url-dir>/classify/classify_input.html` 与 `<skill-root>/script/lib/fewshot/` 下每对 `<name>.html`+`<name>.json` 作少样本。按 v2 schema 写 `working/<url-dir>/classify/classify_plan.json`：

```json
{ "version": 2, "mode": "whole",
  "listFlowSelector": "<列表流父容器选择器，须含文章主标题>",
  "blocks": [ { "id": <data-u2m-id>, "action": "keep|delete|code_block|screenshot|passthrough_svg|svg_convert|latex|block_screenshot" } ] }
```

**约束**：1.8 只做结构判断，不读文本语义；`listFlowSelector` 须圈住文章主体块流并含主标题（其子树外的兄弟会被步骤 2 删除）；代码块靠 `<pre>`/`data-lang`/class 结构识别，标 `code_block`，语言由本地脚本判。

写完进入步骤 2。
```

更新步骤 1.5 路由表：`scrollable | 进入步骤 1.6`（原为"进入步骤 2"）。
更新步骤 2 说明：开头加一句"读 `working/<url-dir>/snapshot.html` 与 `classify/classify_plan.json`（须先完成步骤 1.6/1.8）；缺失则 `error`"。

- [ ] **Step 5: 更新 `CLAUDE.md`**

- 管线顺序段：改为 `0 init → 1 login → 1.5 detect_page → 1.6 capture_snapshot → 1.8 classify → 2 clear_trans_html(双侧) → 3 → 4 → 5`。
- 新增"快照双产物"小节：`snapshot.html`（全保真，渲染源）+ `classify/classify_input.html`（派生精简，LLM 输入）+ `classify/classify_plan.json`（agent 产出，v2 schema）。
- 分派类型表：`action` 枚举取代 `data-u2m-type`；新增 `code_block`（不进 manifest/不经步骤 3）、`block_screenshot`。
- 镜像说明：改为"两运行时 `setContent(同一 snapshot.html)` + 同一 plan → manifest 一致；不再各自重开页"。
- 文档地图：加本计划与 spec 路径。
- 移除对 `page-classify.js`/`page-merge.js`/`processSpecialElements` 的引用，改为 `page-prepare.js`/`page-derive.js`/`applyClassifyPlan`。

- [ ] **Step 6: 全量测试 + 冒烟确认**

Run: `pnpm test:all && uv run pytest test/unit test/integration`
Expected: 单测全绿；集成测试在任务 3/4 适配范围内绿、范围外记已知失败。手动冒烟一个真实 URL（可选，记录到 `test/smoke/SMOKE.md`）。

- [ ] **Step 7: 提交**

```bash
git rm script/lib/page-classify.js script/lib/page-merge.js   # 已在 Step 2
git add SKILL.md CLAUDE.md test/integration/placeholder.test.mjs
git commit -m "docs: SKILL.md 步骤 1.6/1.8 + 废弃 page-classify/merge + CLAUDE.md 更新"
```

---

## Self-Review（写完后已自查）

1. **Spec 覆盖**：§3 决策 1（快照自包含）→ T1；决策 2（双产物）→ T1；决策 3（列表流+id）→ T2/T3；决策 4（列表流外删）→ T3 Step 5；决策 5（type+clean→action）→ T2 schema；决策 6（代码全占位+本地判语言）→ T1 derive + T3 code_block；决策 7（镜像）→ T3/T4；§5.3 region 模式——**未单独成任务**，capture 的 `too_large` emit 已实现，分区序列化留作后续（spec 标注为降级路径，YAGNI 现阶段不实现）；§7.4 setContent 资源解析→T3 Step 6；§8 测试→各任务内。
2. **占位符扫描**：T3 Step 2 的 `<…-id>` 是"实施者跑 capture 后填入"的明确指令（非 TBD/TODO），期望向量在 Step 1 文字说明"以 Step 2 实际 id 映射为准"——回填动作已写明。无"add error handling"/"similar to"。
3. **类型一致**：`applyClassifyPlan(frame, ctx, plan)`（Node）/ `apply_classify_plan(page, ctx, plan)`（Python）——Node 用 `frame`、Python 用 `page`，与既有 `processSpecialElements(frame, ctx)`/`process_special_elements(page, ctx)` 一致。`validatePlan`/`_validate_plan` 镜像。`escapeHtml` 仅 Node 有（Python `text` 直接插，未转义——**已知差异**：Python 侧 code_block 文本未 HTML 转义，若代码含 `<` 会破。**实施期须在 Python 侧也加 `html.escape(text)`**，已记为 T4 Step 3 注记的"与 Node 侧对齐"项）。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-llm-driven-classification.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
