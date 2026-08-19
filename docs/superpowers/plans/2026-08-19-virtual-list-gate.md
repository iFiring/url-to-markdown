# 虚拟列表中断门 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SKILL.md 步骤 1（登录）与步骤 2（清洗转换）之间新增一道 Node-only 检测门：命中虚拟列表即中断、告知用户，避免静默产出残缺 Markdown。

**Architecture:** 新建共享页面脚本 `script/lib/page-detect.js`（`async function __u2mDetectVirtualList(cfg)`，整段在浏览器内一次 evaluate 跑完）作为检测逻辑的单一事实源；新建 Node-only CLI `script/detect_page.mjs`（与 `login_url.mjs` 同形态）开页、注入 pageInit、调用检测、按结果 emit；`clear_trans_html.{mjs,py}` 完全不变。检测信号：顶部取正文签名 → 滚到底 → 在底部（回顶之前）检查签名是否仍在 innerText，消失即虚拟列表。

**Tech Stack:** Node ≥20、Playwright 1.62（`chromium`）、`node --test`。无新依赖。

**Spec:** `docs/superpowers/specs/2026-08-19-virtual-list-gate-design.md`

## Global Constraints

- 每个 CLI 向 stdout 输出**恰好一行 JSON**（失败路径亦然），日志走 stderr，退出码 0/1/2（usage_error=2）。`virtual_list` 与 `scrollable` 均为 exit 0 的正常路径。
- **emit 延迟退出陷阱**：`emit()` 先写行、再在写回调里 `process.exit`，本身同步返回。`usage()`/`emit()` 之后的代码可能输出第二行或零行崩溃——用 `parseArgs` 返回 null + 提前 return 防护，不在 emit 之后继续执行。
- **共享页面脚本是分类/检测的唯一事实源**：`script/lib/page-*.js` 是普通非模块文件，双运行时当**文本**读入注入。检测逻辑只许存在于 `page-detect.js`，严禁分叉进 `.py` 或 `.mjs`。
- **Playwright 1.62 evaluate 语义**：无元素实参的共享脚本走完整表达式形式 `page.evaluate(`(${src})()`)`（src 解析得到函数值后立即调用）。
- 测试以子进程方式启动真实 CLI、对接随机端口的夹具服务器；集成测试需要已安装 chromium；`U2M_WORKING_ROOT` 隔离工作目录。
- 转换运行 viewport 1280×3000；浏览器一律在最终 emit **之前**关闭（emit 会退出进程，顺序错会留孤儿 chromium）。
- `U2M_PROXY` 控制代理（未设置继承系统代理 / `direct` 绕过 / URL 显式钉住），由 `openPage` 内部 `proxyLaunchOptions()` 统一处理。

## File Structure

- **Create** `script/lib/page-detect.js` — 共享检测脚本，含 `async function __u2mDetectVirtualList(cfg)`。页面内运行：取签名→滚到底→在底部检查→返回 `{isVirtualList, signature}`。单一事实源，双运行时文本注入。
- **Create** `script/detect_page.mjs` — Node-only CLI。`parseArgs` + `openPage`（注入 pageInit + 登录态）+ evaluate 检测 + 分支 emit。与 `login_url.mjs` 同形态。
- **Create** `test/fixtures/virtual-list.html` — tall spacer + 固定大小渲染窗口、滚动回收顶项的虚拟列表夹具。
- **Create** `test/integration/detect-page.test.mjs` — 端到端：virtual-list→virtual_list、long-column/lazy-load/static-article→scrollable、无参→usage_error；且 virtual_list 不写 working 目录。
- **Modify** `SKILL.md` — 插入"步骤 1.5 · 检测页面特性"（决策表），步骤 1 表"进入步骤 2"改为"进入步骤 1.5"，常见错误表补一行。
- **Modify** `CLAUDE.md` — 共享脚本清单加 `page-detect.js`；管线/CLI 说明加步骤 1.5 门与 `detect_page.mjs`。

---

