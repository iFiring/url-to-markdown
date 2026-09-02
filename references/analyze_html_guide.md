# 任务

这是**一篇文章页面**的快照，读取页面 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、语义 class）与**文本规模**分布，找到该页面文章四类关键元素的 `data-idx`（**以下统称 ID**）：

1. **标题分块**（`titleId`）：文章主标题对应的元素 ID。通常是文章主体范围（见「原则/约束」）内层级最高的 `<h1>`-`<h3>` 或结构上处于段落流外部或顶部的标题性容器；**无论在段落流内还是流外都标这里**——若标题元素本身落在段落流中，**可同时保留其在 `paragraphIds` 的原位**；无主标题或不可判时为 `null`

2. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID 集合，如作者、日期、摘要、副标题、开篇词；**无论在段落流内还是流外都标这里**——落在段落流中者同样可保留其在 `paragraphIds` 的原位；可为空数组

3. **段落流**（`paragraphIds`）：文章**段落块的嵌套序列**，整棵按文档序——**标量是段落块 ID，数组是一个子段落流的块列表**

  - 常见段落块元素（清单为指引，非白名单）：
    - 段落：`<p>`
    - 标题：`<h1>`-`<h6>`
    - 预格式块/代码块：`<pre>`（内容折叠为 `{{CODE_k|x_lines}}` 占位，k 为文档序编号、x = 代码行数）
    - 表格块：`<table>`（内容折叠为 `{{TABLE_k|y×x}}` 占位，k 为文档序编号、y = 行数、x = 列数）
    - 复合单元：`<figure>`（图 + `<figcaption>`）
    - 列表：`<ul>`、`<ol>`
    - 定义列表 `<dl>`（`<dt>`/`<dd>` 的术语对、问答、元信息对）
    - 引用块 `<blockquote>`
    - 折叠块：`<details>`、带 `hidden` 属性的折叠树（FAQ/手风琴/折叠块/展开收起块）
    - 展开钮：`<button>`（手风琴/折叠项的成行控件）
    - 结构块：`<section>`、`<aside>`、`<header>`
    - 媒体块：`<img>`、`<picture>`
    - 图解/图表容器（多级 `<div>` 的可视模块）、卡片/提示框——整棵作为一个子块，内部不拆

  - 段落块是**完整子树**，内部不拆

  - **行内元素与分隔符通常不是段落级块**：`<span>`、`<a>`、`<strong>`、`<b>`、`<em>`、`<i>`、行内 `<code>`、`<br>` 等行内元素，以及 `<hr>` 分隔符；**当它们是段落流的直接子元素时除外**

  - **段落块通常不是固定的元素**，而是包装容器 + 语义内容的组合（见结构说明），嵌套链如：`<div> > <h1>`（容器包标题）/ `<div> > <table>`（容器包表格）/ `<section> > <div> > <pre>`（多层容器包代码块）

  - **主段落流与子段落流的判定逻辑不同**——主段落流是文章正文的最外层内容序列；子段落流是嵌套其中的序列。两者分开判定，通用性更高：

    | | 主段落流 | 子段落流 |
    |---|---|---|
    | 标题头块 | 不排除：计规模、可留原位 | 首个直接子块若为标题头：排除计数、居流首位标量 |
    | 锚点/子流 | 不要求 | 要求：\|R\|≥2 须含锚点或已成立子流；\|R\|=1 须为子流且带标题头 |
    | 最小规模 | ≥2 个内容子块（标题/说明计入、噪音不计） | 排标题头/噪音后 \|R\|≥2，或标题头 + 单子流 |

  - **主段落流（顶层）**——文章正文的最外层内容序列容器（在「文章主体范围」内语义识别：承载正文主体、排除页眉/导航/页脚/封面等页面级包装；页面级包装不因包含段落流而成流）：
    - **不做标题头块排除**——文章主标题是 `titleId`、hero/元数据是 `descriptionIds`；二者**可保留在主段落流原位**（与 `titleId`/`descriptionIds` 重叠），不必为 disjoint 而剔出。主段落流中出现的非主级标题（如扁平分部 `<h2>`）是普通标量块，不特殊处理
    - **不要求锚点块**——直接子块可全是平行的、无嵌套关系的子段落流，如 `[[1,[2]], [3,[4]]]`；只要 ≥ 2 个内容子块（段落块/子流；**标题/说明块计入规模**、可同时留在 `paragraphIds` 原位、噪音不计）即成流。剔除标题/说明/噪音后只剩一个内容子块者是**透明包装层**，向内取（见「一流一维」）
    - 块按文档序排列；子段落流占一个数组槽、其容器 ID 不进 JSON

  - **子段落流（嵌套）**——主段落流或更上层子流内、嵌套的内容序列：
    - 首个直接子块若为**标题头块**（子树含 `<h1>`-`<h6>`；裸标题、`<header>`/标题性容器均可），将其**排除出规模计数**并居该子流首位为标量块；再剔除噪音子块，设剩余为 R：
      1. **|R| ≥ 2** 且 R 中至少一个锚点块或已成立子段落流 → 成流；或
      2. **|R| = 1** 且该子块为已成立子段落流（此时须带标题头块——「带标题的流」；无标题头块而只剩一个子流者是透明包装层，见「一流一维」）→ 成流
    - **要求锚点或子流**——以区分内容序列与单个复合单体；不满足者整棵作为上层流的一个块（标题头块 + 单个非流块是典型「带标题单体」，不成流）
    - 成流时：标题头块（若有）居首位标量；子段落流占数组槽、容器 ID 不进 JSON。无标题头块时首个子块不排除、直接计 R（如收束区 `[label, [body…], ul]`，首块是 label 非标题、不排除，靠 ≥2 + 锚点成流）

  - **锚点块**是一眼可辨的明显段落块：`<p>` / `<h1>`-`<h6>` / `<table>` / `<pre>` / `<figure>` / `<ul>` / `<ol>` / `<block><img/></block>` / `<blockquote>` / `<button>` / `<dl>` / `<details>` / hidden 属性元素。共同性质：**内容语义标签 ∧ 默认渲染独占一行**——标签本身就宣告「我是段落/标题/列表/表格/引用/代码块/图片块」，无须看样式即可确认（快照不带样式，成行性来自标签语义）；清单为指引，此性质才是判据。`<div>`/`<section>`/`<aside>` 等结构容器标签默认也是块级、但装什么由内容决定——**可作块、不能作锚点**。**例外——单层锚点穿透**：某直接子块的子树**恰含一个**锚点块时（`<div><p>…</p></div>`、`<div><table>…</table></div>`），该包装块按锚点判定——真实页面几乎全是这类包装形态，锚点性看内容不看壳；子树含多块者不适用穿透。`<button>` 默认行内块，但作为段落流直接子元素出现时即手风琴/折叠的成行展开钮
    - 当容器直接子块全为 `<div>` 但文本/结构明显呈段落序列时（如 prose 容器、同 class 重复段落实例），可依语义判为流——锚点是强默认信号，不是死门槛；但需谨慎，避免把多级嵌套 div 误判为流

  - **折叠块 / 可视模块的优先级**：`<details>`、div 类折叠块（button 标题 + content 容器，功能等同 `<details>`，不论 snapshot 中 content 是否可见）、带 `hidden` 属性的折叠树，以及图解/图表/卡片/提示框等多级 div 可视模块，一律作为**标量锚点块整棵标记、内部不拆**——即使其内部含 `<p>`/`<h4>`/`<table>` 等锚点元素，也**不触发子段落流分裂**（子流判据不穿透这些语义壳）；图解/图表内部的 `<h4>`/`<h5>` 是图表标注，不计为标题头块。此优先级高于 div 的结构性子流判据

  - **一流一维**：数组与段落流一一对应；流之间的非流包装层（剔除噪音后只剩一个子流、且无标题头块的中间容器）**透明、不占维度**，其子流的数组直接并入上层

  - 嵌套结构示例 `paragraphIds: [1, 2, [3, 4, [5, 6]], 7]`：`1/2/7` 在外层段落流，`3/4` 在「子段落流」，`5/6` 在更深的「子段落流」（单元素、无标题头的子流不成立——规模不足，见子段落流规则）。顶层就是文档序序列——段落流之外的游离内容块（流的兄弟元素）同为顶层标量，不做区分；若页面无单一容器、正文直接平铺在 `<body>` 下，顶层即 body 直接子块的文档序序列（body 自身不进 JSON）

