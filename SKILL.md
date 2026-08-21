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

所有产物存放在 `working/<url-dir>/steps/` 目录下，`<url-dir>` 由 URL 自动净化生成。

### 步骤 0 · 初始化环境（仅首次或环境变更时）

```bash
bash <skill-root>/script/init.sh
```

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 1 |
| `error` | **终止全部流程**，把 `reason` 反馈给用户 |

stderr 中的"警告"不阻断，可忽略。

### 步骤 1 · 快照下载

```bash
node <skill-root>/script/snapshot.mjs <url> [--timeout 300000] [--scroll-rounds 60]
```

合并登录检测、渐进滚动、虚拟列表检测、全保真快照抓取为一个步骤。脚本内部依次执行：
1. **登录阶段**：打开 URL，六信号检测是否需要登录；如需登录则弹出 Screencast viewer 供人工操作
2. **滚动阶段**：渐进滚动到底部再回顶，触发懒加载，等待 DOM 稳定
3. **检测阶段**：检查是否为虚拟列表（仅渲染可见窗口的页面无法全文转化）
4. **快照阶段**：注入页面脚本，合并同源 iframe、内联外部 CSS、剥尽 JS、标记 `data-u2m-id`，序列化全保真快照。标记覆盖 body 内所有元素（文档序连续编号），仅排除纯文本修饰/薄语义行内标签（`strong`/`em`/`b`/`i`/`br`/`wbr`/`abbr`/`q`/`time`/`kbd` 等）与 svg/math 的内部后代（根元素本身仍标记）

产物：`steps/1_snapshot.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 2。`elements` 字段为标记元素数量 |
| `error`（reason=`virtual_list`） | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error`（reason=`login_timeout`/`login_aborted`） | 询问用户是否重试登录；重试则再次运行本命令 |
| `error`（其他） | 把 `reason` 反馈给用户并终止 |

### 步骤 2 · 结构清洗

```bash
node <skill-root>/script/clean_snapshot.mjs <url-dir>
```

`<url-dir>` 为 `working/` 下的 URL 目录名（相对或绝对路径均可）。

打开 `steps/1_snapshot.html`，单趟结构清洗，产出两份快照（共享同一套清洗与占位）：
- 共同清洗（两版一致）：
  - 删除 `<link>` 标签、`<meta>` 标签、`<base>` 标签（`<title>` 保留）
  - 删除按钮类控件（`<button>`、`role="button"`、按钮型 `<input>`）——交互 UI 与正文结构无关
  - 级联删除空元素（子树无非空白文本、无内容元素的空壳）；`img`/`svg`/`br`/`hr`/`iframe`/`pre`/`h1`-`h6` 等内容元素即使无子节点也保留，含文本的元素不受影响
- 仅清洗版：删除所有 `style` 属性与 `<style>` 标签、清空 SVG 内容（仅保留空 `<svg></svg>` 壳）
- 仅带样式版：保留 `style` 属性、`<style>` 标签与完整 SVG（SVG 内文字不占位、原样保留）
- 长文本占位（两版编号逐一对应；中英文分标准；纯空白文本节点与 svg/style 子树文本不占位）：
  - 中文文本（含汉字）：字符数 > 16 → `{{LONG_TEXT_k|N_chars}}`（N=字符数）
  - 英文文本（不含汉字）：单词数 > 12 → `{{LONG_TEXT_k|N_words}}`（N=单词数）
  - 原文按占位编号记入 `steps/2_long_text.json`（编号 → 原文映射），供后续流程恢复

产物：`steps/2_clean_snapshot.html`（步骤 3 的结构视图）、`steps/2_clean_style_snapshot.html`（带样式版）、`steps/2_long_text.json`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 3。`longTextCount` 为占位符数量，`longText` 为恢复清单路径，`styledSnapshot` 为带样式版路径 |
| `error` | 按 `reason` 处理：快照缺失→先跑步骤 1；其他→反馈给用户 |

### 步骤 3 · 关键 ID 识别（LLM 步骤）

读取 `steps/2_clean_snapshot.html`。

你的任务：仅根据 DOM 结构（元素层级、标签类型、嵌套深度）和长文本占位符（`{{LONG_TEXT_k|N_chars}}` / `{{LONG_TEXT_k|N_words}}`）分布，找到以下三类关键元素的 `data-u2m-id`：

1. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器
2. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等。可为空数组
3. **列表流**（`listFlowIds`）：文章主体区域的父容器 ID。列表流是包含多个子块（段落、图片、代码块等）的最外层容器，可能有多个

