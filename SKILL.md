---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用 / 不使用

- 使用：把单个 URL 的正文转为 Markdown 文件
- 不使用：批量爬取、站点镜像；登录态存于 IndexedDB / Service Worker 的站点

## 工作原则

- 没有明确要求或流程需要的话，你不要去读脚本产物
- 你自己负责 "步骤 3" 和 "步骤 7" 的语义化操作：
  - 当你有权限调用子智能体（Sub-Agent）时，优先把任务交给子智能体
  - 当任务完成后，你要负责审阅一次

## 操作手册（步骤 0-9）

本技能目录为 `<skill-root>`（SKILL.md 所在目录）。

- `<url>` 指用户给定的完整 URL（仅步骤 1）
- `<url-path>` 由步骤 1 脚本通过 `url.replace(/[^A-Za-z0-9.-]/g, '_')` 自动创建
- `<url-dir>` 为 URL 专属工作目录 `<skill-root>/working/<url-path>`，步骤 1 之后的产物都存放在此目录下

**`<skill-root>`结构**
```
SKILL.md                 # Skill 主体文件
script/                  # 脚本
package.json

working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录
  <url-path>/            # 步骤 1-9 的中间产物文件
    assets/
      images/
      trans/
    1_snapshot.html
    ...
    9_markdown.md 
``` 

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

单条命令依次完成登录检测（需要时弹出 Screencast viewer 供人工登录）、渐进滚动、虚拟列表检测、全保真快照抓取（同源 iframe 合并、外部 CSS 内联、剥尽 JS、标记 `data-u2m-id`）。四阶段细节见脚本头部注释。

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

打开 `1_snapshot.html` 单趟结构清洗（删噪声标签/控件、级联删空元素），长文本替换为占位符；清洗规则与占位阈值见脚本头部注释。

产物：`2_clean_snapshot.html`（结构视图）、`2_clean_style_snapshot.html`（带样式版）、`2_long_text.json`（占位符原文映射）

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 3。`longTextCount` 为占位符数量，`longText` 为恢复清单路径，`styledSnapshot` 为带样式版路径 |
| `error` | 按 `reason` 处理：快照缺失→先跑步骤 1；其他→反馈给用户 |

### 步骤 3 · 你负责关键 ID 识别

读取 `2_clean_snapshot.html`。你的任务：这是**一篇文章**，仅根据 DOM 结构（元素层级、标签类型、嵌套深度）和长文本占位符（`{{LONG_TEXT_k|n_chars}}` / `{{LONG_TEXT_k|n_words}}`）分布，找到以下三类关键元素的 `data-u2m-id`：

1. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器
2. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等。可为空数组
3. **列表流**（`listFlowIds`）：文章主体区域的父容器 ID。列表流是包含多个子块（段落、图片、代码块等）的最外层容器，可能有多个

**约束**：
- **必须排除**菜单、导航、广告、推荐、视频等不属于文章核心内容的元素
- 不读语义内容——文本已被 `{{LONG_TEXT_k|…}}` 占位，你只能看到结构
- 当标题或说明分块已经在列表流中，不要再找它们的 `data-u2m-id` 了
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

按 `3_key_ids.json` 裁剪 `2_clean_style_snapshot.html`：key 元素子树 + 到 `<body>` 的祖先链一字不动保留，其余 body 元素删除；`<head>` 与全部 `<style>` 保留。裁剪规则见脚本头部注释。

产物：`4_styled_extract.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 5。`removedCount` 为删除元素数 |
| `error` | 按 `reason` 处理：key_ids 缺失→跑步骤 3；快照缺失→跑步骤 2；id 未命中 / listFlowIds 为空→重跑步骤 3 |

### 步骤 5 · 样式内联（juice）

```bash
node <skill-root>/script/compute_styles.mjs <url-dir>
```

把 `4_styled_extract.html` 的 `<style>` 规则内联进元素 style 属性，再按白名单只保留明显结构化的样式（border/outline/background/box-shadow、flex/grid 布局、overflow、transform）与 font-size/font-weight，删净其余声明及残留 `<style>`/`class`，终态纯内联。两轮处理细节见脚本头部注释。

产物：`5_juice_styles.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 6。`styledCount` 为带内联样式的元素数 |
| `error` | 步骤 4 产物缺失→跑步骤 4 |

