# 任务

读取 HTML `<url-working-path>/6_article.html` 的 DOM 结构，把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。长文本只引用占位编号、一字不抄，正文回填由后续脚本完成。

## 专有名词

**「单传祖先链」**：

- 对某个目标模块，从 `<body>` 下包裹它的子元素开始向下走到模块容器为止——每一级的子元素中，没有有效内容（子树内无文字/图标/图片，`h/p/span/table/img/text/pre/…`）的空元素当它不存在；剩下的有效子元素只有一个 → 穿过它继续下探；剩余多个 → 停在该元素（含该元素），它就是**模块容器**。链上所有元素的 `data-idx` 组成该模块的 ID 集
- `<body>` 的所有子元素都是「单传祖先链」的第一个元素（也可能是最后一个）

DOM 结构示例：

> 单传祖先链：`[1]-[3]`

```html
<body>
<!-- 祖先链从 <body> 子元素开始：[1]-[3] -->
<div data-idx="1">
  <!-- 元素 [2] 为没有任何有效内容「文字/图标/图片」的空元素，直接忽略 -->
  <div data-idx="2"><p><span></span></p></div>
  <!-- 元素 [3] 虽然有兄弟，但兄弟没有效内容 -->
  <!-- 祖先链到含有多个有效子元素的 [3] 为止 -->
  <div data-idx="3">
    <!-- 元素 [4] 和 [6] 都是有效兄弟元素 -->
    <div data-idx="4">
      <img data-idx="5" src="url">
    </div>
    <div data-idx="6">
      <p data-idx="7">text</p>
    </div>
  </div>
</div>
</body>
```

**「块元素样式」**：「背景/边框/圆角/阴影」

## 词汇表：

| key | value |
|---|---|
| `h1 - h6` | 标题内容：`# xxx` |
| `p` | 段落内容 |
| `blockquote` | 引用内容：`> xxx` |
| `ul` / `ol` | 列表体：`- xxx\n - xxx` / `1. xxx\n 2. xxx` 一行 |
| `img` | 图片绝对 URL：`![img](url)`|
| `code` | 语言类型 + 独立代码内容：`{"lang": "tsx", "content": "…"}` |
| `table` | 完整 markdown 表格：含 `|--|--|` 分隔行 |
| `trans2img` | 独立复杂视觉模块：取「单传祖先链」的 `data-idx` |

- 保持文档序、不重不漏、不要修改原义
- key 是**语义判断**的结果，具体按照下面的**判定规则**判定
- value 要带上 Markdown 语法，包括行外语法（`#`、`>`、`-`、`1.`、`![img](url)`等），行内格式（`**粗体**`、`[链接文本](url)`、`` `code` ``等）
- 「长文本」的占位符**只引用编号**（不带统计后缀）：`{{LONG_TEXT_5|…}}`  → `{{LONG_TEXT_5}}`
- 短文本（未达长文本占位阈值）与 URL → 照抄
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（无块样式的卡片 div → 单个 `p`）
- 在「单传祖先链」中，没有「块元素样式」的父组件可直接忽略

## 判定规则

### `h1 - h6` 判定

- 带有明显 `h1 - h6` 标签 → `h1 - h6`
- 字体大小为 `h1 - h6` 级别大小 → `h1 - h6`

字号粗略映射（浏览器默认字号为基准；整站字号偏移时按页面内相对大小定级；1rem/16px 常为正文常规字号，需结合加粗/语义再定级）：

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

输出示例：
```json
{"h1": "# {{LONG_TEXT_1}}"},
{"h1": "# {{LONG_TEXT_2}}"},
{"h2": "## {{LONG_TEXT_3}}"}
```

### `blockquote` 判定

- 带有明显 `blockquote` 标签 → `blockquote`
- 在「单传祖先链」上，存在单个元素有「块元素样式」的提示段落，子孙元素没有「块元素样式」，只有文本内容 → `blockquote`

DOM 结构示例：
```html
<body>
<div>
  <blockquote style="border: xxx;">
    <p>{{LONG_TEXT_1}}</p>
    <p>{{LONG_TEXT_2}}</p>
  </blockquote>
</div>
<div>
  <div style="border-left: xxx;">
    <p>{{LONG_TEXT_3}}</p>
  </div>
</div>
<div>
  <div style="background-color: xxx;">
    <ol>
      <li>{{LONG_TEXT_4}}</li>
      <li>{{LONG_TEXT_5}}</li>
    </ol>
  </div>
</div>
</body>
```

