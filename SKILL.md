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

这是**一篇文章页面**， 读取 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、class 名称）和长文本占位符（`{{LONG_TEXT_k|...}}`）分布，找到以下三类关键元素与列表流噪音的 `data-u2m-id` (ID)：

  1. **列表流**（`listFlowIds`）：文章主体段落的父容器 ID。列表流是包含多个子块（段落块、图片、代码块、引用块、列表块等）的**最外层父元素**；可能有多个，但**至少有一个**
  2. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器；可为空数组（在 `listFlowIds` 内）
  3. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等；可为空数组（在 `listFlowIds` 内；不存在）
  4. **列表流噪音**（`listFlowDeleteIds`）：列表流**之内**的噪音：菜单、导航、广告、推荐，步骤 6 提取时整棵剔除；**必须确定不属于文章内容**，不确定不能带上。列表流之外的噪音无需标记（不在任何 key 元素子树内，步骤 4 自然裁掉）

**约束**

  1. **必须排除**菜单、导航、广告等不属于三类关键元素的元素
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
    <div data-u2m-id="13" class="article">
      <div data-u2m-id="14"><h2 data-u2m-id="15">...</h2></div>
      <h2 data-u2m-id="16">...</h2>
      <p data-u2m-id="17"><span data-u2m-id="18">...</span></p>
    </div>
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

当前任务完成后，进入步骤 4

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

#### 专有名词

**「单传祖先链元素」**：从 <body> 到有效元素(`h/p/span/table/img/文本/...`)之间，没有『有效』兄弟元素的每一级祖先元素，为多级祖先元素的统称

DOM 结构示例：
> 单传祖先链元素：[1]-[3]

```html
<body>
<!-- 祖先链到从 <body> 开始 -->
<div data-u2m-id="1">
  <!-- 元素 [2] 为没有任何有效内容「文字/图标/图片」的空元素，直接忽略 -->
  <div data-u2m-id="2"></div>
  <!-- 元素 [3] 虽然有兄弟，但兄弟没有效内容 -->
  <!-- 祖先链到含有多个子元素的 [3] 为止 -->
  <div data-u2m-id="3">
    <!-- 元素 [4]/[6] 有有效兄弟元素 -->
    <div data-u2m-id="4">
      <img data-u2m-id="5" src="url">
    </div>
    <div data-u2m-id="6">
      <p data-u2m-id="7">text</p>
    </div>
  </div>
</div>
</body>
```

#### 词汇表：

| key | value |
|---|---|
| `h1 - h6` | 标题内容：`# xxx` |
| `p` | 段落内容 |
| `blockquote` | 引用内容：`> xxx` |
| `ul` / `ol` | 列表体：`- xxx\n - xxx` / `1. xxx\n 2. xxx` 一行 |
| `img` | 图片绝对 URL：`![img](url)`|
| `code` | 语言类型 + 独立代码内容：`{"lang": "tsx", "content": "..."}` |
| `table` | 完整 markdown 管线表：含 `\|--\|--\|` 分隔行 |
| `trans2img` | 独立复杂视觉模块：取「单传祖先链元素」的 `data-u2m-id` |

- 保持文档序、不重不漏；不要修改原义
- key 是**语义判断**的结果，具体按照下面的**判定规则**判定
- value 要带上 Markdown 语法，包括行外语法（`#`、`>`、`-`、`1.`、`![img](url)`等），行内格式（`**粗体**`、`[文本](url)`、`` `code` ``等）
- 长文本**只引用编号**：读到的 `{{LONG_TEXT_5|16_chars}} / {{LONG_TEXT_5|16_words}}` 写成 `{{LONG_TEXT_5}}`（不带后缀）
- 短文本（未达长文本占位阈值）与 URL → 照抄
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（卡片 div → 单个 `p`）
- 在「单传祖先链元素」中，没有块样式（背景/边框/阴影）的父组件可直接忽略

#### 判定规则

**`h1 - h6` 判定**

- 带有明显 `h1 - h6` 标签 → `h1 - h6`
- 字体大小为 `h1 - h6` 级别大小 → `h1 - h6`

字号粗略映射（浏览器默认字号为基准；整站字号偏移时按页面内相对大小定级）：

| 字体大小（约） | 判定 |
|---|---|
| 2rem / 32px | `h1` |
| 1.5rem / 24px | `h2` |
| 1.17rem / 19px | `h3` |
| 1rem / 16px | `h4` |
| 0.83rem / 13px | `h5` |
| 0.67rem / 11px | `h6` |

DOM 结构示例：
```html
<body>
<div>
  <div>
    <!-- 判定成 h1 -->
    <span style="font-size: 32px;">
      <span>{{LONG_TEXT_1}}</span>
    </span>
    <p style="font-size: 2rem;">
      <span>{{LONG_TEXT_2}}</span>
    </p>
  </div>
  <div>
    <!-- 判定成 h2 -->
    <h2><span>{{LONG_TEXT_3}}</span></h2>
  </div>
</div>
</body>
```

