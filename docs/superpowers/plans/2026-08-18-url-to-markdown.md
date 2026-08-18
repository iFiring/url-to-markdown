# url-to-markdown 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Claude Code Skill：给定 URL，处理登录墙，双工作流（Node/Python）将主体内容转为干净 Markdown，特殊元素按四类分派（svg_convert / passthrough_svg / screenshot / latex，外加 mermaid 源码直出），LLM 语义去噪，人工双稿择优。

**Architecture:** 共享库 + 薄入口（spec 方案 A）。可单测逻辑集中 `script/lib/`（Node）与 `script/pylib/`（Python）；页面内 JS（分类/清理/合并/内联样式/LaTeX 提取）放 `script/lib/page-*.js`，**两语言共享同一份源文件**（Node readFile + addInitScript/evaluate，Python 同样读文件注入），保证双工作流分类规则字节级一致。所有脚本遵守统一输出契约：stdout 单行 JSON、stderr 日志、退出码 0/1/2。

**Tech Stack:** Node ≥20（ESM、`node --test`、playwright、ws、@mozilla/readability、turndown、@joplin/turndown-plugin-gfm、markdown-it）；Python ≥3.11（uv、pytest、playwright、readability-lxml、markdownify）。

**Spec:** `docs/design/url-to-markdown-design.md`（权威版本；快照 `docs/superpowers/specs/2026-08-18-url-to-markdown-design.md` 同步）

**执行说明（对 spec 的两点落定，均为 spec 原则的直接应用）:**
1. **LaTeX 文本直出**：spec §1 原则"能拿文本形态就拿文本形态"。KaTeX `<annotation encoding="application/x-tex">` / MathJax `<script type="math/tex">` 含原始公式，脚本发现即直接替换为 `$$...$$`（status=done，不经 LLM）；取不到才走 draft → LLM 反读（status=pending）。
2. **同源 iframe 合并**：spec"主文档文本极少→进入 iframe 处理其 DOM"的等价实现——主文档文本 <500 字时，把同源 iframe 的 body 子节点 adopt 进主文档再走统一管线，比"切换处理根"更利于 Readability 打分；嵌套同源 iframe 在分类阶段递归合并（内容型判定：iframe body 文本 ≥200 字）。

---

## Global Constraints

- Node ≥ 20（ESM，`"type":"module"`）；Python ≥ 3.11（uv 管理 `.venv`，`uv sync`）
- 包管理器优先级 **pnpm > yarn > npm**，不自行安装包管理器；`package.json` 预置 `pnpm.onlyBuiltDependencies: ["playwright"]`
- **统一脚本契约**（所有入口脚本）：stdout 有且仅有一行 JSON（失败路径也先输出再退出）；stderr 人类可读日志；退出码 `0` 成功 / `1` 失败或超时 / `2` 参数错误
- **storageState**：单一全局 `working/cookies/storage_state.json`；仅 `login_url.mjs` 写入，其余只读；cookie 按 `(name, domain, path)` 去重、新覆盖旧；localStorage 按 `origin + name` 去重覆盖；加载时剔除 `expires > 0 且 expires < now` 的过期 cookie
- **媒体拦截**：所有 Playwright 上下文 route-block `resourceType === 'media'` 的请求
- **无 CDN**：viewer 页面的 JS/CSS 全部内联；Markdown 渲染用本地 markdown-it
- **URL→目录名**：完整 URL 中所有非 `[A-Za-z0-9.-]` 字符替换为 `_`；超过 120 字符则截断到 120 并追加 `sha256(URL)` 前 8 个 hex 字符；**Node 与 Python 实现必须对同一 URL 产出完全相同结果**
- **working 根可覆盖**：环境变量 `U2M_WORKING_ROOT` 覆盖 working 根目录（测试隔离用），默认 `<项目根>/working`
- **`.temp/` 原型仅参考**（已 gitignore）：detector 移植 `.temp/is_login_page.py`，Screencast 架构移植 `.temp/login.mjs`（去 express，用 node:http），两阶段超时移植 `.temp/wait-click.mjs`
- 全程 TDD：先写测试看失败，再实现；conventional commits（`feat:`/`test:`/`chore:`/`docs:`）
- 验证命令：Node 单测 `pnpm test`，Node 集成 `pnpm test:integration`；Python 单测 `uv run pytest test/unit`，Python 集成 `uv run pytest test/integration`（无 uv 时 `.venv/bin/python -m pytest ...`）

---

## File Structure

```text
script/
  init.sh                    # 环境自检与修复（Task 8）
  login_url.mjs              # 登录态检测 + Screencast 登录（薄入口，Task 9）
  clear_trans_html.mjs       # Node 工作流（薄入口，Task 10）
  clear_trans_html.py        # Python 工作流（薄入口，Task 11）
  render_markdown.mjs        # 双 Tab 择优（薄入口，Task 12）
  lib/
    contract.mjs             # 输出契约：emit/log/usageError（Task 2）
    env.mjs                  # URL→目录名、路径解析（Task 3）
    browser.mjs              # openPage/媒体拦截/storageState 纯函数（Task 4-5）
    detector.mjs             # 登录态六策略计分检测（Task 6）
    placeholder.mjs          # 特殊元素分派编排、manifest、图片下载（Task 7）
    screencast.mjs           # CDP Screencast viewer 服务（Task 9）
    page-init.js             # [共享] IO 劫持 + Mermaid 源码钩子（addInitScript 注入）
    page-merge.js            # [共享] 同源 iframe 内容合并
    page-clean.js            # [共享] video/audio/按钮/行号清理
    page-classify.js         # [共享] 特殊元素判定与类型标记
    page-inline.js           # [共享] computedStyle 内联序列化
    page-latex.js            # [共享] LaTeX 原文提取（annotation/math-tex）
  pylib/
    __init__.py
    env.py                   # 镜像 lib/env.mjs（Task 3）
    browser.py               # 镜像 lib/browser.mjs（Task 5）
    placeholder.py           # 镜像 lib/placeholder.mjs，复用 page-*.js（Task 11）
test/
  conftest.py                # pytest 夹具：fixture_server / tmp_working / sys.path
  helpers/
    fixture-server.mjs       # 夹具 HTTP 服务器（随机端口）
    run-script.mjs           # 子进程跑脚本、收集 stdout/stderr/exit
    assets.mjs               # 1x1 PNG 常量与写入
  fixtures/                  # 夹具 HTML（随任务创建）
  unit/                      # node --test + pytest 纯单测
  integration/               # 起夹具服务→真脚本/真浏览器→断言
  smoke/SMOKE.md             # 真实 URL 手动冒烟清单（Task 15）
working/
  cookies/storage_state.json # 运行时生成；working/ 以 .gitkeep 入库
SKILL.md                     # Task 13
```

---

### Task 1: 项目骨架与依赖

**Files:**
- Create: `package.json`、`pyproject.toml`、`script/pylib/__init__.py`、`test/helpers/fixture-server.mjs`、`test/helpers/run-script.mjs`、`test/helpers/assets.mjs`、`test/conftest.py`、`working/.gitkeep`
- Modify: `.gitignore`（追加 `working/*` 与 `!working/.gitkeep`）
- Test: `test/unit/skeleton.test.mjs`、`test/unit/test_skeleton.py`（各一个冒烟断言）

**Interfaces:**
- Produces: `startFixtureServer(dirname?)` → `{server, url, close()}`；`runScript(cmd, args, {env, timeoutMs})` → `Promise<{code, stdout, stderr}>`；`PIXEL_PNG`（1x1 PNG Buffer）；pytest 夹具 `fixture_server`（→ url str）、`tmp_working`（→ Path，已设 `U2M_WORKING_ROOT`）

- [ ] **Step 1: 写 package.json / pyproject.toml / 目录**

```jsonc
// package.json
{
  "name": "url-to-markdown",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test test/unit/",
    "test:integration": "node --test test/integration/",
    "test:all": "node --test test/unit/ test/integration/"
  },
  "dependencies": {
    "@joplin/turndown-plugin-gfm": "^1.0.2",
    "@mozilla/readability": "^0.6.0",
    "markdown-it": "^14.1.0",
    "playwright": "^1.49.0",
    "turndown": "^7.2.0",
    "ws": "^8.18.0"
  },
  "pnpm": { "onlyBuiltDependencies": ["playwright"] }
}
```

```toml
# pyproject.toml
[project]
name = "url-to-markdown"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "playwright>=1.49,<2",
    "readability-lxml>=0.8.1",
    "markdownify>=0.13.1",
]

[dependency-groups]
dev = ["pytest>=8"]

[tool.uv]
package = false  # 纯脚本项目，不构建安装自身；uv sync 只装依赖（测试/脚本自行 sys.path 引入 pylib）

[tool.pytest.ini_options]
testpaths = ["test/unit"]
```

```text
mkdir -p script/lib script/pylib test/fixtures test/helpers test/unit test/integration test/smoke working/cookies
touch script/pylib/__init__.py working/.gitkeep
```

`.gitignore` 追加：

```gitignore
# 运行时工作目录（保留骨架）
working/*
!working/.gitkeep
```

- [ ] **Step 2: 写测试 helpers 与 conftest**

```js
// test/helpers/fixture-server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript',
};

export async function startFixtureServer(dirname = 'test/fixtures') {
  const root = path.resolve(dirname);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(root, urlPath === '/' ? '/static-article.html' : urlPath);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
```

```js
// test/helpers/run-script.mjs
import { spawn } from 'node:child_process';

export function runScript(cmd, args, { env = {}, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
```

```js
// test/helpers/assets.mjs
import { writeFile } from 'node:fs/promises';

export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function writePixelPng(file) { await writeFile(file, PIXEL_PNG); }
```

```python
# test/conftest.py
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "script"))  # 使测试可 import pylib


class _FixtureHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(REPO / "test" / "fixtures"), **kw)

    def log_message(self, *a):  # 静音
        pass


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: 需要浏览器/夹具服务的集成测试")


@pytest.fixture()
def fixture_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture()
def tmp_working(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    return tmp_path
```

- [ ] **Step 3: 写骨架冒烟测试并验证失败→通过**

```js
// test/unit/skeleton.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

test('夹具服务器可启动并服务 404/200', async () => {
  const fx = await startFixtureServer();
  const res = await fetch(`${fx.url}/no-such-file.html`);
  assert.equal(res.status, 404);
  await fx.close();
});
```

```python
# test/unit/test_skeleton.py
def test_python_alive():
    assert True
```

Run: `node --test test/unit/skeleton.test.mjs` → PASS（helpers 即实现）；`uv run pytest test/unit`（或 `.venv/bin/python -m pytest test/unit`）→ PASS。

- [ ] **Step 4: 安装依赖并锁定**

```bash
pnpm install            # 有 pnpm；否则 yarn install / npm install
uv sync                 # 无 uv: python3 -m venv .venv && .venv/bin/pip install playwright readability-lxml markdownify pytest
npx playwright install chromium
```

Run: `pnpm test && uv run pytest test/unit` → 全绿。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 项目骨架、依赖清单与测试基建（夹具服务器/脚本运行器）"
```

---

### Task 2: lib/contract.mjs —— 统一输出契约

**Files:**
- Create: `script/lib/contract.mjs`
- Test: `test/unit/contract.test.mjs`

**Interfaces:**
- Produces: `log(...parts)`（stderr）；`emit(result, code=0)`（stdout 单行 JSON 后以 code 退出，写完再退避免截断）；`emitError(reason, code=1)`；`usage(msg)`（`{status:"usage_error"}` + 退出码 2）

- [ ] **Step 1: 写失败测试**（emit 会调 process.exit，用子进程验证契约）

```js
// test/unit/contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const mod = pathToFileURL(path.resolve('script/lib/contract.mjs')).href;
const node = (expr) => runScript(process.execPath, ['-e', `import('${mod}').then(m => { ${expr} })`]);

test('emit: stdout 恰一行 JSON 并按码退出', async () => {
  const r = await node("m.emit({status:'ok'}, 0)");
  assert.equal(r.code, 0);
  assert.deepEqual(r.stdout.split('\n').filter(Boolean), ['{"status":"ok"}']);
});

test('emitError: 失败也输出 JSON，退出码 1', async () => {
  const r = await node("m.emitError('页面加载失败')");
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'error');
  assert.equal(JSON.parse(r.stdout).reason, '页面加载失败');
});

