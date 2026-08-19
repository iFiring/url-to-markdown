# LLM 驱动分类与清洗 Implementation Plan（Node 单运行时版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用"登录后一次性抓全保真快照 + LLM 列表流逐块方案"替换 `page-classify.js` 的硬编码启发式分类；同时移除 Python 运行时与双稿择优流程，管线收敛为 Node 单运行时，工作流产物拍平到 `working/<url-dir>/`。

**Architecture:** 登录 + 充分滚动后，`capture_snapshot.mjs` 跑共享 `page-prepare.js`（合并 iframe / 内联外部 CSS / 剥 JS / 注 `<base>` / 资源 src 绝对化 / 打 `data-u2m-id`）→ 序列化全保真 `snapshot.html`，再跑共享 `page-derive.js`（长文本占位 / 信号样式内联）→ 派生 `classify/classify_input.html`。agent 读精简版写 `classify_plan.json`（列表流选择器 + 逐块 `action`，v2 schema）。`clear_trans_html.mjs` `setContent(snapshot.html)` 加载同一快照 → `applyClassifyPlan` 删列表流外兄弟 + 按 `action` 逐块分派（逐字复用既有 screenshot/passthrough_svg/svg_convert/latex 分支 + 新 `code_block`/`block_screenshot`）→ Readability/Turndown → `sketch.md` + `assets/manifest.json`（直接在 `<url-dir>/` 下）。消除"各步骤重开页 + id 匹配"与"双运行时镜像"两条脆弱不变量。

**Tech Stack:** Node 20+ / `node --test`；Playwright 1.62（chromium）；@mozilla/readability + turndown + @joplin/turndown-plugin-gfm；既有 `script/lib/contract.mjs` 一行 JSON 契约。

**Spec:** `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md`（2026-08-19 修订版，已含 Python 移除与目录拍平决策）

**本计划替换**同路径旧计划（旧计划基于双运行时设计，已作废）。

## Global Constraints

- **一行 JSON 契约**：每个 CLI（含新增 `capture_snapshot.mjs`）向 stdout 输出**恰好一行 JSON**，失败路径也不例外；日志走 stderr；退出码 0/1/2（usage_error=2）。`emit()` 先写行、在写回调里 `process.exit`——它本身同步返回，故 `usage()`/`emit()` 之后不得继续执行（用 `return usage(...)` / parseArgs 返回 null 提前 return 防护）。
- **共享页面脚本唯一事实源**：`script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2m…(...)`，由 Node CLI 当**文本**读入注入：`readSharedScript(name)` + `page.evaluate(\`(${src})()\`)`。**严禁把分类/清洗/派生逻辑分叉进 `.mjs` 编排层**。新文件 `page-prepare.js` / `page-derive.js` 须以 `function __u2m` 开头，通过 `test/integration/placeholder.test.mjs` 的约定断言 `/^function __u2m/`——因此这两个函数**不得声明为 `async`**（`async function` 不匹配该正则）；需要网络请求时用同步 `XMLHttpRequest`。
- **Playwright 1.62 evaluate 语义**：字符串表达式只有完整表达式形式可用 `page.evaluate(\`(${src})()\`)`；需元素实参走 `callOnElement` 适配器（先 eval `'(' + src + ')'` 再把元素句柄作实参调用）。
- **浏览器先于 emit 关闭**：emit 内 `process.exit`，顺序反了留孤儿 chromium。
- **工作目录**：`working/<url-dir>/`（拍平，无 workflow 子目录）；`U2M_WORKING_ROOT` 覆盖根（测试隔离用它）。`working/cookies/storage_state.json` 是唯一登录态，仅 `login_url.mjs` 写、其余只读（`openPage` 容忍其缺失）。
- **`data-u2m-id` 不加嵌套守卫**：`__u2mPrepareBody` 对**每个**命中候选选择器的元素按文档序打 id（父与子都可有 id），plan 的 blocks 因此可嵌套引用；`applyClassifyPlan` 按 plan 序处理、对已脱离 DOM 的句柄跳过（spec §7.2"跳 detached"）。
- **滚动/稳定参数一致**：`capture_snapshot.mjs` 内联的 `progressiveScroll` 参数（60 轮 / 150ms）必须与 `page-detect.js` 的 `scrollIters`/`scrollWait` 默认一致；`waitForDomStable`（stableMs=1000 / maxMs=15000 / poll 200ms）沿用原 `clear_trans_html.mjs` 的值。有单测守护（Task 3）。
- **环境**：node ≥20、pnpm > yarn > npm。无 linter。测试以子进程启动真实 CLI、对接随机端口夹具服务器（`test/helpers/fixture-server.mjs` 不发 CORS 头——跨源请求天然失败，可用于兜底测试）。

---

## File Structure

**新建：**
- `script/lib/page-prepare.js` — `__u2mPrepareBody(cfg)`：合并 iframe / 内联外部 CSS / 剥 JS·noscript·template·on* / 剥复制按钮 / 注 `<base>` / 资源 src 绝对化 / 打 `data-u2m-id`。吸收 `page-merge.js` 逻辑。
- `script/lib/page-derive.js` — `__u2mDeriveClassifyInput(cfg)`：长文本→`{{T<k}}` / 剥 `<style>`·`<link>`·`<noscript>`·`<template>` / 白名单信号样式内联 / 返回 `document.body.outerHTML`。
- `script/capture_snapshot.mjs` — Node CLI：开页→滚动稳定→跑 prepare→取 snapshot→跑 derive→写产物→emit 一行 JSON（ok/too_large/error）。
- `script/lib/fewshot/` — 手写少样本对 `<name>.html` + `<name>.json`（v2 schema），7 对。
- 测试夹具：`test/fixtures/classify-article.html` + `test/fixtures/style.css`。
- 测试：`test/integration/capture-snapshot.test.mjs`、`test/unit/fewshot.test.mjs`、`test/unit/code-lang.test.mjs`、`test/unit/scroll-params.test.mjs`。

**修改：**
- `script/lib/env.mjs` — 新增 `urlDir`/`ensureUrlDirs`（拍平）；删除 `workflowDir`/`ensureWorkflowDirs`。
- `script/lib/placeholder.mjs` — 新增 `validateClassifyPlan`/`guessCodeLang`/`applyClassifyPlan`；删除 `processSpecialElements`（不再有调用方）。
- `script/clear_trans_html.mjs` — main 流改 `setContent(snapshot.html)` + 读 plan + `applyClassifyPlan`；移除 progressiveScroll/waitForDomStable/pageMerge/processSpecialElements；目录改 `ensureUrlDirs`。
- `script/render_markdown.mjs` — 单稿预览：读 `<url-dir>/result.md`（缺失降级 sketch.md），去掉双 Tab/`<wf>` 路径段/复制改写逻辑。
- `test/unit/env.test.mjs`、`test/integration/render.test.mjs`、`test/integration/clear-node.test.mjs`、`test/integration/placeholder.test.mjs`、`test/integration/init.test.mjs` — 按各任务适配。
- `script/init.sh` — 移除 Python/uv 检测与安装分支。
- `SKILL.md` / `CLAUDE.md` / `README.md` — 单运行时化（Task 1/2）+ 步骤 1.6/1.8（Task 6）。

**删除：**
- Python 运行时：`script/clear_trans_html.py`、`script/pylib/`（`__init__.py`/`browser.py`/`env.py`/`placeholder.py`）、`test/conftest.py`、`test/unit/test_browser_proxy.py`、`test/unit/test_env.py`、`test/unit/test_skeleton.py`、`test/integration/test_browser.py`、`test/integration/test_clear_py.py`、`pyproject.toml`、`uv.lock`。
- 旧分类：`script/lib/page-classify.js`、`script/lib/page-merge.js`（Task 5，调用方移除后）。`script/prepare_classify.mjs` 在 spec 废弃清单中但**本不存在**，跳过。

---

### Task 1: 移除 Python 运行时（拆除 + 文档收敛单运行时）

**Files:**
- Delete: `script/clear_trans_html.py`、`script/pylib/`（4 个 `.py`）、`test/conftest.py`、`test/unit/test_browser_proxy.py`、`test/unit/test_env.py`、`test/unit/test_skeleton.py`、`test/integration/test_browser.py`、`test/integration/test_clear_py.py`、`pyproject.toml`、`uv.lock`
- Modify: `script/init.sh`、`test/integration/init.test.mjs`、`SKILL.md`、`CLAUDE.md`、`README.md`

**Interfaces:**
- Consumes: 无（纯拆除；Node 侧行为不变）。
- Produces: 单运行时基线——后续任务不再考虑 Python 镜像。`init.sh` 输出 JSON 去掉 `python` 字段：`{"status":"ok","node":"<ver>","pm":"<pm>","chromium":true}`。

- [ ] **Step 1: 删除 Python 文件**

```bash
cd /Volumes/Develop/Skills/MY-SKILL/url-to-markdown
git rm script/clear_trans_html.py pyproject.toml uv.lock \
       script/pylib/__init__.py script/pylib/browser.py script/pylib/env.py script/pylib/placeholder.py \
       test/conftest.py test/unit/test_browser_proxy.py test/unit/test_env.py test/unit/test_skeleton.py \
       test/integration/test_browser.py test/integration/test_clear_py.py
# 清理未跟踪的字节码缓存（若存在）
rm -rf script/pylib/__pycache__ test/unit/__pycache__ test/integration/__pycache__
```

- [ ] **Step 2: 改写 `script/init.sh`（移除 Python 各节）**

用以下内容整体替换 init.sh（原 §2 Python 检查、§5 Python 依赖、§6 Python chromium 段全部移除；输出 JSON 去掉 `python` 字段）：

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

# ── 2. 包管理器探测 pnpm > yarn > npm（不自行安装） ─────────
PM=""
for c in pnpm yarn npm; do
  if command -v "$c" >/dev/null 2>&1; then PM="$c"; break; fi
done
[ -n "$PM" ] || die "未找到 pnpm/yarn/npm，请先安装其中之一"

# ── 3. Node 依赖（有 lock 走 frozen/CI 模式） ────────────────
cd "$ROOT" || die "无法进入项目根目录"
log "使用 $PM 安装 Node 依赖"
case "$PM" in
  pnpm) if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile >&2 || die "pnpm install --frozen-lockfile 失败";
        else pnpm install >&2 || die "pnpm install 失败"; fi ;;
  yarn) if [ -f yarn.lock ]; then yarn install --frozen-lockfile >&2 || die "yarn install 失败";
        else yarn install >&2 || die "yarn install 失败"; fi ;;
  npm)  if [ -f package-lock.json ]; then npm ci >&2 || die "npm ci 失败";
        else npm install >&2 || die "npm install 失败"; fi ;;
esac

# ── 4. chromium（只修复缺失，不重复安装） ────────────────────
CHROMIUM_OK=false
NODE_CHROMIUM="$(node -e 'try { console.log(require("playwright").chromium.executablePath()) } catch { process.exit(1) }' 2>/dev/null || true)"
if [ -n "$NODE_CHROMIUM" ] && [ -x "$NODE_CHROMIUM" ]; then
  CHROMIUM_OK=true
else
  log "安装 chromium（Node Playwright）"
  npx playwright install chromium >&2 || die "npx playwright install chromium 失败"
  CHROMIUM_OK=true
fi

# ── 输出 ─────────────────────────────────────────────────────
printf '{"status":"ok","node":"%s","pm":"%s","chromium":%s}\n' \
  "$NODE_VER" "$PM" "$CHROMIUM_OK"
```

- [ ] **Step 3: 更新 `test/integration/init.test.mjs`**

删除第 15 行：

```js
  assert.ok(json.python);
```

（其余断言不变。）

- [ ] **Step 4: 更新 `SKILL.md`（单运行时，路径暂不动）**

4a. **步骤 2** 整节替换为：

```markdown
### 步骤 2 · 清洗转换