### 步骤 6 · 文章视图提取

```bash
node <skill-root>/script/extract_article.mjs <url-dir>
```

读 `5_juice_styles.html` 与 `3_key_ids.json`，按分组顺序（标题 → 说明 → 正文块）把 key 元素与列表流子节点迁入新 `<body>`（768px 居中阅读布局）。提取与去重规则见脚本头部注释。

产物：`6_article.html`

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 7。`elementCount` 为提取的元素数 |
| `error` | 按 `reason` 处理：步骤 5 产物缺失→跑步骤 5；key_ids 缺失→跑步骤 3；id 未命中 / listFlowIds 为空→重跑步骤 3 |

### 步骤 7 · 你负责 markdown 骨架生成

读取 `6_article.html`。你的任务：把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。长文本只引用占位编号、一字不抄，正文回填由后续脚本完成。

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
- 长文本**只引用编号**：读到的 `{{LONG_TEXT_5|16_chars}} / {{LONG_TEXT_5|16_words}}` 写成 `{{LONG_TEXT_5}}`（不带后缀）
- 短文本（未达长文本占位阈值）与 URL：照抄
- 行内格式（`**粗体**`、`[文](url)`、`` `code` ``）由你写入 value
- key 是**语义判断**的结果：div 判成标题就写 `h2`，span 容器判成段落就写 `p`，不必与 DOM 标签一致

**约束**：
- 保持文档序、不重不漏——`trans2img` 标记子树**之外**的每个 `{{LONG_TEXT_k}}` 编号**恰好引用一次**（回填脚本按此机械校验）；标记子树内的占位符**不在骨架引用**——其文本由截图轮自行还原
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（卡片 div → 单个 `p`）
- 分派判定：**文本形态优先**——凡 markdown 语义可表达的内容不截图，**装饰不是截图理由**
  - 真实 `<table>`（thead/tbody/th/td，或行列对齐的网格数据）**一律走 `table`**，无论带多重的背景/边框装饰（暗色主题记分表也不例外）；分组行用粗体行表达，横向滚动只是页面交互、markdown 表格可直接承载宽内容；仅当结构无法用管线表表达（复杂跨行跨列/嵌套）才降级 `trans2img`
  - callout/提示框（背景+边框的提示段落）→ `blockquote`
  - 其余按**模块标准**圈定 → `trans2img`——**视觉布局本身承载语义、markdown 无法表达**
    - 卡片组/对比面板内容（数字+标签、要点罗列）
    - 对象：图表、图解、以空间关系表意的卡片拼贴、带包装的代码块部件（包装是呈现的一部分，整体截图）
    - 识别线索：父元素带背景/边框/圆角/阴影、多子元素带背景/边框/圆角/阴影，但线索命中时先过前述可表达性判定
    - 边界：外层 figure 容器不入标记范围，模块的 caption/脚注单独成 `p` 条目；仅裸代码块走 `code`
  - 模块之外一律文本形态（优先扁平化）
- 不虚构原文没有的信息

将结果写入 `7_skeleton.json`：

```json
[
  {"h1": "{{LONG_TEXT_1}}"},
  {"p": "作者：{{LONG_TEXT_2}} · 时间：{{LONG_TEXT_3}}"},
  {"img": "https://example.com/a/cover.png"},
  {"blockquote": "{{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|季度|营收|\n|--|--|\n|Q1|1.2亿|"},
  {"ul": "- {{LONG_TEXT_10}}\n- {{LONG_TEXT_11}}"},
  {"trans2img": "518"}
]
```

**后续**：步骤 8 下载 `img` 条目图片、对 `trans2img` 元素截图（live 重渲染优先、快照兜底）并写出 resolved skeleton；步骤 9 把骨架回填为最终 markdown。

