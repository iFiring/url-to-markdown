---
name: url-to-markdown
description: "将 URL（网页）的主体内容转换成 Markdown；在需要将 URL 转 Markdown 时使用。"
---

# url-to-markdown

打开网页（处理登录墙），把主体内容转换成干净的 Markdown。特殊元素按类型分派：能拿文本形态就拿文本形态（LaTeX 公式、Mermaid 源码、代码块），矢量次之（SVG 直接导出 / LLM 重建），像素截图兜底。

## 何时使用

- 把单个 URL 的正文转为 Markdown 文件

## 工作原则

- 没有明确要求或流程需要的话，你**不要去读脚本的产物及其内容**，仅需确认执行了命令，产物存在即可
- 你自己负责 "步骤 3" 和 "步骤 7" 的语义化操作：当你有权限调用子智能体（Sub-Agent）时，**优先把任务交给子智能体**

## 核心参数

- `<url>`：指用户给定的完整 URL；步骤 0 的必填参数
- `<skill-root>`：本技能 SKILL.md 所在目录（**绝对路径**）；由步骤 0 生成
- `<url-name>`：由步骤 0 通过 `replace(/[^A-Za-z0-9.-]/g, '_')` 生成（剥去 `http(s)://` 前缀）
- `<url-working-path>`：当前 URL 的专属目录 `<skill-root>/working/<url-name>`；由步骤 0 生成；步骤 0 之后的产物都存放在此目录下

本技能目录结构：

```
SKILL.md                 # Skill 主体文件
script/                  # 脚本
package.json

working/                 # 工作目录
  cookies/               # 所有访问过 URL 的 cookie 公共存储目录；由步骤 1 生成
  <url-name>/            # 当前 URL 的专属目录 `<skill-root>/working/<url-name>`
    assets/
      images/
      trans/
    1_snapshot.html
    ...
    9_markdown.md 
``` 

## 操作手册（步骤 0-9）

### 步骤 0 · 初始化执行环境和参数

```bash
bash <skill-root>/script/init.sh --url <url>
```

| stdout.status | 动作 |
|---|---|
| `ok` | 拿到 `stdout`的 `skill-root` / `url-name` / `<url-working-path>`，作为**核心参数**，进入步骤 1 |
| `error` | **终止全部流程**，把 `stdout.reason` 反馈给用户 |

**stdout.status=ok 结构示例**
```json
{
  "status": "ok",
  "skill-root": "/root/path/to/skill",
  "url-name": "_name_",
  "url-working-path": "/root/path/to/skill/working/_name_"
}
```

### 步骤 1 · 快照下载

```bash
node <skill-root>/script/snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60]
```

单条命令依次完成登录检测（需要时弹出 Screencast viewer 供人工登录）、渐进滚动、虚拟列表检测、全保真快照抓取。

产物：`<url-working-path>/1_snapshot.html`（产物生成后，不要擅自读取内容）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 2 |
| `error`（reason=`virtual_list`） | 告知用户"该页面为虚拟列表，仅渲染部分内容，无法全文转化为 Markdown"，**终止** |
| `error`（reason=`login_timeout`/`login_aborted`） | 询问用户是否重试登录；重试则再次运行本命令 |
| `error`（其他） | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 2 · 用脚本清洗结构

```bash
node <skill-root>/script/clean_snapshot.mjs --url <url>
```

产物：
```
<url-working-path>/
  2_clean_snapshot.html        # 结构视图
  2_clean_style_snapshot.html  # 结构视图（带样式版）
  2_long_text.json             # 占位符原文映射
``` 

产物生成后，不要擅自读取内容

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 3 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 3 · 你负责关键 ID 识别

**可调用子智能体时，优先把任务交给子智能体**

#### 任务