输出结构示例：
```json
{"h1": "# {{LONG_TEXT_1}}"},
{"h1": "# {{LONG_TEXT_2}}"},
{"h2": "## {{LONG_TEXT_3}}"}
```

**`blockquote` 判定**

- 在「单传祖先链元素」上，存在单个元素有「背景/边框/阴影」的提示段落，子孙元素没有「背景/边框/阴影」等块元素样式，只有文本 → `blockquote`

DOM 结构示例：
```html
<body>
<div>
  <div style="background-color: xxx; border-left: xxx">
    <div>
      <p>{{LONG_TEXT_1}}</p>
      <p>{{LONG_TEXT_2}}</p>
    </div>
    <div>
      <p>{{LONG_TEXT_3}}</p>
    </div>
  </div>
</div>
</body>
```

输出结构示例：
```json
{"blockquote": "> {{LONG_TEXT_1}}\n> {{LONG_TEXT_2}}\n> {{LONG_TEXT_3}}"}
```

**`ul` / `ol` 判定**

- 真实列表标签：`<ul>`/`<ol>`/`<li>` → `ul`/`ol`；
- 在「单传祖先链元素」上，无列表标签但子元素**同构重复**（多个纯文本行的「卡片组、垂直堆叠的图标+文本行、要点罗列、标签组等」），能够用多级 `ul` / `ol` 展示的 → `ul`/`ol`；
- 有序语义（步骤、排名、编号）→ `ol`；无序 → `ul`
- value 是**一个字符串**：一行一项、`\n ` 分隔，行级 `- ` / `1. ` 语法写在 value；嵌套列表用缩进表达、写进同一字符串

DOM 结构示例：

```html
<body>
  <ol>
    <li>{{LONG_TEXT_10}}</li>
    <li>{{LONG_TEXT_11}}</li>
  </ol>
  <div>
    <p><span>{{LONG_TEXT_12}}</span></p>
    <p><span>{{LONG_TEXT_13}}</span></p>
  </div>
</body>
```

输出结构示例：
```json
{"ol": "1. {{LONG_TEXT_10}}\n 2. {{LONG_TEXT_11}}"},
{"ul": "- {{LONG_TEXT_12}}\n - {{LONG_TEXT_13}}"}
```

**`img` 判定**

- `<img>` / `<picture>` 元素：value 统一写 `![img](图片绝对URL)`（URL 为快照阶段已绝对化的 src） → `img`；
- `<figure><img>` + `<figcaption>`：展开为两条——`img` 条 + figcaption 的 `p` 条 → `img`；
- 伴随文本的行内小图标 / 装饰图标不单独成 `img` 条
- 多图组成视觉整体，文本较少（图片组、图文拼贴）→ 判定 `trans2img`，不逐张拆 `img`；CSS 背景图同理（取不到独立 URL）

DOM 结构示例：
```html
<body>
<figure>
  <img src="https://example.com/a/cover.png">
  <figcaption>{{LONG_TEXT_20}}</figcaption>
</figure>
<p><img src="https://example.com/a/diagram.png"></p>
</body>
```

输出结构示例：
```json
{"img": "![img](https://example.com/a/cover.png)"},
{"p": "{{LONG_TEXT_20}}"},
{"img": "![img](https://example.com/a/diagram.png)"}
```

**`code` 判定**

- 在「单传祖先链元素」上：
  「视觉上」没有任何「背景/边框/阴影」的祖先元素 → `code`；
  「视觉上」有单个「背景/边框/阴影」的祖先元素 → `code`；
  「视觉上」有**多个**「背景/边框/阴影」的祖先元素 → 降级 `trans2img`；
- 删除原本代码左边的数字序号

DOM 结构示例：
```html
<body>
<!-- 单层块元素样式 → `code` -->
<section style="background-color: xxx; border: xxx">
  <div>
    <div style="border-bottom: xxx">
      <p>{{LONG_TEXT_k}}</p>
    </div>
  </div>
  <pre>
    <code>code...</code>
  </pre>
</section>
</body>
```

输出结构示例：
```json
{"p": "{{LONG_TEXT_k}}"},
{"code": {"content": "code..."}}
```

**`table` 判定**

- 真实 `<table>`（thead/tbody/th/td，或行列对齐的网格数据）**一律走 `table`**，无论带多重的背景/边框装饰；分组行用粗体行表达，markdown 表格可直接承载宽内容
- 仅当结构无法用 `<table>` 管线表表达（复杂跨行跨列/嵌套）才降级 `trans2img`

**`trans2img` 判定**

>  当模块的视觉布局本身承载语义，markdown 无法表达，就需要将元素整体转换成图片：`trans2img`

- 有「视觉上」的「背景/边框/圆角/阴影」的「单传祖先链元素」和「背景/边框/圆角/阴影」的「子孙/兄弟」元素 → `trans2img`
- 纯文本「很少/没有」的图片组 → `trans2img`
- 多图文组合的卡片组 → `trans2img`
- 图表、流程、图解、以空间关系表意的卡片拼贴 → `trans2img`

