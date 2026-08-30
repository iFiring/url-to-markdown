# 任务

这是**一篇文章页面**， 读取 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、语义 class）与**文本规模 token** 分布，找到以下四类关键元素与列表流噪音的 `data-u2m-id` (ID)：

  1. **列表流**（`listFlowIds`）：文章主体的流容器 ID。**语义门最高优先**：只有**文章主体内容**才能标流——菜单、导航、目录（TOC）、面包屑、页脚链接、相关推荐、评论列表、分享栏等，即使内部结构完全符合下述判据（导航/目录里的 `<ul>` 是最典型的『假流』），也**不是流、绝不标记**；结构判据只用于文章主体**内部**的层级判定。过语义门后：凡**直接子元素包含段落级块、或包含另一个列表流**的容器即是列表流。后者即「流的流」：article / section / 手风琴项等包装容器靠**子流**成流——标题头、展开/收起按钮这类非段落兄弟随子块整体迁入、文本不丢；若无此判据，包装容器只有在恰好直接挂 `<p>` 时才成流，标题头会悬空丢失。段落级块**只有以下六类**，其余元素一律不算：

     - 段落 `<p>`
     - 标题 `<h1>`、`<h2>`、`<h3>`、`<h4>`、`<h5>`、`<h6>`
     - 预格式块 `<pre>`（内容折叠为 `{{PRE_CODE_TAG|x_lines}}` 占位）
     - 列表 `<ul>`、`<ol>`
     - 定义列表 `<dl>`（`<dt>`/`<dd>` 的术语对、问答、元信息对）
     - 引用块 `<blockquote>`

     **不是段落级块**（含有它们的容器不因此成流，除非同一容器还有上列六类之一、或另一个列表流）：

     - 行内元素：`<span>`、`<a>`、`<strong>`、`<b>`、`<em>`、`<i>`、行内 `<code>`、`<img>`、`<br>`、`<hr>`
     - 复合单元：`<figure>`（图 + `<figcaption>`）、`<table>` 及表格包装、图解/图表容器（多级 `<div>` 的可视模块）、卡片/提示框——整棵作为一个子块迁入，内部不拆

     上述判据只用于**判定容器是否为流**，不筛选子块：容器一旦成流，其**全部直接子元素**——六类段落块、复合单元、行内元素条、展开/收起按钮，无论哪种——连同非空白裸文本，各作为一个子块**整体迁入**；这些子块最终转成什么 markdown 由步骤 7 分派。反之，直接子元素只有行内元素与复合单元、既无段落级块也无子流的容器**不是流**，不标——它们本身作为上层流的子块整体迁入。**标记所有层级、嵌套合法**：最外层文章容器与内部各层（article / section / 子小节 body / 节头 / 代码块包装）按同一判据判定，是流就同标——多标无害（步骤 6 最外层优先去重，内层子节点随外层整块带入），**漏标最外层才有害**；至少有一个。判据不向上无限延伸——到**文章主体边界**即止，页面级包装（把封面/导航/侧栏/推荐一起裹住的外层容器）即使含子流也不标；正文被这类包装分割时，各正文区域**分别标流**、流之间的正文块用 `standaloneIds` 补。混在文章容器内部的导航/目录/推荐模块（结构上像流、语义是噪音）→ 标进 `listFlowDeleteIds` 剔除。列出顺序不影响输出（步骤 6 按文档序统一迁入）

  2. **标题分块**（`titleIds`）：文章主标题对应的元素 ID。通常是层级最高的 `<h1>`-`<h3>` 或结构上处于列表流顶部的标题性容器；可为空数组（在 `listFlowIds` 内）
  3. **说明分块**（`descriptionIds`）：描述性元数据对应的元素 ID，如作者、日期、摘要、副标题等；可为空数组（在 `listFlowIds` 内；不存在）
  4. **游离内容**（`standaloneIds`）：不在任何 `listFlowIds` 子树内的正文元素，典型为**流的兄弟元素**或**流的祖先元素的兄弟元素**——页面级大标题下方的引言、流之间的过渡标题/小结、独立的引文块等。每处**整体单独标记**（元素本身完整子树，步骤 4 保真、步骤 6 按文档序各成一块迁入）。已在流子树内的元素不放这里（随流自然带入，标了也被嵌套去重跳过）；主标题放 `titleIds`、作者/日期等元数据放 `descriptionIds`；流的父链可安全标流时优先标流（游离兄弟随子块带入）。**导航文案、面包屑、『返回顶部』等控件文字不是游离内容，不标**。可为空数组；裸文本没有 `data-u2m-id` 无法标记——游离文本须有元素包裹
  5. **列表流噪音**（`listFlowDeleteIds`）：列表流**之内**的噪音：菜单、导航、广告、推荐——**含混在文章流里、结构上像流（有 `<ul>`/`<p>`）但语义是导航/推荐的模块**，步骤 6 提取时整棵剔除；**必须确定不属于文章内容**，不确定不能带上。列表流之外的噪音无需标记（不在任何 key 元素子树内，步骤 4 自然裁掉）

