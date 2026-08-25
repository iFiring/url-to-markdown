# 步骤 2 清洗版瘦身设计（clean snapshot slimming）

- 日期：2026-08-25
- 状态：已与用户确认设计方向，待实施
- 背景数据来源：真实页面 `developers.openai.com/api/docs/guides/prompt-caching` 的全链路产物实测

## 1. 问题

步骤 2 产物 `2_clean_snapshot.html` 在代码型文档页上过大：实测 **352,615 字节**（≈ 88K LLM token）。
该文件唯一消费者是步骤 3 的 LLM agent（读结构识别关键 ID），体积直接决定步骤 3 的上下文成本。

### 1.1 体积构成（实测）

| 构成 | 字节 | 说明 |
|---|---|---|
| `<pre>` 代码块 | 90,133 | shiki 语法高亮把每个 token 包成 `<span class="shiki-token" data-u2m-id>`；**纯代码文本仅 7,514 字节，约 12 倍标记开销**（1,352 个 token 级 id 占 27 KB） |
| class 属性 | 102,832（内容）+ ~25K（`class=""` 包装） | tailwind 工具类 ~64 KB + 框架哈希类（astro-xxx 等）~11 KB 为纯噪声；语义类仅 ~28 KB |
| data-u2m-id | 65,067 | 契约必需，不动 |
| 其它 data-* | 22,445 | `data-1p-ignore`、`data-copy-ignore`、`data-syntax-highlighter-id` 等噪声 |
| 隐藏子树 | 实测顶层 29 个、含 150,267 字节 | 模态/抽屉（`fixed inset-0`）、折叠 expander（`expn-content hidden`）、响应式隐藏（`xl:hidden`）、tab 变体 |
| href / aria / 注释 / 空白 | ~31K | 链接语义保留；注释与标签间空白可删 |

## 2. 目标与非目标

**目标**

- `2_clean_snapshot.html` 从 352 KB 降到 **~32 KB（−91%）**，步骤 3 的上下文成本同比例下降。
- 步骤 3 的识别能力不降级：结构、标签、语义 class、长文本占位符分布、隐藏块的规模提示都可见、可引用。

**非目标（硬约束）**

- **最终 markdown 零变化**：带样式版（`2_clean_style_snapshot.html`）与步骤 4-9 全链路产物语义不变。清洗版的一切删减都不可触达带样式路径。
- stdout 单行 JSON 契约不变（字段与语义照旧，仅可增不改）。

## 3. 总体设计

六条规则**全部只作用于清洗版分支**（`page-clean-snapshot.js` 的 clean-only 段，现步骤 11-13 所在处）。
带样式版除现状行为外零改动。

| # | 规则 | 实测节省 |
|---|---|---|
| R1 | pre 内容替换为 `code...` | −82K（token span + 代码文本） |
| R2 | class 噪声过滤（剥工具/哈希 token，保语义 token） | −60~70K |
| R3 | data-* 白名单（只留 `data-u2m-id`、`data-language`、`data-u2m-hidden`） | −25K |
| R4 | astro 包装解包（`astro-island`/`astro-slot` 替换为子元素） | −3K |
| R5 | 保守空白压缩（仅删安全位置的纯空白文本节点） | −5K |
| R6 | 隐藏子树折叠为标记（juice 级联计算，见 §4-5） | −147K |

叠加效果实测推算：352,534 → 54,633（仅 R6）→ **~32K（全部规则）**。

### 3.1 R1：pre 内容替换为 `code...`

- `<pre>` 的直接子元素中，**首个** `<code>` 壳保留（含其属性，如 `data-language="javascript"`），其余子元素删除；
  该 `<code>`（或无 code 壳时的 `<pre>` 自身）的全部子节点替换为单条文本 `code...`。
- pre 标签自身的 `data-u2m-id` 与属性保留。
- **行内 `<code>` 不动**（实测 91 个 code 中 77 个为行内，是句子成分）。
- 步骤 7 在 `6_article.html`（带样式路径）仍见完整代码写进骨架，最终 markdown 不丢代码。

### 3.2 R2：class 噪声过滤

class 值按空白切 token，逐 token 判定去留：

- **删**：框架哈希 token（`astro-xxxx`、`css-xxxx`、`sc-xxxx`、`jsx-xxxx`、`chakra-xxxx`、`emotion-xxxx` 等「前缀-短哈希」形态）；
  tailwind 工具 token（布局/间距/排版/尺寸/响应式前缀类，含任意值形态 `h-[30rem]`、变体前缀 `hover:*`/`md:*`）。
- **留**：其余全部。
- **原则：拿不准就保留**——漏删只多花字节，误删语义 token（手册里 class 是步骤 3 的正式识别线索，如
  `class="article"` vs `class="ad"`）才伤识别。启发式允许不完美，方向必须保守。
- 过滤后 token 为空则删除整个 class 属性。

### 3.3 R3：data-* 白名单