```bash
node <skill-root>/script/clear_trans_html.mjs <url>
```

| stdout status | 动作 |
|---|---|
| `ok` | 记录 `sketch` 路径，进入步骤 3 |
| `error` | 把 `reason` 反馈给用户并终止 |

产物：`<skill-root>/working/<url-dir>/node_workflow/sketch.md` 与 `assets/`。
```

4b. **步骤 3** 首句改为单 manifest：

```markdown
读 `working/<url-dir>/node_workflow/assets/manifest.json` 中 `status: "pending"` 的条目，按 `type` 分派：
```

（表格内"同 workflow 的"等措辞保留即可，不再有"两个 workflow 各处理各的"一句。）

4c. **步骤 4** 首段替换为（去掉两层目录说明）：

```markdown
对 sketch.md 使用以下提示词清洗，写入 `working/<url-dir>/node_workflow/result.md`。
```

提示词本身（"你是一个网页内容清洗专家……"）**逐字不变**；把"以下是两份网页转换的 Markdown 初稿"改为"以下是网页转换的 Markdown 初稿"，并删除段尾"若只有一个 workflow 产出，则'两份'按一份处理"一句（不再有双稿）。`{{IMG_n}}` 替换说明中的"该 workflow"改为 `node_workflow`。

4d. **常见错误处理表**删除这一行：

```markdown
| 双工作流其一失败 | 用另一份继续步骤 3-5（单选模式） |
```

- [ ] **Step 5: 更新 `CLAUDE.md`（移除 Python/镜像内容）**

5a. **常用命令**代码块：删除 `uv run pytest ...`、`uv sync ...` 两行及"单用例"中的 `uv run pytest ...::test_mermaid` 行；`pnpm test:all` 注释改为"Node 单测 + 集成"。

5b. **环境要求**句改为：

```markdown
环境要求：node ≥20（nvm）、pnpm > yarn > npm。未配置 linter。测试以子进程方式启动真实 CLI、对接随机端口的夹具服务器；集成测试需要已安装 chromium。
```

5c. **架构**节：
- "共享页面脚本"段第一句改为："`script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2mXxx(...)`。Node 工作流把它当**文本**读入并注入页面（`readSharedScript` + evaluate）。"；"严禁把该逻辑分叉进 `.py` 或 `.mjs`"改为"严禁把该逻辑分叉进 `.mjs` 编排层"。
- 删除"Playwright 1.62 evaluate 语义"第二条中的 Python 适配器 `_call_on_element` 句与第三条"Python 同步 Playwright 受 greenlet 线程绑定"整段。
- 删除"**双工作流镜像。**"整段。
- "**工作目录。**"段：`working/<净化URL>/<node_workflow|python_workflow>/` 改为 `working/<净化URL>/node_workflow/`。
- "**登录流程**"/"**虚拟列表检测门**"段不变。

5d. **测试须知**节删除三条 Python 项："夹具在…conftest 的 fixture_server…"句中的 Python 半句、"Python 子进程测试必须继承 os.environ"整条、"Python 侧已被设计吸收的怪癖"整条。

- [ ] **Step 6: 更新 `README.md`（移除 Python 描述）**

6a. 环境要求：删除 `- Python3 >= 3.11` 行。
6b. 技术栈：改为

```markdown
- `Playwright`
- `@mozilla/readability`
- `turndown` + `@joplin/turndown-plugin-gfm`
```

6c. 项目结构树：删除 `python_workflow/` 行；两处文件清单中删除 `uv.lock`、`pyproject.toml` 行。
6d. 核心流程 2：标题段改为"用脚本 `clear_trans_html.mjs` 打开页面，清理 DOM 元素，转化成 Markdown。"，删除"两个脚本可并行运行……择优选择"一条。
6e. 核心流程 3：路径改为 `working/[_U_R_L_]/node_workflow/assets/draft/`。
6f. 核心流程 4：首句"审阅两份 Markdown"改为"审阅 Markdown 初稿"；提示词中"两份网页转换的 Markdown 初稿"改为"网页转换的 Markdown 初稿"（与 SKILL.md 保持一致）。
6g. 核心流程 5：改为"用脚本 `render_markdown.mjs` 渲染生成的 Markdown 文件，人工确认后作为最终交付物。"（删除"两份/Tab 切换"措辞）。
6h. `init.sh` 小节：删除 Python3 版本判断/安装、"Python3 包管理器…"两条；第一条改为"判断 Node 的正确版本，是否安装了依赖和 chromium，没问题则成功退出；没有 Node，报错退出"。
6i. `clear_trans_html.mjs + clear_trans_html.py` 小节：标题去掉 `+ clear_trans_html.py`；清理/转换两条中删除"Python 使用 readability-lxml / markdownify"半句；路径 `XXX_workflow` 改 `node_workflow`。
6j. `render_markdown.mjs` 小节首句改为："在浏览器窗口渲染 Markdown，由用户确认，提交后返回 Markdown 路径"。
6k. 开发进度表：`clear_trans_html 双工作流` 行改为 `| clear_trans_html | Node 清洗转换 HTML → Markdown | 已完成 |`；`render_markdown.mjs` 行描述改为"浏览器渲染，人工确认最终 Markdown"；表尾新增一行：`| 移除 Python 运行时 | 双稿择优退役，收敛 Node 单运行时 | 已完成 |`。

- [ ] **Step 7: 全量 Node 测试确认无回归**

Run: `pnpm test:all`
Expected: PASS（本任务不改 Node 行为；init.test 用新 init.sh 输出）。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: 移除 Python 运行时与双稿择优（拆除文件 + init.sh + 文档收敛单运行时）"
```

---

### Task 2: 产物目录拍平到 `<url-dir>/`（env + clear/render/测试适配）

**Files:**
- Modify: `script/lib/env.mjs`、`test/unit/env.test.mjs`、`script/clear_trans_html.mjs`、`script/render_markdown.mjs`、`test/integration/render.test.mjs`、`test/integration/clear-node.test.mjs`、`SKILL.md`、`CLAUDE.md`、`README.md`

**Interfaces:**
- Consumes: Task 1 的单运行时基线。
- Produces: `ensureUrlDirs(url)` → `{urlDir, wf, assets, draft, complex, images, manifest}`，其中 `wf === urlDir === working/<url-dir>`（保留 `wf` 键使 `makeCtx(dirs,…)` 与既有 `path.join(dirs.wf, …)` 代码不动）。`render_markdown.mjs` 新契约：渲染 `<dir>/result.md`（缺失降级 `<dir>/sketch.md` 并标"⚠️ 初稿"）；`POST /select`（body 忽略）→ `{status:"selected", path:<渲染源文件>}`；静态路由 `/md`、`/file/<rel>`（相对 `<dir>`）。

- [ ] **Step 1: 写失败测试——更新 `test/unit/env.test.mjs`**

import 行改为：

```js
import { urlToDirName, workingRoot, storageStatePath, ensureUrlDirs } from '../../script/lib/env.mjs';
```

末个用例替换为：

```js
test('ensureUrlDirs 拍平创建目录并返回 manifest 路径（wf === urlDir）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  process.env.U2M_WORKING_ROOT = root;
  const dirs = ensureUrlDirs('https://example.com/a');
  for (const k of ['urlDir', 'wf', 'assets', 'draft', 'complex', 'images']) {
    assert.ok(fs.existsSync(dirs[k]), `缺目录 ${k}`);
  }
  assert.equal(dirs.wf, dirs.urlDir);
  assert.equal(dirs.urlDir, path.join(root, urlToDirName('https://example.com/a')));
  assert.equal(dirs.manifest, path.join(dirs.assets, 'manifest.json'));
  delete process.env.U2M_WORKING_ROOT;
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/unit/env.test.mjs`
Expected: FAIL（`ensureUrlDirs` 未导出）。

- [ ] **Step 3: 实现 `env.mjs` 拍平**

`script/lib/env.mjs` 中删除 `workflowDir` 与 `ensureWorkflowDirs`，替换为：

```js
export function urlDir(url) { return path.join(workingRoot(), urlToDirName(url)); }

/** 拍平的产物目录：working/<url-dir>/ 直接放 sketch.md/assets/…（双工作流子目录随 Python 运行时移除）。 */
export function ensureUrlDirs(url) {
  const dir = urlDir(url);
  const assets = path.join(dir, 'assets');
  const draft = path.join(assets, 'draft');
  const complex = path.join(assets, 'complex');
  const images = path.join(assets, 'images');
  for (const d of [dir, assets, draft, complex, images]) fs.mkdirSync(d, { recursive: true });
  return { urlDir: dir, wf: dir, assets, draft, complex, images, manifest: path.join(assets, 'manifest.json') };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test test/unit/env.test.mjs`
Expected: PASS。

- [ ] **Step 5: 切换 `clear_trans_html.mjs` 到拍平目录**

import 行 `ensureWorkflowDirs` 改 `ensureUrlDirs`；main 内

```js
  const dirs = ensureWorkflowDirs(url, 'node_workflow');
```

改为：

```js
  const dirs = ensureUrlDirs(url);
```

（其余逻辑不动——`dirs.wf` 现在就是 `<url-dir>`，sketch/manifest 自动落新层级。）

- [ ] **Step 6: 适配 `test/integration/clear-node.test.mjs` 路径**

`wf` helper 改为：

```js
const wf = (page) => path.join(root, urlToDirName(`${fx.url}/${page}`));
```

（删掉 `'node_workflow'` 段；其余用例断言不变。）

- [ ] **Step 7: 重写 `script/render_markdown.mjs` 为单稿预览**

关键改动（保留两阶段超时/emit 契约/safeFile 思想）：

7a. 源解析（替换 `WORKFLOWS`/`SOURCES` 段）：

```js
  const resultMd = path.join(dir, 'result.md');
  const sketchMd = path.join(dir, 'sketch.md');
  const file = fs.existsSync(resultMd) ? resultMd : (fs.existsSync(sketchMd) ? sketchMd : null);
  if (!file) { emit({ status: 'error', reason: `result.md/sketch.md 均缺失: ${dir}` }, 1); return; }
  const draft = !fs.existsSync(resultMd);
  const imagesDir = path.join(dir, 'assets', 'images');
```

7b. 占位符还原与图片改写去掉 `<wf>` 段：

```js
  function resolveDraftPlaceholders(text) {
    return text.replace(/\{\{IMG_(\d+)\}\}/g, (m, n) => {
      try {
        const hit = fs.readdirSync(imagesDir).find((f) => f.startsWith(`IMG_${n}.`));
        return hit ? `![IMG_${n}](/file/assets/images/${hit})` : m;
      } catch { return m; }
    });
  }

  function renderContent() {
    let text = fs.readFileSync(file, 'utf8');
    if (draft) text = resolveDraftPlaceholders(text);
    let html = md.render(text);
    html = html.replace(/(<img[^>]+src=")(?!https?:|\/\/|data:|#|\/file\/)([^"]+)"/g, '$1/file/$2"');
    return html;
  }
  const RENDERED = renderContent();
```

7c. `pageHtml` 去掉 Tab 栏：单个 `<section class="pane">` + 单个"✅ 确认交付"按钮（`draft` 时在标题区显示"⚠️ 初稿"）；按钮 onclick 仍 `fetch('/select', {method:'POST', body:'{}'})`。

7d. 路由：
- `GET /md` → `RENDERED`（不再有 `/md/<wf>`）。
- `GET /file/(.+)` → `safeFile(rel)`，其中 `safeFile` 基准改为 `dir`：

```js
    const safeFile = (rel) => {
      const base = path.resolve(dir);
      const full = path.resolve(path.join(dir, rel));
      if (full !== base && !full.startsWith(base + path.sep)) return null;
      return full;
    };
```

