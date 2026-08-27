# 任务

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