这是**一篇文章页面**， 读取 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、class 名称）和长文本占位符（`{{LONG_TEXT_k|...}}`）分布，找到以下三类关键元素与列表流噪音的 `data-u2m-id`：

  1. **列表流**（`listFlowIds`）：文章主体段落的父容器 ID。列表流是包含多个子块（段落、图片、代码块等）的最外层容器；可能有多个，但**至少有一个**
  2. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器；可为空数组（在 `listFlowIds` 内）
  3. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等；可为空数组（在 `listFlowIds` 内；不存在）
  4. **列表流噪音**（`listFlowDeleteIds`）：列表流**之内**的噪音：菜单、导航、广告、推荐，步骤 6 提取时整棵剔除；**必须确定不属于文章内容**，不确定不能带上。列表流之外的噪音无需标记（不在任何 key 元素子树内，步骤 4 自然裁掉）

**约束**

  1. **必须排除**菜单、导航、广告等不属于三类关键元素的元素
  2. `listFlowIds` 是列表流**最外层父元素**的 `data-u2m-id`
  3. 不选 `<body>` 或 `<html>`——它们的 ID 无意义
  4. `data-u2m-hidden="N_chars"`（或 `N_chars,fixed`）标记：折叠的隐藏子树（模态/抽屉/折叠展开区/响应式隐藏）。根元素的 `data-u2m-id` 可正常引用——原文完整保留在带样式版，纳入 listFlowIds 即可还原全文；值是该子树的真实文本规模，可据此判断是否值得纳入
  5. `<pre>` 内的 `code...`：代码块内容占位。完整代码在后续步骤保真，识别时把 pre 当作一个结构单元即可


**`2_clean_snapshot.html`结构示例**：

> `data-u2m-id` 的生成是在 DOM 树中自上而下自增的，所以通常只有两个情况：titleIds 或 descriptionIds 在 listFlowIds 里面，值更大，输出 JSON 里不应该有值；titleIds 或 descriptionIds 在 listFlowIds 前面，值更小。

```html
<html>
<body>
  <div data-u2m-id="1" class="xxx">
    <h1 data-u2m-id="2">
      <!-- 全局唯一标题 titleIds[3] -->
      <span data-u2m-id="3">Title...</span>
    </h1>
  </div>
  <div data-u2m-id="4" class="xxx">

    <!-- 列表流 listFlowIds[5] -->
    <section data-u2m-id="5" class="article">
      <!-- descriptionIds:[6] 在 listFlowIds[5] 之内，JSON 不纳入 -->
      <div data-u2m-id="6">
        <h2 data-u2m-id="7">Author:</h2>
        <span data-u2m-id="8">Name...</span>
      </div>
      <!-- 列表流噪音 listFlowDeleteIds[9]：列表流之内 → 必须标记 -->
      <div data-u2m-id="9" class="ad">Ad...</div>
      <p data-u2m-id="10">
        <h2 data-u2m-id="11">...</h2>
        <code data-u2m-id="12">...</code>
      </p>
    </section>
    <!-- 列表流之外的广告无需标记——不在任何 key 元素子树内，步骤 4 自然裁掉 -->
    <!-- 列表流 listFlowIds[13] -->
    <section data-u2m-id="13" class="article">
      <div data-u2m-id="14"><h1 data-u2m-id="15">Section...</h1></div>
      <p data-u2m-id="16"><span data-u2m-id="17">...</span></p>
    </section>
  </div>
</body>
</html>
```

**输出要求** 

输出路径：`<url-working-path>/3_key_ids.json`

输出结构：

```json
{
  "titleIds": [3],
  "descriptionIds": [],
  "listFlowIds": [5, 13],
  "listFlowDeleteIds": [9]
}
```

#### 后续

把 `3_key_ids.json` 反馈给用户，进入步骤 4

### 步骤 4 · 用脚本裁剪 DOM

```bash
node <skill-root>/script/extract_styled.mjs --url <url>
```

产物：`<url-working-path>/4_styled_extract.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 5。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 5 · 用脚本计算内联样式

```bash
node <skill-root>/script/compute_styles.mjs --url <url>
```

产物：`<url-working-path>/5_juice_styles.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 6。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 6 · 用脚本提取视图

```bash
node <skill-root>/script/extract_article.mjs --url <url>
```

产物：`<url-working-path>/6_article.html`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 7。|
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 7 · 你负责 markdown 骨架生成

**可调用子智能体时，优先把任务交给子智能体**

#### 任务