输出示例：
```json
{"blockquote": "> {{LONG_TEXT_1}}\n> {{LONG_TEXT_2}}"}
{"blockquote": "> {{LONG_TEXT_3}}"}
{"blockquote": "> 1. {{LONG_TEXT_4}}\n2. {{LONG_TEXT_5}}"}
```

### `ul` / `ol` 判定

- 真实列表标签：`<ul>`/`<ol>`/`<li>` → `ul`/`ol`；
- 在「单传祖先链」上，无列表标签但子元素**同构重复**（多个纯文本行的「卡片组、垂直堆叠的图标+文本行、要点罗列、标签组等」），能够用多级 `ul` / `ol` 展示的 → `ul`/`ol`；
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

输出示例：
```json
{"ol": "1. {{LONG_TEXT_10}}\n 2. {{LONG_TEXT_11}}"},
{"ul": "- {{LONG_TEXT_12}}\n - {{LONG_TEXT_13}}"}
```

### `img` 判定

- `<img>` / `<picture>` 元素：value 统一写 `![img](图片绝对URL)`（URL 为快照阶段已绝对化的 src） → `img`；
- `<figure><img>` + `<figcaption>`：展开为两条——`img` 条 + figcaption 的 `p` 条 → `img`；
- 伴随文本的行内小图标 / 装饰图标不单独成 `img` 条
- `<img>` 保留的 `style` 宽高（`width`/`height`）是判图片权重的信号：小尺寸（图标级）→ 行内小图标不单独成条；大尺寸 → 独立 `img` 条；多张中等尺寸聚集 → 倾向 `trans2img` 图片组
- 多图组成视觉整体，文本较少（图片组、图文拼贴）→ 判定 `trans2img`，不逐张拆 `img`；CSS 背景图同理（取不到独立 URL）

DOM 示例：
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

### `code` 判定

- 在「单传祖先链」下主体是「代码块 + 标题/说明文字」 → `code` + `p`
- `lang` 必填：优先取 `pre` 的 `data-language` 属性，无线索时写 `""`
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
    <code>code…</code>
  </pre>
</section>
</body>
```

输出示例：
```json
{"p": "{{LONG_TEXT_k}}"},
{"code": {"lang": "", "content": "code…"}}
```

### `table` 判定

- 真实 `<table>`（thead/tbody/th/td，或行列对齐的网格数据）**一律走 `table`**，无论带多重的背景/边框装饰；分组行用粗体行表达，markdown 表格可直接承载宽内容
- 仅当结构无法用 markdown 表格表达（复杂跨行跨列/嵌套）才降级 `trans2img`

### `table` 判定

- 真实 `<table>`（thead/tbody/th/td）**一律走 `table`**，无论带多重的背景/边框装饰；分组行用粗体行表达，markdown 表格可直接承载宽内容
- 仅当结构无法用 markdown 表格表达（复杂跨行跨列/嵌套）才降级 `trans2img`

### `trans2img` 判定

> 当模块的视觉布局本身承载语义，markdown 无法表达，就需要将元素整体转换成图片：`trans2img`

- **文本形态（markdown 语法）优先**：能用 Markdown 正确显示的内容，优先用 Markdown 格式展示：
  - 当「单传祖先链」下是单个 `table` / `pre` / `img`，且「上方/下方」仅有包含纯文本的块元素（`block > p > span > text…`）/纯文本段落（`p/h/blockquote/button`）时 → `table/pre/img` + `blockquote/p/h/button` 组合
  - 当「单传祖先链」下是多行文本段落（`section>div>(h1+pre+p+blockquote+button)`），且**没有多级「块元素样式」** → `h1+pre+p+blockquote+button` 组合

- 所有无法用 markdown 段落表达的元素 → 一律走 `trans2img` 兜底，以下常见的 `trans2img` 元素：
  - 每组纯文本「很少/没有」的图片组 → `trans2img`
  - 卡片组：以文本为主要内容、仅带小图标 → `ul/ol`；以图片为主要内容、文本较短 → `trans2img`
  - 图表、流程、图解、以空间关系表意的卡片拼贴 → `trans2img`
  - 在「单传祖先链」上及其「子孙/兄弟」元素中，**都有多层级「块元素样式」** → `trans2img`
  - 图表、流程、图解、以空间关系表意的卡片拼贴 → `trans2img`
  - 包含 `canvas/iframe` 等特殊元素 → `trans2img`
  - 在「单传祖先链」下的「子孙/兄弟」元素中，包含「绝对定位」元素 → `trans2img`
  - 行列对齐的网格数据（非 `<table>` 标签）→ `trans2img`

**`trans2img` ID 取值规则**

- `trans2img` 取自「单传祖先链」：**截图必须整体，优先在「单传祖先链」上整体截图**，不能被单独拆开
- 「单传祖先链」至少有一个 ID，数值通常是 `+1`/`+2` 连续递增的

DOM 结构示例：
```html
<body>