test('usage: 参数错误输出 usage_error，退出码 2', async () => {
  const r = await node("m.usage('缺少 <url>')");
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

test('log: 走 stderr 不污染 stdout', async () => {
  const r = await node("m.log('进度信息'); m.emit({status:'ok'}, 0)");
  assert.equal(r.stdout, '{"status":"ok"}\n');
  assert.ok(r.stderr.includes('进度信息'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/contract.test.mjs`
Expected: FAIL（`Cannot find module .../contract.mjs`）

- [ ] **Step 3: 实现**

```js
// script/lib/contract.mjs
/** 统一脚本契约：stdout 有且仅有一行 JSON；日志走 stderr；退出码 0/1/2。 */

export function log(...parts) {
  console.error(...parts);
}

/** stdout 输出单行 JSON 后退出。写回调里 exit，保证管道场景不截断。 */
export function emit(result, code = 0) {
  const line = JSON.stringify(result) + '\n';
  process.stdout.write(line, () => process.exit(code));
  // 兜底：极端情况下 1s 内强制退出
  setTimeout(() => process.exit(code), 1000).unref();
}

export function emitError(reason, code = 1) {
  emit({ status: 'error', reason }, code);
}

/** 参数错误：也守契约（先输出 JSON 再退出 2）。 */
export function usage(msg) {
  emit({ status: 'usage_error', reason: msg }, 2);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/unit/contract.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add script/lib/contract.mjs test/unit/contract.test.mjs
git commit -m "feat: 统一输出契约 contract.mjs（单行 JSON/stderr 日志/退出码）"
```

---

### Task 3: lib/env.mjs + pylib/env.py —— URL→目录名与路径（双语言一致）

**Files:**
- Create: `script/lib/env.mjs`、`script/pylib/env.py`
- Test: `test/unit/env.test.mjs`、`test/unit/test_env.py`（同一组向量）

**Interfaces:**
- Produces（Node）: `urlToDirName(url)`、`projectRoot()`、`workingRoot()`、`storageStatePath()`、`workflowDir(url, name)`、`ensureWorkflowDirs(url, name)` → `{wf, assets, draft, complex, images, manifest}`
- Produces（Python）: `url_to_dir_name(url)`、`project_root()`、`working_root()`、`storage_state_path()`、`workflow_dir(url, name)`、`ensure_workflow_dirs(url, name)` → 同键 dict

- [ ] **Step 1: 写失败测试（Node）**

```js
// test/unit/env.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlToDirName, workingRoot, storageStatePath, ensureWorkflowDirs } from '../../script/lib/env.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('urlToDirName: 非法字符转下划线，保留 [A-Za-z0-9.-]', () => {
  assert.equal(urlToDirName('https://example.com/a?b=1'), 'https___example_com_a_b_1');
  assert.equal(urlToDirName('http://127.0.0.1:8000/x.html#frag'), 'http___127_0_0_1_8000_x_html_frag');
  assert.equal(urlToDirName('https://example.com/中文'), 'https___example_com___');
});

test('urlToDirName: 超 120 字符截断 + sha256 前 8 位后缀', () => {
  const url = 'https://example.com/' + 'a'.repeat(101);
  const name = urlToDirName(url);
  assert.equal(name.length, 128);
  assert.ok(name.startsWith('https___example_com_' + 'a'.repeat(100)));
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
  assert.equal(name.slice(120), hash);
});

test('workingRoot 受 U2M_WORKING_ROOT 覆盖；storageStatePath 固定子路径', () => {
  process.env.U2M_WORKING_ROOT = '/tmp/u2m-test-root';
  assert.equal(workingRoot(), '/tmp/u2m-test-root');
  assert.equal(storageStatePath(), path.join('/tmp/u2m-test-root', 'cookies', 'storage_state.json'));
  delete process.env.U2M_WORKING_ROOT;
});

test('ensureWorkflowDirs 创建五级目录并返回 manifest 路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  process.env.U2M_WORKING_ROOT = root;
  const dirs = ensureWorkflowDirs('https://example.com/a', 'node_workflow');
  for (const k of ['wf', 'assets', 'draft', 'complex', 'images']) {
    assert.ok(fs.existsSync(dirs[k]), `缺目录 ${k}`);
  }
  assert.equal(dirs.manifest, path.join(dirs.assets, 'manifest.json'));
  delete process.env.U2M_WORKING_ROOT;
});
```

- [ ] **Step 2: 写失败测试（Python，同一组向量）**

```python
# test/unit/test_env.py
import hashlib
from pathlib import Path

from pylib import env


def test_url_to_dir_name_vectors():
    assert env.url_to_dir_name("https://example.com/a?b=1") == "https___example_com_a_b_1"
    assert env.url_to_dir_name("http://127.0.0.1:8000/x.html#frag") == "http___127_0_0_1_8000_x_html_frag"
    assert env.url_to_dir_name("https://example.com/中文") == "https___example_com___"


def test_url_to_dir_name_long():
    url = "https://example.com/" + "a" * 101
    name = env.url_to_dir_name(url)
    assert len(name) == 128
    assert name.startswith("https___example_com_" + "a" * 100)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    assert name[120:] == digest


def test_working_root_override(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    assert env.working_root() == tmp_path
    assert env.storage_state_path() == tmp_path / "cookies" / "storage_state.json"


def test_ensure_workflow_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("U2M_WORKING_ROOT", str(tmp_path))
    dirs = env.ensure_workflow_dirs("https://example.com/a", "node_workflow")
    for k in ("wf", "assets", "draft", "complex", "images"):
        assert dirs[k].is_dir(), f"缺目录 {k}"
    assert dirs["manifest"] == dirs["assets"] / "manifest.json"
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/unit/env.test.mjs` → FAIL；`uv run pytest test/unit/test_env.py` → FAIL（ModuleNotFoundError）

- [ ] **Step 4: 实现（两语言）**

```js
// script/lib/env.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export function projectRoot() { return path.resolve(thisDir, '..', '..'); }

export function workingRoot() {
  return process.env.U2M_WORKING_ROOT
    ? path.resolve(process.env.U2M_WORKING_ROOT)
    : path.join(projectRoot(), 'working');
}

/** URL→目录名：非 [A-Za-z0-9.-] → _；>120 截断 + sha256(URL) 前 8 hex。Node/Python 必须一致。 */
export function urlToDirName(url) {
  const sanitized = url.replace(/[^A-Za-z0-9.-]/g, '_');
  if (sanitized.length <= 120) return sanitized;
  const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 8);
  return sanitized.slice(0, 120) + hash;
}

export function storageStatePath() { return path.join(workingRoot(), 'cookies', 'storage_state.json'); }

export function workflowDir(url, name) { return path.join(workingRoot(), urlToDirName(url), name); }

export function ensureWorkflowDirs(url, name) {
  const wf = workflowDir(url, name);
  const assets = path.join(wf, 'assets');
  const draft = path.join(assets, 'draft');
  const complex = path.join(assets, 'complex');
  const images = path.join(assets, 'images');
  for (const d of [wf, assets, draft, complex, images]) fs.mkdirSync(d, { recursive: true });
  return { wf, assets, draft, complex, images, manifest: path.join(assets, 'manifest.json') };
}
```

```python
# script/pylib/env.py
"""与 lib/env.mjs 保持字节级一致（同一 URL 必须产出同一目录名）。"""
import hashlib
import os
import re
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def working_root() -> Path:
    env = os.environ.get("U2M_WORKING_ROOT")
    return Path(env).resolve() if env else project_root() / "working"


def url_to_dir_name(url: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9.-]", "_", url)
    if len(sanitized) <= 120:
        return sanitized
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    return sanitized[:120] + digest


def storage_state_path() -> Path:
    return working_root() / "cookies" / "storage_state.json"


def workflow_dir(url: str, name: str) -> Path:
    return working_root() / url_to_dir_name(url) / name


def ensure_workflow_dirs(url: str, name: str) -> dict:
    wf = workflow_dir(url, name)
    assets = wf / "assets"
    dirs = {
        "wf": wf, "assets": assets, "draft": assets / "draft",
        "complex": assets / "complex", "images": assets / "images",
        "manifest": assets / "manifest.json",
    }
    for d in ("wf", "assets", "draft", "complex", "images"):
        dirs[d].mkdir(parents=True, exist_ok=True)
    return dirs
```

- [ ] **Step 5: 运行确认通过 + Commit**

Run: `pnpm test && uv run pytest test/unit` → PASS

```bash
git add script/lib/env.mjs script/pylib/env.py test/unit/env.test.mjs test/unit/test_env.py
git commit -m "feat: URL→目录名与工作目录解析（Node/Python 双语言一致）"
```

---

### Task 4: lib/browser.mjs —— storageState 纯函数

**Files:**
- Create: `script/lib/browser.mjs`（本任务只实现纯函数 + 文件 IO；openPage 在 Task 5）
- Test: `test/unit/browser-state.test.mjs`

**Interfaces:**
- Produces: `pruneExpired(state, nowMs?)`、`mergeStorageState(base?, incoming?)`、`readStorageState(filePath)`、`writeStorageState(filePath, state)`

- [ ] **Step 1: 写失败测试**

```js
// test/unit/browser-state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneExpired, mergeStorageState, readStorageState, writeStorageState } from '../../script/lib/browser.mjs';

const cookie = (over) => ({ name: 'a', value: '1', domain: '.x.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax', ...over });

test('pruneExpired: 剔除已过期（expires>0 且 < now），保留会话与未来', () => {
  const now = 1_700_000_000_000;
  const state = { cookies: [cookie({ name: 'old', expires: 1 }), cookie({ name: 'sess', expires: -1 }), cookie({ name: 'future', expires: 9_999_999_999 })], origins: [] };
  const names = pruneExpired(state, now).cookies.map((c) => c.name);
  assert.deepEqual(names.sort(), ['future', 'sess']);
});

test('mergeStorageState: cookie 按 (name,domain,path) 去重、新覆盖旧', () => {
  const base = { cookies: [cookie({ value: '1' }), cookie({ name: 'b', domain: '.y.com' })], origins: [] };
  const inc = { cookies: [cookie({ value: '9' }), cookie({ name: 'c', domain: '.z.com' })], origins: [] };
  const merged = mergeStorageState(base, inc);
  const a = merged.cookies.find((c) => c.name === 'a');
  assert.equal(a.value, '9');
  assert.equal(merged.cookies.length, 3);
});

test('mergeStorageState: localStorage 按 origin+name 去重覆盖', () => {
  const base = { cookies: [], origins: [{ origin: 'https://a.com', localStorage: [{ name: 'k', value: '1' }] }] };
  const inc = { cookies: [], origins: [{ origin: 'https://a.com', localStorage: [{ name: 'k', value: '2' }, { name: 'm', value: '3' }] }] };
  const merged = mergeStorageState(base, inc);
  assert.deepEqual(merged.origins[0].localStorage, [{ name: 'k', value: '2' }, { name: 'm', value: '3' }]);
});

test('read/write 往返；缺失文件返回空态', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  const file = path.join(dir, 'storage_state.json');
  await writeStorageState(file, { cookies: [cookie()], origins: [] });
  const back = await readStorageState(file);
  assert.equal(back.cookies[0].name, 'a');
  const empty = await readStorageState(path.join(dir, 'nope.json'));
  assert.deepEqual(empty, { cookies: [], origins: [] });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/unit/browser-state.test.mjs` → FAIL

- [ ] **Step 3: 实现**

```js
// script/lib/browser.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export const EMPTY_STATE = { cookies: [], origins: [] };

/** 剔除已过期 cookie（expires>0 且早于 now）。会话 cookie（-1）保留。 */
export function pruneExpired(state, nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000);
  const cookies = (state.cookies || []).filter(
    (c) => !(typeof c.expires === 'number' && c.expires > 0 && c.expires < nowSec),
  );
  return { ...state, cookies };
}

/** cookie 按 (name,domain,path)、localStorage 按 origin+name 去重，incoming 覆盖 base。 */
export function mergeStorageState(base = EMPTY_STATE, incoming = EMPTY_STATE) {
  const cookieMap = new Map();
  for (const c of [...(base.cookies || []), ...(incoming.cookies || [])]) {
    cookieMap.set(`${c.name}|${c.domain}|${c.path}`, c);
  }
  const originMap = new Map(); // origin -> Map(name -> entry)
  for (const o of [...(base.origins || []), ...(incoming.origins || [])]) {
    if (!originMap.has(o.origin)) originMap.set(o.origin, new Map());
    const ls = originMap.get(o.origin);
    for (const entry of o.localStorage || []) ls.set(entry.name, entry);
  }
  return {
    cookies: [...cookieMap.values()],
    origins: [...originMap.entries()].map(([origin, ls]) => ({ origin, localStorage: [...ls.values()] })),
  };
}

export async function readStorageState(filePath) {
  try {
    return pruneExpired(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function writeStorageState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

// ===== 浏览器会话（Task 5 实现 openPage/gotoWithRetry） =====
export async function openPage() { throw new Error('Task 5 实现'); }
export async function gotoWithRetry() { throw new Error('Task 5 实现'); }
export const _chromium = chromium;
```

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `node --test test/unit/browser-state.test.mjs` → PASS

```bash
git add script/lib/browser.mjs test/unit/browser-state.test.mjs
git commit -m "feat: storageState 合并/过期清理/读写（cookie 与 localStorage 去重规则）"
```

---

### Task 5: openPage / open_page + pylib/browser.py 镜像

**Files:**
- Modify: `script/lib/browser.mjs`（实现 openPage/gotoWithRetry）
- Create: `script/pylib/browser.py`
- Create: `test/fixtures/static-article.html`
- Test: `test/integration/browser.test.mjs`、`test/integration/test_browser.py`

**Interfaces:**
- Consumes: Task 3 `storageStatePath()`；Task 4 纯函数
- Produces（Node）: `openPage(url, {headless=true, viewport={width:1280,height:3000}, initScripts=[], storageStatePath, log})` → `{browser, context, page, close()}`；`gotoWithRetry(page, url, log, opts?)`
- Produces（Python）: `open_page(url, **opts)` → `PageSession`（`.page` `.context` `.close()`）；`goto_with_retry(page, url, log)`；`prune_expired/merge_storage_state/read_storage_state/write_storage_state`（语义同 Task 4）

- [ ] **Step 1: 写夹具页**

```html
<!-- test/fixtures/static-article.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>示例文章</title></head>
<body>
<nav>导航噪声 NAV_NOISE</nav>
<main>
<h1>示例文章标题</h1>
<p>这是第一段正文内容，用于验证清理与转换管线。PARA_ONE。</p>
<p>这是第二段正文内容，包含一个图片与表格。PARA_TWO。</p>
<img src="/pixel.png" alt="示例图">
<table>
  <tr><th>名称</th><th>值</th></tr>
  <tr><td>alpha</td><td>1</td></tr>
  <tr><td>beta</td><td>2</td></tr>
</table>
<pre><code class="language-js">const x = 1;
console.log(x);</code></pre>
</main>
<footer>页脚噪声 FOOTER_NOISE</footer>
</body>
</html>
```

- [ ] **Step 2: 写失败测试（Node 集成）**

```js
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
```

- [ ] **Step 3: 写失败测试（Python 集成）**

```python
# test/integration/test_browser.py
import pytest
from pylib import browser

pytestmark = pytest.mark.integration


def test_open_page_loads_fixture(fixture_server):
    session = browser.open_page(f"{fixture_server}/static-article.html",
                                viewport={"width": 1280, "height": 800})
    try:
        session.page.locator("h1").wait_for(state="visible", timeout=5000)
        assert session.page.title() == "示例文章"
    finally:
        session.close()
```

- [ ] **Step 4: 运行确认失败**

Run: `node --test test/integration/browser.test.mjs` → FAIL（openPage 抛 Task 5）；`uv run pytest test/integration/test_browser.py` → FAIL（No module named pylib.browser）

- [ ] **Step 5: 实现 openPage（替换 browser.mjs 尾部占位）**

```js
// script/lib/browser.mjs —— 追加/替换（保留 Task 4 纯函数）
import fsSync from 'node:fs';

/** goto：networkidle 失败重试 1 次；两次失败回落 domcontentloaded + 5s 等待。 */
export async function gotoWithRetry(page, url, log = () => {}, opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000, ...opts });
      return;
    } catch (e) {
      lastErr = e;
      log(`goto 失败(${attempt}/2): ${e.message}`);
    }
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // 兜底：README「等待 5S 再开始」
}

/**
 * 打开页面：storageState 存在则注入；route-block media；逐个注入 initScripts（页面脚本级钩子）。
 * 返回 {browser, context, page, close()}。
 */
export async function openPage(url, {
  headless = true,
  viewport = { width: 1280, height: 3000 },
  initScripts = [],
  storageStatePath: ssPath,
  log = () => {},
} = {}) {
  const browser = await chromium.launch({ headless });
  try {
    const ctxOpts = { viewport };
    if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
    const context = await browser.newContext(ctxOpts);
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue());
    for (const script of initScripts) await context.addInitScript({ content: script });
    const page = await context.newPage();
    await gotoWithRetry(page, url, log);
    return {
      browser, context, page,
      close: async () => { try { await context.close(); } finally { await browser.close(); } },
    };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
```

（同时删除文件尾部的 `export async function openPage() { throw ... }` / `gotoWithRetry` / `_chromium` 占位。）

- [ ] **Step 6: 实现 pylib/browser.py**

```python
# script/pylib/browser.py
"""与 lib/browser.mjs 对应：storageState 纯函数 + open_page 会话。"""
import json
import shutil
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

EMPTY_STATE = {"cookies": [], "origins": []}


def prune_expired(state: dict, now_ms: int | None = None) -> dict:
    now_sec = int((now_ms if now_ms is not None else time.time() * 1000) // 1000)
    cookies = [c for c in state.get("cookies", [])
               if not (isinstance(c.get("expires"), (int, float)) and c["expires"] > 0 and c["expires"] < now_sec)]
    return {**state, "cookies": cookies}


def merge_storage_state(base: dict | None = None, incoming: dict | None = None) -> dict:
    base = base or EMPTY_STATE
    incoming = incoming or EMPTY_STATE
    cookie_map = {}
    for c in [*base.get("cookies", []), *incoming.get("cookies", [])]:
        cookie_map[(c["name"], c["domain"], c["path"])] = c
    origin_map: dict[str, dict] = {}
    for o in [*base.get("origins", []), *incoming.get("origins", [])]:
        ls = origin_map.setdefault(o["origin"], {})
        for entry in o.get("localStorage", []):
            ls[entry["name"]] = entry
    return {
        "cookies": list(cookie_map.values()),
        "origins": [{"origin": k, "localStorage": list(v.values())} for k, v in origin_map.items()],
    }


def read_storage_state(file_path: Path) -> dict:
    try:
        return prune_expired(json.loads(Path(file_path).read_text(encoding="utf-8")))
    except Exception:
        return {"cookies": [], "origins": []}


def write_storage_state(file_path: Path, state: dict) -> None:
    p = Path(file_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def goto_with_retry(page, url: str, log=print) -> None:
    last = None
    for attempt in (1, 2):
        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            log(f"goto 失败({attempt}/2): {e}")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)


class PageSession:
    def __init__(self, pw, browser, context, page):
        self.pw, self.browser, self.context, self.page = pw, browser, context, page

    def close(self):
        try:
            self.context.close()
        finally:
            self.browser.close()
            self.pw.stop()


def open_page(url, *, headless=True, viewport=None, init_scripts=(), storage_state_path=None, log=print) -> PageSession:
    viewport = viewport or {"width": 1280, "height": 3000}
    pw = sync_playwright().start()
    try:
        browser = pw.chromium.launch(headless=headless)
        ctx_kwargs = dict(viewport=viewport)
        if storage_state_path and Path(storage_state_path).exists():
            ctx_kwargs["storage_state"] = str(storage_state_path)
        context = browser.new_context(**ctx_kwargs)
        context.route("**/*", lambda route: route.abort() if route.request.resource_type == "media" else route.continue_())
        for script in init_scripts:
            context.add_init_script(script=script)
        page = context.new_page()
        goto_with_retry(page, url, log)
        return PageSession(pw, browser, context, page)
    except Exception:
        try:
            browser.close()
        finally:
            pw.stop()
        raise
```

- [ ] **Step 7: 运行确认通过 + Commit**

Run: `pnpm test:integration && uv run pytest test/integration/test_browser.py` → PASS

```bash
git add script/lib/browser.mjs script/pylib/browser.py test/integration test/fixtures
git commit -m "feat: openPage/open_page 浏览器会话（storageState 注入、媒体拦截、goto 重试）"
```

---

### Task 6: lib/detector.mjs —— 登录态六策略计分检测

**Files:**
- Create: `script/lib/detector.mjs`、`test/fixtures/login-wall.html`、`test/fixtures/logged-in.html`
- Test: `test/unit/detector-score.test.mjs`（纯函数）、`test/integration/detector.test.mjs`（夹具）

**Interfaces:**
- Consumes: Task 5 `openPage`
- Produces: `URL_PATTERNS`、`USERNAME_SELECTORS`、`TITLE_KEYWORDS`、`TEXT_KEYWORDS`、`AUTH_COOKIE_PATTERNS`、`collectSignals(page, context, originalUrl, {spaWaitMs})` → signals 对象、`scoreSignals(signals)` → `{hits, needsLogin}`、`needsLogin(page, context, originalUrl, {spaWaitMs})` → `{hits, needsLogin, signals}`

- [ ] **Step 1: 写夹具页**

```html
<!-- test/fixtures/login-wall.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>登录 - 示例站</title></head>
<body>
<form id="f">
  <input name="account" placeholder="用户名">
  <input type="password" name="pwd">
  <button type="submit">登录</button>
</form>
<script>
  const u = new URL(location.href);
  if (u.searchParams.get('auto') === '1') {
    setTimeout(() => { document.cookie = 'sessionid=abc; path=/'; location.href = '/logged-in.html'; }, 400);
  }
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    document.cookie = 'sessionid=abc; path=/';
    location.href = '/logged-in.html';
  });
</script>
</body>
</html>
```

```html
<!-- test/fixtures/logged-in.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>会员中心</title></head>
<body>
<main>
<h1>会员中心</h1>
<p>欢迎回来。这里是一篇足够长的会员正文，用于让检测器确认已登录状态。
正文需要超过五百个字符以避免被误判为内容稀少的登录页，这里通过重复叙述来补足篇幅。
会员中心提供资料修改、消息通知与订阅管理等功能，页面上没有任何输入框，也没有密码框，
标题与正文都不包含检测关键词，因此六项策略都不应命中，计分为零，判定为已登录。</p>
<p>第二段正文进一步补充篇幅。会员中心页面通常是登录成功后的跳转目标，
检测器在此页面上运行时应当返回已登录结论，脚本据此刷新合并 storageState 并以 logged_in 状态退出。
这段文字的存在使得页面文本量远超五百字阈值，从而稳定测试结果。</p>
</main>
</body>
</html>
```

- [ ] **Step 2: 写失败测试**

```js
// test/unit/detector-score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals } from '../../script/lib/detector.mjs';

test('计分：命中数 ≥2 判定需登录', () => {
  assert.equal(scoreSignals({}).needsLogin, false);
  assert.equal(scoreSignals({ password: true }).needsLogin, false);
  assert.equal(scoreSignals({ url: true, cookieMissing: true }).needsLogin, true);
  assert.equal(scoreSignals({ password: true, url: true }).hits, 2);
  assert.equal(scoreSignals({ cookieMissing: true, spa: true }).needsLogin, true);
});
```

```js
// test/integration/detector.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openPage } from '../../script/lib/browser.mjs';
import { needsLogin } from '../../script/lib/detector.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

test('login-wall: 密码框+URL/内容 命中 → 需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/login-wall.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/login-wall.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, true);
    assert.equal(r.signals.password, true);
  } finally { await s.close(); await fx.close(); }
});

test('logged-in: 预置 session cookie → 已登录', async () => {
  const fx = await startFixtureServer();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  const ss = path.join(root, 'storage_state.json');
  fs.writeFileSync(ss, JSON.stringify({ cookies: [
    { name: 'sessionid', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ], origins: [] }));
  const s = await openPage(`${fx.url}/logged-in.html`, { viewport: { width: 1280, height: 800 }, storageStatePath: ss });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/logged-in.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});

test('static-article: 公开内容页 → 无需登录', async () => {
  const fx = await startFixtureServer();
  const s = await openPage(`${fx.url}/static-article.html`, { viewport: { width: 1280, height: 800 } });
  try {
    const r = await needsLogin(s.page, s.context, `${fx.url}/static-article.html`, { spaWaitMs: 500 });
    assert.equal(r.needsLogin, false);
  } finally { await s.close(); await fx.close(); }
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/unit/detector-score.test.mjs test/integration/detector.test.mjs` → FAIL

- [ ] **Step 4: 实现（移植 .temp/is_login_page.py，改为计分制 + 全 frames 遍历）**

```js
// script/lib/detector.mjs
import { URL as Url } from 'node:url';

export const URL_PATTERNS = [
  '/login', '/signin', '/sign-in', '/sign_in', '/auth', '/sso', '/cas/login', '/oauth',
  '/account/login', '/user/login', '/passport/login',
  '[?&]redirect=', '[?&]return_url=', '[?&]returnurl=', '[?&]next=', '[?&]continue=',
];
export const USERNAME_SELECTORS = [
  'input[type="email"]', 'input[name*="user"]', 'input[name*="account"]', 'input[name*="email"]',
  'input[name*="login"]', 'input[id*="user"]', 'input[id*="account"]', 'input[id*="email"]',
  'input[placeholder*="用户名"]', 'input[placeholder*="账号"]', 'input[placeholder*="邮箱"]', 'input[placeholder*="手机号"]',
  'input[placeholder*="username"]', 'input[placeholder*="email"]', 'input[autocomplete="username"]', 'input[autocomplete="email"]',
];
export const TITLE_KEYWORDS = ['登录', '登陆', '登入', 'sign in', 'signin', 'log in', 'login'];
export const TEXT_KEYWORDS = [
  '忘记密码', '记住我', '自动登录', 'forgot password', 'remember me', 'keep me signed in',
  '没有账号', '注册账号', 'create account', 'sign up',
];
export const AUTH_COOKIE_PATTERNS = [
  'token', 'session', 'jwt', 'auth', 'sid', 'csrf', 'access_token', 'refresh_token', 'ssoid',
];

const norm = (u) => {
  try { const x = new Url(u); return `${x.origin}${x.pathname.replace(/\/$/, '')}`; } catch { return u; }
};

/** ≥2 项命中判定需登录（README/spec 裁决）。 */
export function scoreSignals(signals) {
  const keys = ['password', 'url', 'content', 'cookieMissing', 'redirected', 'spa'];
  const hits = keys.filter((k) => signals[k]).length;
  return { hits, needsLogin: hits >= 2 };
}

export async function collectSignals(page, context, originalUrl, { spaWaitMs = 5000, includeSpa = true } = {}) {
  const signals = { password: false, url: false, content: false, cookieMissing: false, redirected: false, spa: false };
  const currentUrl = page.url().toLowerCase();
  signals.url = URL_PATTERNS.some((p) => new RegExp(p).test(currentUrl));

  for (const f of page.frames()) { // 遍历全部 frames（含 iframe 内登录表单）
    if (await f.locator('input[type="password"]').count() > 0) { signals.password = true; break; }
  }

  try {
    const title = (await page.title()).toLowerCase();
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 3000).toLowerCase();
    // 标题关键词只匹配 <title>，文本关键词只匹配正文——避免"已登录状态"这类正文误命中 '登录'
    signals.content = TITLE_KEYWORDS.some((k) => title.includes(k)) || TEXT_KEYWORDS.some((k) => body.includes(k));
  } catch { /* 忽略 */ }

  if (context) {
    const cookies = await context.cookies();
    const names = cookies.map((c) => c.name.toLowerCase());
    signals.cookieMissing = !names.some((n) => AUTH_COOKIE_PATTERNS.some((p) => n.includes(p)));
  }

  signals.redirected = norm(page.url()) !== norm(originalUrl) && (signals.url || signals.password);

  if (includeSpa && !scoreSignals(signals).needsLogin) {
    try {
      await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: spaWaitMs });
      signals.spa = true;
    } catch { /* 未出现 */ }
  }
  return signals;
}

export async function needsLogin(page, context, originalUrl, opts = {}) {
  const signals = await collectSignals(page, context, originalUrl, opts);
  return { ...scoreSignals(signals), signals };
}
```

- [ ] **Step 5: 运行确认通过 + Commit**

Run: `node --test test/unit/detector-score.test.mjs test/integration/detector.test.mjs` → PASS

```bash
git add script/lib/detector.mjs test/unit/detector-score.test.mjs test/integration/detector.test.mjs test/fixtures/login-wall.html test/fixtures/logged-in.html
git commit -m "feat: 登录态六策略计分检测 detector.mjs（移植 is_login_page.py，≥2 命中）"
```

---

### Task 7: page-*.js 共享页面脚本 + lib/placeholder.mjs —— 特殊元素分派

**Files:**
- Create: `script/lib/page-init.js`、`page-merge.js`、`page-clean.js`、`page-classify.js`、`page-inline.js`、`page-latex.js`、`script/lib/placeholder.mjs`
- Create: `test/fixtures/complex-elements.html`、`test/fixtures/mermaid.html`
- Test: `test/integration/placeholder.test.mjs`

**Interfaces:**
- Consumes: Task 5 `openPage`
- Produces（placeholder.mjs）:
  - `readSharedScript(name)` → Promise\<string\>
  - `makeCtx(dirs, {context, log})` → `ctx = {dirs, context, log, counters: {img:0, complex:0}, entries: [], warnings: []}`
  - `processMermaid(frame, ctx)` → number（替换数；登记 `{id, type:'mermaid', status:'done'}`）
  - `processSpecialElements(frame, ctx)` → number（处理数）
  - `processImages(frame, ctx)` → number（成功下载数）
  - `writeManifest(manifestPath, entries)`
  - manifest 条目形态：`{id, type, status, draft?, final?}`；`draft`/`final` 为相对 workflow 目录的 `assets/...` 路径
  - 共享 JS 文件约定：每个文件恰好一个具名函数声明 `function __u2mXxx(...)`，Node/Python 均以 `evaluate('(' + src + ')', args)` 形式调用

- [ ] **Step 1: 写夹具页**

```html
<!-- test/fixtures/complex-elements.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>特殊元素页</title></head>
<body>
<main>
<h1>特殊元素页</h1>
<canvas id="c" width="300" height="200"></canvas>
<svg id="big" width="200" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100" fill="red"/></svg>
<div class="chart" style="width:400px;height:300px"><span>chart</span><i>i1</i><b>b1</b><u>u1</u></div>
<div id="viz" style="width:400px;height:300px"><svg width="10" height="10"></svg><svg width="10" height="10"></svg><img src="/pixel.png" width="1" height="1" alt=""></div>
<p>公式 <span class="katex"><span class="katex-mathml"><annotation encoding="application/x-tex">E=mc^2</annotation></span></span> 出现在行内。</p>
<img src="/pixel.png" alt="px">
<video poster="/pixel.png" width="300" height="150" src="/demo.mp4"></video>
</main>
</body>
</html>
```

```html
<!-- test/fixtures/mermaid.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>Mermaid 页</title></head>
<body>
<main><h1>流程图</h1><div id="host"></div></main>
<script>
  const pre = document.createElement('pre');
  pre.className = 'mermaid';
  pre.textContent = 'graph TD; A-->B';
  document.getElementById('host').appendChild(pre);
  setTimeout(() => { // 模拟 mermaid 渲染替换为 svg
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '300'); svg.setAttribute('height', '200');
    pre.innerHTML = ''; pre.appendChild(svg);
  }, 100);
</script>
</body>
</html>
```

- [ ] **Step 2: 写失败测试**

```js
// test/integration/placeholder.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openPage } from '../../script/lib/browser.mjs';
import { makeCtx, processMermaid, processSpecialElements, processImages, writeManifest, readSharedScript } from '../../script/lib/placeholder.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

let fx;
before(async () => { await writePixelPng('test/fixtures/pixel.png'); fx = await startFixtureServer(); });
after(async () => { await fx.close(); });

const tmpDirs = () => {
  const root = fs.mkdtempSync('/tmp/u2m-wf-');
  const assets = `${root}/assets`;
  for (const d of ['draft', 'complex', 'images']) fs.mkdirSync(`${assets}/${d}`, { recursive: true });
  return { wf: root, assets, draft: `${assets}/draft`, complex: `${assets}/complex`, images: `${assets}/images`, manifest: `${assets}/manifest.json` };
};

test('共享脚本可读取且为具名函数声明', async () => {
  for (const n of ['page-init.js', 'page-merge.js', 'page-clean.js', 'page-classify.js', 'page-inline.js', 'page-latex.js']) {
    const src = await readSharedScript(n);
    assert.ok(/^function __u2m/.test(src.trim()), `${n} 应以 function __u2m 开头`);
  }
});

test('complex-elements: 四类分派 + latex 直出 + 图片下载 + manifest', async () => {
  const dirs = tmpDirs();
  const s = await openPage(`${fx.url}/complex-elements.html`, {
    viewport: { width: 1280, height: 800 },
    initScripts: [await readSharedScript('page-init.js')],
  });
  try {
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    await s.page.evaluate(await readSharedScript('page-merge.js') + ' __u2mMergeIframes()');
    const mermaidN = await processMermaid(s.page.mainFrame(), ctx);
    assert.equal(mermaidN, 0);
    await processSpecialElements(s.page.mainFrame(), ctx);
    const imgs = await processImages(s.page.mainFrame(), ctx);

    // canvas → screenshot png；svg → passthrough svg；chart → svg_convert draft；katex → $$..$$ 直出；video → screenshot png
    const byType = Object.fromEntries(ctx.entries.map((e) => [e.type, e]));
    assert.ok(fs.existsSync(byType.screenshot.final.replace('assets/', `${dirs.assets}/`)), 'canvas/video 截图存在');
    assert.ok(fs.existsSync(byType.passthrough_svg.final.replace('assets/', `${dirs.assets}/`)), 'svg 导出存在');
    const draftFile = `${dirs.wf}/${byType.svg_convert.draft}`;
    assert.ok(fs.existsSync(draftFile), 'chart draft 存在');
    assert.match(fs.readFileSync(draftFile, 'utf8'), /style=/); // 计算样式已内联
    assert.equal(byType.latex.status, 'done'); // annotation 直出，不经 LLM

    const bodyText = await s.page.locator('body').innerText();
    assert.match(bodyText, /\$\$E=mc\^2\$\$/);            // latex 已替换为 $$..$$
    assert.match(bodyText, /\{\{COMPLEX_DIV_\d+\}\}/);     // svg_convert 留占位符
    assert.match(bodyText, /\{\{IMG_1\}\}/);               // 图片占位符
    assert.match(bodyText, /视频源：/);                    // video 附加原链接文本
    assert.equal(imgs, 1);
    assert.ok(fs.existsSync(`${dirs.images}/IMG_1.png`));
    // 启发式命中：#viz 无选择器特征，靠 尺寸+文本密度+非文本子元素数 判为 svg_convert
    assert.equal(ctx.entries.filter((e) => e.type === 'svg_convert').length, 2);

    writeManifest(dirs.manifest, ctx.entries);
    const manifest = JSON.parse(fs.readFileSync(dirs.manifest, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.ok(manifest.items.length >= 5);
  } finally { await s.close(); }
});

test('mermaid: 源码钩子命中 → 替换为 language-mermaid 代码块', async () => {
  const dirs = tmpDirs();
  const s = await openPage(`${fx.url}/mermaid.html`, {
    viewport: { width: 1280, height: 800 },
    initScripts: [await readSharedScript('page-init.js')],
  });
  try {
    await s.page.waitForTimeout(300); // 等模拟渲染完成
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    const n = await processMermaid(s.page.mainFrame(), ctx);
    assert.equal(n, 1);
    assert.equal(ctx.entries[0].type, 'mermaid');
    assert.equal(ctx.entries[0].status, 'done');
    const code = await s.page.locator('pre > code.language-mermaid').textContent();
    assert.equal(code, 'graph TD; A-->B');
    // 渲染后的 svg 已随容器替换消失，不再走 passthrough
    assert.equal(await s.page.locator('svg').count(), 0);
  } finally { await s.close(); }
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/integration/placeholder.test.mjs` → FAIL（module not found）

- [ ] **Step 4: 实现六个共享页面脚本**

```js
// script/lib/page-init.js —— addInitScript 注入（每个 frame、每次导航前运行）
function __u2mPageInit() {
  // 1) IntersectionObserver 劫持：callback 立即以 isIntersecting=true 触发（懒加载）
  if (window.IntersectionObserver) {
    window.IntersectionObserver = class {
      constructor(cb) { this._cb = cb; }
      observe(target) {
        try {
          this._cb([{ target, isIntersecting: true, intersectionRatio: 1, time: 0,
            boundingClientRect: target.getBoundingClientRect ? target.getBoundingClientRect() : {},
            rootBounds: null, intersectionRect: null }], this);
        } catch (e) { /* 业务回调异常不阻断 */ }
      }
      unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
  // 2) Mermaid 源码快照：抢在渲染替换前把 textContent 存进行 attribute
  const SEL = '.mermaid, pre.mermaid';
  const snap = (n) => {
    if (n.nodeType === 1 && n.matches && n.matches(SEL) && !n.hasAttribute('data-u2m-mermaid-src')) {
      n.setAttribute('data-u2m-mermaid-src', n.textContent || '');
    }
  };
  const scan = (root) => { if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(snap); };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) { snap(n); if (n.nodeType === 1) scan(n); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}
```

```js
// script/lib/page-merge.js —— 主文档文本过少时合并同源 iframe 内容
function __u2mMergeIframes(minMainText) {
  const minMain = typeof minMainText === 'number' ? minMainText : 500;
  const textLen = (document.body && document.body.innerText ? document.body.innerText : '')
    .replace(/\s+/g, ' ').trim().length;
  if (textLen >= minMain) return 0; // 主文档内容充足，不合并（iframe 视作挂件）
  let rounds = 0;
  for (; rounds < 5; rounds++) {
    const frames = Array.from(document.querySelectorAll('iframe')).filter((f) => {
      try { return f.contentDocument && f.contentDocument.body; } catch (e) { return false; }
    });
    if (!frames.length) break;
    for (const f of frames) {
      const host = document.createElement('div');
      for (const n of Array.from(f.contentDocument.body.childNodes)) {
        host.appendChild(document.adoptNode(n));
      }
      f.replaceWith(host);
    }
  }
  return rounds;
}
```

```js
// script/lib/page-clean.js —— 清理 video/audio/按钮/行号结构（保留主体与 CSS）
function __u2mClean() {
  document.querySelectorAll('video,audio,button,[role="button"],.copy,.copy-btn').forEach((e) => e.remove());
  document.querySelectorAll('.line-numbers-rows,[data-line-number]').forEach((e) => e.remove());
  // 行号列：pre 内 table 首列为纯数字的单元格 / 纯数字 li
  document.querySelectorAll('pre table tr').forEach((tr) => {
    const c = tr.firstElementChild;
    if (c && /^\s*\d+\s*$/.test(c.textContent || '')) c.remove();
  });
  document.querySelectorAll('pre ol > li').forEach((li) => {
    if (/^\s*\d+\s*$/.test(li.textContent || '')) li.remove();
  });
  return true;
}
```

```js
// script/lib/page-classify.js —— 特殊元素判定与类型标记（唯一事实源，Node/Python 共用）
function __u2mClassify(cfg) {
  cfg = cfg || {};
  const SVG_MIN = cfg.svgMinSize || 24;          // 大尺寸 svg 阈值（>24×24 非图标）
  const MIN_W = cfg.minW || 200, MIN_H = cfg.minH || 150;  // 启发式最小可见尺寸
  const DENSITY = cfg.textDensity || 0.005;      // 文本密度阈值（字符/px²）
  const MIN_NON_TEXT = cfg.minNonText || 3;      // 非文本子元素最少数量
  const MIN_IFRAME_TEXT = cfg.minIframeText || 200;        // 同源内容型 iframe 文本量
  const SELECTORS = ['canvas', 'video', 'iframe', 'svg',
    '.MathJax', '.MathJax_Display', '.katex', '.katex-display',
    '.chart', '.echarts', '.highcharts', '[data-chart]', '[role="img"]',
    'div', 'section'].join(', ');

  function classify(el) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'CANVAS' || tag === 'VIDEO') return 'screenshot';
    if (tag === 'IFRAME') {
      let doc = null;
      try { doc = el.contentDocument; } catch (e) { /* 跨域 */ }
      if (doc && doc.body && (doc.body.innerText || '').trim().length >= MIN_IFRAME_TEXT) return 'same_origin_iframe';
      return 'screenshot';
    }
    if (tag === 'SVG') {
      const r = el.getBoundingClientRect();
      if (r.width > SVG_MIN || r.height > SVG_MIN) return 'passthrough_svg';
      return null;
    }
    if (el.matches('.MathJax,.MathJax_Display,.katex,.katex-display')) return 'latex';
    if (el.matches('.chart,.echarts,.highcharts,[data-chart],[role="img"]')) return 'svg_convert';
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_W && r.height >= MIN_H) {
      const text = el.textContent || '';
      if (text.length / (r.width * r.height) < DENSITY) {
        const nonText = el.querySelectorAll('img,svg,canvas,video,iframe,table,figure').length;
        if (nonText >= MIN_NON_TEXT) return 'svg_convert';
      }
    }
    return null;
  }

  const picked = [];
  for (const el of document.querySelectorAll(SELECTORS)) {
    if (el.closest('[data-u2m-type]')) continue; // 父子都命中只取最外层（文档序=先父后子）
    const t = classify(el);
    if (t) { el.setAttribute('data-u2m-type', t); picked.push({ type: t }); }
  }
  return picked;
}
```

```js
// script/lib/page-inline.js —— computedStyle 内联序列化（svg_convert 的 draft 提取）
function __u2mInlineStyles(el) {
  const walk = (n) => {
    const cs = getComputedStyle(n);
    for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i);
      n.style.setProperty(p, cs.getPropertyValue(p));
    }
    Array.from(n.children).forEach(walk);
  };
  walk(el);
  return el.outerHTML;
}
```

```js
// script/lib/page-latex.js —— LaTeX 原文提取（文本优先：annotation / math/tex）
function __u2mLatexText(el) {
  const ann = el.querySelector('annotation[encoding="application/x-tex"], script[type="math/tex"], script[type="math/tex; mode=display"]');
  if (ann) return (ann.textContent || '').trim();
  const prev = el.previousElementSibling;
  if (prev) {
    const t = prev.getAttribute('type') || '';
    if (/^math\/tex/.test(t)) return (prev.textContent || '').trim();
  }
  return null;
}
```

- [ ] **Step 5: 实现 lib/placeholder.mjs**

```js
// script/lib/placeholder.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = path.dirname(fileURLToPath(import.meta.url));

export async function readSharedScript(name) {
  return fs.readFile(path.join(libDir, name), 'utf8');
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/avif': 'avif',
};

export function makeCtx(dirs, { context, log = () => {} } = {}) {
  return { dirs, context, log, counters: { img: 0, complex: 0 }, entries: [], warnings: [] };
}

export async function writeManifest(manifestPath, entries) {
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, items: entries }, null, 2));
}