4. **噪音元素**（`dumpIds`）：**段落流之内**、未入选 `paragraphIds` 的非文章内容元素的 ID 集合；流外噪音**无须标记**
  - 菜单、导航、目录（TOC）、面包屑、页脚链接、相关推荐、评论列表、分享栏、广告、弹窗、表单
  - **必须确定不属于文章内容**，不确定不能带上；噪音元素内部可能会有 `<ul>`（导航/目录/推荐）/`<p>`/`<h>` 等段落元素——**语义门独立于成流判据**，导航/目录结构上完全符合成流条件，语义上仍是噪音
  - dumpIds 应该优先取流内最高的父元素/祖先元素，而不是一堆子孙元素——**上限：任一 dump 不得是任何 key（`titleId`/`descriptionIds`/`paragraphIds` 块）的祖先**；取「子树内不含任何 key 元素」的最高祖先
  - 已标块（段落块/标题/说明）子树**内部**的噪音无须单独标——块整棵标记、内部不拆

### 「段落流」示例

> **优先找 `titleId`(`<h1>`-`<h3>`)**，`descriptionIds` 一定在它之后；`paragraphIds` 从区间起点起（见下「文档序区间」）

#### 主段落流（P）

```html

<div data-idx="A">
  <h1 data-idx="A1">文章标题</h1>
</div>

<div data-idx="B">
  <p data-idx="B1">文章说明</p>
</div>

<!-- 主段落流 [P] + 锚点块 [P1, P2] + 子段落流 [P3] -->
<article data-idx="P">
  <h2 data-idx="P1">…</h2>
  <p data-idx="P2">…</p>
  <section data-idx="P3">
    <header data-idx="P4"><h2 data-idx="x">…</h2></header>
    <div data-idx="P5"><pre data-idx="x">…</pre></div>
    <p data-idx="P6">…</p>
  </section>
</article>
<!-- 标题块：A1 ；说明块：[B1] -->
<!-- 主段落流：[P1, P2, [P4, P5, …]]（P/P3 只是容器，自身不进 JSON）-->
```

