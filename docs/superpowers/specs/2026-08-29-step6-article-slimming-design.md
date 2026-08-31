# 步骤 5/6 文章视图瘦身设计（article slimming）

- 日期：2026-08-29
- 状态：已与用户确认设计方向、规则细节与落点方案（A），待实施
- 分析依据：`.docs/2026-08-28-step6-article-slimming-analysis.md`（未入库）
- 参考页：`working/developers.openai.com_api_docs_guides_prompt-caching`（验收基准）
- 关联备忘：`.docs/2026-08-29-code-block-placeholder-design.md`（代码块占位符，用户决定后续单独立项）

## 1. 问题

参考页 `6_article.html` 239.5 KB，其中 style 属性值占 43%（103 KB），且
1,946 个元素的 style 值只有 `border: 0px solid;`——Tailwind preflight 的
`*{border:0 solid}` 被 juice 内联后被 finalize 白名单按**属性名**保留、
不辨值，"无边框"这个浏览器默认态被忠实写进 2,500+ 个元素。纯文本载荷仅
20.4 KB。步骤 6 是忠实迁移（5→6 仅缩 1.9 KB），瘦身必须做在迁移前后。

连带质量问题：`codex://threads/new?prompt=…` 营销链接（单个 ~1 KB 的
URL-encoded prompt）已验证漏进 `9_markdown.md`（grep 2 处）。

## 2. 目标与非目标

**目标**

- 参考页 `6_article.html` 239.5 KB → **≤ 140 KB**（预估 ~110-120 KB）；
  `5_juice_styles.html` 同步约 −20%（仅零值过滤贡献）。
- 步骤 7 真正需要的信号一项不丢：文本、data-idx、font-size/weight
  （标题层级）、display:flex/grid（布局）、**有值的** border/background/
  radius（视觉模块判据）、data-language（代码语言）。
- 修复 codex 链接污染：`9_markdown.md` 中非白名单协议链接归零。
- 分类规则全部落共享页面脚本（唯一事实源），不进 .mjs 编排层。

**非目标（硬约束）**

- **`1_snapshot.html` 逐字节不变**——步骤 8 截图/签名基准零冲击（验收项 4）。
- 不做：低透明度背景（α<0.1）删除、http 长链接截断、相对 href 绝对化、
  代码块占位符（见关联备忘）。
- 步骤 2/3/4 与 `2_clean_style_snapshot.html` 产物零变化。
- stdout 单行 JSON 契约不变（字段只做加法）。

## 3. 总体架构：双落点收敛（方案 A）

声明级与结构级分开落点，依据两条探索结论：

1. `compute_styles.mjs` **不读** `3_key_ids.json`——步骤 5 做结构手术若
   碰掉 key id 引用的元素，步骤 6 报 missing。步骤 6 迁移后 key 查找已完成，
   结构手术在那儿天然安全。
2. 分析文档建议 href 落步骤 1 prepare——但 prepare 动 `1_snapshot.html`
   （全保真基准），步骤 6 文章视图内剥除 blast radius 最小。

| 改动 | 脚本 | 阶段 |
|---|---|---|
| 零值声明过滤 | `page-finalize-inline.js`（白名单同场） | 步骤 5 |
| 六条结构规则 | 新增 `page-slim-article.js` | 步骤 6（迁移后） |

曾评估并否决：全部收敛到步骤 5（class 可用但引入 key ids 耦合 + 全树
操作，破坏"步骤 5 不知分类"分层）；按分析文档分散落点（prepare 动
1_snapshot、5/6 之间需新阶段，改动面最散）。

## 4. 零值声明过滤（`page-finalize-inline.js`）

**语义定义**：零值 = 声明值等于**对所有元素都成立**的初始值——写与不写
完全等价，对步骤 7 是纯非信息。在现有白名单清理同一次 evaluate 内、逐
元素 CSSOM 循环之后执行一场零值遍历；`dirty` 标记与"style 清空后移除
属性"复用现有逻辑。

### 4.1 边框按"边"语义判无效

`border: 0px solid` 里的 `solid` 单看不是零值，但宽为 0 的边整条不可见，
该边三件套同为非信息。对每边 {top, right, bottom, left}：

| 判定 | 动作 |
|---|---|
| style 为 `none`（显式或**缺省**——缺省即 initial none），**或** width ∈ {`0px`, `0`} | 该边 width/style/color 三件全删（style none 无论 width 多宽都不可见；width 0 无论 style 什么都不可见） |
| style 为实值（solid 等）**且** width 非零 | 保留（实边框） |
| style 为实值 **且** width 缺省（initial medium + solid = 可见边框） | 保留 |

