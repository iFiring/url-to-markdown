# SKILL 管线优化设计

**日期**：2026-08-20
**状态**：设计已确认，待实施

## 1. 概述

将现有 9 子步骤管线（0, 1, 1.5, 1.6, 1.8, 2, 3, 4, 5）重构为 6 步管线（0, 1-5）。核心变化：

- 步骤 1 合并登录、滚动、虚拟列表检测、快照下载为单一脚本
- 新增步骤 2（结构清洗）、3（LLM 关键 ID 识别）、4（分块）、5（LLM 多层块转化）
- 旧步骤 1.8、2-5（即原 classify + clear_trans_html + Readability + Turndown + 预览）本次不涉及，后续单独迭代

## 2. 管线架构

| 步骤 | 执行者 | 脚本 | 产物 |
|---|---|---|---|
| **0** | 脚本 | `script/init.sh`（不变） | 环境就绪 |
| **1** | 脚本 | `script/snapshot.mjs` + `lib/snapshot-*.mjs` | `steps/1_snapshot.html` |
| **2** | 脚本 | `script/clean_snapshot.mjs` | `steps/2_clean_snapshot.html` |
| **3** | LLM | SKILL.md 指导 | `steps/3_key_ids.json` |
| **4** | 脚本 | `script/chunker.mjs` | `steps/4_chunk_list.json` |
| **5** | LLM | SKILL.md 指导 | `steps/5_llm_chunk_list.json` |

### 产物链

```
steps/1_snapshot.html (全保真快照)
  → steps/2_clean_snapshot.html (纯结构+占位符)
    → steps/3_key_ids.json (关键 ID)
      → steps/4_chunk_list.json (分块列表)
        → steps/5_llm_chunk_list.json (LLM 转化后分块)
```

### 目录结构

```
working/<url-dir>/
└── steps/
    ├── 1_snapshot.html
    ├── 2_clean_snapshot.html
    ├── 3_key_ids.json
    ├── 4_chunk_list.json
    └── 5_llm_chunk_list.json
```

`steps/` 位于 `working/<url-dir>/` 下，与现有工作目录结构兼容。`<url-dir>` 命名规则不变（非 `[A-Za-z0-9.-]` → `_`，超 120 字符截断 + sha256 前 8 hex）。

## 3. 步骤 1 — 合并快照

### 架构

方案 B：薄壳入口 + lib/ 编排模块。整个步骤 1 共享一个浏览器实例。

### `script/snapshot.mjs`（薄壳入口）

参数：`<url> [--timeout 300000] [--scroll-rounds 60]`

```
browser = await launchBrowser(viewport, bypassCSP, mediaAbort, proxy, initScripts)
page = await browser.newPage()
try {
  await snapshotLogin(page, url, {timeout, storageStatePath})
  await snapshotScroll(page, {scrollRounds})
  await snapshotDetect(page)
  await snapshotCapture(page, {urlDir, tokenBudget, placeholderMinChars})
} catch (e) {
  await browser.close()
  return emitError(e.reason || e.message)
}
await browser.close()
emit({status:'ok', ...})
```

失败不询问重试——只把原因给用户。

### lib/ 模块

| 模块 | 职责 | 签名 |
|---|---|---|
| `snapshot-login.mjs` | goto URL → 六信号检测 → Screencast viewer（如需登录） | `(page, url, opts) → {needsLogin}` |
| `snapshot-scroll.mjs` | 渐进滚动 N 轮 × 150ms + DOM 稳定等待 | `(page, opts) → void` |
| `snapshot-detect.mjs` | 注入 page-detect.js → 复用滚动后页面状态检查签名 | `(page) → void`（虚拟列表时 throw） |
| `snapshot-capture.mjs` | 注入 page-prepare.js → evaluate → 写盘 | `(page, opts) → {snapshotPath}` |

### 快照规格

`steps/1_snapshot.html` 是全保真 HTML：

- 完整 DOM 结构
- 内联 CSS（`<style>` 标签，来自外部 CSS 内联化）
- 元素 inline style 属性
- **剔除所有 Style 的字体属性**（font-family, font-size, font-weight, font-style, line-height, letter-spacing, text-decoration 等）
- 剥尽 JS（无 `<script>`、无 `on*` 属性）
- 含 `data-idx`（对 div/section/article/p/ul/ol/li/h1-h6/table/blockquote/pre/figure/canvas/svg/video/iframe/.katex 等候选元素打递增 ID）
- 含 `<base href>` 指向原页面 URL

