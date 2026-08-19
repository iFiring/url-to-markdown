# 设计：LLM 驱动的元素分类与清洗

- 日期：2026-08-19
- 状态：待评审
- 范围：重构 SKILL 步骤 2 的"特殊元素分类"环节——登录后一次性抓取全保真 HTML 快照，后续所有步骤在此快照上工作；用一次 LLM 判断（找"列表流"父容器 + 逐块修改方案）替换 `script/lib/page-classify.js` 的硬编码启发式。原步骤 2 整体后移以消费该判断。

## 1 · 背景与问题

当前分类全部由代码完成：`page-classify.js` 的 `__u2mClassify` 按标签名 + 选择器 + 启发式（尺寸 / 文本密度 / 非文本子元素数）给每个元素打 `data-u2m-type`，`placeholder.mjs`/`placeholder.py` 的 `processSpecialElements` 循环读标记分派（screenshot / passthrough_svg / svg_convert / latex / mermaid / iframe 合并）。

实践问题：真实文章页正文常非标准 `h1/h2/h3/p/span/a` 标签，而是复杂多层 DIV。写死的尺寸/密度阈值在长页主列上会把文本密度稀释到阈值以下（虽有 `maxHeuristicText=500` 上限豁免，仍频繁误判），把整列正文当非文本吞掉、或漏判复杂结构。代码无法枚举所有页面结构。

此外，`prepare_classify` 与 `clear_trans_html` 各自重新开页、各跑一遍 prepare 以求 `data-u2m-id` 字节级匹配——真实 URL 的广告/A-B/时间戳致 DOM 漂移会使 id 失配（旧 §7.4 的已知边界），是脆弱不变量。

## 2 · 目标

- 登录后一次性抓取**全保真 HTML 快照**，后续分类、清洗、渲染分派都在此快照上工作——消除"各步骤重开页 + id 匹配"的脆弱不变量。
- 给 LLM 的输入是快照的**派生精简版**：长文本→占位符、仅信号样式内联、候选块打稳定 id，结构与样式信号保留而内容抹除——把 LLM 的理解成本压到最低（文章内容不需要了解）。
- 由 LLM 找出"列表流"父容器（多个章节/段落块的父组件）并逐块给出修改方案，替换硬编码启发式，消除大规模误判。
- 代码块按结构识别、文本不占位；语言由本地脚本判定（`data-lang`/class 优先，否则启发式检测）；代码块展示原文 + 语言围栏。
- 列表流外的内容一律当噪声删除；列表流内的特殊元素整块转成像素截图或既有分派类型，不拆零。
- 提供 LLM 少样本（输入/输出对）以保证识别准确。
- 保持双运行时镜像不变性（两运行时加载同一快照 + 同一 plan → manifest 一致）、emit 一行 JSON 契约、浏览器先于 emit 关闭。

## 3 · 关键决策（经头脑风暴确认）

1. **下载一次，后续全在快照上工作**：登录 + 滚动 + DOM 稳定后，捕获全保真 `snapshot.html`（仅剥 `<script>`，保留 `<style>`/`<link>`/图片/全部属性，注入 `<base href=origin>`）；渲染类分派（截图/SVG/图片下载）此后都加载此快照，不再重开原 URL。
2. **双产物**：全保真 `snapshot.html`（渲染源）+ 派生 `classify_input.html`（占位符 + 信号样式 + id，仅给 LLM）。两者由同一次开页、同一 DOM 状态派生，故 `data-u2m-id` 在两份里天然一致。
3. **块寻址 = 列表流选择器 + 稳定 id**：LLM 用一个选择器指出"列表流"父容器；prepare 给候选块注入稳定 `data-u2m-id`；逐块方案用 id 引用。兼顾"找父组件"与抗动态 class 失配。
4. **列表流划定块流，其外为噪声**：列表流内的块按 `action` 逐块分派；列表流外的一切一律删除（新的结构去噪）。Readability 仍在其后对存活 DOM 抽主体（三层去噪不重叠，§4.2）。
5. **type + clean 合并为 action**：旧 schema 的 `type`（分派类型）与 `clean`（keep/delete/flatten）折叠为单字段 `action`（`keep|delete|code_block|screenshot|passthrough_svg|svg_convert|latex|block_screenshot`）；`flatten` 退役（`keep` 的多层 DIV 交给 Readability 拍平）。
6. **代码块全占位 + 本地判语言**：所有长文本（含代码）→占位符，原件存于快照；LLM 靠结构（`<pre>`/`<code>`/`.hljs`/`.highlight`/`prism`/`data-lang`）识别 `code_block`，不读内容；语言由本地脚本从 `data-lang`/class 取，无则本地启发式检测。
7. **镜像不变性 = 加载同一快照 + 同一 plan**：`snapshot.html` 与 `classify_plan.json` 全局唯一，Node 与 Python 各自 `setContent` 加载同一份；预清洗/占位/id 注入逻辑只存在于共享 `page-*.js`，跑一次即烘进快照 → 两运行时产出一致。