inline 声明推断规则：juice 已把全级联解析进 style 属性，缺省 longhand 即
初始值。`border-width: 5px` 而无 style → style 缺省 none → 无效边，删。

### 4.2 精确值匹配删除表

| 声明值 | 动作 |
|---|---|
| `border-radius: 0px`（全角零） | 删；**非零 radius 保留**（radius + background = 圆角色块，真信号） |
| `box-shadow: none` | 删 |
| `background-color: transparent`（含计算形 `rgba(0, 0, 0, 0)`） | 删 |
| `background-image: none` | 删 |
| `border-image`/`border-image-*` 初始值残影 | 仅当**四边全 void** 时连残影一并删（`border: 0px solid` 经 CSSOM 展开为 17 个 longhand，slice/width/outset/repeat 初始值是残留）；有实边时保留——它们是维持 `border: 2px solid red` 紧凑简写序列化的 CSSOM 工件，删了会把实边框降级为 longhand 串 |
| `outline` 三件（无分边）按 §4.1 同语义：style 为 none（显式或缺省）或 width ∈ {`0px`, `0`} → 三件全删 | 同边框 |
| `overflow`/`overflow-x`/`overflow-y`: `visible` | 删（全元素初始值；分析文档未列，本设计补入同类） |

### 4.3 明确不删的"初始值"

- `font-size: 16px`、`font-weight: 400`：承载标题层级的**相对对比**信号。
- `display: block`：不是所有元素的初始值（span 上是布局信号）。
- `flex: 0 0 auto` / `flex-grow: 0`：flex 布局信号，非零值噪音。
- `<img>` 的 width/height 例外不受影响。

## 5. `page-slim-article.js`：六条结构规则（固定顺序）

新共享脚本，单一具名函数 `__u2mSlimArticle(protectedIds)`，操作
`document`（已迁移的文章 DOM）。顺序本身是设计——前面的规则改变后面
规则看到的输入。

### 5.0 执行顺序

```
① data-* 清理 → ② MathML→LaTeX → ③ 无文本 button/svg 删除
→ ④ 有文本 button 降级 → ⑤ 非 http 协议 href 剥除 → ⑥ 空壳 span 拆壳
```

### 5.1 保护集

`protectedIds = titleIds ∪ descriptionIds ∪ standaloneIds`（listFlowIds
不需要——容器本身不迁移）。保护语义分两档：

- **删除/解包类**（③④⑤⑥）：跳过 id ∈ 保护集的元素**本身**；其后代照常
  瘦身（key 内容里的噪音还是噪音）。防的是步骤 3 把手风琴标题 button 标成
  descriptionId 之类边角。规则①（属性清理）不受保护集约束——脚手架属性
  对保护元素同样是噪音。
- **保真替换类**（② MathML→LaTeX）：不受保护集约束——替换保留内容只换
  形态；保护的目的是防丢内容，不是防换形态。否则被标成 key 的公式永远
  留在 MathML 汤里。

### 5.2 规则① data-\* 清理（保留白名单）

保留恰好两种：`data-idx`（管线元素寻址）、`data-language`（步骤 7
判代码围栏语言的唯一机械信号）。其余 data-\* 一律删除。参考页实测 7 种
57 处（1.3 KB）：data-wrap-long-lines、data-variant、data-size、
data-color、data-actions-placement、data-state、data-selected——全是
组件库脚手架/交互状态，无内容语义。

白名单而非黑名单：对未见过的站点安全默认（陌上 data-\* 自动删除），
发现新信号时显式加保留集并写明理由。

### 5.3 规则② MathML→LaTeX（先于 span 拆壳）

拆壳会把 `.katex-html` 孪生解成裸文本、破坏孪生的结构识别窗口，故先行。
对每个 `<math>`（文档序）：

1. `latex = __u2mLatexText(el)`——**原样复用**休眠的
   `script/lib/page-latex.js`（查 `annotation[encoding="application/x-tex"]` /
   `script[type=math/tex]` / 前邻 script），零改动。
2. latex 为 null → **保留 MathML 原树**（兜底，分析文档要求）。
3. 孪生识别（KaTeX 标准输出结构；注意参考页本身 0 个 katex 孪生——其
   annotation 未声明 encoding，规则② 经分级信任扩展后在该页 19 个公式
   全部以裸 math 路径替换，见修订记录）：el 的父 span **仅含 el 一个元素子**（空白文本子忽略；
   katex-mathml）**且** 祖父 span **恰有两个元素子**、其一为该父、另一
   为 span（katex-html 孪生）**且父/祖父的直文本子纯空白**（终审补的
   守卫——带文字的包装整体替换会丢文本，全分支唯一内容丢失路径）→
   **祖父整体替换为 `$latex$` 文本节点**——孪生一并消灭，公式只出现一遍。