<!-- 「单传祖先链」下的段落组没有单层包装下的 pre + 纯文本段落 → 拆开，不判 trans2img -->
<div style="background-color: xxx; border: xxx">
  <div>
    <div><h1>{{LONG_TEXT_1}}</h1></div>
    <pre data-language="python">…</pre>
    <p style="font-size: 14px;"><span>{{LONG_TEXT_2}}</span></p>
  </div>
</div>

<!-- 从 <body> 的子元素 [8] 开始 -->
<!-- 被判定为 `trans2img`，不能被某些「段落/文本」元素（h/p/span/button）拆开 -->
<div data-idx="8" style="background-color: xxx; border: xxx;">
  <!-- 元素 [9] 为没有任何有效内容「文字/图标/图片」的空元素，直接忽略 -->
  <div data-idx="9"></div>
  <!-- 元素 [10] 虽然有兄弟，但兄弟没有效内容 -->
  <!-- 到含有多个有效子元素的 [10] 为止 -->
  <section data-idx="10" style="background-color: xxx; border: xxx;">
    <div data-idx="11">
      <h2 data-idx="13">{{LONG_TEXT_k}}</h2>
    </div>
    <div data-idx="14" style="display: flex; position: relative;">
      <div style="border: xxx;">
        <p>{{LONG_TEXT_k}}</p>
      </div>
      <div style="background-color: xxx; border: xxx;">
        <p>{{LONG_TEXT_k}}</p>
      </div>
    </div>
  </section>
</div>

<!-- 卡片组：文本为主、仅小图标 → ul -->
<div data-idx="30" style="display: flex">
  <div><img src="https://example.com/i/icon-1.png"><span>{{LONG_TEXT_10}}</span></div>
  <div><img src="https://example.com/i/icon-2.png"><span>{{LONG_TEXT_11}}</span></div>
</div>

<!-- 卡片组：图片为主、文本较短 → trans2img -->
<div data-idx="40" style="display: grid">
  <figure><img src="https://example.com/a/shot-1.png"><figcaption>{{LONG_TEXT_12}}</figcaption></figure>
  <figure><img src="https://example.com/a/shot-2.png"><figcaption>{{LONG_TEXT_13}}</figcaption></figure>
</div>
</body>
```

输出示例：
```json
{"h1": "{{LONG_TEXT_1}}"},
{"code": {"lang": "python", "content": "…"}},
{"p": "{{LONG_TEXT_2}}"},
{"trans2img": [8, 10]},
{"ul": "- {{LONG_TEXT_10}}\n - {{LONG_TEXT_11}}"},
{"trans2img": [40]}
```

## 输出要求

输出路径：`<url-working-path>/7_skeleton.json`

完整 JSON 结构：

```json
[
  {"h1": "# {{LONG_TEXT_1}}"},
  {"p": "作者：Name · 时间：1945/08/01"},
  {"img": "![img](https://example.com/a/cover.png)"},
  {"blockquote": "> {{LONG_TEXT_4}}"},
  {"code": {"lang": "python", "content": "def hello():\n    print('hi')"}},
  {"table": "|季度|营收|\n|--|--|\n|Q1|1.2亿|"},
  {"ul": "- {{LONG_TEXT_10}}\n - {{LONG_TEXT_11}}"},
  {"trans2img": [9, 10]}
]
```