## 4 · 架构与管线

新步骤序（原步骤 2 整体后移，编号顺延）：

```
0 init → 1 login → 1.5 detect_page → 1.6 capture_snapshot → [agent] 1.8 classify → 2 clear_trans_html(双侧) → 3 步骤3 → 4 步骤4 → 5 render
```

- **1.6 `capture_snapshot.mjs`**（Node-only，与 `detect_page.mjs`/`login_url.mjs` 同形态）：复用登录态开页 → 注入 `pageInit`（不变：IO 劫持 + mermaid 源码快照）→ 跑与 `detect_page` **同一序列**的 `progressiveScroll`/`waitForDomStable`（懒加载内容到位）→ evaluate 共享 `page-prepare.js` 的 `__u2mPrepareBody`（合并同源 iframe + 剥 `<script>` + 注入 `<base>` + 给候选块打 `data-u2m-id`）→ 同一 DOM 上分别序列化出 `snapshot.html`（全保真）与 `classify_input.html`（派生精简）→ emit 一行 JSON。
- **1.8 分类（agent 步骤，写入 SKILL.md）**：agent 读 `classify_input.html` + `script/lib/fewshot/` 少样本 → 写 `classify_plan.json`（列表流选择器 + 逐块 action）。LLM 判断本体，沿用步骤 3/4 的 agent 驱动模式。
- **步骤 2 `clear_trans_html`（Node+Python 双侧）**：`setContent(snapshot.html)` 加载快照（**不再 openPage+scroll+waitForDomStable**）→ 读 `classify_plan.json` → 删列表流外噪声 → 按 `action` 逐块分派（替换 `__u2mClassify` 循环）→ Readability/Turndown → sketch.md + manifest.json。

### 4.1 共享产物布局

`snapshot.html` 与 `classify/` 在 workflow 目录上一级，全局唯一，两运行时共读：

```
working/<url-dir>/
├─ snapshot.html                 ← 全保真快照（渲染源；带 data-u2m-id + <base>，保留 <style>/<link>/图片）
├─ classify/                      ← 全局共享
│  ├─ classify_input.html        ← 派生：长文本占位 + 信号样式内联 + data-u2m-id
│  └─ classify_plan.json         ← agent 写的判断结果
├─ node_workflow/  (sketch.md, assets/, manifest.json)
└─ python_workflow/ (…)
```

### 4.2 三层去噪不重叠

- **1.8（结构清洗）**：LLM 划定列表流、逐块给 action、列表流外删除——基于"结构 + 样式信号"判断，**不读文本语义**。
- **步骤 2 Readability**：从存活 DOM 抽主体、剥残留噪声。
- **步骤 4（文本去噪）**：Markdown 层去广告/推荐/版权、修表格——基于"文本语义"。

1.8 给 Readability 喂更干净的 DOM，不取代它；步骤 4 仍管文本层。

## 5 · `capture_snapshot.mjs` + 共享 `page-prepare.js`

### 5.1 `page-prepare.js`

普通非模块文件，双运行时当文本注入（分类/清洗逻辑唯一事实源，禁分叉进 .py/.mjs）。`capture_snapshot.mjs` 跑它一次，把结果烘进 `snapshot.html`。含两个具名导出：

**`function __u2mPrepareBody(cfg)`**（在活页 DOM 上原地变异，**仅 `capture_snapshot` 调用一次**）：