/** DOM 元素替换为文本节点（占位符 / $$..$$） */
function replaceWithText(frame, handle, text) {
  return frame.evaluate('(el, text) => el.replaceWith(document.createTextNode(text))', [handle, text]);
}

/** DOM 元素替换为 HTML 片段（最终图片引用等） */
function replaceWithHtml(frame, handle, html) {
  return frame.evaluate('(el, html) => { const t = document.createElement("template"); t.innerHTML = html; el.replaceWith(...t.content.childNodes); }', [handle, html]);
}

/** Mermaid：钩子取到源码的容器 → <pre><code class="language-mermaid">；登记 done。 */
export async function processMermaid(frame, ctx) {
  const handles = await frame.$$('[data-u2m-mermaid-src]');
  for (const h of handles) {
    const src = await h.getAttribute('data-u2m-mermaid-src');
    if (!src || !src.trim()) continue;
    const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
    const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await replaceWithHtml(frame, h, `<pre><code class="language-mermaid">${esc}</code></pre>`);
    ctx.entries.push({ id, type: 'mermaid', status: 'done' });
    ctx.log(`mermaid 源码直出: ${id}`);
  }
  return handles.length;
}

/** 特殊元素分派主流程。返回处理数量。 */
export async function processSpecialElements(frame, ctx) {
  const classify = await readSharedScript('page-classify.js');
  const inline = await readSharedScript('page-inline.js');
  const latex = await readSharedScript('page-latex.js');
  let processed = 0;

  const classifyOnce = () => frame.evaluate(`(${classify})()`);
  const hoistIframe = (h) => frame.evaluate(
    '(el) => { const host = document.createElement("div"); const doc = el.contentDocument; if (doc && doc.body) { for (const n of Array.from(doc.body.childNodes)) host.appendChild(document.adoptNode(n)); } el.replaceWith(host); }', h);

  for (;;) {
    await classifyOnce();
    const handles = await frame.$$('[data-u2m-type]');
    if (!handles.length) break;
    let merged = false;
    for (const h of handles) {
      let type;
      try { type = await h.getAttribute('data-u2m-type'); } catch { continue; }
      try {
        if (type === 'same_origin_iframe') {
          await hoistIframe(h); // 合并后新内容下一轮分类
          merged = true;
          continue;
        }
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = (ext) => `assets/complex/${id}.${ext}`;
        if (type === 'screenshot') {
          const abs = path.join(ctx.dirs.wf, rel('png'));
          const tag = await h.evaluate('(el) => el.tagName');
          let linkHtml = '';
          if (tag === 'VIDEO') {
            const src = await h.evaluate('(el) => el.getAttribute("src") || el.currentSrc || ""');
            if (src) linkHtml = `<a href="${src}">（视频源：${src}）</a>`;
          }
          await h.screenshot({ path: abs });
          await replaceWithHtml(frame, h, `<img src="${rel('png')}" alt="${id}">${linkHtml}`);
          ctx.entries.push({ id, type, final: rel('png'), status: 'done' });
        } else if (type === 'passthrough_svg') {
          const abs = path.join(ctx.dirs.wf, rel('svg'));
          const svg = await h.evaluate('(el) => { const c = el.cloneNode(true); c.querySelectorAll("script").forEach((s) => s.remove()); [c, ...c.querySelectorAll("*")].forEach((n) => { for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name); }); c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return c.outerHTML; }');
          await fs.writeFile(abs, svg, 'utf8');
          await replaceWithHtml(frame, h, `<img src="${rel('svg')}" alt="${id}">`);
          ctx.entries.push({ id, type, final: rel('svg'), status: 'done' });
        } else if (type === 'svg_convert') {
          const abs = path.join(ctx.dirs.draft, `${id}.html`);
          const draftHtml = await h.evaluate(`(${inline})`);
          await fs.writeFile(abs, draftHtml, 'utf8');
          await replaceWithText(frame, h, `{{${id}}}`);
          ctx.entries.push({ id, type, draft: `assets/draft/${id}.html`, status: 'pending' });
        } else if (type === 'latex') {
          const tex = await h.evaluate(`(${latex})`);
          if (tex) {
            await replaceWithText(frame, h, `$$${tex}$$`);
            ctx.entries.push({ id, type, status: 'done' });
          } else {
            const abs = path.join(ctx.dirs.draft, `${id}.html`);
            const draftHtml = await h.evaluate('(el) => el.outerHTML');
            await fs.writeFile(abs, draftHtml, 'utf8');
            await replaceWithText(frame, h, `{{${id}}}`);
            ctx.entries.push({ id, type, draft: `assets/draft/${id}.html`, status: 'pending' });
          }
        }
        processed++;
      } catch (e) {
        ctx.warnings.push(`特殊元素处理失败(${type}): ${e.message}`);
        try { await h.evaluate('(el) => el.removeAttribute("data-u2m-type")'); } catch { /* 已脱离 DOM */ }
      }
    }
    if (!merged) break;
  }
  return processed;
}