### 执行流程

```
login → 已登录/登录完成
       → scroll（渐进滚动）
       → detect（复用滚动后状态，签名消失 = 虚拟列表 → throw）
       → capture（evaluate __u2mPrepareBody → 写盘）
       → 关浏览器 → emit ok
```

## 4. 步骤 2 — 结构清洗

### `script/clean_snapshot.mjs`

参数：`<url-dir>`（相对 workingRoot 或绝对路径）

使用 Playwright 打开 `steps/1_snapshot.html`，在浏览器内执行清洗函数，写 `steps/2_clean_snapshot.html`。

### 清洗规则

1. 删除所有 `style` 属性
2. 删除所有 `<style>` 标签及其内容
3. 删除所有 `<link rel="stylesheet">` 标签
4. 删除 `<base>` 标签
5. **保留**所有 `class` 属性（class 名有语义价值且体积小，辅助步骤 3 LLM 识别结构）
6. `<svg>` → `<svg></svg>`（删除所有属性和子元素）
7. 长文本占位：文本节点 `textContent.length > 16` → 替换为 `{{LONG_TEXT_k|N_CHARS}}`
   - `k`：文档内全局递增序号
   - `N`：原文字符数
   - 例：`{{LONG_TEXT_3|245_CHARS}}`

### 保留的属性

- `data-idx`（唯一标识）
- `class`（语义辅助）

### 产物

`steps/2_clean_snapshot.html`：完整 HTML 文档，零样式、零 JS、SVG 为空壳、长文本为占位符。

## 5. 步骤 3 — LLM 关键 ID 识别

### 执行者

LLM（由 SKILL.md 指导）

### 输入

读 `steps/2_clean_snapshot.html`

### 任务

仅根据 DOM 结构（元素层级、标签类型、嵌套深度）和 `{{LONG_TEXT_k|N_CHARS}}` 占位符分布，找到：

1. **标题分块**的 `data-idx`（文章主标题）
2. **说明分块**的 `data-idx`（描述、作者、日期等元数据）
3. **列表流**的父组件 `data-idx`（文章主体区域，可能多个）

### 约束

- 不读语义内容（文本已被占位）
- `listFlowIds` 是列表流**最外层父元素**的 data-idx，该父元素内应包含多个重复子结构
- 不选 `<body>` 或 `<html>`

### 产物

```json
{
  "titleIds": [42],
  "descriptionIds": [43, 44],
  "listFlowIds": [10, 88]
}
```

## 6. 步骤 4 — 分块

### `script/chunker.mjs`

参数：`<url-dir>`

读 `steps/3_key_ids.json` + `steps/1_snapshot.html`，使用 Playwright 打开快照，在浏览器内执行分块函数，写 `steps/4_chunk_list.json`。

### 分块算法

1. **定位列表流**：通过 `listFlowIds` 找到列表流父元素（`[data-idx=N]`）
2. **遍历子树**：对列表流内的每个直接子元素，判断 Phrasing / Flow：
   - **Phrasing content**（HTML 标准行内元素）：`span, a, em, strong, code, img, br, sub, sup, small, b, i, u, mark, q, kbd, samp, var, wbr, abbr, cite, dfn, time, data` 等
   - **Flow content**（HTML 标准块级元素）：`div, section, article, p, ul, ol, li, dl, h1-h6, table, blockquote, pre, figure, hr, nav, aside, header, footer` 等
3. **分块决策**：
   - 纯 Phrasing 子元素 → `type: "phrasing"`，`needsLLM: false`
   - Flow 子元素，内部无嵌套 Flow → `type: "flow"`，`needsLLM: false`
   - Flow 子元素，内部有嵌套 Flow → `type: "multiLayer"`，`needsLLM: true`
4. **内联样式计算**（仅 `multiLayer` 块）：
   - 对该块内所有元素调用 `getComputedStyle`
   - 将计算结果写入元素 `style` 属性
   - 序列化为 HTML 字符串存入 `styledHtml` 字段

### 标题/说明块

`titleIds` 和 `descriptionIds` 也作为独立块加入列表，类型固定为 `phrasing`。

### 产物