1. **合并同源内容 iframe**（吸收 `__u2mMergeIframes`，同阈值；主文档文本充足则不合并）。
2. **剥离 `<script>`**（mermaid 源码已由 pageInit 存为 `data-u2m-mermaid-src`，剥离 `<script>` 不丢）。**不剥** `<style>`/`<link rel=stylesheet>`/`<video>`/`<audio>`/图片——全保真快照需保留以供渲染（`video`/`audio` 是 `screenshot` 分派目标）。
3. **剥叶子噪声**：`.copy`、`.copy-btn`、`button[aria-label*="copy" i]`、`template`、`noscript`（非正文渲染内容，剥之不影响保真度，却防代码块里的复制按钮泄漏为文本噪声）。
4. **注入 `<base href="<origin URL>">`** 到 `<head>`，使相对 CSS/图片 URL 在 `setContent` 重载时仍解析回源站。
5. **打 `data-u2m-id`**：给"决策单元"候选打 ID（文档序递增 `data-u2m-id="n"`）——`div, section, article, aside, nav, header, footer, main, figure, table, thead, tbody, tr, canvas, svg, video, iframe, picture, ul, ol, li, dl, pre, blockquote, details, [role], [data-chart], .chart, .echarts, .highcharts, .MathJax, .MathJax_Display, .katex, .katex-display`。叶子文本元素（`p, span, a, code, em, strong, h1-h6, td, th`）不打 ID——由 Readability+Turndown 当文本处理。
6. 原地返回，不序列化。

**`function __u2mDeriveClassifyInput(cfg)`**（在已 prepare 的活页 DOM 上序列化出**精简版**，**仅给 LLM**）：

1. **长文本占位**：每个 `>N` 字符（默认 `N=40`，cfg 可覆盖）的文本节点内容替换为 `{{T<k>}}`（无损；原件不复制，仍在 `snapshot.html` 里）。**包括代码块文本**——代码靠结构识别，内容不读。
2. **剥 `<style>`/`<link rel=stylesheet>`/`<noscript>`/`<template>`**。
3. **白名单样式内联**：仅内联信号性属性——`position, display, float, clear, visibility, overflow, border(-*)?, border-radius, background(-color)?, box-shadow, width, height, min/max-(width|height), transform, z-index, flex(-*)?, grid(-*)?, gap`。**不内联** `color/font/text-*`（文本样式对"文本 vs 非文本"无信号且徒增 token）。
4. 返回 `document.body.outerHTML`（`data-u2m-id` 已由 `__u2mPrepareBody` 打好，与 `snapshot.html` 同源 → id 一致）。

`capture_snapshot.mjs` 序列化全保真快照直接取 `document.documentElement.outerHTML`（prepare 已剥 `<script>`、注入 `<base>`、打好 id、合并 iframe，其余原样保留）。

### 5.2 `capture_snapshot.mjs`

```
复用登录态 openPage(initScripts=[pageInit])        // page-init.js 不变
→ progressiveScroll + waitForDomStable              // 与 detect_page 同序列（共享常量）
→ evaluate(`(${pagePrepare})()`)                    // __u2mPrepareBody：合并 iframe + 剥 script + base + id
→ snapshot = evaluate(() => document.documentElement.outerHTML)   // 全保真
→ classifyInput = evaluate(`(${deriveClassifyInput})()`)           // 精简派生
→ 写 working/<url-dir>/snapshot.html
→ 写 working/<url-dir>/classify/classify_input.html
→ 估算 token（≈ classify_input 字符数 / 4）；超预算（默认 80000，cfg 可覆盖）→ emit too_large
→ emit 一行 JSON：
   {status:"ok",       snapshot:"<path>", classifyInput:"<path>", elements:<idCount>, tokenEstimate:<n>, warnings:[]}
   {status:"too_large", tokenEstimate:<n>, elements:<n>, reason:"..."}   // 不写 classify_input，exit 0（非 error，触发 agent 降级）
   {status:"error",     reason:"..."}                                     // exit 1
```

### 5.3 降级分区模式（`too_large` 时）