/** 正文图片：并发（4）下载 → assets/images/IMG_n.<ext>；DOM 替换为 {{IMG_n}}；失败保留原样并告警。 */
export async function processImages(frame, ctx) {
  const handles = await frame.$$('img');
  const jobs = [];
  for (const h of handles) {
    let src = null;
    try { src = await h.getAttribute('src'); } catch { continue; }
    if (!src) continue;
    const n = ++ctx.counters.img;
    jobs.push({ h, src, n });
  }
  let ok = 0;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const { h, src, n } = queue.shift();
      try {
        let buf, ctype;
        if (src.startsWith('data:')) {
          const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
          if (!m) throw new Error('无法解析 data URL');
          ctype = m[1];
          buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
        } else {
          const res = await ctx.context.request.get(src);
          if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
          ctype = res.headers()['content-type']?.split(';')[0] || '';
          buf = await res.body();
        }
        const ext = EXT_BY_TYPE[ctype] || 'png';
        await fs.writeFile(path.join(ctx.dirs.images, `IMG_${n}.${ext}`), buf);
        await replaceWithText(frame, h, `{{IMG_${n}}}`);
        ok++;
      } catch (e) {
        ctx.warnings.push(`图片下载失败保留原 URL: ${src} (${e.message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  return ok;
}
```

- [ ] **Step 6: 运行确认通过 + Commit**

Run: `node --test test/integration/placeholder.test.mjs` → PASS；`pnpm test && pnpm test:integration` 全绿（回归）

```bash
git add script/lib/page-*.js script/lib/placeholder.mjs test/integration/placeholder.test.mjs test/fixtures/complex-elements.html test/fixtures/mermaid.html
git commit -m "feat: 特殊元素四类分派 + mermaid 源码直出 + manifest（page-*.js 双语言共享）"
```

---

### Task 8: script/init.sh —— 环境自检与修复

**Files:**
- Create: `script/init.sh`（`chmod +x`）
- Test: `test/integration/init.test.mjs`

**Interfaces:**
- Produces: CLI `bash script/init.sh`（无参数）；成功 stdout `{"status":"ok","node":"...","python":"...","pm":"pnpm","chromium":true}` 退出 0；失败 `{"status":"error","reason":"..."}` 退出 1；降级警告走 stderr 不阻断

- [ ] **Step 1: 写失败测试**

```js
// test/integration/init.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../helpers/run-script.mjs';
import path from 'node:path';

test('init.sh: 环境就绪时输出 ok JSON 退出 0', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')], { timeoutMs: 280000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'stdout 恰一行');
  const json = JSON.parse(lines[0]);
  assert.equal(json.status, 'ok');
  assert.ok(json.node);
  assert.ok(json.python);
  assert.ok(['pnpm', 'yarn', 'npm'].includes(json.pm));
  assert.equal(json.chromium, true);
});

test('init.sh: 幂等——二次运行依旧 ok', { timeout: 300000 }, async () => {
  const r = await runScript('bash', [path.resolve('script/init.sh')], { timeoutMs: 280000 });
  assert.equal(r.code, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/integration/init.test.mjs` → FAIL（脚本不存在）

- [ ] **Step 3: 实现**

```bash
#!/usr/bin/env bash
# init.sh —— 环境自检与修复。stdout 有且仅有一行 JSON；日志/警告走 stderr。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '[init] %s\n' "$*" >&2; }
warn() { log "⚠ 警告（不阻断）: $*"; }
die()  { printf '{"status":"error","reason":"%s"}\n' "$1"; exit 1; }

# ── 1. Node ≥ 20 ────────────────────────────────────────────
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
  log "Node >=20 缺失或版本过低，尝试 nvm 安装"
  # nvm 是 shell 函数，需 source
  if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
  if command -v nvm >/dev/null 2>&1; then
    nvm install 20 >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1 || die "nvm 安装 Node 20 失败"
  else
    die "Node >=20 不满足且 nvm 不可用"
  fi
fi
[ "$(node_major)" -ge 20 ] || die "Node >=20 不满足"
NODE_VER="$(node -p process.versions.node)"

# ── 2. Python3 ≥ 3.11 ────────────────────────────────────────
py_ok() { python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; }
if ! py_ok; then
  log "Python >=3.11 缺失或版本过低，尝试安装"
  if command -v uv >/dev/null 2>&1; then
    uv python install 3.12 >/dev/null 2>&1 || die "uv python install 3.12 失败"
    UV_PY="$(uv python find 3.12 2>/dev/null)" || die "uv python find 失败"
    export PATH="$(dirname "$UV_PY"):$PATH"
  elif command -v brew >/dev/null 2>&1; then
    brew install python@3.12 >/dev/null 2>&1 || die "brew 安装 Python 失败"
  else
    die "Python >=3.11 不满足且无可用安装途径（uv/brew）"
  fi
fi
py_ok || die "Python >=3.11 仍不满足"
PY_VER="$(python3 -c 'import platform; print(platform.python_version())')"

# ── 3. 包管理器探测 pnpm > yarn > npm（不自行安装） ─────────
PM=""
for c in pnpm yarn npm; do
  if command -v "$c" >/dev/null 2>&1; then PM="$c"; break; fi
done
[ -n "$PM" ] || die "未找到 pnpm/yarn/npm，请先安装其中之一"

# ── 4. Node 依赖（有 lock 走 frozen/CI 模式） ────────────────
cd "$ROOT" || die "无法进入项目根目录"
log "使用 $PM 安装 Node 依赖"
case "$PM" in
  pnpm) if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile || die "pnpm install --frozen-lockfile 失败";
        else pnpm install || die "pnpm install 失败"; fi ;;
  yarn) if [ -f yarn.lock ]; then yarn install --frozen-lockfile || die "yarn install 失败";
        else yarn install || die "yarn install 失败"; fi ;;
  npm)  if [ -f package-lock.json ]; then npm ci || die "npm ci 失败";
        else npm install || die "npm install 失败"; fi ;;
esac

# ── 5. Python 依赖（uv 优先） ────────────────────────────────
if command -v uv >/dev/null 2>&1; then
  uv sync || die "uv sync 失败"
else
  log "无 uv，回退 venv + pip"
  [ -d .venv ] || python3 -m venv .venv || die "创建 .venv 失败"
  .venv/bin/pip install --quiet playwright readability-lxml markdownify pytest || die "pip 安装依赖失败"
  warn "无 uv：后续请用 .venv/bin/python 运行 Python 脚本与 pytest"
fi

# ── 6. chromium（只修复缺失，不重复安装） ────────────────────
CHROMIUM_OK=false
NODE_CHROMIUM="$(node -e 'try { console.log(require("playwright").chromium.executablePath()) } catch { process.exit(1) }' 2>/dev/null || true)"
if [ -n "$NODE_CHROMIUM" ] && [ -x "$NODE_CHROMIUM" ]; then
  CHROMIUM_OK=true
else
  log "安装 chromium（Node Playwright）"
  npx playwright install chromium || die "npx playwright install chromium 失败"
  CHROMIUM_OK=true
fi
# Python 侧 chromium（版本不一致时缓存不同）
PY_BIN="$ROOT/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="$(command -v python3)"
PY_CHROMIUM="$("$PY_BIN" - <<'PY' 2>/dev/null || true
from playwright.sync_api import sync_playwright
try:
    p = sync_playwright().start()
    print(p.chromium.executable_path)
    p.stop()
except Exception:
    raise SystemExit(1)
PY
)"
if [ -z "$PY_CHROMIUM" ] || [ ! -x "$PY_CHROMIUM" ]; then
  "$PY_BIN" -m playwright install chromium && warn "已为 Python Playwright 安装 chromium" || warn "Python chromium 安装失败（若与 Node 共享缓存则无碍）"
fi

# ── 输出 ─────────────────────────────────────────────────────
printf '{"status":"ok","node":"%s","python":"%s","pm":"%s","chromium":%s}\n' \
  "$NODE_VER" "$PY_VER" "$PM" "$CHROMIUM_OK"
```

```bash
chmod +x script/init.sh
```

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `node --test test/integration/init.test.mjs` → PASS

```bash
git add script/init.sh test/integration/init.test.mjs
git commit -m "feat: init.sh 环境自检与修复（Node/Python/包管理器/依赖/chromium）"
```

---

### Task 9: lib/screencast.mjs + script/login_url.mjs —— 登录流程

**Files:**
- Create: `script/lib/screencast.mjs`、`script/login_url.mjs`
- Test: `test/integration/login.test.mjs`

**Interfaces:**
- Consumes: Task 2 contract、Task 3 env、Task 4/5 browser、Task 6 detector
- Produces:
  - `screencast.mjs`: `loginViewerHtml({width,height})` → string；`startScreencastViewer({page, port=0, width, height, quality, onLoginDone(ws), onClientClose(), log})` → `{port, url, close()}`；viewer WS 消息：入 `{type:'mousemove'|'mousedown'|'mouseup'|'scroll'|'keydown'|'keyup'|'login_done', ...}`，出 `{type:'frame', data}` / `{type:'recheck_failed'}`
  - CLI: `login_url.mjs <url> [--timeout 300000] [--port 0] [--no-open]`；stdout `{"status":"logged_in"|"login_done"|"timeout"|"aborted"|"error"|"usage_error", ...}` 退出 0/1/2

- [ ] **Step 1: 写失败测试**

```js
// test/integration/login.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const script = path.resolve('script/login_url.mjs');
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-login-'));
const SEED_STATE = (root) => {
  fs.mkdirSync(path.join(root, 'cookies'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cookies', 'storage_state.json'), JSON.stringify({ cookies: [
    { name: 'sessionid', value: 'x', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ], origins: [] }));
};
const viewerFromStderr = (line) => {
  const m = /\[login_url\] viewer: (http:\/\/\S+)/.exec(line);
  return m ? m[1] : null;
};

test('已登录：预置 cookie → logged_in，退出 0，storageState 回写', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  SEED_STATE(root);
  const r = await runScript(process.execPath, [script, `${fx.url}/logged-in.html`, '--no-open'], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'logged_in');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'cookies', 'storage_state.json'), 'utf8'));
  assert.ok(saved.cookies.some((c) => c.name === 'sessionid'));
  await fx.close();
});

test('未登录→自动登录→点击登录完成：login_done，退出 0', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  let frames = 0;
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html?auto=1`, '--no-open', '--timeout', '20000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const viewer = viewerFromStderr(line);
      if (!viewer) return;
      const ws = new WebSocket(viewer.replace('http://', 'ws://'));
      ws.on('message', (d) => { if (JSON.parse(d).type === 'frame') frames++; });
      ws.on('open', () => setTimeout(() => ws.send(JSON.stringify({ type: 'login_done' })), 1200));
    } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'login_done');
  assert.ok(frames > 0, 'Screencast 应持续推送画面帧');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'cookies', 'storage_state.json'), 'utf8'));
  assert.ok(saved.cookies.some((c) => c.name === 'sessionid'));
  await fx.close();
});