### Task 1: CLI 骨架 + 夹具 + 失败集成测试

**Files:**
- Create: `script/detect_page.mjs`
- Create: `test/fixtures/virtual-list.html`
- Create: `test/integration/detect-page.test.mjs`

**Interfaces:**
- Consumes: `./lib/contract.mjs` 的 `emit/emitError/usage/log`；`./lib/env.mjs` 的 `storageStatePath`；`./lib/browser.mjs` 的 `openPage`；`./lib/placeholder.mjs` 的 `readSharedScript`。
- Produces: `detect_page.mjs` 的 CLI 表面——`<url> [--timeout ms]`，stdout 一行 JSON：`{status:'scrollable'|'virtual_list'|'error'|'usage_error', page_type?, reason?}`，退出码 0/1/2。本任务骨架恒 emit `scrollable`（检测逻辑 Task 2 注入）。

- [ ] **Step 1: 写虚拟列表夹具**

Create `test/fixtures/virtual-list.html`（tall spacer 固定页高 + 固定大小渲染窗口，scroll 时回收顶项重渲染可见窗口）：

```html
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>虚拟列表页</title></head>
<body>
<div id="list"></div>
<div id="spacer" style="height:0"></div>
<script>
  // 模拟 react-window/react-virtualized：DOM 只保留可见窗口，滚出视口的项被回收
  const TOTAL = 200, ITEM_H = 60, WINDOW = 12;
  const list = document.getElementById('list');
  document.getElementById('spacer').style.height = (TOTAL * ITEM_H) + 'px';
  function renderItem(i) {
    const d = document.createElement('div');
    d.style.height = ITEM_H + 'px';
    // 索引零填充、每项唯一内容，确保顶部签名不会出现在底部窗口的 innerText 中
    d.textContent = 'VLIST 第' + String(i).padStart(4, '0') + ' 项 唯一内容块 ' + (i * 1009 % 9973);
    return d;
  }
  function render() {
    const start = Math.max(0, Math.floor(window.scrollY / ITEM_H) - 2);
    list.textContent = '';
    for (let k = 0; k < WINDOW; k++) {
      const idx = start + k;
      if (idx >= TOTAL) break;
      list.appendChild(renderItem(idx));
    }
  }
  window.addEventListener('scroll', render);
  render();
</script>
</body>
</html>
```

- [ ] **Step 2: 写 detect_page.mjs 骨架**

Create `script/detect_page.mjs`（恒 emit `scrollable`，检测逻辑 Task 2 注入；parseArgs 镜像 `login_url.mjs`，提前 return 防 emit 延迟退出陷阱）：

```js
#!/usr/bin/env node
// detect_page.mjs <url> [--timeout 120000] —— 检测虚拟列表；scrollable / virtual_list / error。
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath } from './lib/env.mjs';
import { openPage } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      // emit 延迟 process.exit：返回 null 让 main 立即停，防止继续执行打出第二行 JSON
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return; // usage_error 已 emit，契约要求后续不再执行
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: detect_page.mjs <url> [--timeout ms]');

  const pageInit = await readSharedScript('page-init.js');
  let s;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    // Task 2 将在此注入 page-detect.js 检测；本骨架恒判 scrollable
    await s.close().catch(() => {});
    emit({ status: 'scrollable', page_type: 'scrollable' }, 0);
  } catch (e) {
    await s?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 3: 写集成测试**

Create `test/integration/detect-page.test.mjs`（镜像 `clear-node.test.mjs` 的 runScript + 夹具服务器 + `U2M_WORKING_ROOT` 模式；复用既有 `long-column.html`/`lazy-load.html`/`static-article.html` 作非虚拟控制）：

```js
// test/integration/detect-page.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx; let root;
before(async () => {
  fx = await startFixtureServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-detect-'));
});
after(async () => { await fx.close(); });

const run = (page) => runScript(process.execPath, [path.resolve('script/detect_page.mjs'), `${fx.url}/${page}`],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 60000 });