4. 结构不匹配（裸 MathML、KaTeX 变体）→ 只替换 `<math>` 本身为 `$latex$`；
   孪生残留由规则⑥解体为文本，公式文本可能重复一次——与今日现状相同
   （参考页 9_markdown 证明 LLM 今天就能从双胞胎正确择一），冒烟验证。
5. `$…$` 单美元内联形式（与参考页现有 9_markdown 约定一致）。

### 5.4 规则③ 无文本/纯符号 button/svg 删除

`tagName ∈ {button, svg}`（大小写不敏感）且子树**无非空白文本，或文本
不含任何字母/数字**（`/[\p{L}\p{N}]/u` 不命中）→ 整棵删。后者覆盖
参考页实测 7 个 textContent 恰为 `⋮` 的溢出菜单按钮——有文本但零信息；
`✕`/`×`/`⋯` 等纯符号交互件同路。含字母数字者（中文按钮、`GPT-5.6+`、
语言 tab）走规则④。svg 的 `<text>` 后代算文本——带文字的图标保留。
保护集跳过。

### 5.5 规则④ 有文本 button 降级

规则③之后剩余的 `<button>`（tab/手风琴标题，必有文本）→ 解包、子节点
上提到父元素原位。按钮自身的 style 弃置（包装铬是装饰），内部文本/span
的样式保留。保护集跳过。

### 5.6 规则⑤ 非白名单协议 href 剥除

`<a href>` 的 scheme ∉ **{http, https, mailto, tel}** → 解包 `<a>`（子
节点上提，href 随元素消失）。codex:/javascript:/slack: 等应用协议全灭。
mailto/tel 是对分析文档"非 http(s) 全剥"的**收窄**：短且 markdown 合法。
相对 href 与 `#锚点` 不动（假定步骤 1 已绝对化，未验证，列为非目标）。

### 5.7 规则⑥ 空壳 span 拆壳（不动点）

属性集 ⊆ {`data-idx`} 的 span → 解包。**迭代到不动点**（嵌套 token
span 逐层塌缩），防御性上限 10 轮（实测通常一轮收敛，上限纯防御性、
静默）。span 限定——div 等块级
元素可能承载 trans2img 模块边界，不碰。id 随元素消失只影响 6/7 血统：
步骤 8 用 `1_snapshot`/live 的 id 对位，零影响（分析文档 §3.2 论证，
探索复核）。保护集跳过。

主要收益来源：pre 内语法高亮 token span（参考页 1,324 个）——样式已被
finalize 清空（color 不在白名单），只剩 id + `border: 0px solid`，经
§4 零值过滤 + 本规则后 code 块对步骤 7 变纯文本。

## 6. 接线与契约

### 6.1 `extract_article.mjs` 接线

```
evaluate(__u2mExtractArticle, keyIds) → result.html
→ 同页 page.setContent(result.html)      // 内存往返，不落盘
→ evaluate(__u2mSlimArticle, protectedIds)
→ 序列化 → 写 6_article.html
```

曾考虑把 slim 源码作参数塞进 extract 的 evaluate——否决（双脚本混一个
表达式过绕；setContent 重解析 ~130 KB 是毫秒级）。

### 6.2 emit 契约（加法式）

`extract_article.mjs` 的 ok 行新增 `slim` 对象：
`{spansUnwrapped, buttonsRemoved, buttonsUnwrapped, svgsRemoved,
linksStripped, mathReplaced, attrsDropped}`。agent 决策表按 `status`
分支不受影响；单行 JSON 契约不变。`compute_styles.mjs` 的 emit 字段
不变。

## 7. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 零值过滤 | `test/unit/compute-styles.test.mjs` 扩展 | §4.1 三态（none/0px/实边 + style 实值 width 缺省）；§4.2 全表（radius 0 vs 非零+background、transparent 计算形、overflow visible vs auto）；§4.3 不删清单（flex: 0 0 auto 等） |
| 结构规则 | `test/unit/extract-article.test.mjs` 扩展 + 新夹具 | 嵌套空壳 span 塌缩；无文本 button+svg 整删；有文本 button 降级；`codex:` 解包而 `mailto:` 保留；katex 孪生整体替换 / 裸 math 替换 / 无 annotation 原样保留；data-\* 白名单；保护集两档（descriptionId 的 button 不解包、key 的 math 照换）；emit `slim` 字段 + 单行 JSON |
| 金测 | `clean-snapshot-golden` | 步骤 2 零接触，应原样通过；compute-styles 现有断言若含零值形状则同步更新 |
| 冒烟 | `test/smoke/SMOKE.md` | 参考页全 9 步重跑并记录 |