#### 主段落流（K）包含标题/说明

```html
<!-- 主段落流 [K] + 标题/说明(计入 ≥ 2 规模) -->
<article data-idx="K">
  <!-- titleId/descriptionIds 在主段落流内时：首 `paragraphIds` 块 [A] < titleId/descriptionIds（嵌于首块子树）< 后续块；首块即区间起点 -->
  <!-- 段落块一定取流的直接子元素 [A]，而不是其内部 [A1, A2] -->
  <div data-idx="A">
    <h1 data-idx="A1">文章标题</h1>
    <p data-idx="A2">文章说明</p>
  </div>
  <section data-idx="M1">
    <div data-idx="M2"><h2 data-idx="x">…</h2></div>
    <div data-idx="M3"><p data-idx="x"></p></div>
    <div data-idx="M4"><ol data-idx="x">…</ol></div>
  </section>
  <section data-idx="M5">
    <header data-idx="M6"><h2 data-idx="x">…</h2></header>
    <div data-idx="M7"><pre data-idx="x"></pre></div>
    <div data-idx="M8"><p data-idx="x">…</p></div>
  </section>
</article>
<!-- 标题块：A1 ；说明块：[A2] -->
<!-- 主段落流：[A, [M2, M3, M4, …], [M6, M7, M8, …]]（K/M1/M5 只是容器，自身不进 JSON）；标题/说明块也可保留在 paragraphIds 原位-->
```

#### 主段落流（M）包含平行子流（M1 + M7(M5)）

```html

<div data-idx="A">
  <h1 data-idx="A1">文章标题</h1>
</div>

<div data-idx="B">
  <p data-idx="B1">文章说明</p>
</div>

<!-- 主段落流平行子流：直接子块全是子流、无锚点 → 主段落流不要求锚点，仍成流 -->
<article data-idx="M">
  <section data-idx="M1">
    <div data-idx="M2"><h2 data-idx="x">…</h2></div>
    <div data-idx="M3"><p data-idx="x">…</p></div>
    <div data-idx="M4"><ol data-idx="x">…</ol></div>
  </section>
  <!-- M5 是带标题的流（规则 2：标题头 M6 + 单子流 M7），与 M1（规则 1：标题头 M2 排除后 R = M3/M4 ≥2、锚点穿透成立）形态不同；M7 是子流、占一个数组槽（容器 ID 不进 JSON）→ M5 数组 = [M6, [M8, M9, M10]] -->
  <section data-idx="M5">
    <div data-idx="M6"><h2 data-idx="x">…</h2></div>
    <div data-idx="M7">
      <div data-idx="M8"><p data-idx="x">…</p></div>
      <div data-idx="M9"><pre data-idx="x">…</pre></div>
      <div data-idx="M10"><table data-idx="x">…</table></div>
    </div>
  </section>
</article>
<!-- 标题块：A1 ；说明块：[B1]-->
<!-- 主段落流：[[M2, M3, M4, …], [M6, [M8, M9, …]]]（M/M1/M5 只是容器，自身不进 JSON）-->
```

