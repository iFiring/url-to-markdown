# 任务

读取 HTML `<url-working-path>/6_article.html` 的 DOM 结构，把文章视图转换成一份 **markdown 骨架**——数组按文档序排列，每项一个单键对象，key 是语义标签，value 是该块的内容模板。占位符（`{{LONG_TEXT_k|…}} / {{CODE_k|…}} / {{TABLE_k|…}}`）只引用占位编号，去除所有后缀（包括 `|`）。

## 专有名词

**「段落块」**：`<body>` 下的每个直接子元素都是一个「段落块」。每个「段落块」都可能包含独立的「小段落」（`h1-h6` / `p` / `span` / `blockquote` / `ul` / `ol` / `pre>code` / `table` / `img`），每个小段落都是**独占一行**的 Markdown 文本（`span` 小段落映射为 `p` 条）；**无法用小段落表达的内容，整体截图成 Markdown 图片**（`trans2img`）。

DOM 结构示例：
```html
<body>
<!-- 段落块 [1]，包含 `h1` / `p` 两个小段落 -->
<div data-idx="1"><h1>…</h1><p>…</p></div>
<!-- 段落块 [10]，包含 `img` / `pre` 两个小段落 -->
<section data-idx="10"><img src="…"/><pre>…</pre></section>
<!-- 段落块 [20]，不能再拆成小段落 -->
<ol data-idx="20">…</ol>
</body>
```

**「块元素样式」**：「背景/边框/圆角/阴影」

## 词汇表：

| key | value |
|---|---|
| `h1 - h6` | 标题内容：`# xxx` |
| `p` | 段落内容 |
| `blockquote` | 引用内容：`> xxx` |
| `ul` / `ol` | 列表体（一项一行、写在同一字符串）：`- xxx\n- xxx` / `1. xxx\n2. xxx` |
| `img` | 图片绝对 URL：`![img](url)`|
| `code` | 语言类型 + 独立代码内容：`{"lang": "tsx", "content": "…"}` |
| `table` | 完整 markdown 表格：含 `|--|--|` 分隔行 |
| `trans2img` | 独立复杂视觉模块：取「截图边界链」的 `data-idx`（整数数组） |

- 保持原始 `HTML` 文档序、不要修改原义
- key 是**语义判断**的结果，具体按照下面的**判定规则**判定
- value 要带上 Markdown 语法：行外语法（`#`、`>`、`-`、`1.`、`![img](url)`等）和行内格式（`**粗体**`、`[链接文本](url)`、行内 code 等）都要写进 value
- 「长文本」的占位符**只引用编号**（不带统计后缀）：`{{LONG_TEXT_5|…}}`  → `{{LONG_TEXT_5}}`；**每个编号在整个骨架中恰引用一次**（`trans2img` 子树内的编号除外——原文随截图保留，不引用、不出条目）
- 短文本（未达长文本占位阈值）与 URL → 照抄
- 数学公式：输入中的 LaTeX 已是 `$…$` 文本形态——照抄源码，不转写为普通文本；显示级公式可独立成 `p` 条、value 写 `$$…$$`
- 「不重不漏」指**正文内容**：每处正文内容恰出一个条目、每个 LONG_TEXT 编号恰引用一次；下列 chrome 内容**豁免**（不出条目、其中的 URL/编号不引用，不算漏）：不构成有效内容的 UI 控件文本（分享/点赞/复制一类按钮）、装饰性行内小图标

## 判定规则

对每个「段落块」逐个判定、产出条目。多个**判定小节**同时命中时，按本节自上而下的顺序取**先命中者**；各小节**内部**的条目是「一般规则 → 例外/细化」关系，**例外优先于一般规则**（如：h 标签一般判 `h1-h6`，但充当模块内部标题时例外不判）。`trans2img` 是最后的兜底——无法用「小段落」表达的内容整体截图成 Markdown 图片。

### `h1 - h6` 判定

- 带有明显 `h1 - h6` 标签 → `h1 - h6`
- 字体大小为 `h1 - h6` 级别大小 → `h1 - h6`
- 多句长文本（导语/摘要）即使字号偏大（如 1.1-1.25rem）仍判 `p`——按字号定级只适用于短句标题
- 标题旁的**纯装饰**编号徽章（如「01」圆形数字标）不并入标题文本；但**语义节号**（如「5.1」「§4.4」，正文交叉引用可指向的）保留在标题文本内
- `h` 标签充当**模块内部的标题/标签**（代码块标题栏、卡片标题、面板标题等）时不判 `h1-h6`，跟随模块归属形态：代码块标题栏 → `p`，卡片/列表项标题 → 列表项文本；`h1-h6` 只留给文档结构性标题
- 加粗短标签判 `h` 还是 `p` 拿不准时的平手规则：字号不超过正文常规字号、且不统领后续内容层级的（徽章式小节名、收束/导语标签）→ `p`（保留粗体）