清洗版只保留 `data-u2m-id`、`data-language`、`data-u2m-hidden`（R6 产物）；其余 `data-*` 全删。
`id` 属性保留（锚点/身份线索）。aria-* 保留（量小且有结构提示价值）。

### 3.4 R4：astro 包装解包

`astro-island`、`astro-slot` 元素一律替换为其子元素（框架脚手架标签，实测 36+25 个）：
子元素原样上提，包装自身属性（含其 data-u2m-id）弃置——清洗版不可见即不可引用，语义与折叠一致。

### 3.5 R5：保守空白压缩

删除**纯空白文本节点**当且仅当：其前一个兄弟与后一个兄弟都**不是**行内文本敏感节点
（非空白文本节点、或固定行内标签集内的元素：`a` `span` `code` `strong` `em` `b` `i` `u` `s`
`mark` `small` `sub` `sup` `abbr` `cite` `q` `kbd` `samp` `time` `img` `br`）。
行内相邻元素之间的空白保留（承载词间分隔语义）。`<pre>` 内部不适用（R1 已清空）。

### 3.6 R6：隐藏子树折叠为标记

- **统一折叠、不删除**：所有「有效隐藏」的顶层子树在清洗版中清空子节点，根元素保留并打标记
  `data-u2m-hidden="N_chars"`（N 为该子树在 juiced DOM 上的 `textContent.trim().length`
  ——真实全文规模而非占位后规模，对 LLM 判断「值得纳入 listFlow」更有意义；根的
  `position` 为 `fixed`/`absolute` 时值追加 `,fixed`，给 LLM 一个「这是 UI 脚手架」的提示）。
- 折叠应用容忍目标元素已不存在（被前序清洗删除的容器内隐藏块）——跳过不报错。
- **不做脱流剪除**（设计过程中曾按 fixed/absolute 二分为「剪除/折叠」两档，实测脱流仅 2 个、省 11 KB；
  为满足「不能误删正文」的绝对约束，统一降级为折叠——任何误判的后果都只是清洗版稍大，
  内容永不可达性为零）。
- 折叠发生在**共享清洗 + 长文本占位之后**、清洗版序列化之前：占位符编号不受影响
  （折叠掉的占位符只从清洗版消失，`2_long_text.json` 与带样式版引用完整——实测 80/80 无缺失）。
- 根元素带 `data-u2m-id`，步骤 3 仍可将其纳入 listFlowIds 引用；步骤 6 从带样式版取全文，
  最终 markdown 含折叠块原文（如 FAQ 答案）。
- 原生 `<details>` 关闭态：juice 无 UA 样式表，内容按可见处理 → 不折叠 → 保留（与浏览器
  computed `display:block` 的实测结论一致，双重安全）。

## 4. 隐藏判定的样式计算：juice 级联（用户指定）

**决策依据**：步骤 5 的历史结论（compute_styles.mjs 头注）——getComputedStyle 计算版已按
效果对比移除，只保留 juice 路径。用户实测 juice 级联更准确。本步骤沿用同一引擎与同一套
引号防御，不引入第二套样式计算。

**准确性优先于速度**（用户明确）：允许全 DOM 递归；juice 对 1.6 MB 快照的内联耗时不设优化目标。

### 4.1 管线（clean_snapshot.mjs 编排，单浏览器实例）

```
阶段 A（页 1）  加载 file://1_snapshot.html
              → 注入 page-normalize-styles.js 规范化 style 属性引号
              → 序列化为 html_norm（页 1 DOM 保持规范化态，供阶段 D 复用）
阶段 B（Node）  juice(html_norm, { removeStyleTags: true, decodeStyleAttributes: true })
              → juiced html（每元素级联胜出声明已写入 style 属性）
阶段 C（页 2）  setContent(juiced) → 注入 page-hidden-detect.js
              → 递归计算有效隐藏，返回顶层隐藏子树的 [{id, chars, fixed}]
阶段 D（页 1）  evaluate __u2mCleanSnapshot({ collapse: 阶段 C 结果 })
              → 现有两版产物照常
```

- 沿用步骤 5 三段式的阶段 0/1（引号规范化 + `decodeStyleAttributes`）：
  juice 写回把值内 `"` 无条件换成 `'`，引号混排会损毁声明；实体不解码会让严格解析崩溃
  （公众号真实页面触发过）。此处只为**读** display/visibility/position，但同一坑照防。
- 阶段 C 的 DOM 遍历逻辑（页面侧）放共享脚本 `page-hidden-detect.js`（具名
  `__u2mDetectHidden`），遵守「共享页面脚本是唯一事实源」——判定语义只存在于此文件。

### 4.2 有效隐藏的精确语义（page-hidden-detect.js 递归实现）

对 juiced DOM（style 属性为级联胜出的字面声明，juice 不推导继承——继承语义由本脚本按 CSS 规范补全）：

- **display 语义**（不继承，但祖先 `display:none` 使整棵子树不生成盒）：
  有效 display:none ⟺ 自身或任一祖先的声明为 `display:none`。