test('viewer 断开且未登录：aborted，退出 1', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html`, '--no-open', '--timeout', '20000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const viewer = viewerFromStderr(line);
      if (!viewer) return;
      const ws = new WebSocket(viewer.replace('http://', 'ws://'));
      ws.on('open', () => setTimeout(() => ws.close(), 300)); // 用户关闭 viewer
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'aborted');
  await fx.close();
});

test('超时：无人交互 → timeout，退出 1', async () => {
  const fx = await startFixtureServer();
  const root = tmpRoot();
  const r = await runScript(process.execPath,
    [script, `${fx.url}/login-wall.html`, '--no-open', '--timeout', '1500'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 20000 });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  await fx.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/integration/login.test.mjs` → FAIL

- [ ] **Step 3: 实现 lib/screencast.mjs**

```js
// script/lib/screencast.mjs —— CDP Screencast → 本地 HTTP+WS viewer（移植 .temp/login.mjs，去 express）
import http from 'node:http';
import { WebSocketServer } from 'ws';

export function loginViewerHtml({ width = 1280, height = 800 } = {}) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>url-to-markdown 登录</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f0f1a; display: flex; flex-direction: column; align-items: center;
         justify-content: center; min-height: 100vh; font-family: -apple-system, "PingFang SC", sans-serif; padding: 20px; }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  h1 { color: #e0e0e0; font-size: 17px; font-weight: 500; }
  #status { font-size: 12px; padding: 3px 10px; border-radius: 10px; background: #1a1a2e; border: 1px solid #333; color: #fbbf24; }
  #status.connected { color: #4ade80; border-color: #4ade80; }
  #status.failed { color: #f87171; border-color: #f87171; }
  #screen { display: block; background: #1a1a2e; border-radius: 10px; border: 1px solid #2a2a3e; max-width: 95vw; max-height: 78vh; }
  .toolbar { margin-top: 12px; }
  #done { padding: 10px 28px; font-size: 15px; border-radius: 8px; border: 1px solid #4ade80;
          background: #14532d; color: #eafbe7; cursor: pointer; }
  #done:hover { background: #166534; }
  .info { margin-top: 10px; color: #888; font-size: 12px; }
</style>
</head>
<body>
<div class="header"><h1>🖥️ 远程页面登录</h1><span id="status">连接中…</span></div>
<canvas id="screen" width="${width}" height="${height}" tabindex="0"></canvas>
<div class="toolbar"><button id="done">✅ 登录完成</button></div>
<p class="info">在画面中完成登录后点「登录完成」。点击画面后可键盘输入；滚轮滚动。</p>
<script>
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  let ws;
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
    ws.onopen = () => { statusEl.textContent = '已连接'; statusEl.className = 'connected'; canvas.focus(); };
    ws.onclose = () => { statusEl.textContent = '连接已断开'; statusEl.className = 'failed'; setTimeout(connect, 3000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'frame') {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = 'data:image/jpeg;base64,' + msg.data;
      } else if (msg.type === 'recheck_failed') {
        statusEl.textContent = '仍未检测到登录态，请继续'; statusEl.className = 'failed';
      }
    };
  }
  connect();
  function coords(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (canvas.width / r.width)),
             y: Math.round((e.clientY - r.top) * (canvas.height / r.height)) };
  }
  function send(d) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(d)); }
  canvas.addEventListener('mousemove', (e) => { const {x, y} = coords(e); send({type:'mousemove', x, y}); });
  canvas.addEventListener('mousedown', (e) => { e.preventDefault(); canvas.focus();
    const {x, y} = coords(e); send({type:'mousedown', x, y, button: ['left','middle','right'][e.button] || 'left'}); });
  canvas.addEventListener('mouseup', (e) => { e.preventDefault();
    const {x, y} = coords(e); send({type:'mouseup', x, y, button: ['left','middle','right'][e.button] || 'left'}); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const {x, y} = coords(e);
    send({type:'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY}); }, { passive: false });
  document.addEventListener('keydown', (e) => { if (document.activeElement === canvas) { e.preventDefault();
    send({type:'keydown', key: e.key, code: e.code, text: e.key.length === 1 ? e.key : '', keyCode: e.keyCode}); } });
  document.addEventListener('keyup', (e) => { if (document.activeElement === canvas) { e.preventDefault();
    send({type:'keyup', key: e.key, code: e.code, keyCode: e.keyCode}); } });
  document.getElementById('done').onclick = () => { send({type:'login_done'});
    statusEl.textContent = '检测登录态中…'; statusEl.className = ''; };
</script>
</body>
</html>`;
}

async function relayInput(cdp, msg) {
  switch (msg.type) {
    case 'mousemove': await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: msg.x, y: msg.y }); break;
    case 'mousedown': await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: msg.x, y: msg.y, button: msg.button || 'left', clickCount: 1 }); break;
    case 'mouseup':   await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: msg.x, y: msg.y, button: msg.button || 'left', clickCount: 1 }); break;
    case 'keydown':   await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: msg.key, code: msg.code, text: msg.text || '', windowsVirtualKeyCode: msg.keyCode, nativeVirtualKeyCode: msg.keyCode }); break;
    case 'keyup':     await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: msg.key, code: msg.code, windowsVirtualKeyCode: msg.keyCode, nativeVirtualKeyCode: msg.keyCode }); break;
    case 'scroll':    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: msg.x, y: msg.y, deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0 }); break;
  }
}

/** 起 HTTP(viewer 页)+WS 服务，把 page 的 CDP Screencast 转发给 WS 客户端并转发输入。 */
export async function startScreencastViewer({
  page, port = 0, width = 1280, height = 800, quality = 80,
  onLoginDone, onClientClose, log = () => {},
}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(loginViewerHtml({ width, height }));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ server });
  const cdp = await page.context().newCDPSession(page);
  let client = null;

  wss.on('connection', async (ws) => {
    client = ws;
    log('viewer 已连接');
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 }).catch(() => {});
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'login_done') { onLoginDone?.(ws); return; }
      await relayInput(cdp, msg).catch(() => {});
    });
    ws.on('close', () => { client = null; onClientClose?.(); });
  });

  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* session 已关 */ }
    if (client && client.readyState === 1) client.send(JSON.stringify({ type: 'frame', data }));
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: async () => {
      try { await cdp.send('Page.stopScreencast'); } catch { /* 忽略 */ }
      wss.close();
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
    },
  };
}
```

- [ ] **Step 4: 实现 script/login_url.mjs**

```js
#!/usr/bin/env node
// login_url.mjs <url> [--timeout 300000] [--port 0] [--no-open]
// 打开 URL 检测登录态；已登录→logged_in；未登录→Screencast viewer 人工登录→login_done；超时/中断→timeout/aborted。
import { execFile } from 'node:child_process';
import { emit, emitError, usage, log } from '../lib/contract.mjs';
import { storageStatePath } from '../lib/env.mjs';
import { openPage, readStorageState, writeStorageState, mergeStorageState } from '../lib/browser.mjs';
import { needsLogin } from '../lib/detector.mjs';
import { startScreencastViewer } from '../lib/screencast.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-open') { out[key] = true; continue; } // 布尔标志无值
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) usage(`参数 --${key} 缺少值`);
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

async function saveMerged(page, filePath) {
  const base = await readStorageState(filePath);
  const fresh = await page.context().storageState();
  await writeStorageState(filePath, mergeStorageState(base, fresh));
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args._[0];
  if (!url) usage('用法: login_url.mjs <url> [--timeout ms] [--port n] [--no-open]');
  const timeoutMs = Number(args.timeout ?? 300000);
  const port = Number(args.port ?? 0);
  const ssPath = storageStatePath();

  const s = await openPage(url, { headless: true, viewport: { width: 1280, height: 800 }, storageStatePath: ssPath, log });
  const check = (spaWaitMs = 5000) => needsLogin(s.page, s.context, url, { spaWaitMs });

  let settled = false;
  let viewer = null;
  // 先关浏览器/viewer 再 emit：emit 内部 process.exit，顺序反了会留孤儿 chromium
  const finish = async (result, code) => {
    if (settled) return;
    settled = true;
    try { await viewer?.close(); } catch { /* 忽略 */ }
    try { await s.close(); } catch { /* 忽略 */ }
    emit(result, code);
  };

  try {
    const first = await check();
    if (!first.needsLogin) {
      await saveMerged(s.page, ssPath);
      log('检测为已登录，storageState 已刷新');
      return await finish({ status: 'logged_in' }, 0);
    }
    log('判定需要登录，进入 Screencast 登录模式');
    viewer = await startScreencastViewer({
      page: s.page, port,
      onLoginDone: async (ws) => {
        try {
          const r = await check(500); // 复检用短 SPA 等待
          if (!r.needsLogin) {
            await saveMerged(s.page, ssPath);
            finish({ status: 'login_done' }, 0);
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        try {
          const r = await check(500);
          if (!r.needsLogin) { await saveMerged(s.page, ssPath); finish({ status: 'login_done' }, 0); }
          else finish({ status: 'aborted' }, 1);
        } catch { finish({ status: 'aborted' }, 1); }
      },
      log,
    });
    log(`viewer: ${viewer.url}`);
    const t = setTimeout(() => finish({ status: 'timeout' }, 1), timeoutMs);
    t.unref?.();
    if (!args['no-open']) {
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', viewer.url] : [viewer.url];
      execFile(cmd, cmdArgs, () => {}); // 打不开不致命：URL 已打印 stderr
    }
  } catch (e) {
    finish({ status: 'error', reason: e.message }, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
```

**注意**：`finish()` 里先 `s.close()` 再 `emit`——emit 内部 `process.exit`，若先 emit 后关浏览器会留下孤儿 chromium 进程。

同时把 `test/helpers/run-script.mjs` 升级为支持可选 `onStderr(line)`（按行回调，其余行为不变）——**完整替换为**：

```js
// test/helpers/run-script.mjs
import { spawn } from 'node:child_process';

export function runScript(cmd, args, { env = {}, timeoutMs = 60000, onStderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = '', stderr = '', stderrBuf = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (!onStderr) return;
      stderrBuf += d;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      for (const line of lines) onStderr(line);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onStderr && stderrBuf) onStderr(stderrBuf);
      resolve({ code, stdout, stderr });
    });
  });
}
```

- [ ] **Step 5: 运行确认通过 + Commit**

Run: `node --test test/integration/login.test.mjs` → PASS（四条）

```bash
git add script/lib/screencast.mjs script/login_url.mjs test/integration/login.test.mjs test/helpers/run-script.mjs
git commit -m "feat: login_url.mjs 登录流程（六策略检测 + Screencast viewer 人工登录 + storageState 合并回写）"
```

---

### Task 10: script/clear_trans_html.mjs —— Node 工作流

**Files:**
- Create: `script/clear_trans_html.mjs`
- Create: `test/fixtures/lazy-load.html`、`test/fixtures/iframe-body.html`、`test/fixtures/iframe-content.html`、`test/fixtures/code-block.html`、`test/fixtures/nav-noise.html`
- Test: `test/integration/clear-node.test.mjs`

**Interfaces:**
- Consumes: Task 2-7 全部 lib
- Produces: CLI `clear_trans_html.mjs <url>`；产物 `working/<url-dir>/node_workflow/{sketch.md, assets/}`；stdout `{"status":"ok","sketch":"<abs>","images":N,"complex":N,"warnings":[...]}` 退出 0；错误 `{"status":"error"}` 1；参数 `usage_error` 2

- [ ] **Step 1: 写夹具页**

```html
<!-- test/fixtures/lazy-load.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>懒加载页</title></head>
<body>
<main>
<h1>懒加载页</h1>
<p>LAZY_PARA 图片由 IntersectionObserver 触发加载。</p>
<img id="lazy" data-src="/pixel.png" width="50" height="50" alt="懒图">
</main>
<script>
  new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.src = e.target.dataset.src; });
  }).observe(document.getElementById('lazy'));