字号粗略映射（浏览器默认字号为基准；整站字号偏移时按页面内相对大小定级；1rem/16px 常为正文常规字号，需结合加粗/语义再定级）：

| 字体大小（约） | 判定 |
|---|---|
| 2rem / 32px | `h1` |
| 1.5rem / 24px | `h2` |
| 1.17rem / 19px | `h3` |
| 1rem / 16px | `h4` |
| 0.83rem / 13px | `h5` |
| 0.67rem / 11px | `h6` |

两档之间的值就近判定（如 28px→距 32px 更近判 `h1`、21px→距 24px 更近判 `h2`）；整站字号缩放、正文非常规 16px 时，先定位正文常规字号作为 **`h4` 基准档**、其余按比例排序定级。

DOM 结构示例：
```html
<body>
<div>
  <div>
    <!-- 判定成 h1 -->
    <span style="font-size: 32px;">
      <span>{{LONG_TEXT_1}}</span>
    </span>
    <!-- 字号 2rem 达 h1 级别，同样判成 h1 -->
    <p style="font-size: 2rem;">
      <span>{{LONG_TEXT_2}}</span>
    </p>
  </div>
  <div>
    <!-- 判定成 h2 -->
    <h2>章节标题…</h2>
  </div>
</div>
</body>
```

输出示例：
```json
{"h1": "# {{LONG_TEXT_1}}"},
{"h1": "# {{LONG_TEXT_2}}"},
{"h2": "## 章节标题…"}
```

### `blockquote` 判定

- 明显 `<blockquote>` 标签 → `blockquote`
- `<aside>` 一类语义旁注/边栏提示标签 → `blockquote`（即使无块样式）
- 「段落块」内只有**一层**带「块元素样式」的包裹（段落块自身、或其下某一子层；内外不再出现其它「块元素样式」）、子孙全为文本形态元素（`p`/`span`/`h1-h6`/文本节点，不含图片/表格/代码块/列表）→ `blockquote`（块内 `h` 并入引用文本，不另出 `h` 条）

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
    <p>{{LONG_TEXT_4}}</p>
    <p>{{LONG_TEXT_5}}</p>
  </div>
</div>
</body>
```

输出示例：
```json
{"blockquote": "> {{LONG_TEXT_1}}\n> {{LONG_TEXT_2}}"}
{"blockquote": "> {{LONG_TEXT_3}}"}
{"blockquote": "> {{LONG_TEXT_4}}\n> {{LONG_TEXT_5}}"}
```

### `ul` / `ol` 判定

- 真实列表标签：`<ul>`/`<ol>`/`<li>` → `ul`/`ol`；有序语义（步骤、排名、编号）→ `ol`；无序 → `ul`
- 「段落块」内有多个子面板，子面板内容**以文本为主**（文本承担主要信息：标题 + ≥1 句说明等）时，按文本形态优先**于截图** → `ul`/`ol`（图片为主时反转，见 `trans2img` 判定反例）；
- 「段落块」内，无列表标签但子元素**同构重复**、且带**列表特征信号**——编号前缀（`1.`/`01` 一类）、圆点/项目符号前缀（●/•/–/✓ 一类）或行首小图标充当项目符号——的条目（多个纯文本行的「卡片组、垂直堆叠的图标+文本行、要点罗列、标签组等」），能够用多级 `ul` / `ol` 展示的 → `ul`/`ol`（源文的列表标记转换为 markdown 行级语法 `- `/`1. `，不照抄进 value）；**无列表特征信号**的连续完整句正文段落 → 多个 `p` 条，不判列表
- 「标签：值」成对重复的元数据行（作者/日期/阅读量等）→ 收敛为单个 `p` 条（如「作者：X · 日期：Y · 阅读：Z」），不判列表
- value 是**一个字符串**：一行一项、`\n` 分隔、**同级项无前导空格**，行级 `- ` / `1. ` 语法写在 value；嵌套列表用缩进表达（每级缩进 2 空格）、写进同一字符串；条目**续行**（卡片内的说明文本一类）同为 2 空格缩进、不写列表标记

DOM 结构示例：

```html
<body>
  <ol>
    <li>{{LONG_TEXT_10}}</li>
    <li>{{LONG_TEXT_11}}</li>
  </ol>
  <div>
    <p>● <span>{{LONG_TEXT_12}}</span></p>
    <p>● <span>{{LONG_TEXT_13}}</span></p>
  </div>