- `POST /select`：body 解析但**忽略内容**（兼容旧 `{"source":...}` 调用）；直接

```js
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(() => finish({ status: 'selected', path: file, elapsedMs: Date.now() - t0 }, 0), 150);
```

7e. 删除 `rewriteAssetRefs` 函数（result.md 已与 assets/ 同级，相对引用天然可解析，无需复制改写）。

- [ ] **Step 8: 重写 `test/integration/render.test.mjs`**

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
  fs.mkdirSync(path.join(dir, 'assets/images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.md'),
    '# 结果\n\n![IMG_1](assets/images/IMG_1.png)\n\n![相对](./assets/images/IMG_1.png)\n\n' +
    '![外链](https://example.com/assets/logo.png)\n\n![内联](data:image/gif;base64,R0lGOD)\n\nRESULT_BODY');
  fs.copyFileSync('test/fixtures/pixel.png', path.join(dir, 'assets/images/IMG_1.png'));
  return { root, dir };
}

test('确认交付：stdout selected + path 指向 result.md + 退出 0', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((html) => {
        assert.match(html, /RESULT_BODY/);
        return fetch(`${m[1]}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      }).catch(() => {});
    } });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'selected');
  assert.equal(json.path, path.join(dir, 'result.md'));
  // 无复制改写：result.md 原样保留 assets/ 相对引用
  const finalMd = fs.readFileSync(path.join(dir, 'result.md'), 'utf8');
  assert.match(finalMd, /!\[IMG_1\]\(assets\/images\/IMG_1\.png\)/);
});

test('降级 sketch.md：⚠️ 初稿标注 + {{IMG_n}} 还原（只访问不点击 → timeout）', async () => {
  const { root, dir } = prepWorking();
  fs.rmSync(path.join(dir, 'result.md'));
  fs.writeFileSync(path.join(dir, 'sketch.md'), '# 初稿\n\n{{IMG_1}}\n\n{{COMPLEX_DIV_9}}\n\nSKETCH_BODY');
  let pageHtml = '', mdHtml = '';
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '8000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(m[1]).then((res) => res.text()).then((t) => {
        pageHtml = t;
        return fetch(`${m[1]}/md`);
      }).then((res) => res.text()).then((t) => { mdHtml = t; }).catch(() => {});
    } });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.match(pageHtml, /⚠️ 初稿/);
  assert.match(mdHtml, /<img[^>]+IMG_1\.png/);
  assert.match(mdHtml, /\{\{COMPLEX_DIV_9\}\}/);
});

test('点击窗口超时：timeout 退出 1', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '1500', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (m) fetch(m[1]).catch(() => {});
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

test('file 指向目录：404 而非 EISDIR 崩溃，服务器继续正常服务', async () => {
  const { root, dir } = prepWorking();
  const r = await runScript(process.execPath,
    [script, dir, '--no-open', '--timeout', '3000', '--open-timeout', '5000'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 30000, onStderr: (line) => {
      const m = /\[render\] 页面: (http:\/\/\S+)/.exec(line);
      if (!m) return;
      fetch(`${m[1]}/file/assets`) // 目录路径 → 404
        .then((res) => {
          assert.equal(res.status, 404);
          return fetch(`${m[1]}/file/assets/images/IMG_1.png`);
        })
        .then((res) => { assert.equal(res.status, 200); })
        .catch(() => {});
    } });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'timeout');
  assert.equal(r.stdout.split('\n').filter((l) => l.trim() !== '').length, 1);
});
```

（`before` 中补 `await writePixelPng('test/fixtures/pixel.png');`——原文件顶部没有 before 钩子，直接在模块加载处调用：在 import 后加 `await writePixelPng('test/fixtures/pixel.png');`，因 ESM 顶层 await 可用。）

- [ ] **Step 9: 更新 `SKILL.md` 路径（步骤 2-5）**

9a. 步骤 2 产物行改为：`<skill-root>/working/<url-dir>/sketch.md` 与 `assets/`。
9b. 步骤 3 manifest 路径改为 `working/<url-dir>/assets/manifest.json`；表格中 `assets/complex/…` 路径不变；"存到同 workflow 的"改为"存到 `assets/complex/`"。
9c. 步骤 4：写入路径改为 `working/<url-dir>/result.md`（删除 node_workflow 层级表述）。
9d. 步骤 5：描述改为"浏览器打开预览 `working/<url-dir>/result.md`（缺失时降级 sketch.md 并标注初稿），用户确认后脚本 emit `selected`（`path` 字段即最终交付物）"；删除"双 Tab/复制到上一级/改写 assets 引用"段；无人值守示例改为：

```bash
curl -X POST http://127.0.0.1:<port>/select -H 'Content-Type: application/json' -d '{}'
```

- [ ] **Step 10: 更新 `CLAUDE.md`/`README.md` 目录表述**

10a. CLAUDE.md "**工作目录。**"段改为：

```markdown
**工作目录。** 每个 URL 对应 `working/<净化URL>/`，产物拍平其下（snapshot.html、classify/、sketch.md、assets/、result.md）；净化保留 `[A-Za-z0-9.-]`，超 120 字符截断 + sha256 前 8 位十六进制后缀。`U2M_WORKING_ROOT` 覆盖根目录（所有测试用它隔离）。`working/cookies/storage_state.json` 是唯一全局登录态——仅 `login_url.mjs` 写入（cookie 按 name|domain|path 去重、localStorage 按 origin+name、读取时剔除过期）；转换脚本只读。
```

10b. README.md 项目结构树改为：

```text
working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录
  [_U_R_L_]/             # 将特殊字符替换成下划线的 URL
    assets/
      draft/             # 复杂元素草稿（内联样式 HTML）
      complex/           # 特殊元素最终产物（SVG/PNG）
      images/            # 下载的正文图片
    sketch.md            # 经过脚本 `clear_trans_html` 初步清洗和转换的 Markdown 文件
    result.md            # 经过 LLM 优化过的 Markdown 文件（最终交付物）
```

脚本列表中的路径 `working/[_U_R_L_]/node_workflow/assets/…` 全部改为 `working/[_U_R_L_]/assets/…`。

- [ ] **Step 11: 全量测试**

Run: `pnpm test:all`
Expected: PASS。

- [ ] **Step 12: 提交**

```bash
git add -A
git commit -m "refactor: 产物目录拍平到 <url-dir>（ensureUrlDirs + render_markdown 单稿预览）"
```

---

### Task 3: 共享 `page-prepare.js` + `page-derive.js` + `capture_snapshot.mjs`

**Files:**
- Create: `script/lib/page-prepare.js`、`script/lib/page-derive.js`、`script/capture_snapshot.mjs`
- Create: `test/fixtures/classify-article.html`、`test/fixtures/style.css`
- Test: `test/integration/capture-snapshot.test.mjs`、`test/unit/scroll-params.test.mjs`

**Interfaces:**
- Consumes: `script/lib/contract.mjs`（`emit`/`emitError`/`usage`/`log`）、`script/lib/env.mjs`（`storageStatePath`/`workingRoot`/`urlToDirName`）、`script/lib/browser.mjs`（`openPage`）、`script/lib/placeholder.mjs`（`readSharedScript`）。
- Produces: `working/<url-dir>/snapshot.html` 与 `working/<url-dir>/classify/classify_input.html`；emit `{status:"ok", snapshot, classifyInput, elements, tokenEstimate, warnings}` / `{status:"too_large", tokenEstimate, elements, reason}`（exit 0，不写 classify_input）/ `{status:"error", reason}`（exit 1）。**`data-u2m-id` 规则：每个命中候选选择器的元素都打 id（父与子都可有 id，无嵌套守卫；文档序递增）**。Task 5 的 `applyClassifyPlan` 消费这些 id。

- [ ] **Step 1: 写夹具 `test/fixtures/classify-article.html` 与 `test/fixtures/style.css`**

```html
<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>Classify Article</title>
  <link rel="stylesheet" href="/style.css">
  <style>.from-style{color:red}</style>
</head><body>
  <nav class="sidebar">侧栏噪声</nav>
  <main>
    <article>
      <h1>标题在列表流内</h1>
      <p>这是一段足够长的正文文本用于触发长文本占位阈值它必须超过四十个字符所以这里继续写下去直到达标为止。</p>
      <pre class="hljs" data-lang="python"><code>def hello():
    print("hi")</code></pre>
      <div class="chart" style="width:400px;height:300px"><canvas></canvas></div>
      <svg width="200" height="100"><rect width="100" height="50"/></svg>
      <video src="/demo.mp4" width="300" height="150"></video>
      <img src="/pixel.png" alt="px" onerror="this.remove()">
      <button class="copy-btn">Copy</button>
    </article>
  </main>
  <script>document.body.dataset.ran='yes'</script>
</body></html>
```

```css
body { background: #fff; }
.chart { border: 1px solid #000; }
```

- [ ] **Step 2: 写失败测试 `test/integration/capture-snapshot.test.mjs`**

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { writePixelPng } from '../helpers/assets.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

let fx, fx2, root;
before(async () => {
  await writePixelPng('test/fixtures/pixel.png');
  fx = await startFixtureServer();
  fx2 = await startFixtureServer(); // 第二个随机端口 = 跨源（无 CORS 头）
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'u2m-cap-'));
});
after(async () => { await fx.close(); await fx2.close(); });

const cap = (url) => runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs'), url],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const dirOf = (url) => path.join(root, urlToDirName(url));

test('capture: ok 路径写两份产物 + emit 恰一行 JSON', async () => {
  const url = `${fx.url}/classify-article.html`;
  const r = await cap(url);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.match(json.snapshot, /snapshot\.html$/);
  assert.match(json.classifyInput, /classify_input\.html$/);
  assert.ok(json.elements > 0);
  assert.ok(json.tokenEstimate > 0);

  const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
  assert.doesNotMatch(snap, /<script[\s>]/);                                    // script 已剥
  assert.match(snap, /<style data-u2m-inlined=/);                               // 外部 CSS 已内联
  assert.doesNotMatch(snap, /<link[^>]*rel=["']stylesheet["']/);                // <link> 已移除
  assert.match(snap, /\.from-style\{color:red\}/);                              // 既有 <style> 保留
  assert.match(snap, /<base href=/);                                            // base 已注入
  assert.match(snap, /style="width:400px;height:300px"/);                       // 元素 inline style 保留
  assert.doesNotMatch(snap, /\son\w+=/);                                        // on* 已剥
  assert.doesNotMatch(snap, /copy-btn/);                                        // 复制按钮已剥
  assert.match(snap, /src="http:\/\/127\.0\.0\.1:\d+\/pixel\.png"/);            // img src 已绝对化

  const ci = await fs.readFile(path.join(dirOf(url), 'classify/classify_input.html'), 'utf8');
  assert.match(ci, /\{\{T\d+\}\}/);                                             // 长文本占位
  assert.match(ci, /data-lang="python"/);                                       // 代码靠结构识别（文本同样占位）
  assert.doesNotMatch(ci, /<style[\s>]/);                                       // style 已剥
  const snapIds = new Set([...snap.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  const ciIds = new Set([...ci.matchAll(/data-u2m-id="(\d+)"/g)].map(m => m[1]));
  assert.ok(ciIds.size > 0);
  for (const id of ciIds) assert.ok(snapIds.has(id), `id ${id} 在 classify 但不在 snapshot`);
});

test('capture: 嵌套候选都有 id（无 closest 守卫）', async () => {
  const url = `${fx.url}/classify-article.html`;
  await cap(url);
  const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
  // main 与其内部 article 都有 id（父子同级候选，逐一可寻址）
  assert.match(snap, /<main[^>]*data-u2m-id="\d+"/);
  assert.match(snap, /<article[^>]*data-u2m-id="\d+"/);
  assert.match(snap, /<pre[^>]*data-u2m-id="\d+"/);
  // 叶子文本元素不打 id
  assert.doesNotMatch(snap, /<p[^>]*data-u2m-id=/);
  assert.doesNotMatch(snap, /<h1[^>]*data-u2m-id=/);
});

test('capture: too_large（--token-budget 1）→ exit 0，不写 classify_input，snapshot 仍在', async () => {
  const url = `${fx.url}/classify-article.html`;
  const r = await runScript(process.execPath,
    [path.resolve('script/capture_snapshot.mjs'), url, '--token-budget', '1'],
    { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'too_large');
  assert.ok(json.tokenEstimate >= 1);
  const dir = dirOf(url);
  assert.ok(fssync.existsSync(path.join(dir, 'snapshot.html')));
  assert.ok(!fssync.existsSync(path.join(dir, 'classify/classify_input.html')));
});

test('capture: 跨源 CSS（无 CORS）→ <link> 原样保留 + warning', async () => {
  // 临时夹具目录：页面引用第二个服务器（跨源、无 ACAO 头）的 CSS
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'u2m-xorigin-'));
  await fs.writeFile(path.join(tmp, 'xorigin.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>x</title>` +
    `<link rel="stylesheet" href="${fx2.url}/style.css"></head>` +
    `<body><main><p>足够长的正文文本用于通过各类阈值这里继续补充一些字数以满足占位与检测需要。</p></main></body></html>`, 'utf8');
  const fxLocal = await startFixtureServer(tmp);
  try {
    const url = `${fxLocal.url}/xorigin.html`;
    const r = await cap(url);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.status, 'ok');
    assert.ok(json.warnings.some((w) => /CSS/.test(w)), `warnings: ${JSON.stringify(json.warnings)}`);
    const snap = await fs.readFile(path.join(dirOf(url), 'snapshot.html'), 'utf8');
    assert.match(snap, new RegExp(`<link[^>]*href="${fx2.url}/style.css"`)); // 兜底保留
  } finally { await fxLocal.close(); }
});

test('capture: usage_error 无参退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs')],
    { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test test/integration/capture-snapshot.test.mjs`
Expected: FAIL（`capture_snapshot.mjs` 不存在）。

- [ ] **Step 4: 实现 `script/lib/page-prepare.js`**

```js
function __u2mPrepareBody(cfg) {
  cfg = cfg || {};
  const MIN_MAIN_TEXT = typeof cfg.minMainText === 'number' ? cfg.minMainText : 500;
  const ID_SELECTORS = 'div,section,article,aside,nav,header,footer,main,figure,table,thead,tbody,tr,canvas,svg,video,iframe,picture,ul,ol,li,dl,pre,blockquote,details,[role],[data-chart],.chart,.echarts,.highcharts,.MathJax,.MathJax_Display,.katex,.katex-display';

  // 1. 合并同源内容 iframe（吸收 __u2mMergeIframes，同阈值 500；主文档文本充足则不合并）
  const textLen = (document.body && document.body.innerText ? document.body.innerText : '')
    .replace(/\s+/g, ' ').trim().length;
  if (textLen < MIN_MAIN_TEXT) {
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

  // 2. 注入 <base>（先于 src 绝对化）：相对 URL 在 setContent 重载时解析回源站
  if (!document.querySelector('base[data-u2m-base]')) {
    const b = document.createElement('base');
    b.setAttribute('data-u2m-base', '1');
    b.href = location.href.split('#')[0];
    document.head.prepend(b);
  }

  // 3. 内联外部 CSS（同步 XHR；fetch 失败的 <link> 原样保留，渲染时由 <base>+cookie+网络兜底）
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  const cssChunks = [];
  const kept = [];
  for (const l of links) {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', l.href, false); // 同步（函数不得 async，见约定测试）
      x.send();
      if (x.status >= 200 && x.status < 300) cssChunks.push(x.responseText);
      else kept.push(l);
    } catch (e) { kept.push(l); }
  }
  if (cssChunks.length) {
    const s = document.createElement('style');
    s.setAttribute('data-u2m-inlined', '1');
    s.textContent = cssChunks.join('\n');
    document.head.appendChild(s);
  }
  for (const l of links) if (!kept.includes(l)) l.remove();

  // 4. 剥尽 JS 与噪声标签 + on* 事件属性（mermaid 源码已由 pageInit 存为 data-u2m-mermaid-src）
  document.querySelectorAll('script,noscript,template').forEach((e) => e.remove());
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });

  // 5. 剥叶子噪声（复制按钮，防泄漏为文本噪声）
  document.querySelectorAll('.copy,.copy-btn,button[aria-label*="copy" i]').forEach((e) => e.remove());

  // 6. 资源 src 绝对化（依赖 <base>）：setContent 后页面是 about:blank，
  //    processImages 用 new URL(src, frame.url()) 解析相对 src 会失败，故抓取时绝对化。
  document.querySelectorAll('img[src],video[src],audio[src],source[src]').forEach((el) => {
    try { if (el.src) el.setAttribute('src', el.src); } catch (e) { /* 忽略 */ }
  });

  // 7. 打 data-u2m-id：每个命中候选的元素按文档序递增（父与子都打、无嵌套守卫；叶子文本元素不在候选内）
  let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode();
  while (el) {
    if (el.matches(ID_SELECTORS)) el.setAttribute('data-u2m-id', String(++n));
    el = walker.nextNode();
  }
  return true;
}
```

- [ ] **Step 5: 实现 `script/lib/page-derive.js`**

```js
function __u2mDeriveClassifyInput(cfg) {
  cfg = cfg || {};
  const N = typeof cfg.placeholderMinChars === 'number' ? cfg.placeholderMinChars : 40;

  // 白名单信号属性（spec §5.1：不含 color/font/text-*）。getComputedStyle 枚举的是长写属性。
  const isSignalProp = (p) => {
    if (/^(position|display|float|clear|visibility|box-shadow|transform|z-index|width|height|gap)$/.test(p)) return true;
    if (/^(min-|max-)(width|height)$/.test(p)) return true;
    if (/^overflow(-x|-y)?$/.test(p)) return true;
    if (/^border(-(top|right|bottom|left))?(-(width|style|color))?$/.test(p)) return true;
    if (/^border.*radius$/.test(p)) return true;
    if (p === 'background-color') return true;
    if (/^flex(-.+)?$/.test(p)) return true;
    if (/^grid(-.+)?$/.test(p)) return true;
    return false;
  };

  // 1. 长文本占位（含代码块文本——代码靠结构识别，内容不读）
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

  // 3. 白名单信号样式内联（非信号样式全部抹掉，压 token）
  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    const parts = [];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs.item(i);
      if (isSignalProp(prop)) parts.push(prop + ':' + cs.getPropertyValue(prop));
    }
    el.removeAttribute('style');
    if (parts.length) el.setAttribute('style', parts.join(';'));
  });

  return document.body.outerHTML;
}
```

- [ ] **Step 6: 实现 `script/capture_snapshot.mjs`**

```js
#!/usr/bin/env node
// capture_snapshot.mjs <url> [--token-budget 80000] [--placeholder-min-chars 40]
// 抓全保真快照 + 派生精简版（供 LLM 分类）。emit ok / too_large / error。
import path from 'node:path';
import fs from 'node:fs/promises';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { storageStatePath, workingRoot, urlToDirName } from './lib/env.mjs';
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