`capture_snapshot` emit `too_large` 后，agent 改走分区模式：capture 以 `data-u2m-region="k"` 把列表流的顶层块按 token 预算切成 N 个连续区，每区单独序列化其 `outerHTML` 为 `classify_input_r<k>.html`；agent 逐区按同 schema 出 plan，最后合并为一份 `mode:"region"` 的 `classify_plan.json`（id 跨区唯一、复用同一 id 序列）。跨区列表流判断降级（整块若跨区边界则无法整块截图，文档化该边界）。clear_trans_html 不区分 whole/region——只要 plan 合 schema 即消费。

### 5.4 关键不变量（简化）

`data-u2m-id` 由 `__u2mPrepareBody` 在活页 DOM 上注入一次，随后烘进 `snapshot.html`；`classify_input.html` 从同一 DOM 派生，id 同源。`clear_trans_html` 双侧 `setContent(snapshot.html)` 加载的是**同一份**快照 → id 天然一致，**不再有"各自重开页求匹配"的不变量与真实 URL 漂移边界**。scroll/stable 参数（60 轮 / 150ms / stableMs=1000 / maxMs=15000）从 `clear_trans_html.mjs`/`.py` 与 `detect_page.mjs` 抽成共享常量统一引用，禁止各自硬编码。

## 6 · `classify_plan.json` schema + agent 步骤 1.8 + 少样本集

### 6.1 schema（v2）

```json
{
  "version": 2,
  "mode": "whole",
  "listFlowSelector": "main > article",
  "blocks": [
    { "id": 12, "action": "keep" },
    { "id": 13, "action": "delete" },
    { "id": 14, "action": "code_block" },
    { "id": 15, "action": "screenshot" },
    { "id": 16, "action": "passthrough_svg" },
    { "id": 17, "action": "svg_convert" },
    { "id": 18, "action": "latex" },
    { "id": 19, "action": "block_screenshot", "blockOf": 19 }
  ]
}
```

- `mode`：`whole`（整页一次）/ `region`（`too_large` 降级分区合并）。
- `listFlowSelector`：一个 CSS 选择器，指向"列表流"父容器（多个章节/段落块的父组件）。clear_trans_html 解析它定位块流；其外的元素一律删除。
- `blocks[*].id`：`data-u2m-id`（int），仅指列表流内的候选块。
- `blocks[*].action`：`keep | delete | code_block | screenshot | passthrough_svg | svg_convert | latex | block_screenshot`。
  - `keep`：留 DOM，Readability+Turndown 当文本（多层 DIV 由 Readability 拍平，故无需 `flatten`）。
  - `delete`：删除该块（列表流内的广告/推荐块）。
  - `code_block`：代码块，原文从 `snapshot.html` 取回，本地判语言，产出带语言围栏的代码（§7.2）。
  - `screenshot`/`passthrough_svg`/`svg_convert`/`latex`：直接复用 `placeholder.mjs`/`placeholder.py` 既有分支与 manifest 条目语义。
  - `block_screenshot`：整块截图成 PNG，不经步骤 3。
- `blocks[*].blockOf`：仅 `block_screenshot` 用，int，默认 = `id` 自身；指整块截图的容器 id。

### 6.2 type ↔ 既有分派映射

- `keep`/`delete`/`code_block` = 不走复杂元素分派（Readability/Turndown 当文本，或 `code_block` 由 clear_trans_html 规范成 `<pre><code>` 后交 Readability/Turndown 出围栏；**不进 manifest、不经步骤 3**）。
- `screenshot` / `passthrough_svg` / `svg_convert` / `latex`：复用 `placeholder.mjs`/`placeholder.py` 既有分支与 manifest 条目语义（done/pending 不变）。
- `block_screenshot` = **新增**：截图 `blockOf` 所指容器整块为 PNG，替换该容器，manifest `{type:"block_screenshot", final:"assets/complex/COMPLEX_DIV_n.png", status:"done"}`，**不经步骤 3**。
- `mermaid` **不进 plan**：仍由 `processMermaid`（读 page-init 的 `data-u2m-mermaid-src`，该属性在快照中保留）处理；LLM 在 classify_input 里看到 `.mermaid` 容器带该属性即知已托管。

### 6.3 agent 步骤 1.8（SKILL.md）

```
读 working/<url-dir>/classify/classify_input.html
读 script/lib/fewshot/ 下每对 <name>.html + <name>.json 作为少样本
按 §6.1 schema 产 working/<url-dir>/classify/classify_plan.json
```