<div data-idx="30" style="display: flex">
  <div data-idx="31">
    <div>
      <p>Title_1…</p>
      <img src="https://example.com/i/icon-1.png" style="width: 24px; height: 24px;">
      <span>{{LONG_TEXT_14}}</span>
    </div>
    <div>
      <p>Title_2…</p>
      <img src="https://example.com/i/icon-2.png" style="width: 24px; height: 24px;">
      <span>{{LONG_TEXT_15}}</span>
    </div>
  </div>
</div>
</body>
```

输出示例：
```json
{"ol": "1. {{LONG_TEXT_10}}\n2. {{LONG_TEXT_11}}"},
{"ul": "- {{LONG_TEXT_12}}\n- {{LONG_TEXT_13}}"},
{"ul": "- Title_1…\n  {{LONG_TEXT_14}}\n- Title_2…\n  {{LONG_TEXT_15}}"}
```

### `img` 判定

- `<img>` / `<picture>` 元素：value 统一写 `![img](图片绝对URL)`（URL 为快照阶段已绝对化的 src；`<picture>` 一律取内部 `<img>` 的 `src`，`srcset`/`<source>` 候选忽略） → `img`；
- `<figure><img>` + `<figcaption>`：展开为两条——`img` 条 + figcaption 的 `p` 条 → `img`；
- `<figure>` 包裹其它内容同理展开：内容按自身类型成条目（`blockquote`/`table`/`pre` 等），`figcaption` → `p`；
- 伴随文本的行内小图标 / 装饰图标不单独成 `img` 条
- `<img>` 保留的 `style` 宽高（`width`/`height`）是判图片权重的信号，按较短边分档（参考值）：**≤48px → 图标级**，行内小图标不单独成条；**≥240px 或宽度接近内容区 → 大图**，独立 `img` 条；两档之间为中等尺寸，多张聚集 → 倾向 `trans2img` 图片组
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

- 见 `pre>code>{{CODE_k|N_lines}}` 占位符 → 生成 `{{CODE_k}}`，剥掉 `|N_lines` 后缀， **不用自行转换**
- 「段落块」内主体是「代码块`pre>code>…` + 标题/说明文字」 → 格式化 `code` + `p`；「标题/说明文字」不一定存在
  - `lang` 必填：优先取 `pre` / `code` 上的 `data-language` 属性，无线索时写 `""`
  - `pre` 自带背景/边框不影响判定（同 `table`），仍走 `code`
  - 代码逐字照抄：源文若有空格粘连/损伤也照抄不改，只删除代码左侧的数字序号，不做任何修复
  - 代码内的长文本照常引用占位符（`content` 中可含 `{{LONG_TEXT_k}}`）

DOM 结构示例：
```html
<body>
<!-- 见 `pre>code>…` 原始代码块  → 格式化的 `code…` -->
<section style="background-color: xxx; border: xxx;">
  <div style="border-bottom: xxx">
    <p>{{LONG_TEXT_6}}</p>
  </div>
  <pre style="background-color: xxx;">
    <code><span>code</span>…</code>
  </pre>
</section>

<!-- 见 `pre>code>{{CODE_k|N_lines}}` 占位符  → `{{CODE_k}}` -->
<section style="background-color: xxx; border: xxx;">
  <div style="background-color: xxx;">
    <pre>
      <code data-language="lang">{{CODE_k|N_lines}}</code>
    </pre>
  </div>
  <p style="border-top: xxx">{{LONG_TEXT_7}}</p>