**`trans2img` ID 取值规则**

- 从「单传祖先链元素」上取出所有 ID
- `trans2img` 的 ID 可能存在一个或多个
- ID 数值通常是 `+1` 连续递增的

DOM 结构示例：
```html
<body>
<!-- 多层「背景/边框/圆角/阴影」块元素样式 → `trans2img` -->
<div data-u2m-id="9">
  <section data-u2m-id="10" style="background-color: xxx; border: xxx">
    <div data-u2m-id="11">
      <div data-u2m-id="12"><p data-u2m-id="13">{{LONG_TEXT_k}}</p></div>
    </div>
    <div data-u2m-id="14" style="display: flex;">
      <div data-u2m-id="15" style="background-color: xxx; border: xxx">
        <pre data-u2m-id="16">
          <code><span><span><span></code>
        </pre>
      </div>
      <div data-u2m-id="21" style="background-color: xxx; border: xxx">
        <pre data-u2m-id="22">
          <code><span><span><span></code>
        </pre>
      </div>
    </div>
  </section>
</div>

<!-- ID 取值规则 -->
<!-- 从 <body> 的子元素 [27] 开始 -->
<div data-u2m-id="27">
  <!-- 元素 [28] 为没有任何有效内容「文字/图标/图片」的空元素，直接忽略 -->
  <div data-u2m-id="28"></div>
  <!-- 元素 [29] 虽然有兄弟，但兄弟没有效内容 -->
  <section data-u2m-id="29" style="background-color: xxx; border: xxx">
    <!-- 祖先链到含有多个子元素的 [30] 为止 -->
    <div data-u2m-id="30">
      <div style="background-color: xxx; border: xxx">
        <div><p>{{LONG_TEXT_k}}</p></div>
      </div>
      <div style="display: flex;">
        <div style="background-color: xxx; border: xxx"></div>
        <div style="background-color: xxx; border: xxx"></div>
      </div>
    </div>
  </section>
</div>
</body>
```

输出结构示例：
```json
{"trans2img": [9, 10]},
{"trans2img": [27, 29, 30]}
```

**冲突判定原则**

- **文本形态（markdown 语法）优先**：能用 Markdown 正确显示的内容，优先用 Markdown 格式展示——`trans2img` 是 markdown 无法表达时的兜底
- `<body>` 下某块元素的子孙是单个 `table` / `pre` / `code` / `img`，且「上方/下方」仅有纯文本段落时，应该拆开成 `p + code + p`（`p + table + p` / `p + img + p` 同理），**不应该判定成 `trans2img`**——包装的背景/边框只是装饰
- 卡片组：以文本为主要内容、仅带小图标 → `ul`；以图片为主要内容、文本较短 → `trans2img`

DOM 结构示例：
```html
<body>
<!-- 单层包装下的 pre + 纯文本段落 → 拆开，不判 trans2img -->
<div style="background-color: xxx; border: xxx">
  <p>{{LONG_TEXT_1}}</p>
  <pre><code>code...</code></pre>
  <p>{{LONG_TEXT_2}}</p>
</div>
<!-- 卡片组：文本为主、仅小图标 → ul -->
<div data-u2m-id="30" style="display: flex">
  <div><img src="https://example.com/i/icon-1.png"><span>{{LONG_TEXT_10}}</span></div>
  <div><img src="https://example.com/i/icon-2.png"><span>{{LONG_TEXT_11}}</span></div>
</div>
<!-- 卡片组：图片为主、文本较短 → trans2img -->
<div data-u2m-id="40" style="display: grid">
  <figure><img src="https://example.com/a/shot-1.png"><figcaption>{{LONG_TEXT_12}}</figcaption></figure>
  <figure><img src="https://example.com/a/shot-2.png"><figcaption>{{LONG_TEXT_13}}</figcaption></figure>
</div>
</body>
```

输出结构示例：
```json
{"p": "{{LONG_TEXT_1}}"},
{"code": {"content": "code..."}},
{"p": "{{LONG_TEXT_2}}"},
{"ul": "- {{LONG_TEXT_10}}\n - {{LONG_TEXT_11}}"},
{"trans2img": [40]}
```

#### 输出要求

输出路径：`<url-working-path>/7_skeleton.json`

输出的 JSON 结构：

```json
[
  {"h1": "# {{LONG_TEXT_1}}"},
  {"p": "作者：Name · 时间：1945/08/01"},
  {"img": "![img](https://example.com/a/cover.png)"},
  {"blockquote": "> {{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|季度|营收|\n|--|--|\n|Q1|1.2亿|"},
  {"ul": "- {{LONG_TEXT_10}}\n - {{LONG_TEXT_11}}"},
  {"trans2img": [10, 13]}
]
```

#### 后续

当前任务完成后，进入步骤 8

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