### 步骤 8 · 占位符还原 + 图片下载 + trans2img 截图

```bash
node <skill-root>/script/screenshot_trans.mjs <url-dir>
```

读 `7_skeleton.json` + `1_snapshot.html` + `2_long_text.json`：先纯 Node 把骨架里所有 `{{LONG_TEXT_k}}` 替换为原文写出 resolved skeleton；再把 `img` 条目的远端图片下载到 `assets/images/`（优先 URL 文件名、冲突带编号），成功者把 resolved skeleton 的 img 值改写为本地路径；最后对 `trans2img` 标记的元素截图——**live 重渲染优先**：按快照 `<base>` 记录的 URL 重新渲染原页面（真实样式/图表/字体），重注入同一套标记脚本后两次渲染结构一致则 `data-u2m-id` 精确对位，与快照侧逐 id 签名严校验，全等才在 live 页截图；失配或重渲染不可达时在快照渲染页兜底。三轮处理细节见脚本头部注释。

产物：`8_resolved_skeleton.json`（必填，结构同步骤 7，占位符已全部还原、下载成功的 img 已指向本地；步骤 9 直接读它，无需再拼 `2_long_text.json`）、`assets/images/<name>`（骨架 img 条目图片）、`assets/trans/{id}.webp`（每个 trans2img 一张，WebP，2x 分辨率）

| stdout status | 动作 |
|---|---|
| `ok` | 进入步骤 9。`resolvedSkeleton` 为 resolved skeleton 路径；`count` 为截图数；`source` 为截图来源（`live` 全部来自重渲染 / `snapshot` 全部快照兜底 / `mixed` 混合——均无需处理）；`images` 为下载成功数、`failedImages` 为失败 URL（其骨架条目保留原 URL，无需处理）；`skipped: "no_trans2img"` 时无截图但图片下载照常 |
| `error` | 按 `reason` 处理：前置产物缺失→补跑对应步骤；id 在快照未命中→重跑步骤 7；占位符引用未定义编号→检查步骤 2 |

### 步骤 9 · 骨架回填为 Markdown

```bash
node <skill-root>/script/render_skeleton.mjs <url-dir>
```

读 `8_resolved_skeleton.json`，按文档序把每条骨架条目转为 markdown 块（块级语法由此脚本加，行内 markdown 已在步骤 7 写好），块间空行。各 key 的转换规则见脚本头部注释。纯 Node，无浏览器依赖。

产物：`9_markdown.md`

| stdout status | 动作 |
|---|---|
| `ok` | 管线完成。`blocks` 为块数，`bytes` 为字节数；`9_markdown.md` 即最终 markdown |
| `error` | 按 `reason` 处理：前置缺失→补跑步骤 8 |

## 常见错误处理

| 现象 | 处置 |
|---|---|
| `init.sh` 报 `未找到 pnpm/yarn/npm` | 请用户安装任一包管理器后重试步骤 0 |
| `snapshot` 判定已登录但页面仍是登录墙 | 请用户手动删除 `working/cookies/storage_state.json` 后重跑步骤 1 |
| `snapshot` 报 `virtual_list` 但用户确信是普通长页 | 该站可能主动裁剪离屏 DOM（与虚拟列表同构，产出亦只是部分窗口），属已知边界；建议改用其他抓取方式 |
| 页面加载报 `net::ERR_TUNNEL_CONNECTION_FAILED` / `ERR_PROXY_CONNECTION_FAILED` | 本机系统代理不可用或拒绝目标站：设 `U2M_PROXY=direct` 绕过系统代理，或 `U2M_PROXY=http://<host>:<port>` 显式指定可用代理后重跑 |
| `clean_snapshot` 报找不到快照 | 先运行步骤 1 生成 `1_snapshot.html` |
| `extract_article` 报找不到纯内联视图 | 先运行步骤 5 生成 `5_juice_styles.html` |
| `extract_styled` / `extract_article` 报找不到 key_ids | 先运行步骤 3 生成 `3_key_ids.json` |