</section>
</body>
```

输出示例：
```json
{"p": "{{LONG_TEXT_6}}"},
{"code": {"lang": "lang", "content": "[formatted]code…"}},
{"code": {"lang": "lang", "content": "{{CODE_k}}"}},
{"p": "{{LONG_TEXT_7}}"}
```

### `table` 判定

- 见 `{{TABLE_k|rows×cols}}` 占位符 → 生成 `{{TABLE_k}}`，剥掉 `|rows×cols` 后缀， **不用自行转换**
- 「段落块」内主体是「表格块（`table>…`） + 标题/说明文字」 → 格式化 `table` + `p`；「标题/说明文字」不一定存在
  - 单元格内的脚注锚点（如 `[*](#...)`）保留链接形式，不退化为裸 `*`
  - 单元格内长文本照常引用占位符（表格 value 中可含 `{{LONG_TEXT_k}}`）
  - 单元格文本内的 `|` 转义为 `\|`，换行写 `<br>`
- 嵌套表、或单元格内含块级内容（列表/多段落/图片等）致 GFM 管线表无法表达 → 降级 `trans2img`（截图链取法见该节判定）

DOM 结构示例：
```html
<body>
<!-- 原始 `table>…` 表格  → 格式化的 markdown 表格 -->
<section style="background-color: xxx; border: xxx;">
  <div style="border-bottom: xxx">
    <p>{{LONG_TEXT_8}}</p>
  </div>
  <table style="border: xxx;">
    <thead>
      <tr><th>指标</th><th>数值</th></tr>
    </thead>
    <tbody>
      <tr><td>营收<a href="#fn1">*</a></td><td>1.2亿</td></tr>
      <tr><td>{{LONG_TEXT_9}}</td><td>{{LONG_TEXT_10}}</td></tr>
    </tbody>
  </table>
</section>

<!-- 见 `{{TABLE_5|3×2}}` 占位符  → `{{TABLE_5}}` -->
<section style="background-color: xxx; border: xxx;">
  <div style="background-color: xxx;">
    {{TABLE_5|3×2}}
  </div>
  <p style="border-top: xxx">{{LONG_TEXT_11}}</p>
</section>
</body>
```

输出示例：
```json
{"p": "{{LONG_TEXT_8}}"},
{"table": "|指标|数值|\n|--|--|\n|营收[*](#fn1)|1.2亿|\n|{{LONG_TEXT_9}}|{{LONG_TEXT_10}}|"},
{"table": "{{TABLE_5}}"},
{"p": "{{LONG_TEXT_11}}"}
```

### 组合模式

- 当「段落块」内是单个 `<table>` / `<pre>` / `<img>`，且其余兄弟只是纯文本段落（`p/h/blockquote` 一类，`block > p > span > text…`）时 → 拆成对应条目组合：`table` / `code` / `img` 条（`pre` 对应 `code` 条）+ `p` / `h1-h6` / `blockquote` 文本条
- 当「段落块」内是**独立、多行**的文本内容（`h1` + `pre` + `p` + `blockquote` + `button` 一类元素组合，分布在 `section` / `header` / `div` / `footer` 等层级中），且**没有多层级「块元素样式」** → `h1+code+p+blockquote` 组合（`pre` 对应 `code` 条）
- 展开器/折叠器（accordion）标题**不是** UI 控件，是内容标题——按页面内相对层级判 `h`（通常比最近的前一个结构标题低一级，嵌套展开器再低一级）

DOM 结构示例（同一 `<body>` 内四个判定场景）：
```html
<body>

<!-- 例 1：单个 <pre> 与纯文本兄弟（h2 / p）共处一个「段落块」→ 拆成 h2 + code + p -->
<div>
  <h2>{{LONG_TEXT_30}}</h2>
  <pre><code data-language="js">const a = 1;</code></pre>
  <p>{{LONG_TEXT_31}}</p>
</div>

<!-- 例 2：独立、多行文本段（h1/pre/p/blockquote/button），无多层级「块元素样式」→ h1/code/p/blockquote；「分享」按钮是 UI 控件，除非按钮是有效的文本内容，否则其文本不出条目 -->
<section>
  <header>
    <h1>{{LONG_TEXT_32}}</h1>
  </header>
  <div>
    <pre><code>{{CODE_4|N_lines}}</code></pre>
  </div>
</section>
<section>
  <div>
    <p>{{LONG_TEXT_33}}</p>
  </div>
  <blockquote><p>{{LONG_TEXT_34}}</p></blockquote>
  <footer>
    <button>分享</button>
  </footer>
</section>

<!-- 例 3：展开器（accordion）标题是内容标题、不是 UI 控件——带 h2 标签按标签级别判 h2；嵌套展开器标题（裸文本、无标签）比其父级低一级判 h3 -->
<div>
  <button aria-expanded="true">
    <svg></svg>
    <h2>展开器标题 A</h2>
  </button>
  <div>
    <p>{{LONG_TEXT_40}}</p>
    <div>
      <button aria-expanded="false">嵌套展开器标题</button>
      <div><p>{{LONG_TEXT_41}}</p></div>
    </div>
  </div>
</div>
</body>
```

输出示例（按文档序）：
```json
{"h2": "## {{LONG_TEXT_30}}"},
{"code": {"lang": "js", "content": "const a = 1;"}},
{"p": "{{LONG_TEXT_31}}"},
{"h1": "# {{LONG_TEXT_32}}"},
{"code": {"lang": "", "content": "{{CODE_4}}"}},
{"p": "{{LONG_TEXT_33}}"},
{"blockquote": "> {{LONG_TEXT_34}}"},
{"h2": "## 展开器标题 A"},
{"p": "{{LONG_TEXT_40}}"},
{"h3": "### 嵌套展开器标题"},
{"p": "{{LONG_TEXT_41}}"}
```

### `trans2img` 判定

> `trans2img` 是将无法用 Markdown 表达的模块整体截图。

- **前面的所有判定都不符合，也就是无法用「小段落」表达** →  `trans2img`
- **反例——「文本形态优先」在图片为主时反转**：内容**以图片为主**（图片面积占主导、文本仅剩短标签——每卡片 ≲1 行短句）、文本较少或没有时，即使夹杂少量可拆的文本小段落，也**优先 `trans2img` 整体截图**、不逐条拆文本；「文本形态优先」只适用于文本为主的「段落块」
- 纯文本「很少/没有」的图片组、图文拼贴；CSS 背景图同理（取不到独立 URL） → `trans2img`
- 图表、流程、图解、以空间关系表意的卡片拼贴 → `trans2img`
- **多层级「块元素样式」**：「段落块」内有 ≥2 层**嵌套**元素带「块元素样式」的复杂布局，或有 **≥2 个并列**、各带「块元素样式」的子面板（对比面板、卡片格） → `trans2img`；段落块主体是单个 `pre`/`table` 时**不适用本条**——走 `code`/`table` + 组合模式判定，样式层只是外壳装饰
- 包含 `canvas/iframe` 等特殊元素 → `trans2img`，截图边界**定死在「段落块」**、链 = [段落块]
- 以图片为主要内容、文本较短的卡片组 → `trans2img`
- 「段落块」子树内含**承载内容**的「绝对定位」元素（悬浮标注、覆盖卡片、定位图文拼贴——与其它内容空间叠放） → `trans2img`；纯装饰性绝对定位（无文字/图片内容的背景装饰、色块、光晕）不触发
- 行列对齐的网格数据（非 `<table>` 标签） → `trans2img`
- 包含 UI 交互控件，UI 控件仅指**纯互斥选择器**：选项卡标签组、下拉/切换触发器、单选组、语言切换等（`role="group"` / `role="button"` / `role="tablist"` / `role="radiogroup"` 一类），「段落块」整体截图 → `trans2img`——**截图边界定死在「段落块」、不拆第一层的「标题/说明」**（UI 控件与内容面板是一体的，第一层文本随截图吸收、不出条目）

**`trans2img` ID 取值规则**

- **`trans2img` 取自「截图边界链」**的数组，按**从最外层链首（段落块或其子元素）到最内层链尾（多子元素的容器）**的顺序取值
- 「截图边界链」至少有一个 ID，数值通常是 `+1`/`+2` 连续递增的
- value 必须是 **JSON 整数数组**（如 `[1, 2, 4]`）——`data-idx` 属性值在 HTML 里是字符串，写入骨架时必须是数字、不能写字符串数组
- 链首本身即多子元素容器时，链上只有一个元素

> **「截图边界链」**：对要走 `trans2img` 的视觉模块，链 = 从**链首**逐层下探到**链尾**途经的全部元素（含两端）——它框定该模块截图的整体边界，链上每个 `data-idx` 都是一张候选截图。链首之下的每一层都**只包裹该模块**：除链上路径外的兄弟元素均无有效内容。

**第一层子元素分两类**：① **文本形态子元素**（「标题/说明」）——`h1-h6`/`p`/短文本行一类文本形态的第一层直接子元素（剔除小图标与 UI 控件）；② **复杂模块**——无法用「小段落」表达的内容子元素（图表、卡片组、拼贴等）。
**链首**：默认是「段落块」元素。**下移规则一律适用**——第一层有文本形态子元素、且恰有 **1 个**复杂模块时，链首下移到该复杂模块（**只能下移一次**，见以下示例），文本形态子元素独立成条目（`p/h/blockquote`）。**仅有的例外**：第一层复杂模块 ≥2 个、或含 UI 交互控件——不下移、也不拆标题/说明，截图边界**定死在「段落块」整体**，链 = [段落块] 一个 ID，第一层文本全部随截图吸收（有滚动内容需要完整截图）。段落块自身即视觉主体（如带 `background-image`）、第一层只有文本形态子元素而无复杂模块可下移时 → 链 = [段落块]，第一层文本属模块内部构成、随截图吸收。
**标题/说明拆分只发生在第一层**：能拆出来独占一行成条目的标题/说明，只能是**「段落块」的直接子元素**，不能拆第二层之下的标题/说明（随模块截图吸收）；UI 控件不能算作标题/说明。
**链尾**：通常是「多子元素的容器」，从链首逐层下探——没有有效内容（子树内无文字/图标/图片）的空元素当它不存在（不入链）；只有一个有效子元素 → 穿过它继续下探（它仍在链上）；有多个有效子元素 → 停在该元素，它就是**链尾模块容器**

DOM 结构示例（截图边界链）：
```html
<body>
<!-- 普通情况，无第一层「标题/说明」，`trans2img` 取值为 `[1,2,4]` -->
<!-- 「段落块」作为默认链首 -->
<section data-idx="1" style="background-color: xxx; border: xxx">
  <!-- 第一层没有「标题/说明」，继续下探 -->
  <div data-idx="2">
    <!-- 无效元素 [3]，从「截图边界链」剔除，继续下探 -->
    <div data-idx="3"><span></span></div>
    <!-- 多个有效子元素 [4]，停止下探——链尾 -->
    <div data-idx="4">
      <div data-idx="5"><span>…</span></div>
      <div data-idx="6"><span>…</span></div>
    </div>
  </div>
</section>

<!-- 第一层有「标题/说明」,`trans2img` 取值为 `[9,10]` -->
<div data-idx="7">
  <!-- 第一层有「标题」 -->
  <h2 data-idx="8">Title…</h2>
  <!-- 第一层有「标题/说明」，链首从「段落块」[7] 下移到非「标题/说明」的子元素 [9] -->
  <section data-idx="9">
    <!-- 多个有效子元素 [10]，停止下探——链尾 -->
    <div data-idx="10">
      <div data-idx="11"><span>…</span></div>
      <div data-idx="12"><span>…</span></div>
    </div>
  </section>
  <!-- 第一层有「说明」 -->
  <div data-idx="13"><span>{{LONG_TEXT_2}}</span></div>
</div>

<!-- 第一层有「标题」+ 多个复杂模块 → 不下移、不拆「标题/说明」，截图定死在「段落块」整体，取值为 `[14]` -->
<div data-idx="14">
  <h2 data-idx="15">Title…</h2>
  <section data-idx="16" style="background-color: xxx; border: xxx">…图表 A…</section>
  <section data-idx="17" style="background-color: xxx; border: xxx">…图表 B…</section>
</div>

<!-- 展开器内嵌视觉模块：展开器标题是第一层「标题」（内容标题、非 UI 控件）→ 独立成 h 条；链首下移进面板，取值为 `[20,21]` -->
<div data-idx="18">
  <button data-idx="19">展开器标题</button>
  <div data-idx="20">
    <section data-idx="21" style="background-color: xxx; border: xxx">
      <img src="https://example.com/a/chart.png">
      <div>…图例…</div>
    </section>
  </div>
</div>
</body>
```

输出示例：
```json
{"trans2img": [1, 2, 4]},
{"h2": "## Title…"},
{"trans2img": [9, 10]},
{"p": "{{LONG_TEXT_2}}"},
{"trans2img": [14]},
{"h3": "### 展开器标题"},
{"trans2img": [20, 21]}
```

DOM 结构示例（`trans2img`判定场景）：
```html
<body>

<!-- 例 1：图文拼贴/图片组（纯文本很少，CSS grid；多张 figure 聚成视觉整体）→ trans2img，链 [20,21]；figcaption 短文本随截图吸收、不逐张拆 img -->
<div data-idx="20" style="display: grid;">
  <div data-idx="21">
    <figure data-idx="22"><img src="https://example.com/a/a.png"><figcaption>SHORT…</figcaption></figure>
    <figure data-idx="23"><img src="https://example.com/a/b.png"><figcaption>SHORT…</figcaption></figure>
  </div>
</div>

<!-- 例 2：CSS 背景图（取不到独立 URL），段落块自身即视觉主体；第一层只有文本形态子元素、无复杂模块可下移 → trans2img，链定死 [24]，横幅标题/短句随截图吸收 -->
<div data-idx="24" style="background-image: url(https://example.com/a/banner.png);">
  <div data-idx="25"><span>横幅标题</span></div>
  <p data-idx="26">SHORT…</p>
</div>

<!-- 例 3：≥2 个并列带「块元素样式」的对比面板（卡片格、以图表/图片表意）→ trans2img，链 [30,31] -->
<div data-idx="30">
  <div data-idx="31" style="display: flex;">
    <div data-idx="32" style="background-color: xxx; border: xxx;">
      <img src="https://example.com/a/m1.png" style="width: 320px; height: 180px;"><div>指标卡 A</div>
    </div>
    <div data-idx="33" style="background-color: xxx; border: xxx;">
      <img src="https://example.com/a/m2.png" style="width: 320px; height: 180px;"><div>指标卡 B</div>
    </div>
  </div>
</div>

<!-- 例 4：包含 canvas 特殊元素（图表 + 图例）→ trans2img；截图边界定死在段落块，链 [40] -->
<div data-idx="40" style="border: xxx;">
  <canvas data-idx="41" width="600" height="300"></canvas>
  <div data-idx="42"><span>● 收入　● 支出</span></div>
</div>

<!-- 例 5：子孙中含「绝对定位」元素（悬浮标注）→ trans2img，链 [50,51] -->
<div data-idx="50">
  <div data-idx="51" style="position: relative;">
    <img data-idx="52" src="https://example.com/a/diagram.png">
    <div data-idx="53" style="position: absolute; top: 0; left: 0;">标注</div>
  </div>
</div>

<!-- 例 6：行列对齐的网格数据（div 模拟表格，非 <table> 标签）→ trans2img，链 [60,61] -->
<div data-idx="60">
  <div data-idx="61" style="display: grid; grid-template-columns: repeat(3, 1fr);">
    <div data-idx="62" style="border: xxx;">Q1</div><div data-idx="63" style="border: xxx;">1.2</div><div data-idx="64" style="border: xxx;">+8%</div>
    <div data-idx="65" style="border: xxx;">Q2</div><div data-idx="66" style="border: xxx;">1.5</div><div data-idx="67" style="border: xxx;">+12%</div>
  </div>
</div>

<!-- 例 7：多个并列数据面板共享标题/汇总句 → 整组算一个模块、一条 trans2img，链收敛到含全部面板的容器 [70,71]；标题 [72]/汇总句 [76] 在模块容器内部（非段落块第一层），随截图吸收、不另出条目 -->
<div data-idx="70">
  <div data-idx="71">
    <h3 data-idx="72">季度对比</h3>
    <div data-idx="73" style="display: flex;">
      <div data-idx="74" style="border: xxx;"><img src="https://example.com/a/c1.png"></div>
      <div data-idx="75" style="border: xxx;"><img src="https://example.com/a/c2.png"></div>
    </div>
    <p data-idx="76">汇总：全年同比增长 10%</p>
  </div>
</div>

<!-- 例 8：纯互斥选择器（语言切换 segmented control，role="group"/"button"）→ trans2img，截图定死在段落块 [80]、[82] 的文本随截图吸收 -->
<div data-idx="80">
  <div data-idx="81" role="group">
    <button role="button" aria-pressed="true">中文</button>
    <button role="button">English</button>
  </div>
  <section data-idx="82">
    <p data-idx="83">SHORT…</p>
    <p data-idx="84">SHORT…</p>
  </section>
</div>
</body>
```

输出示例（按文档序）：
```json
{"trans2img": [20, 21]},
{"trans2img": [24]},
{"trans2img": [30, 31]},
{"trans2img": [40]},
{"trans2img": [50, 51]},
{"trans2img": [60, 61]},
{"trans2img": [70, 71]},
{"trans2img": [80]}
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
  {"ul": "- {{LONG_TEXT_10}}\n- {{LONG_TEXT_11}}"},
  {"trans2img": [8, 10]}
]
```