## 约束

  1. **必须排除**菜单、导航、广告等不属于四类关键元素的元素——特别注意：导航/目录/推荐里的 `<ul>` 结构上完全符合流的判据，但语义上不是文章内容，**任何一类（含 `standaloneIds`）都不能标**；四类标记只收文章主体内容
  2. 不选 `<body>` 或 `<html>`——它们的 ID 无意义
  3. **`hidden` 属性元素 + `{{n_chars;n_a/n_div/...}}` 内容 token**：折叠的隐藏子树（模态/抽屉/移动端导航等）。根元素的 `data-u2m-id` 可正常引用——原文完整保留在带样式版，纳入 listFlowIds 即可还原全文（FAQ 折叠答案、tab 变体面板是典型可纳入场景）；token 值是真实文本规模与标签构成（计数降序），可据此判断是否值得纳入
  4. `{{PRE_CODE_TAG|x_lines}}`：pre 代码块内容占位，x = 代码行数（规模信号：判读代码块的体量与粒度；`data-language` 在 pre 属性上，语言线索看那里）。完整代码在后续步骤保真，识别时把 pre 当作一个结构单元即可
  5. `{{TABLE_TAG|y_rows|x_cols}}`：表格整体占位，y = 行数（`<tr>` 数），x = 列数（各行 colspan 之和的最大值，即网格列数）。行列规模是判读表格的信号——大表（如 `30_rows` 级）大概率是核心数据载体。完整表格在后续步骤从带样式版保真，判定容器是否为流时把 table 当复合单元即可

  占位符形态速览：

  ```html
  <!-- 普通表格：2 行 × 2 列 -->
  <table data-u2m-id="35">{{TABLE_TAG|2_rows|2_cols}}</table>
  <!-- 跨列表格：首行 1 个 colspan=3 的单元格 + 1 个尾列 = 4 列，取各行最大 -->
  <table data-u2m-id="36">{{TABLE_TAG|3_rows|4_cols}}</table>
  <!-- 代码块：行数按换行切分（高亮 span 是语法 token、不是行）；
       语言线索在 data-language 属性 -->
  <pre data-u2m-id="37" data-language="tsx">{{PRE_CODE_TAG|87_lines}}</pre>
  <!-- 纯代码块（无高亮、无语言） -->
  <pre data-u2m-id="38">{{PRE_CODE_TAG|12_lines}}</pre>
  ```
  6. 链接与图片元素**不带 URL**（href/src 已清空，链接文本与 alt 保留）；超阈值的连续行内文本段（含链接混排）整段折叠为 `{{n_chars;n_a/...}}` token——文本规模与构成是判读流价值的线索，短文本（≤16 汉字 / ≤12 词）保留原文；`<title>` 原文保留（不 token 化），仍是识别线索


