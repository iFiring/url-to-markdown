---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用 / 不使用

- 使用：把单个 URL 的正文转为 Markdown 文件
- 不使用：批量爬取、站点镜像；登录态存于 IndexedDB / Service Worker 的站点

## 操作手册（步骤 0-9）

本技能目录为 `<skill-root>`（SKILL.md 所在目录）。以下 `<url>` 均指用户给定的完整 URL。

所有产物直接存放在 `working/<url-dir>/` 目录下（截图在 `assets/trans/`），`<url-dir>` 由 URL 自动净化生成。

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

产物：`1_snapshot.html`

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

打开 `1_snapshot.html`，单趟结构清洗，产出两份快照（共享同一套清洗与占位）：
- 共同清洗（两版一致）：
  - 删除 `<link>` 标签、`<meta>` 标签、`<base>` 标签（`<title>` 保留）
  - 删除按钮类控件（`<button>`、`role="button"`、按钮型 `<input>`）——交互 UI 与正文结构无关
  - 删除页面骨架标签（`<nav>`/`<footer>`/`<form>` 及 `role="navigation"`/`role="contentinfo"`/`role="form"` 等价物）——导航/页脚/表单不属于正文，`<article>` 内嵌 footer 同样删除
  - 删除媒体播放器（`<video>`/`<audio>`，子元素 `<source>`/`<track>` 随之删除）——播放器无正文结构价值（分派阶段读原始快照，不受影响）
  - 删除残余表单控件与模态框（`<input>`/`<select>`/`<textarea>`/`<label>`/`<dialog>`）——`<form>` 已整体删除，此处兜住 form 外的搜索框等 UI 控件；`<header>`/`<aside>` 属正文结构（hero/章节），保留
  - 级联删除空元素（子树无非空白文本、无内容元素的空壳）；`img`/`svg`/`br`/`hr`/`iframe`/`pre`/`h1`-`h6` 等内容元素即使无子节点也保留，含文本的元素不受影响；表格结构（`table`/`tr`/`td`/`th`/`col`/`colgroup` 等）即使为空也全体保留——删掉空单元格/列定义会让行列错位，单元格内的噪声照删、留空壳
- 仅清洗版：删除所有 `style` 属性与 `<style>` 标签、清空 SVG 内容（仅保留空 `<svg></svg>` 壳）
- 仅带样式版：保留 `style` 属性与 `<style>` 标签；SVG 瘦身为空壳（仅留标签的 `id`/`class`/`data-u2m-id`，其余属性与子元素全部删除）
- 长文本占位（两版编号逐一对应；中英文分标准；纯空白文本节点与 svg/style 子树文本不占位）：
  - 中文文本（含汉字）：字符数 > 16 → `{{LONG_TEXT_k|n_chars}}`（n=字符数）
  - 英文文本（不含汉字）：单词数 > 12 → `{{LONG_TEXT_k|n_words}}`（n=单词数）
  - 原文按占位编号记入 `2_long_text.json`（编号 → 原文映射），供后续流程恢复

产物：`2_clean_snapshot.html`（步骤 3 的结构视图）、`2_clean_style_snapshot.html`（带样式版）、`2_long_text.json`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 3。`longTextCount` 为占位符数量，`longText` 为恢复清单路径，`styledSnapshot` 为带样式版路径 |
| `error` | 按 `reason` 处理：快照缺失→先跑步骤 1；其他→反馈给用户 |

### 步骤 3 · 关键 ID 识别（LLM 步骤）

读取 `2_clean_snapshot.html`。

你的任务：这是**一篇文章**，仅根据 DOM 结构（元素层级、标签类型、嵌套深度）和长文本占位符（`{{LONG_TEXT_k|n_chars}}` / `{{LONG_TEXT_k|n_words}}`）分布，找到以下三类关键元素的 `data-u2m-id`：

1. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器
2. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等。可为空数组
3. **列表流**（`listFlowIds`）：文章主体区域的父容器 ID。列表流是包含多个子块（段落、图片、代码块等）的最外层容器，可能有多个

**约束**：
- **必须排除**菜单、导航、广告、推荐、视频等不属于文章核心内容的元素
- 不读语义内容——文本已被 `{{LONG_TEXT_k|…}}` 占位，你只能看到结构
- `listFlowIds` 是列表流**最外层父元素**的 `data-u2m-id`，不是子元素的
- 不选 `<body>` 或 `<html>`——它们的 ID 无意义
- 如果找不到明确的标题或说明元素，对应数组可为空
- 列表流至少选一个——它是后续分块的根容器

将结果写入 `3_key_ids.json`：

```json
{
  "titleIds": [1],
  "descriptionIds": [2, 3],
  "listFlowIds": [4, 5]
}
```

### 步骤 4 · 样式视图裁剪

```bash
node <skill-root>/script/extract_styled.mjs <url-dir>
```

`<url-dir>` 为 `working/` 下的 URL 目录名（相对或绝对路径均可）。

读取 `3_key_ids.json` 与 `2_clean_style_snapshot.html`，裁剪出只含文章主体的带样式视图：

- **完整保留（一字不动，含全部标签属性与样式属性）**：三类 key 元素（`titleIds`/`descriptionIds`/`listFlowIds`）的子树 + 它们到 `<body>` 的祖先链——祖先上下文不变，CSS 选择器照常生效
- **`<head>` 完全不动**（`<title>` + 全部 `<style>` 原地保留）；body 里即将删除的分支中若有 `<style>`，先挪入 `<head>` 再删分支，样式标签零丢失
- **删除**：其余全部 body 元素（封面区块、推荐、营销等 step 3 排除的内容）

产物：`4_styled_extract.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 5。`removedCount` 为删除元素数 |
| `error` | 按 `reason` 处理：key_ids 缺失→跑步骤 3；快照缺失→跑步骤 2；id 未命中 / listFlowIds 为空→重跑步骤 3 |

### 步骤 5 · 样式内联（juice）

```bash
node <skill-root>/script/compute_styles.mjs <url-dir>
```

读取 `4_styled_extract.html`，juice 按自身 CSS 级联引擎把 `<style>` 规则内联到元素的 style 属性并移除标签（字面声明值：不推导继承、不解析 `var()`；原有内联样式参与级联故保留），随后在浏览器里清理并删净（正文含字面 `class="..."` 文本也不会误伤）：

- **噪声声明删除**：`font-family`、`font-style`（任意值）、`-webkit-` 前缀属性、值为 `inherit` 的声明；清空后移除 style 属性。只动确有噪声的元素——无噪声的保持 juice 字面输出（被清理元素的声明经 CSSOM 重序列化，颜色归一为 rgb() 形式，语义等价）
- **`<style>` 标签与 `class` 属性删净**

终态：无 `<style>`、无 `class`，内联声明只留有意义的。

产物：`5_juice_styles.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 6。`styledCount` 为带内联样式的元素数 |
| `error` | 步骤 4 产物缺失→跑步骤 4 |

### 步骤 6 · 文章视图提取

```bash
node <skill-root>/script/extract_article.mjs <url-dir>
```

`<url-dir>` 为 `working/` 下的 URL 目录名（相对或绝对路径均可）。

读取 `5_juice_styles.html` 与 `3_key_ids.json`，新建一份只含文章主体的 html，按**分组顺序**（标题 → 说明 → 正文块）把元素提取进新 `<body>`：

- `titleIds` / `descriptionIds`：**元素本身**（完整子树，属性与内容一字不动）
- `listFlowIds`：遍历各容器子节点，**元素与非空白裸文本按文档序交错迁入**——裸文本没有 `data-u2m-id` 但可能是未包标签的正文，丢弃即内容损失；纯空白文本与注释不迁（容器本身与祖先骨架不入新 html）
- 去重：同一元素被指名两次（如 description 同时是 flow 子元素）只出现一次
- head：保留原文 `<title>`；`<html lang>` 照抄
- 新 `<body>` 带阅读布局内联样式 `max-width: 768px; margin: 4rem auto`（限宽、水平居中）