#### 子段落流三形态（A/B/C）

```html
<!-- 形态 A：裸标题 + 扁平正文（无 body 包装）——首个 h2 是标题头块、居首位标量；正文 ≥2 锚点 → 成流 -->
<div data-idx="A">
  <h2 data-idx="A1">章节标题</h2>
  <p data-idx="A2">…</p>
  <p data-idx="A3">…</p>
</div>
<!-- 在上层流中：[A1, A2, A3] -->
```

```html
<!-- 形态 B：div + body 子流-->
<!-- [B1] 标题头块标量；[B3] 是子流 → 占数组槽；B/B3 本身只是容器，自身不进 JSON -->
<section data-idx="B">
  <div data-idx="B1"><span>01</span><h2 data-idx="B2">章节标题</h2></div>
  <div data-idx="B3" class="section__body">
    <p data-idx="B4">…</p>
    <p data-idx="B5">…</p>
    <div data-idx="B6" class="diagram">…多级 div 可视模块，整块不拆…</div>
  </div>
</section>
<!-- 在上层流中：[B1, [B4, B5, B6]] -->
```

```html
<!-- 形态 C：标题头块 + 单个「非流块/说明块」 → 不成流，整棵是上层流的一个块 -->
<section data-idx="C">
  <header data-idx="C1"><span>02</span><h2 data-idx="C2">章节标题</h2></header>
  <p data-idx="C3">…</p>
</section>
<!-- 在上层流中：标量 C（C1/C2/C3 都不进 JSON，整棵一个块）-->
```

## 原则/约束

- 段落流（`paragraphIds`）**必须排除**噪音元素，只收文章主体核心内容

- 四键约束——`titleId`/`descriptionIds` 可与 `paragraphIds` **重叠**（流内标题/说明保留其在流中原位）；其余组合（`titleId`∩`descriptionIds`、任一键 ∩ `dumpIds`）互不相交、同一键内不得重复列举

- 不选 `<body>` 或 `<html>`——它们的 ID 无意义

- **文章主体范围**（成流判据的应用域）= 承载文章标题/说明/正文的最小内容容器（常为 `<article>`、`<main>`，或 class 含 article/content/post/prose 的容器）；站点级页眉（站名/导航）、侧栏、页脚、封面等页面级包装不在其内，也不因包含段落流而成流。站点级 `<h1>`（站名/logo，位于页眉）不是文章主标题——文章主标题在主体范围内，层级可能是 `<h2>`/`<h3>`

- **文档序区间（产物原则）**：文章主体在文档中是一段连续区间，顺序固定为 `titleId` → `descriptionIds` → `paragraphIds`——`titleId` ≤ 所有 `descriptionIds`。标题/说明可在流外（`descriptionIds` < `paragraphIds` 最小值，标题/说明在流前），或在流内首段（`paragraphIds` 最小值 ≤ `titleId`——标题/说明即首 `paragraphIds` 块、或按「取直接子元素」嵌于首块子树；首块即区间起点）。**区间起点 = min(`titleId`, `paragraphIds` 最小值)**。据此：
  - **区间起点之前**、不在任何键中的元素（封面、页眉、站点导航、hero 标题上方的 eyebrow / 装饰性 tagline）是**外部元素**——不标（流外噪音无须标记）
  - **落在 `paragraphIds` 区间内**（导语/正文之后）的「摘要 / 路线图 / 要点」类卡片，归 `paragraphIds` 作标量块，**不归 `descriptionIds`**——它已是正文内容，不是前置元数据
  - 该区间是文章主体的边界判据：区间之外的非文章结构（footer、相关推荐、评论、浮窗等）一律外部、不标
  - **技巧**：优先找 `titleId`(`<h1>`-`<h3>`)，`descriptionIds` 一定在它之后；`paragraphIds` 从区间起点起——流外时起点 = `titleId`，流内首段时起点 = 首 `paragraphIds` 块（≤ `titleId`）