prompt 写进 SKILL.md 步骤 1.8 操作说明（不内联示例正文，仅指 few-shot 目录 + schema + 三层去噪边界提醒：1.8 只做结构判断，不读文本语义、不改写文本）。**`listFlowSelector` 选取约束**：应圈住文章主体块流，且**包含文章主标题**（若主标题是 listFlow 的首个块或在其容器内）；列表流子树外的兄弟节点（nav/aside/footer/广告）会被 clear_trans_html 删除，故 selector 不可把标题落在删除侧。agent 运行时读 few-shot 文件。

### 6.4 少样本集 `script/lib/fewshot/`

手写固定集，3–5 对，复用为契约测试夹具：

- `nested-text-wrapper` — 复杂多层 DIV 正文容器 → `keep`（Readability 拍平）
- `sidebar-ads-nav` — 列表流外的侧栏/广告/推荐兄弟 → `listFlowSelector` 不含它们 → clear_trans_html 删
- `title-in-listflow` — 主标题是 listFlow 首块 → `keep`（验证 selector 不可把标题落在删除侧）
- `chart-card-grid` — 图表卡片网格（列表流内的特殊块）→ `block_screenshot`
- `canvas-video` — canvas/video → `screenshot`
- `big-svg-and-latex` — 大 SVG → `passthrough_svg`；MathJax → `latex`
- `code-block` — `<pre class="hljs" data-lang="python">` → `code_block`（占位文本，结构识别）

每对断言：输入片段含合法 `data-u2m-id` + 信号内联样式 + 长文本已占位；输出 plan 合 schema、`listFlowSelector` 合法、blocks 的 id ⊆ 输入 id 集、`action` 取值正确、列表流外无 id。

### 6.5 schema 校验

`clear_trans_html` 读 plan 时校验：`version`、`listFlowSelector` 为非空字符串、`blocks[*].id`∈int、`action`∈enum、`blockOf`∈int?。非法 → throw（上层 catch → `emitError`，一行 JSON），stderr 指出错项，agent 据以修正重写。

## 7 · `clear_trans_html` 改造（Node+Python 双侧镜像）

### 7.1 新 main 流（替换 openPage/scroll + `processSpecialElements`）

```
launch browser (login cookies)                     // 仅渲染分派需要
page.setContent(snapshot.html) + wait             // 加载同一快照，不再 openPage+scroll+waitForDomStable
ctx = makeCtx(...)
await processMermaid(frame, ctx)                  // 不变（读 data-u2m-mermaid-src）
const plan = JSON.parse(await fs.readFile(planPath))   // working/<url-dir>/classify/classify_plan.json
await applyClassifyPlan(frame, ctx, plan)         // 新：删列表流外 + 逐块按 action 分派
await processImages(frame, ctx)                  // 不变（data-u2m-asset 跳过逻辑覆盖 block_screenshot 产物）
await frame.evaluate(`(${pageClean})()`)          // 不变（剩行号列清理等）
readability → turndown → sketch.md + manifest.json // 不变
```

`page-merge.js` 与 `page-classify.js` 在本设计后**不再被引用**（合并逻辑并入 `__u2mPrepareBody`；分类被 plan 驱动分派取代）。是否删除文件留作实施期决定，但不得再有调用方。

### 7.2 `applyClassifyPlan(frame, ctx, plan)`（`placeholder.mjs`，`placeholder.py` 镜像 `apply_classify_plan`）