产物：`6_article.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 7。`elementCount` 为提取的元素数 |
| `error` | 按 `reason` 处理：步骤 5 产物缺失→跑步骤 5；key_ids 缺失→跑步骤 3；id 未命中 / listFlowIds 为空→重跑步骤 3 |

### 步骤 7 · markdown 骨架生成（LLM 步骤）

读取 `6_article.html`。

你的任务：把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。长文本只引用占位编号、一字不抄，正文回填由后续脚本完成。

**词汇表**：

| key | value |
|---|---|
| `h1`-`h6` | 标题内容（块级 `#` 前缀由回填脚本加，不写在 value） |
| `p` | 段落内容 |
| `blockquote` | 引用内容（`> ` 前缀由回填脚本加） |
| `ul` / `ol` | 列表体，`- xxx` / `1. xxx` 行（行级语法写在 value） |
| `code` | 对象 `{"lang": "tsx", "content": "..."}`：代码内容 + 语言（语言取自源码块标注或内容判断，无法判断时可省略 `lang`；围栏由回填脚本加）。仅用于**裸**代码块——带背景/边框/标题栏包装的代码块部件按 `trans2img` 模块标准整体截图 |
| `img` | 图片绝对 URL |
| `table` | 完整 markdown 管线表（含 `\|--\|--\|` 分隔行） |
| `trans2img` | 元素 `data-u2m-id`：独立复杂视觉模块（背景色/边框父元素 + 多级边框/背景色子元素）——卡片组、对比面板、图表、图解、带包装的代码块部件等，后续步骤截图 |

**value 写法**：
- 长文本**只引用编号**：读到的 `{{LONG_TEXT_5|47_chars}}` 写成 `{{LONG_TEXT_5}}`（不带后缀）
- 短文本（未达步骤 2 占位阈值）与 URL：照抄
- 行内格式（`**粗体**`、`[文](url)`、`` `code` ``）由你写入 value
- key 是**语义判断**的结果：div 判成标题就写 `h2`，span 容器判成段落就写 `p`，不必与 DOM 标签一致

**约束**：
- 保持文档序、不重不漏——`trans2img` 标记子树**之外**的每个 `{{LONG_TEXT_k}}` 编号**恰好引用一次**（回填脚本按此机械校验）；标记子树内的占位符**不在骨架引用**——其文本由截图轮自行还原
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（卡片 div → 单个 `p`）
- 分派判定：按**模块标准**圈定——父元素带背景色/边框，子元素再带多级边框/背景色（卡片组、对比面板、图表、图解、带包装的代码块部件）→ 一律走 `trans2img`。外层 figure 容器不入标记范围，模块的 caption/脚注单独成 `p` 条目；仅裸代码块走 `code`。模块之外一律文本形态（优先扁平化）
- 不虚构原文没有的信息

将结果写入 `7_skeleton.json`：

```json
[
  {"h1": "{{LONG_TEXT_1}}"},
  {"p": "作者：{{LONG_TEXT_2}} · {{LONG_TEXT_3}}"},
  {"img": "https://example.com/a/cover.png"},
  {"blockquote": "{{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|季度|营收|\n|--|--|\n|Q1|1.2亿|"},
  {"ul": "- {{LONG_TEXT_10}}\n- {{LONG_TEXT_11}}"},
  {"trans2img": "518"}
]
```

**后续**：步骤 8 对 `trans2img` 元素截图（含占位符还原）并写出 resolved skeleton；步骤 9 把骨架回填为最终 markdown。

### 步骤 8 · 占位符还原 + trans2img 截图

```bash
node <skill-root>/script/screenshot_trans.mjs <url-dir>
```