## 结构说明（`2_clean_snapshot.html`）

- `data-idx` 是 body 内元素的**文档序递增整数**（1, 2, 3, …）：编号大小即文档前后位置，可直接比较——「文档序区间」等位置推理均依赖这一点

- 链接与图片元素**不带 URL**（href/src 已清空，链接文本与 alt 保留）

- `{{LONG_TEXT_k|n_chars}}` / `{{LONG_TEXT_k|n_words}}` 为长文本占位符，超阈值（>16 汉字 / >12 词）的**单个文本节点**折叠为编号占位符，短文本（≤16 汉字 / ≤12 词）保留原文；占位符分布是判读线索——段落/标题/按钮的位置与体量看得到；`<title>` 原文保留（不占位）

- `{{CODE_k|x_lines}}` 为代码块内容占位，k = 文档序编号（1 起、跳过 `[hidden]` pre）、x = 代码行数（按占位前原文的行结构计）；`data-language` 在 pre 属性上。ok/failed 在清洗版同为占位符（clean 恒折叠），标 paragraphIds 的方式与表格占位符一致；成功代码块的原文已由步骤 2 预计算存 `2_code.json`、步骤 8 还原

- `{{TABLE_k|y×x}}`：表格整体占位，k = 文档序编号（1 起、跳过 `[hidden]` 表），y = 行数（`<tr>` 数），x = 列数（各行 colspan 之和的最大值，即网格列数）。行列规模是判读表格的信号——大表（如 `30×` 级）大概率是核心数据载体。成功表的 GFM markdown 已由步骤 2 预计算存 `2_tables.json`、步骤 8 还原；步骤 3 仅需标记其 `data-idx` 入 paragraphIds

- `{{HIDDEN_TAG|n_chars;n_a/n_div/…}}` 为带 `hidden` 属性的元素，折叠了子树；token 是真实文本规模与标签构成（计数降序），标明其后是整块折叠内容。hidden 元素按内容语义判身份：文章正文（FAQ/附录/展开收起）→ 段落块（也是锚点）；页面功能（模态/抽屉/移动端导航）→ 流内标 `dumpIds`、流外不标

### 示例（`2_clean_snapshot.html`）：