</script>
</body>
</html>
```

```html
<!-- test/fixtures/iframe-body.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>iframe 正文</title></head>
<body>
<main>
<h1>iframe 内的正文标题</h1>
<p>IFRAME_BODY 正文内容。这段文字要足够长，以便主文档文本稀少时，合并逻辑能把它识别为内容型 iframe 并合并进主文档。通过重复这句话来增加文本量。iframe 正文需要超过两百个字符才会被判定为内容型，所以这里继续重复补充篇幅，确保判定稳定。IFRAME_BODY 正文内容补充第二段，进一步加长文本。</p>
</main>
</body>
</html>
```

```html
<!-- test/fixtures/iframe-content.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>外壳页</title></head>
<body>
<div id="shell">Loading…</div>
<iframe src="/iframe-body.html" width="800" height="600"></iframe>
</body>
</html>
```

```html
<!-- test/fixtures/code-block.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>代码块页</title></head>
<body>
<main>
<h1>代码块页</h1>
<pre><code class="language-python">def hello():
    print("world")</code><span class="line-numbers-rows">1
2</span></pre>
<table><tr><th>项</th><th>值</th></tr><tr><td>普通表格</td><td>keep</td></tr></table>
<button class="copy-btn">复制</button>
</main>
</body>
</html>
```

```html
<!-- test/fixtures/nav-noise.html -->
<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>噪声页</title></head>
<body>
<nav>NAV_LINKS 首页 文档 关于</nav>
<aside>ASIDE_AD 广告位：点击领取优惠券</aside>
<main>
<article>
<h1>真正的正文标题</h1>
<p>MAIN_CONTENT 这是正文第一段。正文包含足够多的文字，使得 Readability 能够把主体识别出来，噪声元素被剔除。这里继续补充正文内容以超过最低字符阈值，保证打分稳定。正文第二段继续补充篇幅，确保主体内容占页面文本的主要部分，从而让清理库正确保留主体。</p>
</article>
</main>
<footer>FOOTER_COPY © 2026 示例公司 版权所有</footer>
</body>
</html>
```

- [ ] **Step 2: 写失败测试**

```js
// test/integration/clear-node.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx; let root;
before(async () => {
  await writePixelPng('test/fixtures/pixel.png');
  fx = await startFixtureServer();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clear-'));
});
after(async () => { await fx.close(); });

const run = (page) => runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs'), `${fx.url}/${page}`],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });

const wf = (page) => path.join(root, urlToDirName(`${fx.url}/${page}`), 'node_workflow');
const sketch = (page) => fs.readFileSync(path.join(wf(page), 'sketch.md'), 'utf8');