读取 HTML `<url-working-path>/6_article.html` 的 DOM 结构，把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。长文本只引用占位编号、一字不抄，正文回填由后续脚本完成。

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
- 行内格式（`**粗体**`、`[文](url)`、`` `code` ``）由你写入 value；删除代码左边的序号
- key 是**语义判断**的结果：div 判成标题就写 `h2`，span 容器判成段落就写 `p`，不必与 DOM 标签一致

**约束**：

- 保持文档序、不重不漏——`trans2img` 标记子树**之外**的每个 `{{LONG_TEXT_k}}` 编号**恰好引用一次**（回填脚本按此机械校验）；标记子树内的占位符**不在骨架引用**——其文本由截图轮自行还原
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（卡片 div → 单个 `p`）
- 分派判定：**文本形态优先**——凡 markdown 语义可表达的内容不截图，**装饰不是截图理由**
  - 真实 `<table>`（thead/tbody/th/td，或行列对齐的网格数据）**一律走 `table`**，无论带多重的背景/边框装饰（暗色主题记分表也不例外）；分组行用粗体行表达，横向滚动只是页面交互、markdown 表格可直接承载宽内容；仅当结构无法用管线表表达（复杂跨行跨列/嵌套）才降级 `trans2img`
  - callout/提示框（背景+左边框的提示段落）→ `blockquote`
  - 卡片组/对比面板：内容文本可表达的（引语、数字+标签、要点罗列）→ 列表/引用/小`table`等文本形态，不截图（不判定为`trans2img`）
  - 其余按**模块标准**圈定 → `trans2img`——**视觉布局本身承载语义、markdown 无法表达**
    - 文本不可表达的(如图片组)才走整组一个 trans2img（圈住含组标题与全部卡片的父容器），不逐卡拆分
    - 对象：图表、图解、以空间关系表意的卡片拼贴、带包装的代码块部件（包装是呈现的一部分，整体截图）
    - 识别线索：父元素带背景/边框/圆角/阴影、多子元素带背景/边框/圆角/阴影，但线索命中时先过前述可表达性判定
    - 边界：外层 figure 容器不入标记范围，模块的 caption/脚注单独成 `p` 条目；仅裸代码块走 `code`
  - 模块之外一律文本形态（优先扁平化）
- 不虚构原文没有的信息

**结构示例**：

```html
<html>
<head><title>...</title></head>
<body style="max-width: 768px; margin: 4rem auto">
  <span data-u2m-id="3">Title...</span>
  <div data-u2m-id="6">
    <h2 data-u2m-id="7">Author:</h2>
    <span data-u2m-id="8">Name...</span>
  </div>
  <p data-u2m-id="10">
    <h2 data-u2m-id="11">...</h2>
    <code data-u2m-id="12">...</code>
  </p>
  <div data-u2m-id="14"><h1 data-u2m-id="15">Section...</h1></div>
  <p data-u2m-id="16"><span data-u2m-id="17">...</span></p>
</body>
</html>
```

**输出要求** 

输出路径：`<url-working-path>/7_skeleton.json`

输出结构：

```json
[
  {"h1": "{{LONG_TEXT_1}}"},
  {"p": "作者：Name · 时间：1945/08/01"},
  {"img": "https://example.com/a/cover.png"},
  {"blockquote": "{{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|季度|营收|\n|--|--|\n|Q1|1.2亿|"},
  {"ul": "- {{LONG_TEXT_10}}\n- {{LONG_TEXT_11}}"},
  {"trans2img": "518"}
]
```

#### 后续

进入步骤 8

### 步骤 8 · 用脚本还原占位符 + 图片下载

```bash
node <skill-root>/script/screenshot_trans.mjs --url <url>
```

产物：`<url-working-path>/8_resolved_skeleton.json`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，进入步骤 9。 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

### 步骤 9 · 用脚本将骨架转换为 Markdown

```bash
node <skill-root>/script/render_skeleton.mjs --url <url>
```

产物：`<url-working-path>/9_markdown.md`（你自己不要去读脚本的产物内容，确认有即可）

| stdout.status | 动作 |
|---|---|
| `ok` | 把 stdout 反馈给用户，所有步骤完成 |
| `error` | 把 `stdout.reason` 反馈给用户并终止 |

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