```html
<html>
<body>
  <div data-idx="1" class="xxx">

    <!-- 全局唯一标题 → titleId = 2 -->
    <h1 data-idx="2"><span>Title…</span></h1>
  </div>

  <!-- [3]/[4] 为独立的文章说明，纳入 descriptionIds；因为是独立的，选 [3] 和选 [4] 没有本质区别 -->
  <div data-idx="3">
    <p data-idx="4"><span>This is an article about …</span></p>
  </div>
  <!-- 最外层段落流容器 [6] 的祖先元素 [5]，不能算在 paragraphIds 内（多包一层 "[]" 没有意义） -->
  <div data-idx="5" class="xxx">

    <!-- `paragraphIds` 顶层从最外层段落流容器 [6] 的子块开始：
         内容子块 [7]（说明计入规模）/[10]/[13]/[14] ≥2、噪音 [9]/[37] 不计 → [6] 成流（主段落流不要求锚点） -->
    <section data-idx="6" class="article main content">
      <!-- [7] 为段落流之内的文章说明——无论位置，统一纳入 descriptionIds -->
      <!-- 段落块一定取流的直接子元素 [7]，而不是其内部 [8]；[7] 也可留在 paragraphIds 原位 -->
      <div data-idx="7">
        <p data-idx="8"><span>Author: xxx</span><span>Name: xxx</span></p>
      </div>

      <!-- 噪音元素 [9] 在段落流之内 → 标 dumpIds -->
      <div data-idx="9" class="ad">Ad…</div>

      <!-- 段落块通常不是固定的元素，而是包装容器 + 语义内容的组合 -->
      <!-- [10] 首块 <h2>[11] 是标题头、排除计数后 R 只剩 <pre>[12] 一块（非流）→ 不成流（带标题单体）——整个作为 [6] 的一个块，取 [10] 而不是 [11, 12] -->
      <div data-idx="10">
        <h2 data-idx="11">…</h2>
        <pre data-idx="12">{{CODE_k|x_lines}}</pre>
      </div>

      <!-- 例外：当行内元素是段落流的直接子元素时，应该当作独立段落块 -->
      <span data-idx="13">{{LONG_TEXT_k|n_chars}}</span>

      <!-- 段落流下的独立章节模块，内部还有「子段落流」 -->
      <!-- [14] 首块 [15] 是标题头 → 排除计数、居该子流首位；R = [18]/[31]/[36] ≥2、
           锚点 [36]（hidden）→ 是子段落流；在 [6] 的序列里以一个数组占位，[14] 本身不出现在 JSON 中 -->
      <section data-idx="14" class="block">
        <!-- 独立段落块 [15] -->
        <header class="head" data-idx="15">
          <span data-idx="16">01</span>
          <h2 data-idx="17">章节标题</h2>
        </header>

        <!-- [18] 剔除噪音 [19] 后只剩子流 [20]、无标题头 → 透明包装层、不占维度（见「一流一维」） -->
        <section data-idx="18" class="article main content">

          <!-- [19] 没有有效内容（段落/文本），是噪音元素（在流 [14] 之内）→ 标 dumpIds -->
          <div data-idx="19"></div>

          <!-- 独立「子段落流」 [20]：首块 [21] 标题头排除计数、居首位；R = [23]/[27]/[28] ≥2、锚点 <figure>[23]/<p>[27]/<dl>[28] -->
          <div data-idx="20">
            <header class="head" data-idx="21">
              <h2 data-idx="22"><span>01</span>章节标题</h2>
            </header>
            <figure class="table" data-idx="23">
              <figcaption data-idx="24">表题</figcaption>
              <div data-idx="25">
                <table data-idx="26">{{TABLE_3|8×4}}</table>
              </div>
            </figure>
            <p data-idx="27"><span>…</span></p>
            <dl data-idx="28">
              <dt data-idx="29">…</dt>
              <dd data-idx="30">…</dd>
            </dl>
          </div>
        </section>

        <!-- [31] 首块 header[32] 是标题头、排除计数后 R 只剩 <p>[35] 一块（非流）→ 不成流（带标题单体）——整个作为一个段落块 -->
        <section data-idx="31" class="article main content">
          <header class="head" data-idx="32">
            <span data-idx="33">02</span>
            <h2 data-idx="34">章节标题</h2>
          </header>
          <p data-idx="35"><span>…</span></p>
        </section>

        <!-- 被 hidden 折叠的隐藏元素，在段落流中要算作一个段落块（也是 [14] 成流的锚点） -->
        <div data-idx="36" hidden class="expand">{{HIDDEN_TAG|120_chars;3_p}}</div>
      </section>

      <!-- 明确是目录/导航等噪音元素（内部有 h/ul/li/p，结构上符合成流条件但语义是导航）→ 标 dumpIds -->
      <!-- dumpIds 应该优先取最高的父元素/祖先元素 [37]，而不是一堆子孙元素 [38,39,40] -->
      <nav class="toc" data-idx="37">
        <p data-idx="38">01 xxx</p>
        <ul data-idx="39">
          <li data-idx="40">01 xxx</li>
          <li data-idx="41">02 xxx</li>
          <li data-idx="42">03 xxx</li>
        </ul>
        <p data-idx="43">01 xxx</p>
      </nav>
    </section>
  </div>

  <!-- 明确是噪音元素，但在段落流之外——无须标记 -->
  <div data-idx="44" class="dialog">
    <h2 data-idx="45">…</h2>
    <p data-idx="46">…</p>
    <section data-idx="47">…</section>
    <div data-idx="48" class="button">confirm</div>
  </div>
</body>
</html>
```

## 输出要求

输出路径：`<url-working-path>/3_key_ids.json`

**JSON 契约**：四键全部写出；`titleId` 为正整数，无主标题或不可判时为 `null`；`descriptionIds`/`dumpIds` 可为空数组；`paragraphIds` **必填且非空**（至少标一个段落块）；数组成员为正整数（块）或嵌套数组（子段落流），各数组按文档序书写

完整 JSON 结构：

```json
{
  "titleId": 2,
  "descriptionIds": [3, 7],
  "paragraphIds": [10, 13, [15, [21, 23, 27, 28], 31, 36]],
  "dumpIds": [9, 19, 37]
}
```

无标题/无说明/无流内噪音时的最小形态：

```json
{
  "titleId": null,
  "descriptionIds": [],
  "paragraphIds": [5, 6, [8, 9]],
  "dumpIds": []
}
```
