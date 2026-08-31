# 任务

这是**一篇文章页面**的快照，读取页面 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、语义 class）与**文本规模**分布，找到该页面文章四类关键元素的 `data-idx`（**以下统称 ID**）：

1. **标题分块**（`titleId`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于段落流外部或顶部的标题性容器；**无论在段落流内还是流外都标这里**、不进 `paragraphIds`；无主标题或不可判时为 `null`

2. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID 集合，如作者、日期、摘要、副标题、开篇词；**无论在段落流内还是流外都标这里**、不进 `paragraphIds`；可为空数组

3. **段落流**（`paragraphIds`）：文章**段落块的嵌套序列**，整棵按文档序——**标量是段落块 ID，数组是一个子段落流的块列表**

  - 常见段落块元素（清单为指引，非白名单）：
    - 段落：`<p>`
    - 标题：`<h1>`-`<h6>`
    - 预格式块/代码块：`<pre>`（内容折叠为 `{{PRE_CODE_TAG|x_lines}}` 占位）
    - 表格块：`<table>`（内容折叠为 `{{TABLE_TAG|y_rows|x_cols}}` 占位）
    - 复合单元：`<figure>`（图 + `<figcaption>`）
    - 列表：`<ul>`、`<ol>`
    - 定义列表 `<dl>`（`<dt>`/`<dd>` 的术语对、问答、元信息对）
    - 引用块 `<blockquote>`
    - 折叠块：`<details>`、带 `hidden` 属性的折叠树（FAQ/手风琴/折叠块/展开收起块）
    - 展开钮：`<button>`（手风琴/折叠项的成行控件）
    - 结构块：`<section>`、`<aside>`、`<header>`
    - 媒体块：`<img>`、`<picture>`
    - 图解/图表容器（多级 `<div>` 的可视模块）、卡片/提示框——整棵作为一个子块迁入，内部不拆

  - 段落块是**完整子树**，内部不拆

  - **行内元素通常不是段落级块**：`<span>`、`<a>`、`<strong>`、`<b>`、`<em>`、`<i>`、行内 `<code>`、`<br>`、`<hr>`；**当行内元素是段落流的直接子元素时除外**

  - **段落块通常不是固定的元素**，而是多种元素的复杂组合（见结构说明）： `<div><p><h1></p></div>` / `<p><h2><div><table></div></p>` / `<section><div><pre></div></section>`

  - **段落流（数组）的成流条件**——一个容器必须**同时满足**：
    1. **规模**：直接子块 ≥ 3 个（噪音子块不数、子段落流算一个；标题/说明子块虽不入 `paragraphIds`，仍是内容、计入）
    2. **锚点**：直接子块中至少一个是**锚点块**，或其子树内存在按同规则成立的子段落流

  - **锚点块**是一眼可辨的明显段落块：`<p>` / `<h1>`-`<h6>` / `<table>` / `<pre>` / `<figure>` / `<ul>` / `<ol>` / `<blockquote>` / `<button>` / `<dl>` / hidden 属性元素。共同性质：**内容语义标签 ∧ 默认渲染独占一行**——标签本身就宣告「我是段落/标题/列表/表格/引用/代码块」，无须看样式即可确认（快照不带样式，成行性来自标签语义）。`<div>`/`<section>`/`<aside>` 等结构容器标签默认也是块级、但装什么由内容决定——**可作块、不能作锚点**；`<button>` 默认行内块，但作为段落流直接子元素出现时即手风琴/折叠的成行展开钮

  - **粒度**：直接子块 <3 个、或无锚点的容器**不是流**——它的整个子树作为上层流的一个块（见结构说明）

  - **一流一维**：数组与段落流一一对应；流之间的非流包装层（如剔除噪音后只剩一个子流的中间容器）**透明、不占维度**

  - 嵌套结构示例 `paragraphIds: [1, 2, [3, 4, [5]], 6]`：`1/2/6` 在外层段落流，`3/4` 在「子段落流」，`5` 在更深的「子段落流」；顶层就是文档序序列——段落流之外的游离内容块（流的兄弟元素）同为顶层标量，不做区分

4. **噪音元素**（`dumpIds`）：**段落流之内**、未入选 `paragraphIds` 的非文章内容元素的 ID 集合；流外噪音**无须标记**——白名单之外的元素在后续步骤自然裁掉
  - 菜单、导航、目录（TOC）、面包屑、页脚链接、相关推荐、评论列表、分享栏、广告、弹窗、表单
  - **必须确定不属于文章内容**，不确定不能带上；噪音元素内部可能会有 `<ul>`（导航/目录/推荐）/`<p>`/`<h>` 等段落元素——**语义门独立于成流判据**，导航/目录结构上完全符合成流条件，语义上仍是噪音
  - dumpIds 应该优先取流内最高的父元素/祖先元素，而不是一堆子孙元素

## 原则/约束

- 段落流（`paragraphIds`）**必须排除**噪音元素，只收文章主体核心内容

- 四类标记**互不相交**——同一元素不得同时进两个键

- 不选 `<body>` 或 `<html>`——它们的 ID 无意义

- 成流判据在文章主体范围内应用，页面级包装不因包含段落流而成流

## 结构说明（`2_clean_snapshot.html`）

- 链接与图片元素**不带 URL**（href/src 已清空，链接文本与 alt 保留）

- `{{LONG_TEXT_k|n_chars}}` / `{{LONG_TEXT_k|n_words}}` 为长文本占位符，超阈值（>16 汉字 / >12 词）的**单个文本节点**折叠为编号占位符，短文本（≤16 汉字 / ≤12 词）保留原文；占位符分布是判读线索——段落/标题/按钮的位置与体量看得到；`<title>` 原文保留（不占位）