## `2_clean_snapshot.html`结构示例：

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

    <!-- 列表流 listFlowIds[5]（最外层文章流） -->
    <section data-u2m-id="5" class="article">
      <!-- 元素 [6] 在 listFlowIds[5] 之内，不纳入 descriptionIds -->
      <div data-u2m-id="6">
        <h2 data-u2m-id="7">Author:</h2>
        <span data-u2m-id="8">Name...</span>
      </div>
      <!-- 列表流噪音——元素 [9] 在列表流之内 → 必须纳入 listFlowDeleteIds -->
      <div data-u2m-id="9" class="ad">Ad...</div>
      <p data-u2m-id="10">
        <h2 data-u2m-id="11">...</h2>
        <code data-u2m-id="12">...</code>
      </p>
      <!-- 嵌套列表流 listFlowIds[14]：直接子元素含 <p> → 也是流，与 [5] 同标；
           步骤 6 最外层优先，[14] 整块作为 [5] 的子块迁入，[15]/[16] 不拆出 -->
      <div data-u2m-id="14" class="sub">
        <p data-u2m-id="15">子小节段落...</p>
        <p data-u2m-id="16">子小节段落...</p>
        <!-- 噪音不限深度：嵌在嵌套流内部 → 同样纳入 listFlowDeleteIds -->
        <div class="ad" data-u2m-id="17">内嵌广告...</div>
      </div>
      <!-- 非流：直接子元素全是行内 span/a，无段落级块 → 不标，
           整体作为 [5] 的子块迁入 -->
      <div class="tags" data-u2m-id="18">
        <span data-u2m-id="19">#tag1</span>
        <a data-u2m-id="20">#tag2</a>
      </div>
      <!-- 代码块包装：装饰条 [22] + <pre>[23]，含段落级块 <pre> → 按判据
           也是流（标不标均可、多标无害——随外层 [5] 整块迁入，[22]/[23] 不拆出） -->
      <div class="codeblock" data-u2m-id="21">
        <div class="bar" data-u2m-id="22">tsx</div>
        <pre data-u2m-id="23" data-language="tsx">{{PRE_CODE_TAG|23_lines}}</pre>
      </div>
      <!-- 非流：直接子元素仅 figure 复合单元 → 不标，整体迁入 -->
      <div data-u2m-id="24"><figure data-u2m-id="25">...</figure></div>
      <!-- hidden 折叠子树（{{n_chars;构成}} token）：在流内无需特殊处理——
           原文在带样式版完整保留，整块迁入即还原全文（token 是真实文本
           规模与标签构成） -->
      <div hidden data-u2m-id="26">{{120_chars;3_p}}</div>
    </section>
    <!-- 列表流之外的广告无需标记——不在任何 key 元素子树内，步骤 4 自然裁掉 -->
    <!-- 列表流 listFlowIds[28]（与 [5] 互不嵌套的另一流） -->
    <div data-u2m-id="28" class="article">
      <!-- 节头：序号 span + <h2>，含段落级块 <h2> → 按判据也是流，同标 -->
      <header class="head" data-u2m-id="29">
        <span data-u2m-id="30">01</span>
        <h2 data-u2m-id="31">章节标题</h2>
      </header>
      <!-- 非流：figcaption 与表格包装都是复合单元、无段落级块 → 不标，整体迁入 -->
      <figure class="table" data-u2m-id="32">
        <figcaption data-u2m-id="33">表题</figcaption>
        <div data-u2m-id="34"><table data-u2m-id="35">{{TABLE_TAG|8_rows|4_cols}}</table></div>
      </figure>
      <p data-u2m-id="36"><span data-u2m-id="37">...</span></p>
      <!-- <dl> 本身是段落级块：作为 [28] 的一个子块整体迁入 -->
      <dl data-u2m-id="38">
        <dt data-u2m-id="39">术语</dt>
        <dd data-u2m-id="40">释义</dd>
      </dl>
    </div>
    <!-- 手风琴项（不在任何外层流内）：直接子元素 = 展开/收起标题 button [43]
         + 折叠内容流 [44]（hidden 折叠为 {{200_chars;1_p}}——构成 1_p 即原
         <p> 子元素，含段落级块 → 是流）——按「含子流」判据项容器 [42] 也是
         流，标 [42] 与 [44] → button 作为子块整体迁入，标题文本保留 -->
    <div class="accordion-item" data-u2m-id="42">
      <button data-u2m-id="43">{{80_chars}}</button>
      <div hidden data-u2m-id="44">{{200_chars;1_p}}</div>
    </div>
    <!-- 游离内容：[28]/[42] 的兄弟元素、不在任何流子树内（此处不把包装
         div 标成流——标它会把上方的流外广告一并带入）→ 整体单独标
         standaloneIds [46][47]，步骤 6 按文档序各成一块迁入 -->
    <h2 data-u2m-id="46">小结</h2>
    <p data-u2m-id="47">全文完。</p>
    <!-- 陷阱：目录/导航——内部 <ul>[49] 结构上完全符合流的判据（六类之一），
         但语义是页面导航、不是文章正文 → 绝不标流、不标 standaloneIds、
         也无需 deleteIds（不在任何 key 子树内，步骤 4 自然裁掉）；
         若这类模块嵌在文章流内部 → 标 listFlowDeleteIds 剔除 -->
    <nav class="toc" data-u2m-id="48">
      <ul data-u2m-id="49">
        <li data-u2m-id="50">01 为什么缓存主宰 Agent</li>
        <li data-u2m-id="51">02 把提示词按缓存的方式来排版</li>
      </ul>
    </nav>
  </div>
</body>
</html>
```

## 输出要求

输出路径：`<url-working-path>/3_key_ids.json`

完整 JSON 结构：

```json
{
  "titleIds": [3],
  "descriptionIds": [],
  "standaloneIds": [46, 47],
  "listFlowIds": [5, 14, 21, 28, 29, 42, 44],
  "listFlowDeleteIds": [9, 17]
}
```