test('static-article: 契约输出 + 占位符 + 表格 + 围栏', async () => {
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(wf('static-article.html'), 'assets/images/IMG_1.png')));
  const md = sketch('static-article.html');
  assert.match(md, /示例文章标题/);
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /PARA_ONE/);
  assert.match(md, /\|\s*名称\s*\|\s*值\s*\|/); // GFM 表格（容忍单元格两侧空格）
  assert.match(md, /```js/);
});

test('lazy-load: IO 劫持使懒图入册', async () => {
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(wf('lazy-load.html'), 'assets/images/IMG_1.png')));
});

test('iframe-content: 主文档稀少时合并同源 iframe 正文', async () => {
  const r = await run('iframe-content.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('iframe-content.html');
  assert.match(md, /iframe 内的正文标题/);
  assert.match(md, /IFRAME_BODY/);
});

test('code-block: 行号与复制按钮被清理，语言保留', async () => {
  const r = await run('code-block.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('code-block.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  assert.doesNotMatch(md, /line-numbers-rows/);
  assert.doesNotMatch(md, /复制/);
  assert.match(md, /普通表格/); // 非行号表格不受影响
});

test('nav-noise: 导航/广告/页脚被剔除', async () => {
  const r = await run('nav-noise.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('nav-noise.html');
  assert.match(md, /MAIN_CONTENT/);
  assert.doesNotMatch(md, /NAV_LINKS/);
  assert.doesNotMatch(md, /ASIDE_AD/);
  assert.doesNotMatch(md, /FOOTER_COPY/);
});

test('complex-elements: 全分派端到端', async () => {
  const r = await run('complex-elements.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('complex-elements.html');
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /\$\$E=mc\^2\$\$/);
  assert.match(md, /\{\{COMPLEX_DIV_\d+\}\}/); // svg_convert 占位符
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.svg\)/); // passthrough 直替
  const manifest = JSON.parse(fs.readFileSync(path.join(wf('complex-elements.html'), 'assets/manifest.json'), 'utf8'));
  const types = manifest.items.map((i) => i.type).sort();
  // canvas、video 各一 screenshot；大 svg passthrough；.chart 与 #viz（启发式）各一 svg_convert；katex latex
  assert.deepEqual(types, ['latex', 'passthrough_svg', 'screenshot', 'screenshot', 'svg_convert', 'svg_convert']);
  const pending = manifest.items.filter((i) => i.status === 'pending');
  assert.equal(pending.length, 2);
  assert.ok(pending.every((i) => i.type === 'svg_convert'));
});

test('mermaid: 源码 → mermaid 围栏', async () => {
  const r = await run('mermaid.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('mermaid.html');
  assert.match(md, /```mermaid\ngraph TD; A-->B\n```/);
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test test/integration/clear-node.test.mjs` → FAIL（脚本不存在）

- [ ] **Step 4: 实现 script/clear_trans_html.mjs**

```js
#!/usr/bin/env node
// clear_trans_html.mjs <url> —— Node 工作流：完整性→特殊元素→清理→readability→turndown→sketch.md
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, emitError, usage, log } from '../lib/contract.mjs';
import { projectRoot, ensureWorkflowDirs, storageStatePath } from '../lib/env.mjs';
import { openPage } from '../lib/browser.mjs';
import { makeCtx, readSharedScript, processMermaid, processSpecialElements, processImages, writeManifest } from '../lib/placeholder.mjs';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import fs from 'node:fs/promises';

const READABILITY_JS = path.join(projectRoot(), 'node_modules', '@mozilla', 'readability', 'Readability.js');

/** 渐进滚动到底再回顶（懒加载） */
async function progressiveScroll(page) {
  await page.evaluate(async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  });
}

/** DOM 稳定：节点数连续 stableMs 不变（虚拟 DOM 场景；不移除任何元素） */
async function waitForDomStable(page, { stableMs = 1000, maxMs = 15000 } = {}) {
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = await page.evaluate(() => document.getElementsByTagName('*').length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= stableMs) return;
    await page.waitForTimeout(200);
  }
}

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--')) usage('用法: clear_trans_html.mjs <url>');
  const dirs = ensureWorkflowDirs(url, 'node_workflow');

  const pageInit = await readSharedScript('page-init.js');
  const pageMerge = await readSharedScript('page-merge.js');
  const pageClean = await readSharedScript('page-clean.js');

  let s;
  let result;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    await progressiveScroll(s.page);
    await waitForDomStable(s.page);

    const ctx = makeCtx(dirs, { context: s.context, log });
    await s.page.evaluate(`(${pageMerge})()`);
    await processMermaid(s.page.mainFrame(), ctx);
    await processSpecialElements(s.page.mainFrame(), ctx);
    await processImages(s.page.mainFrame(), ctx);

    await s.page.evaluate(`(${pageClean})()`);

    // Readability 在页面内运行（避免 jsdom 依赖）
    await s.page.addScriptTag({ path: READABILITY_JS });
    const article = await s.page.evaluate(() => {
      const a = new Readability(document).parse();
      return a ? { title: a.title, content: a.content } : null;
    });
    let html;
    if (article?.content) {
      html = article.content;
    } else {
      ctx.warnings.push('readability 未能解析主体，回退 body 全文');
      html = await s.page.evaluate(() => document.body.innerHTML);
    }

    const td = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx', bulletListMarker: '-' });
    td.use(gfm);
    const md = td.turndown(html);

    await fs.writeFile(path.join(dirs.wf, 'sketch.md'), md, 'utf8');
    await writeManifest(dirs.manifest, ctx.entries);
    result = {
      status: 'ok',
      sketch: path.join(dirs.wf, 'sketch.md'),
      images: ctx.counters.img,
      complex: ctx.entries.length,
      warnings: ctx.warnings,
    };
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {}); // 先关浏览器再 emit（emit 内 process.exit）
  emit(result, 0);
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 5: 运行确认通过（允许的微调）+ Commit**

Run: `node --test test/integration/clear-node.test.mjs` → PASS。若 readability 把 `{{IMG_1}}` 文本节点或 `assets/` 图片引用剔除（集成断言会暴露），微调顺序为"readability → 占位符处理"不可取（spec 已定序），正确修法是给 img 替换节点加 `data-u2m` 前后文包裹 `<p>`——在 placeholder.mjs 的 `replaceWithHtml` 外层包 `<p>...</p>`。

```bash
git add script/clear_trans_html.mjs test/fixtures test/integration/clear-node.test.mjs
git commit -m "feat: clear_trans_html.mjs Node 工作流（完整性/分派/清理/readability+turndown）"
```

---

### Task 11: pylib/placeholder.py + script/clear_trans_html.py —— Python 工作流

**Files:**
- Create: `script/pylib/placeholder.py`、`script/clear_trans_html.py`
- Test: `test/integration/test_clear_py.py`

**Interfaces:**
- Consumes: Task 5 pylib.browser、Task 7 的 `script/lib/page-*.js`（读文件注入）、Task 3 pylib.env
- Produces:
  - `placeholder.py`: `read_shared_script(name)`、`make_ctx(dirs, context, log)`、`process_mermaid(page, ctx)`、`process_special_elements(page, ctx)`、`process_images(page, ctx)`、`write_manifest(path, entries)`（ctx 字段与 Node 版同构：`dirs/context/log/counters/entries/warnings`，dirs 为 dict）
  - CLI: `clear_trans_html.py <url>` → `python_workflow/`；stdout JSON 同 Node 版字段

- [ ] **Step 1: 写失败测试**

```python
# test/integration/test_clear_py.py
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from pylib.env import url_to_dir_name

REPO = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO / "script" / "clear_trans_html.py"

pytestmark = pytest.mark.integration


def run(tmp_working, url):
    # 继承完整环境（playwright 需要 HOME 等定位浏览器缓存），仅覆盖 working 根
    env = {**os.environ, "U2M_WORKING_ROOT": str(tmp_working)}
    return subprocess.run(
        [sys.executable, str(SCRIPT), url],
        capture_output=True, text=True, timeout=120, env=env,
    )


def wf(tmp_working, url, name="python_workflow"):
    return tmp_working / url_to_dir_name(url) / name


def test_static_article(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/static-article.html")
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout.strip())
    assert payload["status"] == "ok"
    assert payload["images"] == 1
    md = (wf(tmp_working, f"{fixture_server}/static-article.html") / "sketch.md").read_text(encoding="utf-8")
    assert "{{IMG_1}}" in md
    assert "PARA_ONE" in md
    assert "```js" in md
    assert "|名称|值|" in md.replace(" ", "")


def test_complex_elements(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/complex-elements.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/complex-elements.html") / "sketch.md").read_text(encoding="utf-8")
    assert "$$E=mc^2$$" in md
    assert "{{IMG_1}}" in md
    assert "assets/complex/" in md  # passthrough_svg 直替
    manifest = json.loads((wf(tmp_working, f"{fixture_server}/complex-elements.html") / "assets" / "manifest.json").read_text(encoding="utf-8"))
    types = sorted(i["type"] for i in manifest["items"])
    assert types == ["latex", "passthrough_svg", "screenshot", "screenshot", "svg_convert", "svg_convert"]


def test_code_block(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/code-block.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/code-block.html") / "sketch.md").read_text(encoding="utf-8")
    assert "```python" in md          # code_language 回调补齐围栏语言
    assert "复制" not in md
    assert "line-numbers-rows" not in md


def test_mermaid(fixture_server, tmp_working):
    r = run(tmp_working, f"{fixture_server}/mermaid.html")
    assert r.returncode == 0, r.stderr
    md = (wf(tmp_working, f"{fixture_server}/mermaid.html") / "sketch.md").read_text(encoding="utf-8")
    assert "```mermaid" in md


def test_usage_error(tmp_working):
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=30,
                       env={**os.environ, "U2M_WORKING_ROOT": str(tmp_working)})
    assert r.returncode == 2
    assert json.loads(r.stdout.strip())["status"] == "usage_error"
```

- [ ] **Step 2: 运行确认失败**

Run: `uv run pytest test/integration/test_clear_py.py` → FAIL（脚本不存在）

- [ ] **Step 3: 实现 pylib/placeholder.py**

```python
# script/pylib/placeholder.py —— 与 lib/placeholder.mjs 对应；分类/清理逻辑复用 script/lib/page-*.js
import base64
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"

EXT_BY_TYPE = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/avif": "avif",
}


def read_shared_script(name: str) -> str:
    return (LIB_DIR / name).read_text(encoding="utf-8")


def make_ctx(dirs: dict, context, log=print) -> dict:
    return {"dirs": dirs, "context": context, "log": log,
            "counters": {"img": 0, "complex": 0}, "entries": [], "warnings": []}


def write_manifest(manifest_path, entries) -> None:
    Path(manifest_path).write_text(
        json.dumps({"version": 1, "items": entries}, ensure_ascii=False, indent=2), encoding="utf-8")


def _emit(result: dict, code: int):
    print(json.dumps(result, ensure_ascii=False), flush=True)
    raise SystemExit(code)


def process_mermaid(page, ctx) -> int:
    handles = page.query_selector_all("[data-u2m-mermaid-src]")
    for h in handles:
        src = h.get_attribute("data-u2m-mermaid-src") or ""
        if not src.strip():
            continue
        ctx["counters"]["complex"] += 1
        cid = f"COMPLEX_DIV_{ctx['counters']['complex']}"
        esc = src.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        page.evaluate(
            '(el, html) => { const t = document.createElement("template"); t.innerHTML = html; el.replaceWith(...t.content.childNodes); }',
            [h, f'<pre><code class="language-mermaid">{esc}</code></pre>'],
        )
        ctx["entries"].append({"id": cid, "type": "mermaid", "status": "done"})
    return len(handles)


def process_special_elements(page, ctx) -> int:
    classify = read_shared_script("page-classify.js")
    inline = read_shared_script("page-inline.js")
    latex = read_shared_script("page-latex.js")
    dirs = ctx["dirs"]
    processed = 0

    for _ in range(10):  # 合并循环上限
        page.evaluate(f"({classify})()")
        handles = page.query_selector_all("[data-u2m-type]")
        if not handles:
            break
        merged = False
        for h in handles:
            try:
                etype = h.get_attribute("data-u2m-type")
            except Exception:
                continue
            if etype == "same_origin_iframe":
                page.evaluate(
                    '(el) => { const host = document.createElement("div"); const doc = el.contentDocument;'
                    " if (doc && doc.body) { for (const n of Array.from(doc.body.childNodes)) host.appendChild(document.adoptNode(n)); }"
                    " el.replaceWith(host); }", h)
                merged = True
                continue
            ctx["counters"]["complex"] += 1
            cid = f"COMPLEX_DIV_{ctx['counters']['complex']}"
            rel = lambda ext: f"assets/complex/{cid}.{ext}"  # noqa: E731
            try:
                if etype == "screenshot":
                    png = Path(dirs["wf"]) / rel("png")
                    tag = h.evaluate("el => el.tagName")
                    link = ""
                    if tag == "VIDEO":
                        vsrc = h.evaluate('(el) => el.getAttribute("src") || el.currentSrc || ""')
                        if vsrc:
                            link = f'<a href="{vsrc}">（视频源：{vsrc}）</a>'
                    h.screenshot(path=str(png))
                    _replace_with_html(page, h, f'<img src="{rel("png")}" alt="{cid}">{link}')
                    ctx["entries"].append({"id": cid, "type": etype, "final": rel("png"), "status": "done"})
                elif etype == "passthrough_svg":
                    svg = h.evaluate(
                        '(el) => { const c = el.cloneNode(true); c.querySelectorAll("script").forEach((s) => s.remove());'
                        ' [c, ...c.querySelectorAll("*")].forEach((n) => { for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name); });'
                        ' c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return c.outerHTML; }')
                    (Path(dirs["wf"]) / rel("svg")).write_text(svg, encoding="utf-8")
                    _replace_with_html(page, h, f'<img src="{rel("svg")}" alt="{cid}">')
                    ctx["entries"].append({"id": cid, "type": etype, "final": rel("svg"), "status": "done"})
                elif etype == "svg_convert":
                    draft = h.evaluate(f"({inline})")
                    (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                    _replace_with_text(page, h, "{{" + cid + "}}")
                    ctx["entries"].append({"id": cid, "type": etype, "draft": f"assets/draft/{cid}.html", "status": "pending"})
                elif etype == "latex":
                    tex = h.evaluate(f"({latex})")
                    if tex:
                        _replace_with_text(page, h, f"$${tex}$$")
                        ctx["entries"].append({"id": cid, "type": etype, "status": "done"})
                    else:
                        draft = h.evaluate("(el) => el.outerHTML")
                        (Path(dirs["draft"]) / f"{cid}.html").write_text(draft, encoding="utf-8")
                        _replace_with_text(page, h, "{{" + cid + "}}")
                        ctx["entries"].append({"id": cid, "type": etype, "draft": f"assets/draft/{cid}.html", "status": "pending"})
                processed += 1
            except Exception as e:  # noqa: BLE001
                ctx["warnings"].append(f"特殊元素处理失败({etype}): {e}")
                try:
                    h.evaluate('(el) => el.removeAttribute("data-u2m-type")')
                except Exception:
                    pass
        if not merged:
            break
    return processed


def process_images(page, ctx) -> int:
    jobs = []
    for h in page.query_selector_all("img"):
        src = h.get_attribute("src")
        if src:
            ctx["counters"]["img"] += 1
            jobs.append((h, src, ctx["counters"]["img"]))

    def download(job):
        h, src, n = job
        try:
            if src.startswith("data:"):
                m = re.match(r"^data:([^;,]+)(;base64)?,(.*)$", src, re.S)
                if not m:
                    raise ValueError("无法解析 data URL")
                ctype = m.group(1)
                buf = base64.b64decode(m.group(3)) if m.group(2) else unquote(m.group(3))
            else:
                res = ctx["context"].request.get(src)
                if not res.ok:
                    raise ValueError(f"HTTP {res.status}")
                ctype = (res.headers.get("content-type") or "").split(";")[0]
                buf = res.body()
            ext = EXT_BY_TYPE.get(ctype, "png")
            (Path(ctx["dirs"]["images"]) / f"IMG_{n}.{ext}").write_bytes(buf)
            _replace_with_text(page, h, f"{{{{IMG_{n}}}}}")
            return True
        except Exception as e:  # noqa: BLE001
            ctx["warnings"].append(f"图片下载失败保留原 URL: {src} ({e})")
            return False

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(download, jobs))
    return sum(1 for r in results if r)


def _replace_with_text(page, handle, text):
    page.evaluate('(el, text) => el.replaceWith(document.createTextNode(text))', [handle, text])


def _replace_with_html(page, handle, html):
    page.evaluate('(el, html) => { const t = document.createElement("template"); t.innerHTML = html; el.replaceWith(...t.content.childNodes); }', [handle, html])
```

- [ ] **Step 4: 实现 script/clear_trans_html.py**

```python
#!/usr/bin/env python3
"""clear_trans_html.py <url> —— Python 工作流：完整性→特殊元素→清理→readability-lxml→markdownify→sketch.md"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from markdownify import MarkdownConverter  # noqa: E402
from readability import Document  # noqa: E402

from pylib import env, placeholder  # noqa: E402
from pylib.browser import open_page  # noqa: E402


def log_err(*a):
    print(*a, file=sys.stderr)


def emit(result: dict, code: int):
    print(json.dumps(result, ensure_ascii=False), flush=True)
    sys.exit(code)


def usage(msg: str):
    emit({"status": "usage_error", "reason": msg}, 2)


def progressive_scroll(page):
    page.evaluate("""async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 150));
      const h = document.documentElement.scrollHeight;
      if (h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
  }""")


def wait_for_dom_stable(page, stable_ms=1000, max_ms=15000):
    import time
    t0 = time.time()
    last, last_change = -1, time.time()
    while time.time() - t0 < max_ms:
        n = page.evaluate("() => document.getElementsByTagName('*').length")
        if n != last:
            last, last_change = n, time.time()
        elif time.time() - last_change >= stable_ms:
            return
        page.wait_for_timeout(200)


def code_language(tag):
    """markdownify 回调：从 <code class="language-x"> 补齐围栏语言标注（与 Node 工作流形态一致）。"""
    for cls in tag.get("class") or []:
        if cls.startswith("language-"):
            return cls[len("language-"):]
    return ""


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        usage("用法: clear_trans_html.py <url>")
    url = sys.argv[1]
    dirs = env.ensure_workflow_dirs(url, "python_workflow")
    warnings = []

    page_init = placeholder.read_shared_script("page-init.js")
    page_merge = placeholder.read_shared_script("page-merge.js")
    page_clean = placeholder.read_shared_script("page-clean.js")

    session = open_page(url, viewport={"width": 1280, "height": 3000},
                        init_scripts=[page_init],
                        storage_state_path=env.storage_state_path(), log=log_err)
    try:
        page = session.page
        progressive_scroll(page)
        wait_for_dom_stable(page)

        ctx = placeholder.make_ctx(dirs, session.context, log_err)
        page.evaluate(f"({page_merge})()")
        placeholder.process_mermaid(page, ctx)
        placeholder.process_special_elements(page, ctx)
        placeholder.process_images(page, ctx)
        page.evaluate(f"({page_clean})()")

        html = page.content()
        doc = Document(html)
        content = doc.summary(html_partial=True)
        if not content or len(content.strip()) < 20:
            warnings.append("readability-lxml 未能解析主体，回退 body 全文")
            content = page.evaluate("() => document.body.innerHTML")

        md = MarkdownConverter(heading_style="ATX", bullets="-", code_language=code_language).convert(content)
        md = md.strip() + "\n"

        (dirs["wf"] / "sketch.md").write_text(md, encoding="utf-8")
        placeholder.write_manifest(dirs["manifest"], ctx["entries"])
        payload = {
            "status": "ok",
            "sketch": str(dirs["wf"] / "sketch.md"),
            "images": ctx["counters"]["img"],
            "complex": len(ctx["entries"]),
            "warnings": warnings + ctx["warnings"],
        }
    finally:
        session.close()  # 先关浏览器再输出退出（emit 内 sys.exit）
    emit(payload, 0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        emit({"status": "error", "reason": str(e)}, 1)
```

- [ ] **Step 5: 运行确认通过 + Commit**

Run: `uv run pytest test/integration/test_clear_py.py` → PASS。若 `code_language` 回调不被当前 markdownify 版本支持（`TypeError`），改用等价后处理：转换前用正则提取 `html` 中 `<code class="language-(\w[\w+-]*)">` 顺序表 `langs`，转换后把无名围栏按序补语言：

```python
langs = re.findall(r'<code class="language-([\w+-]+)"', content)
parts = md.split("```\n")
for i, lang in enumerate(langs):
    if i + 1 < len(parts) and not parts[i].endswith("`"):
        parts[i] = parts[i] + f"```{lang}"
md = "```\n".join(parts)
```

（两种实现择一入库，测试同一断言。）

```bash
git add script/pylib/placeholder.py script/clear_trans_html.py test/integration/test_clear_py.py
git commit -m "feat: clear_trans_html.py Python 工作流（readability-lxml + markdownify，复用 page-*.js）"
```

---

### Task 12: script/render_markdown.mjs —— 双 Tab 择优

**Files:**
- Create: `script/render_markdown.mjs`
- Test: `test/integration/render.test.mjs`

**Interfaces:**
- Consumes: Task 2 contract、Task 3 env
- Produces: CLI `render_markdown.mjs <url-dir> [--port 0] [--timeout 120000] [--open-timeout 5000] [--no-open]`；stdout `{"status":"selected","source":"node_workflow|python_workflow","path":"..."} / {"status":"timeout"} / {"status":"open_failed","url":...}`；选择后复制到 `<url-dir>/result.md`；缺失 result.md 降级 sketch.md 并标注 "⚠️ 初稿"，`{{IMG_n}}` 由服务端扫描 `assets/images/IMG_n.*` 解析为本地图片，未处置 `{{COMPLEX_DIV_n}}` 原样显示为占位标记

- [ ] **Step 1: 写失败测试**

```js
// test/integration/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript } from '../helpers/run-script.mjs';
import { writePixelPng } from '../helpers/assets.mjs';

const script = path.resolve('script/render_markdown.mjs');

function prepWorking() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-render-'));
  const dir = path.join(root, 'example_com_page');
  for (const wf of ['node_workflow', 'python_workflow']) {
    fs.mkdirSync(path.join(dir, wf, 'assets/images'), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'node_workflow', 'result.md'),
    '# Node 版\n\n![IMG_1](assets/images/IMG_1.png)\n\nNODE_RESULT_BODY');
  fs.writeFileSync(path.join(dir, 'python_workflow', 'result.md'), '# Python 版\n\nPYTHON_RESULT_BODY');
  fs.copyFileSync('test/fixtures/pixel.png', path.join(dir, 'node_workflow', 'assets/images/IMG_1.png'));
  return { root, dir };
}

test('选择 node_workflow：复制 result.md + stdout selected + 退出 0', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((html) => {
        assert.match(html, /Node 版/); assert.match(html, /Python 版/);
        return fetch(`${m[1]}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'node_workflow' }) });
      }).catch(() => {});
    } });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'selected');
  assert.equal(json.source, 'node_workflow');
  assert.ok(fs.existsSync(path.join(dir, 'result.md')));
  assert.match(fs.readFileSync(path.join(dir, 'result.md'), 'utf8'), /NODE_RESULT_BODY/);
});

test('降级 sketch.md：⚠️ 初稿标注 + {{IMG_n}} 还原（未点击 → 最终 timeout 属预期）', async () => {
  const { root, dir } = prepWorking();
  fs.rmSync(path.join(dir, 'node_workflow', 'result.md'));
  fs.rmSync(path.join(dir, 'python_workflow', 'result.md'));
  for (const wf of ['node_workflow', 'python_workflow']) {
    fs.writeFileSync(path.join(dir, wf, 'sketch.md'), `# 初稿 ${wf}\n\n{{IMG_1}}\n\n{{COMPLEX_DIV_9}}\n\nSKETCH_${wf}`);
  }
  let pageHtml = '', mdHtml = '';
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((t) => {
        pageHtml = t;
        return fetch(`${m[1]}/md/node_workflow`);
      }).then((res) => res.text()).then((t) => { mdHtml = t; }).catch(() => {});
    } });
  assert.equal(r.code, 1); // 只访问不点击 → 点击窗口超时
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.match(pageHtml, /⚠️ 初稿/);
  assert.match(mdHtml, /<img[^>]+IMG_1\.png/);   // 占位符已还原为本地图片
  assert.match(mdHtml, /\{\{COMPLEX_DIV_9\}\}/); // 未处置占位保留为标记
});

test('点击窗口超时：timeout 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '1500', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (m) fetch(m[1]).catch(() => {}); // 只访问不点击 → 点击窗口超时
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
});

test('打开失败：open-timeout 内无请求 → open_failed 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--open-timeout', '1200', '--timeout', '60000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000 });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'open_failed');
});
```

（`run-script.mjs` 的 `onStderr` 已在 Task 9 加入。）

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/integration/render.test.mjs` → FAIL

- [ ] **Step 3: 实现**

```js
#!/usr/bin/env node
// render_markdown.mjs <url-dir> [--port 0] [--timeout 120000] [--open-timeout 5000] [--no-open]
// 双 Tab 渲染两份 result.md（缺失降级 sketch.md 标注初稿），人工选择后复制到 <url-dir>/result.md。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import MarkdownIt from 'markdown-it';
import { emit, log } from '../lib/contract.mjs';
import { workingRoot } from '../lib/env.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'no-open') { out[key] = true; continue; } // 布尔标志无值
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { emit({ status: 'usage_error', reason: `参数 --${key} 缺少值` }, 2); }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv);
const rawDir = args._[0];
if (!rawDir) emit({ status: 'usage_error', reason: '用法: render_markdown.mjs <url-dir> [--port n] [--timeout ms] [--open-timeout ms] [--no-open]' }, 2);
const dir = path.isAbsolute(rawDir) ? rawDir : path.join(workingRoot(), rawDir);
if (!fs.existsSync(dir)) emit({ status: 'error', reason: `目录不存在: ${dir}` }, 1);
const port = Number(args.port ?? 0);
const timeoutMs = Number(args.timeout ?? 120000);
const openTimeoutMs = Number(args['open-timeout'] ?? 5000);

const WORKFLOWS = ['node_workflow', 'python_workflow'];
const SOURCES = WORKFLOWS.map((wf) => {
  const base = path.join(dir, wf);
  const resultMd = path.join(base, 'result.md');
  const sketchMd = path.join(base, 'sketch.md');
  const file = fs.existsSync(resultMd) ? resultMd : (fs.existsSync(sketchMd) ? sketchMd : null);
  return { wf, file, draft: !fs.existsSync(resultMd) && !!file, imagesDir: path.join(base, 'assets', 'images') };
}).filter((s) => s.file);

if (SOURCES.length === 0) emit({ status: 'error', reason: '两个 workflow 均无 result.md/sketch.md' }, 1);

const md = new MarkdownIt({ html: true });

/** 初稿模式：{{IMG_n}} → 本地图片；{{COMPLEX_DIV_n}} 原样保留（占位标记） */
function resolveDraftPlaceholders(text, imagesDir, wf) {
  return text.replace(/\{\{IMG_(\d+)\}\}/g, (m, n) => {
    try {
      const hit = fs.readdirSync(imagesDir).find((f) => f.startsWith(`IMG_${n}.`));
      return hit ? `![IMG_${n}](/file/${wf}/assets/images/${hit})` : m;
    } catch { return m; }
  });
}

function renderSource(src) {
  let text = fs.readFileSync(src.file, 'utf8');
  if (src.draft) text = resolveDraftPlaceholders(text, src.imagesDir, src.wf);
  let html = md.render(text);
  // 相对图片引用 → /file/<wf>/...
  html = html.replace(/(<img[^>]+src=")(?!https?:|\/\/|data:|#|\/file\/)([^"]+)"/g, `$1/file/${src.wf}/$2"`);
  return html;
}

const RENDERED = Object.fromEntries(SOURCES.map((s) => [s.wf, renderSource(s)]));

function pageHtml(remainingMs) {
  const tabs = SOURCES.map((s, i) => `
    <button class="tab${i === 0 ? ' active' : ''}" data-wf="${s.wf}">${s.wf === 'node_workflow' ? 'Node 版' : 'Python 版'}${s.draft ? ' ⚠️ 初稿' : ''}</button>`).join('');
  const panes = SOURCES.map((s, i) => `
    <section class="pane${i === 0 ? '' : ' hidden'}" data-wf="${s.wf}">
      <div class="content md">${RENDERED[s.wf]}</div>
      <button class="pick" data-wf="${s.wf}">✅ 选这个</button>
    </section>`).join('');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>选择 Markdown</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #fafafa; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 8px 16px; display: flex; gap: 8px; align-items: center; z-index: 1; }
  .tab { padding: 8px 16px; border: 1px solid #ccc; border-radius: 8px; background: #fff; cursor: pointer; }
  .tab.active { background: #e8f0fe; border-color: #4a7dd6; }
  #countdown { color: #888; margin-left: auto; font-size: 13px; }
  .pane { padding: 16px; max-width: 52em; margin: 0 auto; }
  .hidden { display: none; }
  .content { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; padding: 24px; overflow-x: auto; }
  .content img { max-width: 100%; }
  .pick { display: block; margin: 16px auto; padding: 10px 32px; font-size: 15px; border-radius: 8px;
          border: 1px solid #4a7dd6; background: #e8f0fe; cursor: pointer; }
  #done { text-align: center; color: #2e7d32; margin-top: 24px; white-space: pre-line; }
</style>
</head>
<body>
<header>${tabs}<span id="countdown"></span></header>
${panes}
<p id="done"></p>
<script>
  const REMAINING_MS = ${remainingMs};
  const deadline = Date.now() + REMAINING_MS;
  const tick = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    document.getElementById('countdown').textContent = left > 0 ? '剩余 ' + Math.ceil(left / 1000) + ' 秒' : '';
    if (left === 0) { clearInterval(tick); document.getElementById('done').textContent = '已超时，可关闭此页'; disableAll(); }
  }, 250);
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.wf !== b.dataset.wf));
  });
  function disableAll() { document.querySelectorAll('.pick').forEach((b) => b.disabled = true); }
  document.querySelectorAll('.pick').forEach((b) => b.onclick = async () => {
    try {
      const res = await fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: b.dataset.wf }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      document.getElementById('done').textContent = '已提交，可以关闭此页';
    } catch { document.getElementById('done').textContent = '服务已关闭（可能已超时），可关闭此页'; }
    disableAll();
  });
</script>
</body>
</html>`;
}

// ── 两阶段超时（对齐 wait-click.mjs）──
const t0 = Date.now();
const url = () => `http://127.0.0.1:${server.address().port}`;
let settled = null;
let visitedAt = null;
let openTimer = null;
let clickTimer = null;

function finish(result, code) {
  if (settled) return;
  settled = result;
  clearTimeout(openTimer); clearTimeout(clickTimer);
  server.close(); server.closeAllConnections();
  emit(result, code);
}

const server = http.createServer((req, res) => {
  if (visitedAt === null) { // 首个请求 = 页面已打开，进入点击窗口
    visitedAt = Date.now();
    clearTimeout(openTimer);
    clickTimer = setTimeout(() => finish({ status: 'timeout' }, 1), timeoutMs);
  }
  const safeFile = (wf, rel) => {
    const full = path.resolve(path.join(dir, wf, rel));
    if (!full.startsWith(path.resolve(path.join(dir, wf)))) return null;
    return full;
  };
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(pageHtml(Math.max(0, timeoutMs)));
    return;
  }
  const mdMatch = req.url?.match(/^\/md\/(node_workflow|python_workflow)$/);
  if (req.method === 'GET' && mdMatch && RENDERED[mdMatch[1]] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(RENDERED[mdMatch[1]]);
    return;
  }
  const fileMatch = req.url?.match(/^\/file\/(node_workflow|python_workflow)\/(.+)$/);
  if (req.method === 'GET' && fileMatch) {
    const full = safeFile(fileMatch[1], decodeURIComponent(fileMatch[2]));
    if (full && fs.existsSync(full)) {
      const ext = path.extname(full);
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(fs.readFileSync(full));
      return;
    }
    res.writeHead(404); res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/select') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let source = null;
      try { source = JSON.parse(body).source; } catch { /* 400 */ }
      if (!WORKFLOWS.includes(source)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid source' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      const src = SOURCES.find((s) => s.wf === source);
      const dest = path.join(dir, 'result.md');
      fs.copyFileSync(src.file, dest);
      setTimeout(() => finish({ status: 'selected', source, path: dest, elapsedMs: Date.now() - t0 }, 0), 150);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.on('error', (e) => { console.error(`[render] 服务启动失败: ${e.message}`); process.exit(1); });

server.listen(port, '127.0.0.1', () => {
  log(`[render] 页面: ${url()}（${SOURCES.length} 个 Tab，打开自检 ${Math.round(openTimeoutMs / 1000)}s，点击窗口 ${Math.round(timeoutMs / 1000)}s）`);
  if (!args['no-open']) {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url()] : [url()];
    execFile(cmd, cmdArgs, () => {});
  }
  openTimer = setTimeout(() => {
    log(`[render] 打开失败：${openTimeoutMs}ms 内浏览器没有加载页面；可手动访问 ${url()}`);
    finish({ status: 'open_failed', url: url() }, 1);
  }, openTimeoutMs);
});
```

- [ ] **Step 4: 运行确认通过 + Commit**

Run: `node --test test/integration/render.test.mjs` → PASS（四条）；`pnpm test:all` 全绿回归

```bash
git add script/render_markdown.mjs test/integration/render.test.mjs
git commit -m "feat: render_markdown.mjs 双 Tab 择优（markdown-it 本地渲染、初稿降级、两阶段超时）"
```

---

### Task 13: SKILL.md —— 操作手册

**Files:**
- Create: `SKILL.md`（项目根）
- Modify: `README.md`（进度表更新为各阶段已完成）

**Interfaces:**
- Consumes: Task 8-12 的四个 CLI（命令行与 status 枚举即接口）
- Produces: Skill 主体文件；frontmatter 与 README 一致

- [ ] **Step 1: 写 SKILL.md**

````markdown
---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用 / 不使用

- 使用：把单个 URL 的正文转为 Markdown 文件
- 不使用：批量爬取、站点镜像；登录态存于 IndexedDB / Service Worker 的站点

## 操作手册（步骤 0-5）

本技能目录为 `<skill-root>`（SKILL.md 所在目录）。以下 `<url>` 均指用户给定的完整 URL。

### 步骤 0 · 初始化环境（仅首次或环境变更时）

```bash
bash <skill-root>/script/init.sh
```

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 1 |
| `error` | **终止全部流程**，把 `reason` 反馈给用户 |

stderr 中的"警告"不阻断，可忽略。

### 步骤 1 · 打开 URL，判断/完成登录

```bash
node <skill-root>/script/login_url.mjs <url> [--timeout 300000]
```

脚本会自动弹出本地 viewer 页面供人工登录（如需要）。

| stdout status | 动作 |
|---|---|
| `logged_in` | 进入步骤 2 |
| `login_done` | 进入步骤 2 |
| `timeout` / `aborted` | 询问用户是否重试登录；重试则再次运行本命令 |
| `error` | 把 `reason` 反馈给用户并终止 |

### 步骤 2 · 双工作流清洗转换（可并行）

```bash
node <skill-root>/script/clear_trans_html.mjs <url>
```

```bash
cd <skill-root> && .venv/bin/python script/clear_trans_html.py <url>
# 若 .venv 不存在（例如环境用 uv 托管）：uv run python script/clear_trans_html.py <url>
```

两条命令互不依赖，可并行执行、独立退出码。

| stdout status | 动作 |
|---|---|
| `ok` | 记录 `sketch` 路径；两个都成功 → 步骤 3 |
| `error`（单个） | 不影响另一条；按实际成功的数量继续（只有一个成功则后续"单选"） |
| 两条都 `error` | 把 reason 反馈给用户并终止 |

产物：`<skill-root>/working/<url-dir>/<node_workflow|python_workflow>/sketch.md` 与 `assets/`。

### 步骤 3 · 你负责转换特殊 DOM 元素

读 `working/<url-dir>/node_workflow/assets/manifest.json` 与 `python_workflow/assets/manifest.json` 中 `status: "pending"` 的条目，按 `type` 分派（两个 workflow 各处理各的）：

| type | 处置 |
|---|---|
| `svg_convert` | 读 `draft` 路径的 HTML（已内联计算样式），生成**语义等价的 SVG**，存到同 workflow 的 `assets/complex/COMPLEX_DIV_n.svg`；把对应 `sketch.md` 中的 `{{COMPLEX_DIV_n}}` 替换为 `![COMPLEX_DIV_n](assets/complex/COMPLEX_DIV_n.svg)`；完成后把 manifest 该条 `status` 改为 `done` |
| `latex` | 读 `draft` 的公式渲染 DOM，反读 LaTeX 源码，把 `sketch.md` 中 `{{COMPLEX_DIV_n}}` 内联替换为 `$$公式$$`；manifest 改 `done` |

`passthrough_svg` / `screenshot` / `mermaid` / 已直出的 `latex` 均为 `status: "done"`，**不经你处理**（脚本已在 sketch.md 中替换完毕）。

### 步骤 4 · 你负责语义去噪

对每份处理完的 sketch.md 使用以下提示词清洗，写入同目录 `result.md`：

> 你是一个网页内容清洗专家。以下是两份网页转换的 Markdown 初稿。请去除其中的广告、推荐阅读、版权声明等无关内容，只保留核心正文。同时，请检查并修复其中的 Markdown 表格格式，确保其符合标准。去除多余的换行，空格。直接输出清洗后的 Markdown。**注意**：不要添加/修改/删除主体文本内容和原义。

清洗时把 `{{IMG_n}}` 替换为 `![IMG_n](assets/images/IMG_n.<ext>)`——扩展名以该 workflow `assets/images/` 下实际文件为准。若只有一个 workflow 产出，则"两份"按一份处理。

### 步骤 5 · 人工选择 Markdown

```bash
node <skill-root>/script/render_markdown.mjs <url-dir> [--timeout 120000]
```

`<url-dir>` 为 `working/` 下的 URL 目录名。浏览器双 Tab 打开，提醒用户人工选择。

| stdout status | 动作 |
|---|---|
| `selected` | 完成。最终文件在 `path` 字段（`working/<url-dir>/result.md`），报告给用户 |
| `timeout` / `open_failed` | 告知用户可重跑本命令 |
| `error` | 把 `reason` 反馈给用户 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `login_url` 判定已登录但页面仍是登录墙 | 手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| 图片下载失败（warnings 中有"保留原 URL"） | 正常降级：Markdown 保留原图链接，不需处理 |
| sketch.md 中残留 `{{COMPLEX_DIV_n}}` 且 manifest 无对应项 | 该元素被当普通 DOM 转成了文本，人工检查是否需要补图 |
| 双工作流其一失败 | 用另一份继续步骤 3-5（单选模式） |
````

- [ ] **Step 2: 更新 README 进度表**

`README.md` 末尾进度表按实际完成情况更新（项目结构 / init.sh / login_url.mjs / clear_trans_html / render_markdown / SKILL.md → 已完成）。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm test:all && uv run pytest` → 全绿（SKILL.md 不影响测试，回归确认）

```bash
git add SKILL.md README.md
git commit -m "docs: SKILL.md 操作手册（步骤 0-5、status 分支决策表、错误处理）"
```

---

### Task 14: SKILL.md baseline 测试

**Files:**
- Create: `docs/superpowers/plans/baseline-notes.md`（记录两次运行的观察，供审阅）

**Interfaces:**
- Consumes: Task 13 SKILL.md、Task 8-12 脚本、夹具服务器

- [ ] **Step 1: 准备夹具环境**

```bash
node -e "import('./test/helpers/fixture-server.mjs').then(async m => { const fx = await m.startFixtureServer(); console.log('FIXTURE_URL=' + fx.url + '/static-article.html'); await new Promise(r => setTimeout(r, 1000000)); })" &
```

记下输出的 `FIXTURE_URL`。执行会话（或其子代理）在同一仓库工作目录运行。

- [ ] **Step 2: 无 SKILL.md 基线**

用 Agent 工具派发 general-purpose 子代理，提示词：

> 你在一个工具仓库中工作。任务：把 URL `<FIXTURE_URL>` 的主体内容转换成一个干净的 Markdown 文件，保存到合适的位置。仓库里的 `script/` 目录有一些脚本可以帮你。记录你每一步的决策与遇到的困难。

不给它 SKILL.md 内容。观察并记录失败模式（不知道从哪个脚本开始 / 不了解输出契约 / 不知道 manifest 怎么用 / 产物位置错误等）到 `baseline-notes.md`。

- [ ] **Step 3: 有 SKILL.md 复测**

再次派发子代理，提示词：

> 你在一个工具仓库中工作。请先阅读仓库根目录的 `SKILL.md` 并严格按其操作手册执行。任务：把 URL `<FIXTURE_URL>` 转成 Markdown。

判定标准（全部满足 = 通过）：

1. 按顺序执行步骤 0→5，每步依据 stdout JSON 的 `status` 做分支
2. 产物落在 `working/<url-dir>/result.md`
3. 步骤 3 正确处理 manifest 的 pending 项、步骤 4 用了指定提示词与 `{{IMG_n}}` 替换规则
4. 遇到 warnings 不误判为失败

- [ ] **Step 4: 差距回写**

若有不满足项：修改 SKILL.md 对应小节（补决策表行/命令示例），重跑 Step 3 直至通过。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/baseline-notes.md SKILL.md
git commit -m "test: SKILL.md baseline 测试（无/有手册子代理对比，差距回写）"
```

---

### Task 15: 收尾 —— 冒烟清单与交付结构

**Files:**
- Create: `test/smoke/SMOKE.md`
- Modify: `README.md`（进度表全绿）、`working/.gitkeep` 确认存在
- Test: 全量回归

- [ ] **Step 1: 写 SMOKE.md**

```markdown
# 真实 URL 手动冒烟清单（不入自动测试）

前置：`bash script/init.sh` 输出 ok。

## 1. 真实静态文章页

1. `node script/login_url.mjs <文章URL>` → 期望 `logged_in`
2. 并行运行 `node script/clear_trans_html.mjs <文章URL>` 与 `uv run python script/clear_trans_html.py <文章URL>`
3. 人工执行 SKILL.md 步骤 3/4（LLM 步骤）
4. `node script/render_markdown.mjs <url-dir>` → 人工选择 → `selected`
5. 检查 `working/<url-dir>/result.md`：正文完整、无导航/广告、图片引用有效

记录：URL / 截图 / 发现的问题。

## 2. 真实登录墙页

1. `node script/login_url.mjs <登录页URL>` → viewer 弹出
2. 在 viewer 中完成真实登录 → 点「✅ 登录完成」→ 期望 `login_done`
3. 重跑同 URL → 期望 `logged_in`（storageState 复用）
4. 后续同上 2-5

记录：站点 / 登录方式（账密/验证码/SSO）/ Screencast 操控是否顺畅。

## 3. 特殊元素页（含 canvas/图表/公式/Mermaid 的公开页）

验证 manifest 分派与步骤 3 产物（SVG 语义等价性人工评审）。
```

- [ ] **Step 2: 全量回归**

Run: `pnpm test:all && uv run pytest test/unit test/integration` → 全绿

- [ ] **Step 3: 交付结构核对**

对照 README「Skill 文件夹结构」：

```bash
ls SKILL.md script/ working/.gitkeep README.md package.json pnpm-lock.yaml uv.lock pyproject.toml
```

`.temp/` 与 `docs/` 不属于交付物（留在仓库但不入 Skill 分发目录）。

- [ ] **Step 4: README 进度表终态 + Commit**

```bash
git add test/smoke/SMOKE.md README.md
git commit -m "chore: 冒烟清单与交付结构收尾（进度表全绿）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§2 架构（T1/T7 文件结构一致）、§3 契约（T2+各入口）、§4 目录与 storageState（T3/T4）、§5 数据流（T9→T10/11→T12 对应步骤 1/2/5；步骤 3/4 为 LLM 步骤，落在 SKILL.md T13）、§6.1（T8）、§6.2（T9）、§6.3（T7/T10/T11）、§6.4（T12）、§7 错误处理（各入口 catch → emitError；goto 重试 T5）、§8 测试策略（T1 helpers + 各任务夹具/单测/集成 + T15 冒烟；含启发式判定专测——complex-elements 的 #viz 无选择器特征）、§9（T13/T14）、§10 阶段表（任务 1-15 映射 9 阶段）、§11 验收（T15 Step 2 + T14 + 冒烟）、§12 已知限制（SKILL.md「何时不使用」已述）——无缺口
- **占位符扫描**：Task 11 markdownify `code_language` 给出了等价后处理备选（两者择一入库，同一断言约束）；其余无 TBD/TODO/"稍后实现"
- **类型一致性**：`makeCtx` 字段（dirs/counters/entries/warnings/log/context）Node/Python 同构；manifest 条目 `{id,type,status,draft?,final?}` 各任务一致（含双 workflow 的 6 项断言）；`emit(result, code)`、`usage_error`、`{{IMG_n}}`/`{{COMPLEX_DIV_n}}` 语义全篇一致；`urlToDirName`/`url_to_dir_name` 双语言同一向量组约束
- **复查修正**（写入后自查并已就地修复）：媒体拦截测试改用 `<video>`+`requestfailed`（`fetch()` 的 resourceType 不是 media，拦不到）；检测器标题关键词只匹配 `<title>`（防正文"已登录"误命中）；`--no-open` 布尔标志在两个 CLI 的 parseArgs 中特判；所有脚本 exit 前先关浏览器/viewer（防孤儿 chromium）；Python 子进程测试环境继承 `os.environ`（playwright 需 HOME 定位浏览器缓存）；pyproject 改用 `tool.uv.package=false` 免打包；SKILL.md 的 Python 命令改为合法 shell 写法