**约束**：
- 不读语义内容——文本已被 `{{LONG_TEXT_k|…}}` 占位，你只能看到结构
- `listFlowIds` 是列表流**最外层父元素**的 `data-u2m-id`，不是子元素的
- 不选 `<body>` 或 `<html>`——它们的 ID 无意义
- 如果找不到明确的标题或说明元素，对应数组可为空
- 列表流至少选一个——它是后续分块的根容器

将结果写入 `steps/3_key_ids.json`：

```json
{
  "titleIds": [42],
  "descriptionIds": [43, 44],
  "listFlowIds": [10, 88]
}
```

### 步骤 4 · 分块

```bash
node <skill-root>/script/chunker.mjs <url-dir>
```

读取 `steps/3_key_ids.json` 和 `steps/1_snapshot.html`，在浏览器中按列表流遍历子元素，将内容分为三类块：

| type | 条件 | needsLLM |
|---|---|---|
| `phrasing` | 纯行内元素（`<a>`/`<span>`/`<em>` 等 HTML Phrasing content 标签） | `false` |
| `flow` | 单层块级元素（`<p>`/`<div>`/`<h1>`-`<h6>`/`<ul>`/`<ol>` 等，且子元素不含嵌套 Flow） | `false` |
| `multiLayer` | 未知标签（`<svg>`/`<canvas>`/`<video>`/`<iframe>`/`<math>` 等）或含嵌套 Flow 的块级元素 | `true` |

`multiLayer` 块会附带 `styledHtml`（带有效样式内联的 HTML 副本：白名单视觉属性的计算值，`var()` 已解析，与 UA 默认值及父元素继承值差分去重；剥离 class 与字体名，缩进空白折叠，pre 内容原样保留），供步骤 5 的 LLM 转化使用。

产物：`steps/4_chunk_list.json`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 5。`totalChunks` 为总块数，`llmChunks` 为需 LLM 处理的块数 |
| `error` | 按 `reason` 处理：快照缺失→跑步骤 1；key_ids 缺失→跑步骤 3；其他→反馈给用户 |

### 步骤 5 · 多层块转化（LLM 步骤）

读取 `steps/4_chunk_list.json`，筛选 `needsLLM: true` 的块（即 `type: "multiLayer"` 的块）。

你的任务：对每个 `multiLayer` 块，基于其 `styledHtml`（带有效内联样式的 HTML，仅含渲染有效的计算值）进行转化。每个块有两种转化路径：

**路径 A：转化为 Phrasing 内容（优先）**

将复杂嵌套结构扁平化为简洁的行内文本描述。保留语义信息，丢失布局细节。适用于：
- 卡片式布局（标题+描述的卡片 → 用文字描述卡片内容）
- 嵌套列表/表格的变体（→ 用简洁文本概括）
- 装饰性布局容器（→ 提取其中的有意义文本）

**路径 B：转化为 SVG 图片（兜底）**

对于无法用文本充分表达的内容，生成语义等价的自包含 SVG。适用于：
- 图表、数据可视化（柱状图、折线图、饼图等）
- 复杂几何布局（信息图、流程图、组织结构图）
- 纯视觉内容（图标组合、装饰性图形）

**约束**：
- **优先转化为 Phrasing**——只有图表/可视化/纯布局类内容才转 SVG
- SVG 转化要求：生成自包含 SVG（含 `xmlns`、`viewBox`），不依赖外部资源（字体用系统字体栈，图片用占位矩形代替）
- 每个块的转化**独立进行**，不跨块引用
- 不修改或补充原文中不存在的信息
- `phrasing` 和 `flow` 类型的块（`needsLLM: false`）不需要处理，直接跳过

将结果写入 `steps/5_llm_chunk_list.json`：

```json
{
  "chunks": [
    {
      "id": 3,
      "originalType": "multiLayer",
      "resultType": "phrasing",
      "content": "扁平化后的文本描述..."
    },
    {
      "id": 7,
      "originalType": "multiLayer",
      "resultType": "svg",
      "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 300\">...</svg>"
    }
  ]
}
```

- `id`：对应 `4_chunk_list.json` 中块的 `id`
- `originalType`：固定为 `"multiLayer"`
- `resultType`：`"phrasing"` 或 `"svg"`
- `content`：转化后的内容（纯文本或完整 SVG 源码）

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `snapshot` 判定已登录但页面仍是登录墙 | 手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `clean_snapshot` 报找不到快照 | 先运行步骤 1 生成 `1_snapshot.html` |
| `chunker` 报找不到 key_ids | 先运行步骤 3 生成 `3_key_ids.json` |