1. 校验 plan schema（§6.5）；非法 → throw。
2. **解析 `listFlowSelector`**：`frame.$(listFlowSelector)`；null → throw（agent 选错，stderr 反馈）。**删除列表流子树外的顶层节点**：在 listFlow 的父节点上，移除与 listFlow 同级的兄弟节点（导航/侧栏/页脚/广告等结构噪声）。**不删 listFlow 子树内部**——逐块由 `action` 处理（见下）。
3. **逐块按 `action` 分派**（plan 序，跳 detached）：每 item 取 `frame.$('[data-u2m-id="n"]')`；**id 必然命中**（来自同一快照），不设漂移 warning 路径。命中即：
   - `keep`：不动。
   - `delete`：`remove()`。
   - `code_block`（**新分支**）：读该块在快照里的原文文本（`element.textContent`，未占位——快照是全保真）→ 判语言（`data-lang`/class 优先，否则本地启发式检测）→ 把该块替换为规范 `<pre><code class="language-<lang>">原文</code></pre>`（标 `data-u2m-code` 以被 `processImages` 跳过）→ **不进 manifest、不经步骤 3**：代码是文本而非复杂资源，Readability+Turndown 自然把 `<pre><code class="language-x">` 转成带语言的围栏代码块。
   - `screenshot`/`passthrough_svg`/`svg_convert`/`latex`：复用 `placeholder` 既有分支一字不改。
   - `block_screenshot`：解析 `blockOf`（默认 `id`）→ `frame.$('[data-u2m-id="blockOf"]')` → `screenshot({path: abs/COMPLEX_DIV_n.png})` → `replaceWithHtml('<img src=... data-u2m-asset>')` → manifest `{type:"block_screenshot", final, status:"done"}`。
4. 返回处理数。

### 7.3 镜像要点

- `snapshot.html` 与 `classify_plan.json` 是同一份文件，两运行时各 `setContent` 加载 → DOM 起点一致 → 同 plan 同操作 → manifest 字节级一致（complex-elements 夹具断言继续成立，且比旧"各自重开页"更可靠）。
- `page-prepare.js` 共享文本，仅 `capture_snapshot`（Node-only）注入一次；`clear_trans_html` 不再注入它，只 `setContent`。
- `apply_classify_plan` 用既有 `_call_on_element` 适配器处理需元素实参的分支（inline/latex），镜像规则与现状一致。
- greenlet 线程绑定——`setContent` 后的 screenshot/svg 串行，不引入线程池。

### 7.4 `setContent` 资源解析

`setContent(snapshot.html)` 无源 URL，相对 CSS/图片会失解析——快照里已注入 `<base href="<origin>">`，浏览器据此解析回源站；`bypassCSP:true`（已设）处理 CSP；页面 context 继承登录 cookies，受保护资源仍可取。若个别跨域资源被拒，截图降级（warning），不崩。

### 7.5 安全网

plan 缺失或非法 → `emitError("缺/非法 classify_plan.json: ...", 1)`（一行 JSON 契约不破）；SKILL.md 步骤序强制 1.8 先于 2。`listFlowSelector` 解析为 null → `emitError`，stderr 指出选择器失配，agent 修正重写。

## 8 · 测试

沿用既有分层（`node --test test/unit` + `uv run pytest test/unit test/integration`，夹具服务器 + 子进程 CLI）：

- **`page-prepare.js` 集成**：夹具页含 `<script>`/`<style>`/广告/`<video>`/同源 iframe → 断言 `<script>` 已剥、`<style>`/`<link>`/图片**保留**（全保真）、`<base>` 已注入、`data-u2m-id` 仅落在候选集（叶子文本无 id）、iframe 已合并。
- **派生 pass 集成**：断言长文本 → `{{T*k}}`（含代码块文本占位）、信号属性已内联、`color/font-*` 未内联、id 与 `snapshot.html` 同源一致。
- **快照保真集成**：`setContent(snapshot.html)` 加载后断言某复杂元素带颜色/图片渲染（未被剥）。
- **`applyClassifyPlan` 集成**：给定夹具 + 手工 plan → 断言列表流子树外兄弟删除、`delete` 移除、各 action 分派产出正确 manifest + assets、`code_block` 从快照取原文 + 语言围栏且**不进 manifest/不经步骤 3**、`block_screenshot` 产 PNG + `status:done` + `data-u2m-asset` 标记、产出 img/code 被 `processImages` 跳过、listFlow 内主标题 `keep` 不被误删、id 必命中（无漂移路径）。
- **少样本契约测试**：遍历 `script/lib/fewshot/*.json` → 断言 schema 合法、`listFlowSelector` 非空、blocks id ⊆ 对应 `.html` 的 id 集、`action` 取值合法、`title-in-listflow` 用例的主标题 id 落在 blocks 内。
- **`capture_snapshot.mjs` CLI 契约**：emit 恰好一行 JSON；`ok`/`too_large`/`error` 三路径；`too_large` 不写 classify_input、exit 0；`elements`/`tokenEstimate`/`snapshot`/`classifyInput` 字段在。
- **`clear_trans_html` 回归（双侧）**：有快照+plan 时产 sketch.md + manifest；`svg_convert` 留 `{{COMPLEX_DIV_n}}` 占位；`block_screenshot`/`code_block` 已替换；plan 缺失/非法 → `emitError` 一行。
- **镜像不变性**：complex-elements 夹具 → 两运行时 manifest 相同（扩既有断言，覆盖 `block_screenshot` 条目）。
- **scroll/stable 共享常量**：单元断言 `capture_snapshot`、`detect_page`、`clear_trans_html` 双侧引用同一组参数（防各自硬编码致内容/ID 错位）。