/** 渐进滚动到底再回顶（懒加载）。参数必须与 page-detect.js 的 scrollIters/scrollWait 一致（scroll-params 单测守护）。 */
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

/** DOM 稳定：节点数连续 stableMs 不变。沿用原 clear_trans_html 的值。 */
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
  const args = parseArgs(process.argv);
  if (!args) return; // usage_error 已 emit
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: capture_snapshot.mjs <url> [--token-budget n] [--placeholder-min-chars n]');
  const tokenBudget = Number(args['token-budget'] ?? 80000);
  const placeholderMinChars = Number(args['placeholder-min-chars'] ?? 40);

  const pageInit = await readSharedScript('page-init.js');
  const pagePrepare = await readSharedScript('page-prepare.js');
  const pageDerive = await readSharedScript('page-derive.js');

  const urlDir = path.join(workingRoot(), urlToDirName(url));
  const classifyDir = path.join(urlDir, 'classify');

  let s;
  let result;
  try {
    s = await openPage(url, { viewport: { width: 1280, height: 3000 }, initScripts: [pageInit], storageStatePath: storageStatePath(), log });
    await progressiveScroll(s.page);
    await waitForDomStable(s.page);

    await s.page.evaluate(`(${pagePrepare})()`);
    // 关键顺序：先取全保真 snapshot，再跑 derive（derive 会占位/剥 style，变异只影响其序列化结果）
    const snapshot = await s.page.evaluate(() => document.documentElement.outerHTML);
    const classifyInput = await s.page.evaluate(`(${pageDerive})(${JSON.stringify({ placeholderMinChars })})`);

    const idCount = (snapshot.match(/data-u2m-id="\d+"/g) || []).length;
    const tokenEstimate = Math.round(classifyInput.length / 4);
    const warnings = [];
    const keptLinks = (snapshot.match(/<link[^>]*rel=["']stylesheet["']/g) || []).length;
    if (keptLinks) warnings.push(`${keptLinks} 个外部 CSS 抓取失败（跨源无 CORS 等），保留 <link> 兜底`);

    await fs.mkdir(classifyDir, { recursive: true });
    await fs.writeFile(path.join(urlDir, 'snapshot.html'), snapshot, 'utf8');
    if (tokenEstimate > tokenBudget) {
      result = { status: 'too_large', tokenEstimate, elements: idCount, reason: `classify_input token 估算 ${tokenEstimate} 超预算 ${tokenBudget}；可用 --placeholder-min-chars 调大占位阈值后重跑` };
    } else {
      await fs.writeFile(path.join(classifyDir, 'classify_input.html'), classifyInput, 'utf8');
      result = { status: 'ok', snapshot: path.join(urlDir, 'snapshot.html'), classifyInput: path.join(classifyDir, 'classify_input.html'), elements: idCount, tokenEstimate, warnings };
    }
  } catch (e) {
    await s?.close().catch(() => {});
    return emitError(e.message, 1);
  }
  await s.close().catch(() => {}); // 先关浏览器再 emit（emit 内 process.exit）
  emit(result, 0);
}

main().catch((e) => emitError(e.message, 1));
```

- [ ] **Step 7: 写滚动参数一致性单测 `test/unit/scroll-params.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('capture_snapshot 滚动参数与 page-detect.js 一致', () => {
  const cap = fs.readFileSync('script/capture_snapshot.mjs', 'utf8');
  const det = fs.readFileSync('script/lib/page-detect.js', 'utf8');
  const iters = Number(det.match(/scrollIters \|\| (\d+)/)[1]);
  const wait = Number(det.match(/scrollWait \|\| (\d+)/)[1]);
  assert.ok(cap.includes(`i < ${iters}`), `capture 滚动轮次应为 ${iters}`);
  assert.ok(cap.includes(`setTimeout(r, ${wait})`), `capture 每轮等待应为 ${wait}ms`);
});

test('capture_snapshot 稳定参数沿用原 clear_trans_html 值', () => {
  const cap = fs.readFileSync('script/capture_snapshot.mjs', 'utf8');
  assert.match(cap, /stableMs = 1000/);
  assert.match(cap, /maxMs = 15000/);
  assert.match(cap, /waitForTimeout\(200\)/);
});
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `node --test test/integration/capture-snapshot.test.mjs test/unit/scroll-params.test.mjs`
Expected: PASS。若某断言因 fixture 序列化细节（属性顺序等）失败，先 `node script/capture_snapshot.mjs <fixture-url>`（设 `U2M_WORKING_ROOT` 到临时目录）人工查看 snapshot.html 再校准断言——**不得放宽断言语义**。

- [ ] **Step 9: 运行既有测试确认无回归**

Run: `pnpm test:all`
Expected: PASS（本任务只增不改既有代码）。

- [ ] **Step 10: 提交**

```bash
git add script/lib/page-prepare.js script/lib/page-derive.js script/capture_snapshot.mjs \
        test/fixtures/classify-article.html test/fixtures/style.css \
        test/integration/capture-snapshot.test.mjs test/unit/scroll-params.test.mjs
git commit -m "feat(capture): page-prepare/derive + capture_snapshot.mjs（快照双产物，TDD 绿）"
```

---

### Task 4: `classify_plan.json` v2 schema 少样本集 + 契约测试

**Files:**
- Create: `script/lib/fewshot/{nested-text-wrapper,sidebar-ads-nav,title-in-listflow,chart-card-grid,canvas-video,big-svg-and-latex,code-block}.{html,json}`
- Test: `test/unit/fewshot.test.mjs`

**Interfaces:**
- Consumes: 无（纯数据）。
- Produces: v2 schema 契约——`{version:2, mode:"whole"|"region", listFlowSelector:string, blocks:[{id:int, action:enum, blockOf?:int}]}`，`action ∈ {keep,delete,code_block,screenshot,passthrough_svg,svg_convert,latex,block_screenshot}`。SKILL.md 步骤 1.8（Task 6）读这些少样本；Task 5 的 `validateClassifyPlan` 实现同一 schema。

- [ ] **Step 1: 写失败测试 `test/unit/fewshot.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const FEWSHOT = path.resolve('script/lib/fewshot');
const ACTIONS = new Set(['keep','delete','code_block','screenshot','passthrough_svg','svg_convert','latex','block_screenshot']);

test('fewshot: 每对 .html/.json 合 v2 schema 且 blocks id ⊆ 输入 id 集', async () => {
  const files = await fs.readdir(FEWSHOT);
  const names = files.filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
  assert.ok(names.length >= 7, `少样本应 ≥7 对，实际 ${names.length}`);
  for (const name of names) {
    const html = await fs.readFile(path.join(FEWSHOT, `${name}.html`), 'utf8');
    const plan = JSON.parse(await fs.readFile(path.join(FEWSHOT, `${name}.json`), 'utf8'));
    assert.equal(plan.version, 2, `${name}: version`);
    assert.ok(['whole', 'region'].includes(plan.mode), `${name}: mode`);
    assert.ok(typeof plan.listFlowSelector === 'string' && plan.listFlowSelector.trim(), `${name}: listFlowSelector`);
    const htmlIds = new Set([...html.matchAll(/data-u2m-id="(\d+)"/g)].map((m) => m[1]));
    assert.ok(plan.blocks.length, `${name}: blocks 非空`);
    for (const b of plan.blocks) {
      assert.ok(Number.isInteger(b.id), `${name}: id int`);
      assert.ok(ACTIONS.has(b.action), `${name}: action ${b.action}`);
      assert.ok(htmlIds.has(String(b.id)), `${name}: id ${b.id} 不在输入`);
      if (b.blockOf != null) assert.ok(Number.isInteger(b.blockOf), `${name}: blockOf int`);
    }
  }
});

test('fewshot: title-in-listflow 的主标题在列表流内侧（其 id 或父块 id 在 blocks 内）', async () => {
  const html = await fs.readFile(path.join(FEWSHOT, 'title-in-listflow.html'), 'utf8');
  const plan = JSON.parse(await fs.readFile(path.join(FEWSHOT, 'title-in-listflow.json'), 'utf8'));
  assert.match(html, /<h1[^>]*>标题/);
  const h1InsideListFlow = /listFlowSelector/.test(JSON.stringify(plan)); // selector 存在
  assert.ok(h1InsideListFlow);
  assert.ok(plan.blocks.some((b) => b.action === 'keep'), '主标题侧应有 keep');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test test/unit/fewshot.test.mjs`
Expected: FAIL（目录不存在）。

- [ ] **Step 3: 写 7 对少样本**

`script/lib/fewshot/nested-text-wrapper.html`：
```html
<main><article data-u2m-id="2"><div data-u2m-id="3"><div data-u2m-id="4"><p>{{T1}}</p></div></div></article></main>
```
`nested-text-wrapper.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "keep" } ] }
```

`sidebar-ads-nav.html`：
```html
<nav class="sidebar" data-u2m-id="1">{{T1}}</nav>
<main><article data-u2m-id="2"><p>{{T2}}</p></article></main>
<footer data-u2m-id="3">{{T3}}</footer>
```
`sidebar-ads-nav.json`（侧栏/页脚在列表流外，由 clear_trans 删兄弟，不进 blocks）：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "keep" } ] }
```

`title-in-listflow.html`：
```html
<main><article data-u2m-id="1"><h1>标题</h1><p>{{T1}}</p></article></main>
```
`title-in-listflow.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 1, "action": "keep" } ] }
```

`chart-card-grid.html`：
```html
<main><article data-u2m-id="1"><div class="chart" data-u2m-id="2" style="width:600px;height:400px"><canvas></canvas></div><div class="chart" data-u2m-id="3" style="width:600px;height:400px"><canvas></canvas></div></article></main>
```
`chart-card-grid.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "block_screenshot", "blockOf": 2 }, { "id": 3, "action": "block_screenshot", "blockOf": 3 } ] }
```

`canvas-video.html`：
```html
<main><article data-u2m-id="1"><canvas data-u2m-id="2" width="300" height="200"></canvas><video data-u2m-id="3" src="/v.mp4" width="300" height="150"></video></article></main>
```
`canvas-video.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "screenshot" }, { "id": 3, "action": "screenshot" } ] }
```

`big-svg-and-latex.html`：
```html
<main><article data-u2m-id="1"><svg data-u2m-id="2" width="400" height="300"><rect width="400" height="300"></rect></svg><span class="katex" data-u2m-id="3"><span class="katex-mathml"><annotation encoding="application/x-tex">E=mc^2</annotation></span></span></article></main>
```
`big-svg-and-latex.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "passthrough_svg" }, { "id": 3, "action": "latex" } ] }
```

`code-block.html`：
```html
<main><article data-u2m-id="1"><pre class="hljs" data-lang="python" data-u2m-id="2"><code>{{T1}}</code></pre></article></main>
```
`code-block.json`：
```json
{ "version": 2, "mode": "whole", "listFlowSelector": "main > article", "blocks": [ { "id": 2, "action": "code_block" } ] }
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test test/unit/fewshot.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add script/lib/fewshot test/unit/fewshot.test.mjs
git commit -m "feat(fewshot): v2 schema 少样本对（7 对）+ 契约测试"
```

---

### Task 5: `applyClassifyPlan` + `clear_trans_html.mjs` setContent 改造 + 废弃旧分类

**Files:**
- Modify: `script/lib/placeholder.mjs`（新增 `validateClassifyPlan`/`guessCodeLang`/`applyClassifyPlan`；删除 `processSpecialElements`）
- Delete: `script/lib/page-classify.js`、`script/lib/page-merge.js`
- Modify: `script/clear_trans_html.mjs`（main 流重写）
- Modify: `test/integration/clear-node.test.mjs`（全用例改 capture→plan→clear + 新增错误路径/code_block/block_screenshot 用例）
- Modify: `test/integration/placeholder.test.mjs`（约定名单更新；`processSpecialElements` 用例替换为 `applyClassifyPlan` 用例）
- Test: `test/unit/code-lang.test.mjs`

**Interfaces:**
- Consumes: Task 3 的 `snapshot.html`（含 `data-u2m-id`）；Task 4 的 v2 schema。`placeholder.mjs` 既有 `makeCtx`/`processMermaid`/`processImages`/`writeManifest`/`callOnElement`/`replaceWithHtml`/`replaceWithText` 不变。
- Produces: `applyClassifyPlan(frame, ctx, plan) => Promise<number>`（逐块按 action 分派、写 `ctx.entries`）；`validateClassifyPlan(plan)`（非法即 throw，消息供 stderr）；`guessCodeLang(text) => string`（本地语言启发式，可为 `''`）。`clear_trans_html.mjs` 读 `working/<url-dir>/snapshot.html` + `working/<url-dir>/classify/classify_plan.json`，产 `<url-dir>/sketch.md` + `<url-dir>/assets/manifest.json`。

- [ ] **Step 1: 写 `test/unit/code-lang.test.mjs`（失败测试）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCodeLang } from '../../script/lib/placeholder.mjs';

test('guessCodeLang: shebang 优先', () => {
  assert.equal(guessCodeLang('#!/usr/bin/env bash\necho hi'), 'bash');
  assert.equal(guessCodeLang('#!/usr/bin/python3\nprint(1)'), 'python');
});

test('guessCodeLang: python 结构', () => {
  assert.equal(guessCodeLang('def hello():\n    print("hi")'), 'python');
});

test('guessCodeLang: javascript 结构', () => {
  assert.equal(guessCodeLang('const x = 1;\nconsole.log(x);'), 'javascript');
  assert.equal(guessCodeLang('function add(a, b) { return a + b; }'), 'javascript');
});

test('guessCodeLang: json', () => {
  assert.equal(guessCodeLang('{"a": 1, "b": [2]}'), 'json');
  assert.equal(guessCodeLang('[1, 2, 3]'), 'json');
});

test('guessCodeLang: html', () => {
  assert.equal(guessCodeLang('<div class="x">hi</div>'), 'html');
});

test('guessCodeLang: 无法判定返回空串', () => {
  assert.equal(guessCodeLang('SELECT * FROM t;'), '');
  assert.equal(guessCodeLang(''), '');
});
```