读取 `7_skeleton.json` + `6_article.html` + `2_long_text.json`。

你的任务：
1. 把骨架里所有 `{{LONG_TEXT_k}}` / `{{LONG_TEXT_k|suffix}}` 替换为 `2_long_text.json` 的真实文本，写出与步骤 7 同结构的 `8_resolved_skeleton.json`
2. 对其中 `trans2img` 标记的元素，在真实渲染状态下截图（子树内占位符已替换）

脚本行为：
1. 读骨架 + `2_long_text.json`，纯 Node 做占位符替换，写出 `8_resolved_skeleton.json`（条目数、顺序、key 与步骤 7 完全一致，trans2img 条目保留，value 全部为真实文本）
2. 若骨架中任一 value 引用了 `2_long_text.json` 未定义的编号 → 直接报 error
3. 按文档序收集骨架中所有 `trans2img` 的 id；若为空：`skipped: "no_trans2img"`，resolved skeleton 已写出，直接进入步骤 9
4. 用 playwright 加载 `6_article.html`（body 已设 `max-width: 768px`，即真实渲染宽度）
5. 注入 `page-resolve-placeholders.js`：遍历全文档文本节点，把 `{{LONG_TEXT_k|...}}` / `{{LONG_TEXT_k}}` 替换为 `2_long_text.json` 里的原文（与 resolved skeleton 的还原结果一致，用于截图）
6. 对每个 id 定位元素并调 `el.screenshot({type: 'webp'})` → `assets/trans/{id}.webp`

产物：
- `8_resolved_skeleton.json`（必填，结构同步骤 7，所有占位符已还原；下游回填脚本直接读它生成 markdown，无需再拼 `2_long_text.json`）
- `assets/trans/{id}.webp`（每个 trans2img 一个截图，WebP 格式，2x 分辨率）

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 9。`resolvedSkeleton` 为 resolved skeleton 路径；`count` 为截图数；`replaced` 为截图前的占位符替换数；`skipped: "no_trans2img"` 时只有 resolved skeleton |
| `error` | 按 `reason` 处理：前置产物缺失→补跑对应步骤；id 在 DOM 未命中→重跑步骤 7；占位符引用未定义编号→检查步骤 2 |

### 步骤 9 · 骨架回填为 Markdown

```bash
node <skill-root>/script/render_skeleton.mjs <url-dir>
```

读取 `8_resolved_skeleton.json`，按文档序把每条骨架条目转为 markdown 块，块与块之间以空行分隔。纯 Node，无浏览器依赖。

转换规则（块级语法由此脚本加，行内 markdown 已在步骤 7 由 LLM 写好）：

| key | markdown 输出 |
|---|---|
| `h1`-`h6` | `#`-`######` + ` ` + value |
| `p` | value 原样 |
| `blockquote` | 每行前缀 `> ` |
| `ul` / `ol` | value 原样（LLM 已写 `- ` / `1. ` 行级语法） |
| `code` | ` ```{lang}\n{content}\n``` `（`lang` 缺省时仅 ` ``` `） |
| `img` | `![]({url})` |
| `table` | value 原样（LLM 已写完整管线表） |
| `trans2img` | `![](assets/trans/{id}.webp)`（相对 urlDir） |

未知 key 静默跳过。空骨架输出空文件。

产物：`9_markdown.md`

| stdout status | 动作 |
|---|---|
| `ok` | 管线完成。`blocks` 为块数，`bytes` 为字节数；`9_markdown.md` 即最终 markdown |
| `error` | 按 `reason` 处理：前置缺失→补跑步骤 8 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `snapshot` 判定已登录但页面仍是登录墙 | 手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `clean_snapshot` 报找不到快照 | 先运行步骤 1 生成 `1_snapshot.html` |
| `extract_article` 报找不到纯内联视图 | 先运行步骤 5 生成 `5_juice_styles.html` |
| `chunker` 报找不到 key_ids | 先运行步骤 3 生成 `3_key_ids.json` |