## 9 · 错误处理与降级汇总

| 阶段 | 现象 | 处置 |
|---|---|---|
| 1.6 capture | classify_input 过大超 token 预算 | emit `too_large`（exit 0），不写 classify_input；SKILL.md 指示 agent 走分区模式（`mode:"region"`）或缩白名单重跑 |
| 1.6 capture | 开页/注入/序列化失败 | emit `error`（exit 1），reason 反馈用户 |
| 1.6 capture | `setContent` 资源解析个别失败 | warning，截图降级，不崩 |
| 1.8 classify | agent 产 plan 非法/缺字段 | clear_trans_html emit `error`（一行），stderr 指出错项；agent 据 stderr 修正重写 |
| 1.8 classify | `listFlowSelector` 解析为 null | clear_trans_html emit `error`，stderr 指出选择器失配；agent 修正重写 |
| 1.8 classify | plan 缺失（未跑步骤 1.8） | clear_trans_html emit `error`，提示先跑 1.8 |
| 2 clear | 单 action 分派异常 | 沿用现状：`warnings.push` + 移除该 `data-u2m-id` 继续 |
| 2 clear | 单 workflow 失败 | 沿用：另一份继续，单选模式 |
| 全程 | emit 后进程退出 | 沿用：浏览器/viewer 在 emit 前关闭，无孤儿 chromium |

## 10 · 受影响文件

新增：
- `script/capture_snapshot.mjs`（Node-only CLI，替代旧 `prepare_classify.mjs`）
- `script/lib/page-prepare.js`（共享脚本，含 `__u2mPrepareBody` + `__u2mDeriveClassifyInput`，吸收 page-merge 逻辑）
- `script/lib/fewshot/`（手写少样本对，v2 schema）
- `script/pylib/` 对应镜像（`apply_classify_plan` 于 `placeholder.py`）
- 测试夹具与用例（§8）

修改：
- `script/clear_trans_html.mjs` / `script/clear_trans_html.py`（新 main 流：`setContent(snapshot.html)` + 调 `applyClassifyPlan`/`apply_classify_plan`，移除 openPage/scroll/prepare）
- `script/lib/placeholder.mjs` / `script/pylib/placeholder.py`（新增 `applyClassifyPlan`/`apply_classify_plan` + `code_block` 分支，`processSpecialElements` 不再被调用）
- `SKILL.md`（新增步骤 1.6/1.8，步骤 2 改为消费快照+plan；步骤序与决策表更新）
- `CLAUDE.md`（管线顺序、快照双产物、分派类型表、镜像说明、文档地图更新）

废弃（不再有调用方，实施期决定是否删除）：
- `script/lib/page-classify.js`
- `script/lib/page-merge.js`（逻辑并入 `__u2mPrepareBody`）
- `script/prepare_classify.mjs`（被 `capture_snapshot.mjs` 取代）

## 11 · 非目标（YAGNI）

- 不保留双分类器（LLM plan 为主，无 `__u2mClassify` 回退路径）。
- 不让 LLM 改写文本语义（步骤 4 仍负责文本去噪）；LLM 不读文章/代码内容。
- 不在脚本内调 Claude API（LLM 判断是 agent 步骤，脚本保持纯 Playwright+fs）。
- 不做跨区域列表流的完美对齐（分区降级模式文档化该降级）。
- 不引入自由形修改指令（逐块 `action` 仅枚举值，不做"任意重构"——延后）。
- 不保留 `flatten`（`keep` 的多层 DIV 交 Readability 拍平）。