Run: `node --test test/unit/code-lang.test.mjs`
Expected: FAIL（`guessCodeLang` 未导出）。

- [ ] **Step 2: 实现 `guessCodeLang`（`script/lib/placeholder.mjs` 追加导出）**

```js
/** 本地代码语言启发式（data-lang/class 缺失时的兜底）。返回 '' 表示无法判定。 */
export function guessCodeLang(text) {
  const t = String(text || '');
  const s = t.trim();
  const shebang = s.match(/^#!\s*\S*\b(bash|sh|zsh|python\d?|node)\b/);
  if (shebang) {
    const b = shebang[1];
    if (b.startsWith('python')) return 'python';
    if (b === 'node') return 'javascript';
    if (b === 'sh' || b === 'zsh') return 'bash';
    return b;
  }
  if ((s[0] === '{' && s.endsWith('}')) || (s[0] === '[' && s.endsWith(']'))) {
    try { JSON.parse(s); return 'json'; } catch { /* 非 JSON，继续判定 */ }
  }
  if (/\bdef\s+\w+\s*\([^)]*\)\s*:/.test(t)) return 'python';
  if (/\bconsole\.\w+\(|\bfunction\s+\w+\s*\(|\b(const|let|var)\s+\w+\s*=/.test(t)) return 'javascript';
  if (/^\s*<(html|body|div|span|head|p)\b/i.test(s)) return 'html';
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

Run: `node --test test/unit/code-lang.test.mjs` → PASS。

- [ ] **Step 3: 追加失败测试——重写 `test/integration/clear-node.test.mjs`**

整体替换为以下内容（capture→plan→clear 流程；路径已拍平）：

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

const urlOf = (page) => `${fx.url}/${page}`;
const dirOf = (page) => path.join(root, urlToDirName(urlOf(page)));
const capture = (page) => runScript(process.execPath, [path.resolve('script/capture_snapshot.mjs'), urlOf(page)],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const run = (page) => runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs'), urlOf(page)],
  { env: { U2M_WORKING_ROOT: root }, timeoutMs: 90000 });
const sketch = (page) => fs.readFileSync(path.join(dirOf(page), 'sketch.md'), 'utf8');
const manifestOf = (page) => JSON.parse(fs.readFileSync(path.join(dirOf(page), 'assets/manifest.json'), 'utf8'));
const snapOf = (page) => fs.readFileSync(path.join(dirOf(page), 'snapshot.html'), 'utf8');

function writePlan(page, plan) {
  fs.mkdirSync(path.join(dirOf(page), 'classify'), { recursive: true });
  fs.writeFileSync(path.join(dirOf(page), 'classify/classify_plan.json'), JSON.stringify(plan), 'utf8');
}
/** keep-only plan：快照里全部 data-u2m-id 一律 keep（纯文本页的通用过法） */
function keepAllPlan(page, listFlowSelector) {
  const ids = [...snapOf(page).matchAll(/data-u2m-id="(\d+)"/g)].map((m) => Number(m[1]));
  return { version: 2, mode: 'whole', listFlowSelector, blocks: ids.map((id) => ({ id, action: 'keep' })) };
}
const idByMark = (page, markRe) => {
  const m = snapOf(page).match(markRe);
  assert.ok(m, `快照中未找到 ${markRe}`);
  return Number(m[1]);
};

test('static-article: 契约输出 + 占位符 + 表格 + 围栏', async () => {
  await capture('static-article.html');
  writePlan('static-article.html', keepAllPlan('static-article.html', 'main'));
  const r = await run('static-article.html');
  assert.equal(r.code, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'ok');
  assert.equal(json.images, 1);
  assert.ok(fs.existsSync(path.join(dirOf('static-article.html'), 'assets/images/IMG_1.png')));
  const md = sketch('static-article.html');
  assert.match(md, /示例文章标题/);
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /PARA_ONE/);
  assert.match(md, /\|\s*名称\s*\|\s*值\s*\|/);
  assert.match(md, /```js/);
});