- `{{PRE_CODE_TAG|x_lines}}` 为代码块内容占位，x = 代码行数；`data-language` 在 pre 属性上

- `{{TABLE_TAG|y_rows|x_cols}}`：表格整体占位，y = 行数（`<tr>` 数），x = 列数（各行 colspan 之和的最大值，即网格列数）。行列规模是判读表格的信号——大表（如 `30_rows` 级）大概率是核心数据载体；完整表格在后续步骤从带样式版保真

- `{{HIDDEN_TAG|n_chars;n_a/n_div/...}}` 为带 `hidden` 属性的元素，折叠了子树（模态/抽屉/移动端导航/FAQ/手风琴等）；token 是真实文本规模与标签构成（计数降序），标明其后是整块折叠正文

### 示例：

```html
<html>
<body>
  <div data-idx="1" class="xxx">

    <!-- 全局唯一标题 titleId<2> -->
    <h1 data-idx="2"><span>Title...</span></h1>
  </div>

  <!-- [3]/[4] 为独立的文章说明，纳入 descriptionIds；因为是独立的，选 [3] 和选 [4] 没有本质区别 -->
  <div data-idx="3">
    <p data-idx="4"><span>This is an article about ...</span></p>
  </div>
  <!-- 最外层段落流容器 [6] 的祖先元素 [5]，不能算在 paragraphIds 内（多包一层 "[]" 没有意义） -->
  <div data-idx="5" class="xxx">

    <!-- `paragraphIds` 顶层从最外层段落流容器 [6] 的子块开始：
         直接子块 [7]/[10]/[13]/[14] ≥3 个，锚点经子流 [14] 成立 → [6] 成流 -->
    <section data-idx="6" class="article main content">
      <!-- [7] 为段落流之内的文章说明——无论位置，统一纳入 descriptionIds、不进 paragraphIds -->
      <!-- 块一定取流的直接子元素 [7]，而不是其内部 [8] -->
      <div data-idx="7">
        <p data-idx="8"><span>Author: xxx</span><span>Name: xxx</span></p>
      </div>

      <!-- 噪音元素 [9] 在段落流之内 → 标 dumpIds -->
      <div data-idx="9" class="ad">Ad...</div>

      <!-- 段落块通常不是固定的元素，而是多种元素的复杂组合 -->
      <!-- [10] 直接子块只有 2 个（<3）不成流——整个作为 [6] 的一个块，取 [10] 而不是 [11, 12] -->
      <div data-idx="10">
        <h2 data-idx="11">...</h2>
        <pre data-idx="12">{{PRE_CODE_TAG|x_lines}}</pre>
      </div>

      <!-- 例外：当行内元素是段落流的子元素时，应该当作独立段落块 -->
      <span data-idx="13">{{LONG_TEXT_k|n_chars}}</span>

      <!-- 段落流下的独立章节模块，内部还有「子段落流」 -->
      <!-- [14] 直接子块 [15]/[18]/[31]/[36] ≥3 个、锚点 [36]（hidden）→ 是子段落流；
           在 [6] 的序列里以一个数组占位，[14] 本身不出现在 JSON 中 -->
      <section data-idx="14" class="block">
        <!-- 独立段落块 [15] -->
        <header class="head" data-idx="15">
          <span data-idx="16">01</span>
          <h2 data-idx="17">章节标题</h2>
        </header>

        <!-- [18] 不是流（剔除噪音 [19] 后只剩子流 [20]，直接子块 <3）——非流包装层透明、不占维度 -->
        <section data-idx="18" class="article main content">

          <!-- [19] 没有有效内容（段落/文本），是噪音元素（在流 [14] 之内）→ 标 dumpIds -->
          <div data-idx="19"></div>

          <!-- 独立「子段落流」 [20]：直接子块 [21]/[23]/[27]/[28] ≥3 个，锚点 <p>[27]/<dl>[28] -->
          <div data-idx="20">
            <header class="head" data-idx="21">
              <h2 data-idx="22"><span>01</span>章节标题</h2>
            </header>
            <figure class="table" data-idx="23">
              <figcaption data-idx="24">表题</figcaption>
              <div data-idx="25">
                <table data-idx="26">{{TABLE_TAG|8_rows|4_cols}}</table>
              </div>
            </figure>
            <p data-idx="27"><span>...</span></p>
            <dl data-idx="28">
              <dt data-idx="29">...</dt>
              <dd data-idx="30">...</dd>
            </dl>
          </div>
        </section>

        <!-- [31] 直接子块 [32]/[35] 只有 2 个（<3）不成流——整个作为一个段落块 -->
        <section data-idx="31" class="article main content">
          <header class="head" data-idx="32">
            <span data-idx="33">02</span>
            <h2 data-idx="34">章节标题</h2>
          </header>
          <p data-idx="35"><span>...</span></p>
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
  </div>

  <!-- 明确是噪音元素，但在段落流之外——无须标记，白名单外元素在后续步骤自然裁掉 -->
  <div data-idx="44" class="dialog">
    <h2 data-idx="45">...</h2>
    <p data-idx="46">...</p>
    <section data-idx="47">...</section>
    <div data-idx="48" class="button">confirm</div>
  </div>
</body>
</html>
```

## 输出要求

输出路径：`<url-working-path>/3_key_ids.json`

完整 JSON 结构：

```json
{
  "titleId": 2,
  "descriptionIds": [3, 7],
  "paragraphIds": [10, 13, [15, [21, 23, 27, 28], 31, 36]],
  "dumpIds": [9, 19, 37]
}
```
