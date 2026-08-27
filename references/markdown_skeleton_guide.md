# 任务

读取 HTML `<url-working-path>/6_article.html` 的 DOM 结构，把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。长文本只引用占位编号、一字不抄，正文回填由后续脚本完成。

## 专有名词

**「单传祖先链元素」**：对某个目标模块，从 `<body>` 下包裹它的子元素开始向下走到模块容器为止——每一级的子元素中，没有有效内容（子树内无文字/图标/图片，`h/p/span/table/img/文本/...`）的空元素当它不存在；剩下的有效子元素只有一个 → 穿过它继续下探；剩余多个 → 停在该元素（含该元素），它就是**模块容器**。链上所有元素的 `data-u2m-id` 组成该模块的 ID 集

DOM 结构示例：
> 单传祖先链元素：[1]-[3]

```html
<body>
<!-- 祖先链从 <body> 开始 -->
<div data-u2m-id="1">
  <!-- 元素 [2] 为没有任何有效内容「文字/图标/图片」的空元素，直接忽略 -->
  <div data-u2m-id="2"></div>
  <!-- 元素 [3] 虽然有兄弟，但兄弟没有效内容 -->
  <!-- 祖先链到含有多个有效子元素的 [3] 为止 -->
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

## 词汇表：

| key | value |
|---|---|
| `h1 - h6` | 标题内容：`# xxx` |
| `p` | 段落内容 |
| `blockquote` | 引用内容：`> xxx` |
| `ul` / `ol` | 列表体：`- xxx\n - xxx` / `1. xxx\n 2. xxx` 一行 |
| `img` | 图片绝对 URL：`![img](url)`|
| `code` | 语言类型 + 独立代码内容：`{"lang": "tsx", "content": "..."}` |
| `table` | 完整 markdown 表格：含 `|--|--|` 分隔行 |
| `trans2img` | 独立复杂视觉模块：取「单传祖先链元素」的 `data-u2m-id` |

- 保持文档序、不重不漏；不要修改原义
- key 是**语义判断**的结果，具体按照下面的**判定规则**判定
- value 要带上 Markdown 语法，包括行外语法（`#`、`>`、`-`、`1.`、`![img](url)`等），行内格式（`**粗体**`、`[文本](url)`、`` `code` ``等）
- 长文本**只引用编号**：读到的 `{{LONG_TEXT_5|16_chars}} / {{LONG_TEXT_5|16_words}}` 写成 `{{LONG_TEXT_5}}`（不带后缀）
- 短文本（未达长文本占位阈值）与 URL → 照抄
- 一个顶层元素可展开为多条（`figure` → `img` 条 + `figcaption` 的 `p` 条），也可收敛为一条（无块样式的卡片 div → 单个 `p`）
- 在「单传祖先链元素」中，没有块样式（背景/边框/圆角/阴影）的父组件可直接忽略

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

- 在「单传祖先链元素」上，存在单个元素有「背景/边框/圆角/阴影」的提示段落，子孙元素没有「背景/边框/圆角/阴影」等块元素样式，只有文本 → `blockquote`

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

输出示例：
```json
{"blockquote": "> {{LONG_TEXT_1}}\n> {{LONG_TEXT_2}}\n> {{LONG_TEXT_3}}"}
```

### `ul` / `ol` 判定

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

输出示例：
```json
{"ol": "1. {{LONG_TEXT_10}}\n 2. {{LONG_TEXT_11}}"},
{"ul": "- {{LONG_TEXT_12}}\n - {{LONG_TEXT_13}}"}
```

### `img` 判定

- `<img>` / `<picture>` 元素：value 统一写 `![img](图片绝对URL)`（URL 为快照阶段已绝对化的 src） → `img`；
- `<figure><img>` + `<figcaption>`：展开为两条——`img` 条 + figcaption 的 `p` 条 → `img`；
- 伴随文本的行内小图标 / 装饰图标不单独成 `img` 条
- `<img>` 保留的 `style` 宽高（`width`/`height`，步骤 5 唯一元素级例外）是判图片权重的信号：小尺寸（图标级）→ 行内小图标不单独成条；大尺寸 → 独立 `img` 条；多张中等尺寸聚集 → 倾向 `trans2img` 图片组
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

- 在「单传祖先链元素」上：
  「视觉上」没有任何「背景/边框/圆角/阴影」的祖先元素 → `code`；
  「视觉上」有单个「背景/边框/圆角/阴影」的祖先元素 → `code`；
  「视觉上」有**多个**「背景/边框/圆角/阴影」的祖先元素 → 降级 `trans2img`；
- `lang` 必填：优先取 `class="language-xxx"` 等语言线索，无线索时写 `""`
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

输出示例：
```json
{"p": "{{LONG_TEXT_k}}"},
{"code": {"lang": "", "content": "code..."}}
```

### `table` 判定

- 真实 `<table>`（thead/tbody/th/td，或行列对齐的网格数据）**一律走 `table`**，无论带多重的背景/边框装饰；分组行用粗体行表达，markdown 表格可直接承载宽内容
- 仅当结构无法用 markdown 表格表达（复杂跨行跨列/嵌套）才降级 `trans2img`

### `trans2img` 判定

>  当模块的视觉布局本身承载语义，markdown 无法表达，就需要将元素整体转换成图片：`trans2img`

- 有「视觉上」的「背景/边框/圆角/阴影」的「单传祖先链元素」和「背景/边框/圆角/阴影」的「子孙/兄弟」元素 → `trans2img`
- 纯文本「很少/没有」的图片组 → `trans2img`
- 多图文组合的卡片组 → `trans2img`
- 图表、流程、图解、以空间关系表意的卡片拼贴 → `trans2img`

### `trans2img` ID 取值规则

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
    <!-- 祖先链到含有多个有效子元素的 [30] 为止 -->
    <div data-u2m-id="30">
      <div style="background-color: xxx; border: xxx">
        <div><p>{{LONG_TEXT_k}}</p></div>
      </div>
      <div style="display: flex;">
        <div style="background-color: xxx; border: xxx"><p>text</p></div>
        <div style="background-color: xxx; border: xxx"><p>text</p></div>
      </div>
    </div>
  </section>
</div>
</body>
```

输出示例：
```json
{"trans2img": [9, 10]},
{"trans2img": [27, 29, 30]}
```

### 冲突判定原则

- **文本形态（markdown 语法）优先**：能用 Markdown 正确显示的内容，优先用 Markdown 格式展示——`trans2img` 是 markdown 无法表达时的兜底
- 当「单传祖先链元素」下是单个 `table` / `pre` / `code` / `img`，且「上方/下方」仅有纯文本段落时，应该拆开成 `p + code + p`（`p + table + p` / `p + img + p` 同理），**不应该判定成 `trans2img`**——包装的背景/边框只是装饰
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

输出示例：
```json
{"p": "{{LONG_TEXT_1}}"},
{"code": {"lang": "", "content": "code..."}},
{"p": "{{LONG_TEXT_2}}"},
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