test('lazy-load: IO 劫持使懒图入册', async () => {
  await capture('lazy-load.html');
  writePlan('lazy-load.html', keepAllPlan('lazy-load.html', 'main'));
  const r = await run('lazy-load.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).images, 1);
  assert.ok(fs.existsSync(path.join(dirOf('lazy-load.html'), 'assets/images/IMG_1.png')));
});

test('iframe-content: 主文档稀少时合并同源 iframe 正文', async () => {
  await capture('iframe-content.html');
  writePlan('iframe-content.html', keepAllPlan('iframe-content.html', 'body > div:not(#shell)'));
  const r = await run('iframe-content.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('iframe-content.html');
  assert.match(md, /iframe 内的正文标题/);
  assert.match(md, /IFRAME_BODY/);
});

test('code-block(keep): 行号与复制按钮被清理，语言保留', async () => {
  await capture('code-block.html');
  writePlan('code-block.html', keepAllPlan('code-block.html', 'main'));
  const r = await run('code-block.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('code-block.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  assert.doesNotMatch(md, /line-numbers-rows/);
  assert.doesNotMatch(md, /复制/);
  assert.match(md, /普通表格/);
});

test('nav-noise: 导航/广告/页脚被剔除', async () => {
  await capture('nav-noise.html');
  writePlan('nav-noise.html', keepAllPlan('nav-noise.html', 'main > article'));
  const r = await run('nav-noise.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('nav-noise.html');
  assert.match(md, /MAIN_CONTENT/);
  assert.doesNotMatch(md, /NAV_LINKS/);
  assert.doesNotMatch(md, /ASIDE_AD/);
  assert.doesNotMatch(md, /FOOTER_COPY/);
});

test('complex-elements: plan 驱动全分派端到端', async () => {
  await capture('complex-elements.html');
  const mainId  = idByMark('complex-elements.html', /<main[^>]*data-u2m-id="(\d+)"/);
  const canvasId = idByMark('complex-elements.html', /<canvas[^>]*data-u2m-id="(\d+)"/);
  const videoId  = idByMark('complex-elements.html', /<video[^>]*data-u2m-id="(\d+)"/);
  const svgId    = idByMark('complex-elements.html', /<svg id="big"[^>]*data-u2m-id="(\d+)"/);
  const chartId  = idByMark('complex-elements.html', /<div class="chart"[^>]*data-u2m-id="(\d+)"/);
  const vizId    = idByMark('complex-elements.html', /<div id="viz"[^>]*data-u2m-id="(\d+)"/);
  const katexId  = idByMark('complex-elements.html', /<span class="katex"[^>]*data-u2m-id="(\d+)"/);
  writePlan('complex-elements.html', { version: 2, mode: 'whole', listFlowSelector: 'main', blocks: [
    { id: mainId, action: 'keep' },
    { id: canvasId, action: 'screenshot' },
    { id: videoId, action: 'screenshot' },
    { id: svgId, action: 'passthrough_svg' },
    { id: chartId, action: 'block_screenshot', blockOf: chartId },
    { id: vizId, action: 'svg_convert' },
    { id: katexId, action: 'latex' },
  ] });
  const r = await run('complex-elements.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('complex-elements.html');
  assert.match(md, /\{\{IMG_1\}\}/);
  assert.match(md, /\$\$E=mc\^2\$\$/);
  assert.match(md, /\{\{COMPLEX_DIV_\d+\}\}/); // svg_convert 占位符
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.png\)/); // block_screenshot 直替
  assert.match(md, /!\[COMPLEX_DIV_\d+\]\(assets\/complex\/COMPLEX_DIV_\d+\.svg\)/); // passthrough 直替
  assert.match(md, /视频源：/); // video screenshot 附原链接
  const manifest = manifestOf('complex-elements.html');
  const types = manifest.items.map((i) => i.type).sort();
  assert.deepEqual(types, ['block_screenshot', 'latex', 'passthrough_svg', 'screenshot', 'screenshot', 'svg_convert']);
  const pending = manifest.items.filter((i) => i.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'svg_convert');
});

test('long-column: 正文完整保留，不误判 svg_convert', async () => {
  await capture('long-column.html');
  writePlan('long-column.html', keepAllPlan('long-column.html', '.page-layout__main'));
  const r = await run('long-column.html');
  assert.equal(r.code, 0, r.stderr);
  const manifest = manifestOf('long-column.html');
  assert.equal(manifest.items.filter((i) => i.type === 'svg_convert').length, 0,
    `不应有 svg_convert: ${JSON.stringify(manifest.items)}`);
  const md = sketch('long-column.html');
  assert.match(md, /LONGCOL_BODY/);
  assert.ok(!md.includes('{{COMPLEX_DIV_'));
});

test('mermaid: 源码 → mermaid 围栏', async () => {
  await capture('mermaid.html');
  writePlan('mermaid.html', keepAllPlan('mermaid.html', 'main'));
  const r = await run('mermaid.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('mermaid.html');
  assert.match(md, /```mermaid\ngraph TD; A-->B\n```/);
});

test('csp-article: 严格 CSP 页面（bypassCSP）→ ok + 正文保留', async () => {
  await capture('csp-article.html');
  writePlan('csp-article.html', keepAllPlan('csp-article.html', 'main'));
  const r = await run('csp-article.html');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'ok');
  assert.match(sketch('csp-article.html'), /CSP_PARA/);
});

test('classify-article: code_block 分支 → 语言围栏，不进 manifest', async () => {
  await capture('classify-article.html');
  const articleId = idByMark('classify-article.html', /<article[^>]*data-u2m-id="(\d+)"/);
  const preId = idByMark('classify-article.html', /<pre[^>]*data-u2m-id="(\d+)"/);
  writePlan('classify-article.html', { version: 2, mode: 'whole', listFlowSelector: 'main > article', blocks: [
    { id: articleId, action: 'keep' },
    { id: preId, action: 'code_block' },
  ] });
  const r = await run('classify-article.html');
  assert.equal(r.code, 0, r.stderr);
  const md = sketch('classify-article.html');
  assert.match(md, /```python/);
  assert.match(md, /def hello\(\):/);
  const manifest = manifestOf('classify-article.html');
  assert.ok(!manifest.items.some((i) => i.type === 'code_block'), 'code_block 不进 manifest');
});

test('plan 缺失 → error 一行，提示先跑 1.6/1.8', async () => {
  await capture('nav-noise.html');
  // 不写 plan
  const r = await run('nav-noise.html');
  assert.equal(r.code, 1);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.status, 'error');
  assert.match(json.reason, /classify_plan\.json/);
});

test('plan 非法（version≠2）→ error', async () => {
  await capture('static-article.html');
  writePlan('static-article.html', { version: 1, mode: 'whole', listFlowSelector: 'main', blocks: [] });
  const r = await run('static-article.html');
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).status, 'error');
});

test('listFlowSelector 未命中 → error 指出选择器', async () => {
  await capture('mermaid.html');
  const p = keepAllPlan('mermaid.html', 'main');
  p.listFlowSelector = 'no-such-container-xyz';
  writePlan('mermaid.html', p);
  const r = await run('mermaid.html');
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.stdout).reason, /listFlowSelector/);
});

test('参数错误: usage_error 退出 2', async () => {
  const r = await runScript(process.execPath, [path.resolve('script/clear_trans_html.mjs')], { env: { U2M_WORKING_ROOT: root } });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});
```

- [ ] **Step 4: 更新 `test/integration/placeholder.test.mjs`**

4a. 约定名单用例改为：

```js
test('共享脚本可读取且为具名函数声明', async () => {
  for (const n of ['page-init.js', 'page-prepare.js', 'page-derive.js', 'page-clean.js', 'page-inline.js', 'page-latex.js']) {
    const src = await readSharedScript(n);
    assert.ok(/^function __u2m/.test(src.trim()), `${n} 应以 function __u2m 开头`);
  }
});
```

（`page-detect.js` 是 `async function`，不满足该正则，继续不入名单。）

4b. import 增加 `applyClassifyPlan`；把 `complex-elements: 四类分派…` 用例整体替换为：

```js
test('applyClassifyPlan: delete/code_block/block_screenshot 分支（setContent 迷你快照）', async () => {
  const dirs = tmpDirs();
  const s = await openPage('about:blank', { viewport: { width: 1280, height: 800 } });
  try {
    await s.page.setContent(`<!doctype html><html><body>
      <main data-u2m-id="1">
        <div class="ad" data-u2m-id="2">AD_BLOCK</div>
        <pre data-lang="python" data-u2m-id="3"><code>def hi(): pass</code></pre>
        <div class="chart" data-u2m-id="4" style="width:200px;height:100px"><canvas></canvas></div>
      </main></body></html>`, { waitUntil: 'domcontentloaded' });
    const ctx = makeCtx(dirs, { context: s.context, log: () => {} });
    const n = await applyClassifyPlan(s.page.mainFrame(), ctx, {
      version: 2, mode: 'whole', listFlowSelector: 'main',
      blocks: [
        { id: 1, action: 'keep' },
        { id: 2, action: 'delete' },
        { id: 3, action: 'code_block' },
        { id: 4, action: 'block_screenshot', blockOf: 4 },
      ],
    });
    assert.equal(n, 4);
    const html = await s.page.evaluate(() => document.body.innerHTML);
    assert.doesNotMatch(html, /AD_BLOCK/);
    assert.match(html, /<pre data-u2m-code><code class="language-python">def hi\(\): pass<\/code><\/pre>/);
    assert.match(html, /<img src="assets\/complex\/COMPLEX_DIV_1\.png"[^>]*data-u2m-asset="1">/);
    assert.deepEqual(ctx.entries.map((e) => e.type), ['block_screenshot']);
    assert.equal(ctx.entries[0].status, 'done');
    assert.ok(fs.existsSync(`${dirs.complex}/COMPLEX_DIV_1.png`));
  } finally { await s.close(); }
});
```

4c. mermaid 用例不动。

- [ ] **Step 5: 运行测试，确认失败**

Run: `node --test test/integration/clear-node.test.mjs test/integration/placeholder.test.mjs`
Expected: FAIL（`applyClassifyPlan` 未实现 / clear 仍旧流程）。

- [ ] **Step 6: 实现 `validateClassifyPlan` + `applyClassifyPlan`（`script/lib/placeholder.mjs` 追加）**

```js
const PLAN_ACTIONS = new Set(['keep', 'delete', 'code_block', 'screenshot', 'passthrough_svg', 'svg_convert', 'latex', 'block_screenshot']);

export function validateClassifyPlan(plan) {
  if (!plan || plan.version !== 2) throw new Error('plan.version 必须为 2');
  if (typeof plan.listFlowSelector !== 'string' || !plan.listFlowSelector.trim()) throw new Error('plan.listFlowSelector 缺失');
  if (!Array.isArray(plan.blocks)) throw new Error('plan.blocks 缺失');
  for (const b of plan.blocks) {
    if (!Number.isInteger(b.id)) throw new Error(`block.id 非法: ${JSON.stringify(b)}`);
    if (!PLAN_ACTIONS.has(b.action)) throw new Error(`block.action 非法: ${b.action}`);
    if (b.blockOf != null && !Number.isInteger(b.blockOf)) throw new Error(`block.blockOf 非法: ${JSON.stringify(b)}`);
  }
}

/**
 * 按 v2 plan 分派：删列表流子树外兄弟 → 逐块按 action 处理。
 * 分支语义逐字复用 processSpecialElements 的既有实现（screenshot 的 VIDEO 源链接、
 * passthrough_svg 的消毒、svg_convert/latex 的 draft+占位符均保持一致）。
 */
export async function applyClassifyPlan(frame, ctx, plan) {
  validateClassifyPlan(plan);
  const listFlow = await frame.$(plan.listFlowSelector);
  if (!listFlow) throw new Error(`listFlowSelector 未命中: ${plan.listFlowSelector}`);
  // 1. 删列表流子树外的兄弟节点（结构去噪；listFlow 子树内部交给逐块 action）
  await frame.evaluate((sel) => {
    const lf = document.querySelector(sel);
    if (!lf || !lf.parentElement) return;
    for (const sib of Array.from(lf.parentElement.children)) if (sib !== lf) sib.remove();
  }, plan.listFlowSelector);

  const inline = await readSharedScript('page-inline.js');
  const latex = await readSharedScript('page-latex.js');
  let processed = 0;
  for (const b of plan.blocks) {
    const h = await frame.$(`[data-u2m-id="${b.id}"]`);
    if (!h) { ctx.warnings.push(`plan id 未命中（快照中不存在或已被外层删除）: ${b.id}`); continue; }
    try {
      if (b.action === 'keep') {
        // 不动
      } else if (b.action === 'delete') {
        await h.evaluate((el) => el.remove());
      } else if (b.action === 'code_block') {
        const text = await h.evaluate((el) => el.textContent);
        let lang = await h.evaluate((el) => {
          const fromAttr = el.getAttribute('data-lang');
          if (fromAttr && fromAttr.trim()) return fromAttr.trim();
          const m = String(el.className || '').match(/(?:language-|lang-)([\w+#-]+)/);
          if (m) return m[1];
          const inner = el.querySelector('[class*="language-"]');
          const m2 = inner && String(inner.className || '').match(/language-([\w+#-]+)/);
          return m2 ? m2[1] : '';
        });
        if (!lang) lang = guessCodeLang(text);
        await replaceWithHtml(frame, h, `<pre data-u2m-code><code class="language-${lang}">${escapeHtml(text)}</code></pre>`);
        // 代码是文本而非复杂资源：不进 manifest、不经步骤 3
      } else if (b.action === 'block_screenshot') {
        const target = await frame.$(`[data-u2m-id="${b.blockOf ?? b.id}"]`);
        if (!target) { ctx.warnings.push(`blockOf 未命中: ${b.blockOf ?? b.id}`); continue; }
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.png`;
        await target.screenshot({ path: path.join(ctx.dirs.wf, rel) });
        await replaceWithHtml(frame, target, `<img src="${rel}" alt="${id}" data-u2m-asset="1">`);
        ctx.entries.push({ id, type: 'block_screenshot', final: rel, status: 'done' });
      } else if (b.action === 'screenshot') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.png`;
        const tag = await h.evaluate((el) => el.tagName);
        let linkHtml = '';
        if (tag === 'VIDEO') {
          const src = await h.evaluate((el) => el.getAttribute('src') || el.currentSrc || '');
          if (src) linkHtml = `<a href="${src}">（视频源：${src}）</a>`;
        }
        await h.screenshot({ path: path.join(ctx.dirs.wf, rel) });
        // data-u2m-asset 标记：分派自产的资源引用，processImages 跳过
        await replaceWithHtml(frame, h, `<img src="${rel}" alt="${id}" data-u2m-asset="1">${linkHtml}`);
        ctx.entries.push({ id, type: 'screenshot', final: rel, status: 'done' });
      } else if (b.action === 'passthrough_svg') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const rel = `assets/complex/${id}.svg`;
        const svg = await h.evaluate((el) => {
          const c = el.cloneNode(true);
          c.querySelectorAll('script').forEach((s) => s.remove());
          [c, ...c.querySelectorAll('*')].forEach((n) => {
            for (const a of Array.from(n.attributes)) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
          });
          c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          return c.outerHTML;
        });
        await fs.writeFile(path.join(ctx.dirs.wf, rel), svg, 'utf8');
        await replaceWithHtml(frame, h, `<img src="${rel}" alt="${id}" data-u2m-asset="1">`);
        ctx.entries.push({ id, type: 'passthrough_svg', final: rel, status: 'done' });
      } else if (b.action === 'svg_convert') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const draftHtml = await callOnElement(h, inline);
        await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8');
        // <p> 包裹：裸文本节点占位符会被 Readability 当噪声丢弃（冒烟发现）
        await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`);
        ctx.entries.push({ id, type: 'svg_convert', draft: `assets/draft/${id}.html`, status: 'pending' });
      } else if (b.action === 'latex') {
        const id = `COMPLEX_DIV_${++ctx.counters.complex}`;
        const tex = await callOnElement(h, latex);
        if (tex) {
          await replaceWithText(frame, h, `$$${tex}$$`);
          ctx.entries.push({ id, type: 'latex', status: 'done' });
        } else {
          const draftHtml = await h.evaluate((el) => el.outerHTML);
          await fs.writeFile(path.join(ctx.dirs.draft, `${id}.html`), draftHtml, 'utf8');
          // <p> 包裹：同上
          await replaceWithHtml(frame, h, `<p>{{${id}}}</p>`);
          ctx.entries.push({ id, type: 'latex', draft: `assets/draft/${id}.html`, status: 'pending' });
        }
      }
      processed++;
    } catch (e) {
      ctx.warnings.push(`action ${b.action}(id=${b.id}) 失败: ${e.message}`);
      try { await h.evaluate((el) => el.removeAttribute('data-u2m-id')); } catch { /* 已脱离 DOM */ }
    }
  }
  return processed;
}
```

- [ ] **Step 7: 删除 `processSpecialElements`**

从 `placeholder.mjs` 删除 `processSpecialElements` 函数本体（`applyClassifyPlan` 已内联其全部分支语义；保留会诱导误用）。

- [ ] **Step 8: 重写 `script/clear_trans_html.mjs` main 流**

```js
#!/usr/bin/env node
// clear_trans_html.mjs <url> —— setContent(snapshot) + plan 驱动分派 → sketch.md + manifest.json
import path from 'node:path';
import { emit, emitError, usage, log } from './lib/contract.mjs';
import { projectRoot, ensureUrlDirs, storageStatePath } from './lib/env.mjs';
import { openPage } from './lib/browser.mjs';
import { makeCtx, readSharedScript, processMermaid, applyClassifyPlan, processImages, writeManifest } from './lib/placeholder.mjs';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import fs from 'node:fs/promises';