```json
{
  "chunks": [
    {
      "id": 1,
      "type": "phrasing",
      "dataU2mId": 55,
      "html": "<p>{{LONG_TEXT_3|245_CHARS}}</p>",
      "needsLLM": false
    },
    {
      "id": 2,
      "type": "flow",
      "dataU2mId": 60,
      "html": "<div data-idx=\"60\"><h2>{{LONG_TEXT_4|120_CHARS}}</h2></div>",
      "needsLLM": false
    },
    {
      "id": 3,
      "type": "multiLayer",
      "dataU2mId": 70,
      "html": "<div data-idx=\"70\">...</div>",
      "styledHtml": "<div data-idx=\"70\" style=\"display:flex;...\">...</div>",
      "needsLLM": true
    }
  ]
}
```

## 7. 步骤 5 — LLM 多层块转化

### 执行者

LLM（由 SKILL.md 指导）

### 输入

读 `steps/4_chunk_list.json`，筛选 `needsLLM: true` 的块。

### 任务

对每个 `multiLayer` 块，基于 `styledHtml`（带完整内联样式的 HTML）进行转化：

- **转化为 Phrasing 内容**：将复杂嵌套结构扁平化为简洁的行内文本描述（保留语义、丢失布局）
- **转化为 SVG 图片**：对于图表、数据可视化、复杂布局等无法用文本表达的内容，生成语义等价的 SVG

### 约束

- 优先转化为 Phrasing——只有图表/可视化/纯布局类内容才转 SVG
- SVG 转化：生成自包含 SVG（含 xmlns、viewBox），不依赖外部资源
- 每个块的转化独立进行，不跨块引用

### 产物

```json
{
  "chunks": [
    {
      "id": 3,
      "originalType": "multiLayer",
      "resultType": "phrasing",
      "content": "这是扁平化后的文本描述..."
    },
    {
      "id": 7,
      "originalType": "multiLayer",
      "resultType": "svg",
      "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 200\">...</svg>"
    }
  ]
}
```

## 8. Python 残留清理

| 位置 | 操作 |
|---|---|
| `script/pylib/` | 删除空目录 |
| `script/lib/env.mjs:17` | 删注释"Node/Python 必须一致" |
| `script/lib/env.mjs:29` | 删注释"双工作流子目录随 Python 运行时移除" |
| `test/smoke/SMOKE.md` | 更新 Python 命令为 node 命令 |
| `test/__pycache__/` | 删除 |
| `.pytest_cache/` | 删除 |
| `.venv/` | 删除 |
| `.gitignore` | 删除 "# Python" 段落 |
| `docs/design/url-to-markdown-design.md` | 加顶部 ⚠️ 过时警告 |

## 9. 旧脚本处理

| 脚本 | 处理 |
|---|---|
| `script/login_url.mjs` | 删除（逻辑迁入 `lib/snapshot-login.mjs`） |
| `script/detect_page.mjs` | 删除（逻辑迁入 `lib/snapshot-detect.mjs`） |
| `script/capture_snapshot.mjs` | 删除（逻辑迁入 `lib/snapshot-capture.mjs`） |
| `script/clear_trans_html.mjs` | 保留（后续步骤 6 用） |
| `script/render_markdown.mjs` | 保留（后续步骤 8 用） |
| `script/lib/placeholder.mjs` | 保留（后续步骤 6 用） |
| `script/lib/fewshot/` | 保留（后续步骤 1.8 用） |
| `script/lib/page-*.js` | 保留（共享页面脚本） |

## 10. 测试策略

### 新增测试

- **`test/unit/clean-snapshot.test.mjs`**：清洗规则单测（style 删除、SVG 清空、长文本占位格式）
- **`test/unit/chunker.test.mjs`**：分块逻辑单测（Phrasing/Flow 判定、多层检测、styledHtml 生成）
- **`test/unit/snapshot.test.mjs`**：步骤 1 入口集成测试（mock lib/ 模块，验证流程编排和错误传播）

### 迁移测试

- 现有 `login_url`、`detect_page`、`capture_snapshot` 的集成测试迁移到 `snapshot.mjs` 下
- 保留对 `page-*.js` 共享脚本的单测

### 契约测试

- 所有新 CLI 遵循单行 JSON 输出契约（`emit`/`emitError`/`usage`）
- 退出码：0=成功，1=错误，2=usage_error