## 8. 验收标准

1. `pnpm test:all` 全绿。
2. 参考页 `6_article.html` ≤ 140 KB（预估 ~110-120 KB）；
   `5_juice_styles.html` 约 −20%。
3. `9_markdown.md` 前后 diff：**仅** codex 链接消失（这是修复）；公式、
   代码内容（字节级）、正文、标题层级不变。
4. `1_snapshot.html` 与改动前**逐字节一致**。

## 9. 风险与边界

| 风险 | 缓解 |
|---|---|
| KaTeX 结构识别在变体站点失配 | 退化路径只替换 `<math>`（公式不丢，孪生可能重复——同今日现状）；冒烟验证 |
| 零值误删真边框（`medium + solid`） | §4.1 按边语义：style 实值 + width 缺省 = 可见边框，保留 |
| 陌上站点 data-\* 有真信号 | 白名单默认删，发现即显式加保留集（data-language 先例） |
| 嵌套 span 不动点死循环 | 上限 10 轮 + 触顶日志 |
| 5→6 不对称（5 仍带结构噪音） | 有意为之：6 是 LLM 消费终端，5 是中间产物；5 的 -20% 已是零值过滤的顺带收益 |

## 10. 文档同步

- `SKILL.md`：步骤 5（零值过滤）、步骤 6（slim pass）描述。
- `CLAUDE.md`：管线段步骤 5/6 措辞。
- `README.md`：机制摘要与进度。

## 修订记录

- 2026-08-29（用户决策——高度还原原则）：`__u2mLatexText` 分级信任扩展
  ——未声明 encoding 的裸 `<annotation>` 也信（实践中是渲染器省略属性、
  内容即原文；参考页 19 个公式全此方言、内容经核实为 LaTeX）；显式声明
  **非 TeX** encoding 者仍拒（内容可能是其他格式，替换即失真）。参考页
  `mathReplaced` 0→19、MathML 汤清零、`6_article` 110.5KB→96.7KB。
  本条同时解除前文"原样复用 page-latex.js 零改动"约束（本条即改动依据）。
- 2026-08-29：初版。范围 = 分析文档 3.1/3.2/3.3/3.4/3.5 + 3.6 的
  data-\* 与空 svg（低透明度背景经用户决定不做；代码块占位符经用户决定
  后续单独立项，见 `.docs/2026-08-29-code-block-placeholder-design.md`）。
- 2026-08-29（终审收口）：§5.3 孪生识别补"父/祖父直文本纯空白"守卫
  （带文字包装整体替换丢文本——全分支唯一内容丢失路径，merge 前必修，
  随附夹具锁定与"key 的 math 照换"第二档测试）；§5.3 措辞纠正——参考页
  0 个 katex 孪生（annotation 无 `encoding` 属性，规则② 在该页零命中、
  公式由步骤 7 转录，与改造前一致；是否扩 `__u2mLatexText` 选择器接受
  无 encoding 的 annotation 留作用户决策）；§5.7 去掉未实现的"触顶记
  日志"。终审其余 14 项递延 minor 裁定 ride。
- 2026-08-29（Task 1 实施时）：§4.2 border-image 行收紧——实测
  `border: 0px solid` 在 CSSOM 展开为 17 个 longhand，无条件按值删
  border-image-\* 会破坏实边框的简写序列化；改为"四边全 void 时连残影
  删、有实边保留（纯序列化工件）"。实施另将白名单循环拆为两趟（先函数值
  替换落定、再零值过滤）——简写带 var 的 longhand 在 CSSOM 读作空串，
  融合单趟会把待替换的边误判为缺省 none 而删掉真实宽。
- 2026-08-29（写实施计划时）：§5.4 规则③ 扩为"无文本**或纯符号**"——
  实测参考页 7 个 `⋮` 按钮的 textContent 恰为 `⋮`（有文本但零字母
  数字），原"无文本"字面规则够不着自己的动机案例。判定标准
  `/[\p{L}\p{N}]/u` 不命中，中文/含字母数字按钮不受影响。