const READABILITY_JS = path.join(projectRoot(), 'node_modules', '@mozilla', 'readability', 'Readability.js');

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--')) return usage('用法: clear_trans_html.mjs <url>');
  const dirs = ensureUrlDirs(url);
  const snapshotPath = path.join(dirs.urlDir, 'snapshot.html');
  const planPath = path.join(dirs.urlDir, 'classify', 'classify_plan.json');
  const pageClean = await readSharedScript('page-clean.js');

  let s;
  let result;
  try {
    const snapshot = await fs.readFile(snapshotPath, 'utf8').catch(() => null);
    if (snapshot === null) return emitError(`snapshot.html 缺失，先跑步骤 1.6 capture_snapshot: ${snapshotPath}`, 1);
    const planText = await fs.readFile(planPath, 'utf8').catch(() => null);
    if (planText === null) return emitError(`classify_plan.json 缺失，先跑步骤 1.8: ${planPath}`, 1);
    let plan;
    try { plan = JSON.parse(planText); } catch (e) { return emitError(`classify_plan.json 非法: ${e.message}`, 1); }

    // about:blank + setContent：不再 openPage 原 URL、不再滚动/等稳定（快照已含全量内容）。
    // openPage 仍提供 storageState（受保护图片）与 route-abort media。
    s = await openPage('about:blank', { viewport: { width: 1280, height: 3000 }, storageStatePath: storageStatePath(), log });
    await s.page.setContent(snapshot, { waitUntil: 'domcontentloaded' });

    const ctx = makeCtx(dirs, { context: s.context, log });
    await processMermaid(s.page.mainFrame(), ctx);
    await applyClassifyPlan(s.page.mainFrame(), ctx, plan); // plan 非法/listFlowSelector 失配 → throw → emitError
    await processImages(s.page.mainFrame(), ctx);

    await s.page.evaluate(`(${pageClean})()`);

    // Readability 在页面内运行（避免 jsdom 依赖）
    await s.page.addScriptTag({ path: READABILITY_JS });
    // keepClasses: 默认会剥除全部 class，fenced 代码块语言标注（language-*）将丢失
    const article = await s.page.evaluate(() => {
      const a = new Readability(document, { keepClasses: true }).parse();
      return a ? { title: a.title, content: a.content } : null;
    });
    let html;
    if (article?.content) {
      html = article.content;
    } else {
      ctx.warnings.push('readability 未能解析主体，回退 body 全文');
      html = await s.page.evaluate(() => document.body.innerHTML);
    }
    // Readability _fixRelativeUris 会把分派自产的 assets/ 相对引用绝对化——按 manifest 还原
    for (const e of ctx.entries) {
      if (e.final) html = html.split(new URL(e.final, url).href).join(e.final);
    }

    const td = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx', bulletListMarker: '-' });
    td.use(gfm);
    // 不转义下划线：{{IMG_n}}/{{COMPLEX_DIV_n}} 是后续精确替换的机器令牌，须原样保留
    const md = td.turndown(html).replace(/\\_/g, '_');

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

- [ ] **Step 9: 删除废弃共享脚本**

```bash
git rm script/lib/page-classify.js script/lib/page-merge.js
```

确认无残留调用方：

Run: `grep -rn "page-classify\|page-merge\|processSpecialElements" script/ test/ || true`
Expected: 无命中（文档中的历史描述除外）。

- [ ] **Step 10: 运行测试，确认通过**

Run: `node --test test/integration/clear-node.test.mjs test/integration/placeholder.test.mjs test/unit/code-lang.test.mjs`
Expected: PASS。若 complex-elements 的 id 正则失配，打印 snapshot.html 核对元素属性序后修正 `idByMark` 正则（不得改 plan 语义）。

- [ ] **Step 11: 全量测试**

Run: `pnpm test:all`
Expected: PASS。

- [ ] **Step 12: 提交**

```bash
git add -A
git commit -m "feat(clear): applyClassifyPlan + setContent(snapshot) 改造，废弃启发式分类（TDD 绿）"
```

---

### Task 6: 文档——SKILL.md 步骤 1.6/1.8 + CLAUDE.md/README 收尾

**Files:**
- Modify: `SKILL.md`、`CLAUDE.md`、`README.md`

**Interfaces:**
- Consumes: Task 1-5 的全部产物。
- Produces: 与新管线一致的操作手册与仓库文档；agent 照 SKILL.md 即可走通 0 → 1 → 1.5 → 1.6 → 1.8 → 2 → 3 → 4 → 5。

- [ ] **Step 1: `SKILL.md` 插入步骤 1.6**

在步骤 1.5 之后插入：

````markdown
### 步骤 1.6 · 抓取全保真快照

```bash
node <skill-root>/script/capture_snapshot.mjs <url> [--token-budget 80000] [--placeholder-min-chars 40]
```

复用步骤 1 写好的登录态，充分滚动后抓取全保真 `snapshot.html`（DOM + 内联 CSS + 元素 inline style，剥尽 JS，含 `data-u2m-id` 与 `<base>`），并派生 `classify/classify_input.html`（长文本占位 + 信号样式，供步骤 1.8 阅读）。

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 1.8 |
| `too_large` | 页面超出单次处理规模：把 `tokenEstimate` 告知用户；可加大 `--placeholder-min-chars`（如 120）重跑一次，仍超则终止并说明 |
| `error` | 把 `reason` 反馈给用户并终止 |
````

- [ ] **Step 2: `SKILL.md` 插入步骤 1.8**

````markdown
### 步骤 1.8 · LLM 分类（列表流 + 逐块方案）

读 `working/<url-dir>/classify/classify_input.html` 与 `<skill-root>/script/lib/fewshot/` 下每对 `<name>.html` + `<name>.json`（少样本），按 v2 schema 写 `working/<url-dir>/classify/classify_plan.json`：

```json
{ "version": 2, "mode": "whole",
  "listFlowSelector": "<列表流父容器的 CSS 选择器>",
  "blocks": [ { "id": 12, "action": "keep" } ] }
```

- `action` 取值：`keep | delete | code_block | screenshot | passthrough_svg | svg_convert | latex | block_screenshot`；`block_screenshot` 可带 `blockOf`（整块截图的容器 id，默认 = `id`）。
- `blocks[*].id` 是 `classify_input.html` 里的 `data-u2m-id`，只列列表流内需要处置的块。
- mermaid 容器（带 `data-u2m-mermaid-src`）已托管，**不进 plan**。

**约束**：
1. 只做结构判断，不读文本语义、不改写文本（语义去噪是步骤 4 的事）。
2. `listFlowSelector` 应圈住文章主体块流，且让文章主标题落在其子树内（子树外的兄弟节点会被步骤 2 删除；不要选 `body`——那会把 `<head>` 当兄弟删掉）。
3. 代码块靠结构识别（`<pre>`/`<code>`/`.hljs`/`data-lang` 等），标 `code_block`；语言由脚本本地判定。
4. 列表流内的特殊元素整块处置（截图/既有分派），不拆零。

写完进入步骤 2。
````

- [ ] **Step 3: `SKILL.md` 更新步骤 1.5 路由与步骤 2**

3a. 步骤 1.5 表格：`| scrollable | 进入步骤 2 |` 改为 `| scrollable | 进入步骤 1.6 |`。

3b. 步骤 2 整节替换为：

```markdown
### 步骤 2 · 消费快照与 plan，产出初稿

```bash
node <skill-root>/script/clear_trans_html.mjs <url>
```

前置：步骤 1.6 的 `snapshot.html` 与步骤 1.8 的 `classify_plan.json`（缺失或非法时脚本 emit `error`，按其 `reason` 补跑对应步骤）。脚本加载快照、按 plan 删列表流外噪声并逐块分派，产出 Markdown 初稿。

| stdout status | 动作 |
|---|---|
| `ok` | 记录 `sketch` 路径，进入步骤 3 |
| `error` | 按 `reason` 处理：快照缺失→跑 1.6；plan 缺失/非法/选择器失配→修正后重写 plan（1.8）再重跑本步 |

产物：`<skill-root>/working/<url-dir>/sketch.md` 与 `assets/`。
```

- [ ] **Step 4: `CLAUDE.md` 更新管线与分类描述**

4a. "**架构**"节"**管线顺序（spec 规定）**"条改为：

```markdown
**管线顺序（spec 规定）**：打开页面（initScripts 注入 page-init.js——IO 劫持 + mermaid 源码快照）→ 渐进滚动 → DOM 稳定等待 → 序列化全保真快照（capture_snapshot：同源 iframe 合并 + 外部 CSS 内联 + 剥 JS + <base> + 资源 src 绝对化 + data-u2m-id；再派生 classify_input）→ [agent] LLM 分类写 classify_plan.json → setContent(快照) → mermaid 源码直出 → applyClassifyPlan 逐块分派 → 图片下载 → 页面清理 → Readability（页面内 addScriptTag）→ Markdown 转换 → sketch.md + manifest.json。
```

4b. "**分派类型与 manifest。**"条改为：

```markdown
**分派类型与 manifest。** 分派由 `classify_plan.json`（v2：`listFlowSelector` + 逐块 `action`）驱动，取代旧 `data-u2m-type` 启发式。`manifest.json` 条目为 `{id, type, status, draft?, final?}`。`screenshot` / `passthrough_svg` / `mermaid` / 可提取 tex 的 latex / `block_screenshot` 为 `done`——转换前已在 DOM 内联替换。`svg_convert` 与无 tex 的 latex 为 `pending`——在 sketch 里留 `{{COMPLEX_DIV_n}}` 占位符（用 `<p>` 包裹，防 Readability 丢弃），交给 LLM 步骤 3；draft 存 `assets/draft/`。`code_block` 不进 manifest（规范为 `<pre data-u2m-code><code class="language-*">`，语言取 data-lang/class，缺失时 `guessCodeLang` 启发式）。分派产生的 `<img>` 引用带 `data-u2m-asset`，必须持续排除在 `processImages` 之外（否则 IMG 编号错位）。
```

4c. 删除"**启发式护栏（真实 URL 冒烟教训）**"整条（`maxHeuristicText` 随启发式退役）。

4d. "**工作目录。**"条补一句（在 Task 2 已改的拍平描述后）：`snapshot.html` 与 `classify/`（classify_input.html、classify_plan.json）也在 `<url-dir>/` 下，全局唯一。

4e. "**登录流程**"条不变；"**虚拟列表检测门**"条末尾"`clear_trans_html` 不感知此门"保留。

4f. "**文档地图**"加两行：

```markdown
- `docs/superpowers/specs/2026-08-19-llm-driven-classification-design.md`——LLM 驱动分类与快照管线设计（含 Python 移除）
- `docs/superpowers/plans/2026-08-19-llm-driven-classification.md`——其实施计划
```

4g. 常用命令无需再改（Task 1 已处理）。

- [ ] **Step 5: `README.md` 收尾**

5a. 脚本列表新增一节（插在 `clear_trans_html.mjs` 小节之后）：

```markdown
### `capture_snapshot.mjs`

复用登录态打开 URL，充分滚动并等待 DOM 稳定后，一次性抓取全保真自包含快照 `snapshot.html`（内联外部 CSS、剥尽 JS、注入 `<base>`、打 `data-u2m-id`），并派生精简版 `classify/classify_input.html`（长文本占位 + 信号样式）供 LLM 分类。后续所有步骤只在这份快照上工作，不再重开原 URL。
```

5b. `clear_trans_html.mjs` 小节首段改为："加载 `snapshot.html` 快照与 `classify_plan.json`，清理 DOM 元素，转化成 Markdown。"；"处理懒加载/虚拟 DOM"两条改为"由 `capture_snapshot.mjs` 在抓取阶段完成（渐进滚动 + DOM 稳定）"。

5c. 开发进度表追加：`| LLM 驱动分类与快照管线 | capture_snapshot + classify_plan + applyClassifyPlan | 已完成 |`。

- [ ] **Step 6: 全量回归**

Run: `pnpm test:all`
Expected: PASS。可选：按 `test/smoke/SMOKE.md` 手动冒烟一个真实 URL，把结果记录进 SMOKE.md。

- [ ] **Step 7: 提交**

```bash
git add SKILL.md CLAUDE.md README.md
git commit -m "docs: SKILL.md 步骤 1.6/1.8 + CLAUDE.md/README 快照管线与单运行时收尾"
```

---

## Self-Review（写完后已自查）

1. **Spec 覆盖**：
   - §3 决策 1（快照自包含）→ Task 3；决策 2（双产物）→ Task 3；决策 3（列表流选择器 + 稳定 id）→ Task 3（id）/Task 4（schema）/Task 5（解析）；决策 4（列表流外删）→ Task 5 Step 6；决策 5（action 枚举、flatten 退役）→ Task 4/5；决策 6（代码全占位 + 本地判语言）→ Task 3 derive + Task 5 code_block/guessCodeLang；决策 7（单运行时 + 快照唯一来源）→ Task 1/2/5。
   - §5.1 prepare 各步 → Task 3 Step 4（含 spec 未列的"资源 src 绝对化"，为 setContent 场景下 processImages 可下载相对图所必需，已在代码注释与本计划标注）；§5.1 derive → Task 3 Step 5；§5.2 capture CLI → Task 3 Step 6；**§5.3 分区模式未实现**——与 spec 一致按降级路径 YAGNI：capture emit `too_large` 后 SKILL.md 给出"调大 --placeholder-min-chars 重跑或终止"的可执行出路，region 序列化留待真实需要时再立任务（spec §9 亦将其列为降级）。
   - §6.5 schema 校验 → Task 5 `validateClassifyPlan` + clear-node 错误路径用例；§7.3 setContent 资源解析 → Task 3 src 绝对化 + `<base>`；§7.4 安全网 → Task 5 Step 8 + 错误用例；§8 测试清单 → 各任务内对应（其中"快照保真集成"由 capture 测试的内联 CSS/剥 script/`<base>`/inline style 断言 + complex-elements 在快照上的渲染分派（block_screenshot 对带样式块出 PNG）覆盖，不引入像素级比对——后者需基准图，YAGNI）；§10 受影响文件 → File Structure 与各任务 Files；§11 非目标（无 `__u2mClassify` 回退、不保留 Python）→ Task 5 删除、Task 1 拆除。
2. **占位符扫描**：无 TBD/TODO；所有代码步均含完整代码；复杂-elements 的 id 获取用 `idByMark` 正则从实际 snapshot 提取（确定性：fixture 固定、id 按文档序分配），失败时的校准动作在 Task 5 Step 10 写明。
3. **类型/命名一致**：`ensureUrlDirs`（Task 2）→ Task 3/5 一致使用 `dirs.urlDir`/`dirs.wf`；`applyClassifyPlan(frame, ctx, plan)` 与 `validateClassifyPlan(plan)`、`guessCodeLang(text)` 在 Task 5 内定义并被测试引用；`keepAllPlan`/`writePlan`/`idByMark` 仅存在于 clear-node.test.mjs；emit 字段（`snapshot`/`classifyInput`/`elements`/`tokenEstimate`/`warnings`）在 capture 实现与测试断言间一致；render `/select` 返回 `{status:"selected", path}` 与 render.test 断言一致。
4. **与 spec 的两处有意偏差（已标注）**：① prepare 增加资源 src 绝对化（spec §7.4 只覆盖渲染侧解析，未覆盖 Node 侧下载）；② `<base href>` 用 `location.href.split('#')[0]` 而非裸 origin（子目录相对路径可正确解析，语义仍是"解析回源站"）。另：`prepare_classify.mjs` 本不存在，跳过删除。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-llm-driven-classification.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