test('virtual-list: 命中即 virtual_list、退出 0、不写 working 目录', async () => {
  const r = await run('virtual-list.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'virtual_list');
  assert.equal(json.page_type, 'virtual_list');
  // 检测门不产文件：working/<url-dir> 不应被创建
  const dir = path.join(root, urlToDirName(`${fx.url}/virtual-list.html`));
  assert.ok(!fs.existsSync(dir), `不应创建 working 目录: ${dir}`);
});

test('long-column: 长静态页判 scrollable', async () => {
  const r = await run('long-column.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('lazy-load: 懒加载页判 scrollable（顶部内容仍在 DOM）', async () => {
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('static-article: 短静态页判 scrollable', async () => {
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'scrollable');
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/detect_page.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 4: 运行测试，确认 virtual-list 失败、其余通过**

Run: `node --test test/integration/detect-page.test.mjs`
Expected: 4 PASS（long-column / lazy-load / static-article / 参数错误），1 FAIL（virtual-list：骨架 emit `scrollable`，断言期望 `virtual_list`）。

- [ ] **Step 5: 提交**

```bash
git add script/detect_page.mjs test/fixtures/virtual-list.html test/integration/detect-page.test.mjs
git commit -m "feat(detect_page): 虚拟列表检测门 CLI 骨架 + 夹具 + 集成测试（TDD 红）"
```

---

### Task 2: 实现 page-detect.js 检测逻辑并接线

**Files:**
- Create: `script/lib/page-detect.js`
- Modify: `script/detect_page.mjs`（在 openPage 之后注入检测 + 超时竞速 + 分支 emit）

**Interfaces:**
- Consumes: Task 1 的 `detect_page.mjs` 骨架与夹具/测试。
- Produces: `__u2mDetectVirtualList(cfg)` → `Promise<{isVirtualList: boolean, signature: string}>`。调用约定 `page.evaluate(`(${src})()`)`（无元素实参，cfg 可选走默认）。`detect_page.mjs` 据此 emit `virtual_list`/`scrollable`。

- [ ] **Step 1: 写 page-detect.js**

Create `script/lib/page-detect.js`（与 `page-classify.js`/`page-init.js` 同模式：普通非模块文件，一个具名 function）：

```js
async function __u2mDetectVirtualList(cfg) {
  cfg = cfg || {};
  const SIG_CHARS = cfg.signatureChars || 400;   // 顶部正文签名长度
  const ITERS = cfg.scrollIters || 60;           // 滚到底最大轮次（与 progressiveScroll 一致）
  const WAIT = cfg.scrollWait || 150;            // 每轮等待 ms

  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const bodyText = () => normalize(document.body.innerText || '');

  // 1) 顶部取签名：当前 innerText 归一化后前 SIG_CHARS 字符
  const sig = bodyText().slice(0, SIG_CHARS);
  if (!sig) return { isVirtualList: false, signature: '' };

  // 2) 滚到底加载全程（与 progressiveScroll 同款循环，至 scrollHeight 稳定）
  let last = -1;
  for (let i = 0; i < ITERS; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, WAIT));
    const h = document.documentElement.scrollHeight;
    if (h === last) break;
    last = h;
  }

  // 3) 关键时序：在底部、回顶之前检查。虚拟列表回顶会重新渲染顶部窗口，回顶后检查会失效。
  //    顶部签名仍在 → 普通长页（顶部只是滚出视口、节点仍在 DOM）；消失 → 节点被回收 → 虚拟列表。
  const now = bodyText();
  return { isVirtualList: !now.includes(sig), signature: sig };
}
```

- [ ] **Step 2: 接线 detect_page.mjs**

Modify `script/detect_page.mjs`：在 `openPage(...)` 之后、`s.close()` 之前，注入检测 + 超时竞速 + 分支 emit。把骨架的 `// Task 2 将在此注入...` 与恒 emit `scrollable` 两行替换为：

```js
    const pageDetect = await readSharedScript('page-detect.js');
    const timeoutMs = Number(args.timeout ?? 120000);
    let timer;
    const detect = await Promise.race([
      s.page.evaluate(`(${pageDetect})()`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('detect timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    const result = detect.isVirtualList
      ? { status: 'virtual_list', page_type: 'virtual_list', reason: '页面为虚拟列表，仅渲染可见窗口，无法全文转化为 Markdown' }
      : { status: 'scrollable', page_type: 'scrollable' };
    await s.close().catch(() => {}); // 先关浏览器再 emit（emit 内 process.exit）
    emit(result, 0);
```

（`catch (e)` 块保持 Task 1 原样：`await s?.close().catch(() => {}); emitError(e.message, 1);`。）

- [ ] **Step 3: 运行测试，确认全绿**

Run: `node --test test/integration/detect-page.test.mjs`
Expected: 5 PASS（virtual-list 现命中 `virtual_list`；三个控制页 `scrollable`；usage_error 退出 2）。

- [ ] **Step 4: 回归现有转换测试，确认未受影响**

Run: `node --test test/integration/clear-node.test.mjs`
Expected: 全 PASS（`clear_trans_html` 未改，行为不变）。

- [ ] **Step 5: 全量 Node 测试**

Run: `pnpm test`
Expected: 全 PASS。

- [ ] **Step 6: 提交**

```bash
git add script/lib/page-detect.js script/detect_page.mjs
git commit -m "feat(detect_page): page-detect.js 回收签名检测 + 接线 virtual_list/scrollable 分支（TDD 绿）"
```

---

### Task 3: 文档——SKILL.md 步骤 1.5 + CLAUDE.md

**Files:**
- Modify: `SKILL.md`（插入步骤 1.5；步骤 1 表指向 1.5；常见错误表补一行）
- Modify: `CLAUDE.md`（共享脚本清单 + 管线/CLI 说明）

**Interfaces:**
- Consumes: Task 1/2 的 `detect_page.mjs` 契约（`scrollable`/`virtual_list`/`error`，退出 0/0/1）。
- Produces: agent 据以在步骤 1 与步骤 2 之间决策的 SKILL.md 决策表。

- [ ] **Step 1: SKILL.md 插入步骤 1.5**

在 `SKILL.md` 的"### 步骤 1 · 打开 URL，判断/完成登录"一节之后、"### 步骤 2 · 双工作流清洗转换（可并行）"之前，插入：

```markdown
### 步骤 1.5 · 检测页面特性

```bash
node <skill-root>/script/detect_page.mjs <url> [--timeout 120000]
```

检测页面是否为虚拟列表（仅渲染可见窗口、滚动回收顶项，无法全文转化）。复用步骤 1 写好的登录态。

| stdout status | 动作 |
|---|---|
| `scrollable` | 进入步骤 2 |
| `virtual_list` | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error` | 把 `reason` 反馈给用户并终止 |
```

- [ ] **Step 2: SKILL.md 步骤 1 决策表指向 1.5**

把步骤 1 决策表中 `logged_in` / `login_done` 两行的动作"进入步骤 2"改为"进入步骤 1.5"：

```markdown
| `logged_in` | 进入步骤 1.5 |
| `login_done` | 进入步骤 1.5 |
```

- [ ] **Step 3: SKILL.md 常见错误表补一行**

在"## 常见错误处理"表末尾追加：

```markdown
| `detect_page` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
```

- [ ] **Step 4: CLAUDE.md 共享脚本清单加 page-detect.js**

在 `CLAUDE.md` 的"**共享页面脚本是分类的唯一事实源。**"段，把 `page-*.js` 清单补上 `page-detect.js`（在 `page-classify.js` 之后、`page-clean.js` 之前或末尾均可，保持现有列举风格）：

```markdown
`script/lib/page-*.js`（含 `page-init.js`、`page-classify.js`、`page-detect.js`、`page-merge.js`、`page-clean.js`、`page-inline.js`、`page-latex.js`）是普通非模块文件……
```

- [ ] **Step 5: CLAUDE.md 管线说明加步骤 1.5 门**

在 `CLAUDE.md` "登录流程"段之后（或"管线顺序"段之前）补一小段：

```markdown
**虚拟列表检测门**：步骤 1.5 的 `detect_page.mjs`（Node-only，与 `login_url.mjs` 同形态）复用登录态开页、注入 pageInit、调用共享 `page-detect.js` 的 `__u2mDetectVirtualList`：顶部取正文签名 → 滚到底 → 在底部（回顶之前）检查签名是否仍在 innerText，消失即虚拟列表。命中 emit `virtual_list`（exit 0 正常中断，非 error）并终止，**不写 working 目录、不产 sketch**；否则 emit `scrollable` 进步骤 2。`clear_trans_html` 不感知此门。
```

- [ ] **Step 6: 验证文档无断链**

Run: `grep -n "步骤 1.5\|detect_page\|page-detect" SKILL.md CLAUDE.md`
Expected: 各处引用一致、无遗留"进入步骤 2"指向旧流程（步骤 1 的 logged_in/login_done 应指向 1.5）。

- [ ] **Step 7: 提交**

```bash
git add SKILL.md CLAUDE.md
git commit -m "docs: SKILL.md 步骤 1.5 虚拟列表检测门 + CLAUDE.md 共享脚本/管线说明"
```

---

## Self-Review

**1. Spec coverage**（对照 spec 各节）：
- §2 检测信号（顶部签名→滚到底→底部检查→时序约束）→ Task 2 Step 1 的 `page-detect.js` 实现 + 注释。
- §3.1 共享脚本 `page-detect.js` / `__u2mDetectVirtualList` / `(${src})()` 调用 → Task 2 Step 1-2。
- §3.2 `detect_page.mjs` Node-only、openPage+pageInit+storageState、emit `virtual_list`/`scrollable`、浏览器先关再 emit、usage exit 2、异常 emitError → Task 1 Step 2 骨架 + Task 2 Step 2 接线。
- §3.3 `clear_trans_html` 不变 → Task 2 Step 4 回归验证。
- §3.4 SKILL.md 步骤 1.5 + 步骤 1 指向 + 常见错误行 → Task 3 Step 1-3。
- §5 契约（恰好一行 JSON、virtual_list=exit0 正常路径、emit 延迟退出陷阱防护）→ Global Constraints + Task 1/2。
- §6 错误处理（open 失败→emitError、超时、U2M_PROXY 继承）→ Task 2 Step 2 超时竞速 + `openPage` 已含 proxy/goto 重试。
- §7 测试（virtual-list / long-article-lazy / static-short / 契约 / 共享脚本纯函数）→ Task 1 Step 3 用 virtual-list + long-column + lazy-load + static-article + usage_error 覆盖；纯函数单测因 `page-*.js` 为非模块文本（同 `page-classify.js`，仅集成测试，repo 惯例）而以集成测试替代，已如实说明。
- §4 数据流（1.5 门不写 working 目录）→ Task 1 Step 3 的 `!fs.existsSync(dir)` 断言。
- §8 非目标（不调参、不处理无限 Feed/路由切换、不塞进 clear_trans_html）→ 不在任务范围内，符合。
- CLAUDE.md 更新（spec 未单列，但属文档完整性）→ Task 3 Step 4-5。

**2. Placeholder scan**：无 TBD/TODO/"适当处理"；每步含可执行代码或具体命令。

**3. Type consistency**：`__u2mDetectVirtualList` 返回 `{isVirtualList, signature}` 在 Task 2 Step 1 定义、Step 2 消费 `detect.isVirtualList` 一致；`detect_page.mjs` 的 `parseArgs`/`emit`/`openPage` 签名与 `login_url.mjs` 一致；测试中 `urlToDirName`/`runScript`/`startFixtureServer` 与 `clear-node.test.mjs` 一致；SKILL.md `status` 值 `scrollable`/`virtual_list`/`error` 与 CLI emit 一致。

无问题，计划可执行。