- **visibility 语义**（继承，子代可 `visibility:visible` 重新可见）：
  有效 visibility:hidden ⟺ 沿祖先链最近一次显式声明为 hidden 且之后未被 visible 覆盖，
  且自身不在任何有效 display:none 子树内（display:none 优先，子代 visibility 无从谈起）。
- **顶层隐藏子树**：有效隐藏元素中，不存在其它有效隐藏真祖先者（折叠只打在最外层，
  嵌套隐藏子树随之消失）。
- **fixed 标记**：顶层隐藏根的 style 声明含 `position:fixed|absolute`。
- 读值只认字面声明；`display: var(--x)` 类不可解析值按可见处理（juice 不解析 var()，天然安全方向）。

### 4.3 安全设计（「不能误删正文内容」的硬约束）

1. **折叠不删除**：带样式版与后续全链路永不丢失任何字节；清洗版的折叠根仍带 id 可引用。
2. **失败方向安全**：juice 对不支持的选择器丢弃规则、var() 不解析、无 UA 样式表——
   三种不完备都把元素推向「可见 → 保留」，绝不会把可见内容判成隐藏。
3. **雪崩护栏**：juiced DOM 上折叠后剩余可见文本（trim 后字符数）低于折叠前的 5% 且折叠前文本
   ≥ 2000 字符时，本轮放弃 R6（全部不折叠），`U2M_DEBUG` 输出警告。防「整页被 cookie 墙
   display:none」类极端页面把清洗版折成空壳。
4. **端到端验收**：集成测试断言最终 markdown 含折叠块的原文。

## 5. 契约与文档

- **stdout JSON**：字段与语义完全不变（`status`/`cleanedSnapshot`/`styledSnapshot`/`longText`/`longTextCount`）。
- **U2M_DEBUG 新增行**：`[clean] 折叠 N 个隐藏子树（M 字节）`；护栏触发时输出警告行。
- **SKILL.md 步骤 3**：补两句——`data-u2m-hidden="N_chars"` 标记的含义与可引用性；
  pre 内 `code...` 的含义（代码全文在后续步骤保真）。
- **CLAUDE.md / README.md**：步骤 2 描述同步更新。

## 6. 测试计划

**语义测试（浏览器直调共享脚本，放 test/integration——页面脚本依赖 DOM，无 Node 直测路径）**

- display 祖先链：祖先 none、自身 none、嵌套 none——顶层判定与子树归属。
- visibility 继承链：祖先 hidden + 子代 visible 覆盖；display:none 优先于 visibility。
- var() 与不可解析值按可见处理。
- fixed/absolute 标记。
- class 噪声过滤：astro/tailwind token 剥除、语义 token 存活、混合 class 部分过滤、
  全噪声时属性删除、拿不准保留。

**集成（clean_snapshot.mjs 子进程 + 夹具页）**

夹具覆盖：
1. shiki 结构代码块 → 清洗版 pre 内为 `code...`，`data-language` 保留；带样式版完整。
2. 混合 class（`class="article flex px-4 astro-abc12"`）→ 清洗版剩 `class="article"`。
3. data-* 白名单：噪声属性消失，`data-u2m-id`/`data-language` 保留。
4. `fixed` 隐藏模态 + 流内 expander → 清洗版均折叠为标记（值含 `,fixed` 与否）；
   **带样式版两者原文完整**。
5. `xl:hidden` 响应式块 → 清洗版折叠；带样式版保留。
6. 原生 `<details>` 关闭内容 → 两版都不折叠。
7. 占位符编号完整性：`2_long_text.json` 键与带样式版引用一一对应。
8. 雪崩护栏：整页 hidden 夹具 → 不折叠 + 警告。
9. 回归：现有步骤 2 测试全部保持绿；带样式版对既有夹具**逐字节不变**断言。

**验收基准**

- 真实 prompt-caching 页重新跑步骤 2：清洗版 ≤ 40 KB；步骤 3-9 全链路可走通；
  最终 `9_markdown.md` 含 FAQ expander 原文与完整代码块。

## 7. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| juice 选择器子集覆盖不全 → 漏判隐藏 → 清洗版偏大 | 失败方向安全，仅影响体积不影响正确性；实测本页 80/80 占位完整、expander/模态全部正确分类 |
| class 噪声过滤误删语义 token | 保守启发式（拿不准保留）；语义类实测仅 ~28 KB，最坏全留也不回退多少 |
| 折叠标记过多稀释步骤 3 注意力 | 实测 25-27 个标记 vs 352K 结构噪声，注意力负担显著下降 |
| juice 对 1.6 MB 全文档内联耗时 | 用户明确本步不求快；不设优化目标，只在 debug 行记录耗时 |
| 页 1 规范化态与原始快照的 style 属性引号差异传入带样式版 | 规范化语义等价（单双引号重排），步骤 5 同款处理已验证无损 |
