# 步骤 2 清洗版极致简化设计（clean snapshot simplify）

- 日期：2026-08-27
- 状态：已与用户确认设计方向与规则细节，待实施
- 取代：`2026-08-25-clean-snapshot-slimming-design.md` 中的 R2（收紧改形）、R6（整体废除，由 K5 裸属性折叠取代）；R1/R3/R4/R5 语义延续（部分改形为 K6/K2/K4/K9）
- 参考页：`working/developers.openai.com_api_docs_guides_prompt-caching`（验收基准）

## 1. 问题

步骤 2 在 2026-08-25 瘦身改造后仍有三组问题：

1. **隐藏处理过度且复杂**。R6 走 juice 级联检测四阶段管线（页 1 引号规范化 →
   Node 端 juice 内联 1.6 MB → 页 2 递归解读 display/visibility → 页 1 折叠），
   外加雪崩护栏与三处边界补丁（@media 不内联、hidden 属性、行内 `!important`），
   最近步骤 8 又被迫叠加 reveal-hidden 强制展开。补丁链五层，仍偶发清洗过头。
2. **瘦身未达标**。目标 ~32 KB，参考页实测 91,422 字节。R2 class 过滤漏网严重
   （`overflow-x-hidden`、`border`、CSS-modules `_Button_6dmow_1` 等存活），
   aria-*（5.9 KB）、href/src（6.8 KB）未清理。
3. **juice 实证无产出**。参考页 17 个被折叠的隐藏子树**全部**带裸 `hidden` 属性——
   样式级联检测在该页净贡献为零，整条管线维护成本白付。

## 2. 目标与非目标

**目标**

- 步骤 2 变为单页面、单趟结构变换 ×2（styled/clean 两趟）、零样式计算、零检测
  管线、零边界补丁；删除 juice 依赖引用与 `page-hidden-detect.js`。
- 清洗版为步骤 3 提供纯结构视图：属性极简、文本元数据 token 化，参考页目标
  **≤ 70 KB**（预估 62-67 KB，现状 91 KB）。
- 规则全部机械可判定（属性存在性、标签集、字数阈值），无 CSS 语义。

**非目标（硬约束）**

- **带样式版逐字节不变**：`2_clean_style_snapshot.html`、`2_long_text.json`
  与今日产物完全一致，步骤 4-9 契约零变化。
- stdout 单行 JSON 契约字段不变。

## 3. 总体架构：单页两趟

`clean_snapshot.mjs` 启动单浏览器实例、单页面，挂
`page.route(/^https?:/, abort)`（只拦 http(s) 子资源，file:// 主文档导航不受
影响——DOM 解析不需要子资源，顺带修掉今日页 1 真拉图片的隐患），对
`file://1_snapshot.html` 执行两次 goto + evaluate：

- **趟 1 `mode: styled`**：结构清洗（与今日步骤 1-8 一致）→ LONG_TEXT 占位
  （今日步骤 9）→ SVG 瘦身（今日步骤 10）→ 序列化 `2_clean_style_snapshot.html`
  与 `2_long_text.json`。产物与今日逐字节一致。
- **趟 2 `mode: clean`**：结构清洗（同一套代码）→ SVG 清空 + style 剥除
  （今日步骤 11-13）→ K1-K9（§5）→ 序列化 `2_clean_snapshot.html`。

两趟各自直线代码、无跨趟状态。今日文档中「两版占位编号逐一对应」契约**废除**
（清洗版不再参与任何还原链，见 §6 不变量）。

## 4. 共享结构清洗（两趟一致，与今日相同，仅列不改）

link/meta/base 删除；nav/footer/form 及 role 等价物删除；video/audio 删除；
input/select/textarea/label/dialog 删除；button 与 [role=button] 保留；空元素
级联删除（KEEP_EMPTY 白名单不变）；`<title>` 保留。带样式版另含 SVG 瘦身与
LONG_TEXT 占位（阈值 16 汉字 / 12 词不变）。

## 5. 清洗版规则 K1-K9（按实施顺序）

### K1 class 语义过滤

class 值按空白切 token，逐 token 判定：样式强相关 token 删，其余保留；全噪声则
删整个属性。在今日 R2 基础上补齐实测漏网：`overflow-*`、`appearance-*`、裸
`border`/`shadow`/`prose` 等 tailwind 单体、`!` 前缀 important 变体、CSS-modules
`_Name_hash` 形态、负号前缀的位移/尺寸工具类（`-top-0.5` 等——今日正则漏网，
匹配时先剥前导 `-` 再走位移/间距族）、工具名类（`shiki`/`shiki-themes`/
`syntax-highlighter`——代码块语义已由 pre + data-language 表达）。原则不变：
**拿不准保留**——漏删只费字节，
误删语义 token 才伤步骤 3 判读。过滤表以参考页实测校准。

### K2 属性白名单

全文档只保留：`class`（K1 过滤后）、`id`、`data-u2m-id`、`data-language`、
`hidden`、`type`、`role`、`alt`。**其余一律删除**——含 href/src/aria-*/style/
width/height/tabindex 等。效果即「a/img 等外部链接元素的 URL 一律清空」：
`<a href="https://…">text</a>` → `<a>text</a>`，`<img src="…">` →
`<img data-u2m-id="7">`。

### K3 SVG 清空与媒体裸标签

SVG 剥成 `<svg data-u2m-id="…"></svg>`（子树清空、白名单外属性删除）；
img/iframe/canvas/object/embed/picture/source 保留裸标签 + 白名单属性（src 已被
K2 清）。媒体元素不折叠、不 token 化。

### K4 astro 解包

`astro-island`/`astro-slot` 替换为子元素上提（今日 R4 原样）。

### K5 hidden 裸属性折叠

最外层带 `hidden` 属性的元素（任意值：`hidden`/`hidden=""`/`hidden="true"`/
`hidden="until-found"`；HTML 规范：属性存在即隐藏，无需样式计算），子树清空，
内容放单个文本节点 token：

```html
<div id="mobile-nav-panel-3" hidden="true" data-u2m-id="898">{{612_words;112_a/38_div}}</div>
```

- 单位规则同 K8（子树文本含汉字 → chars，否则 → words）。
- 无条件折叠（不设字数阈值——hidden 是明确信号，脚手架再小也无判读价值）。
- 根元素保留白名单属性（含 `hidden` 与 `data-u2m-id`，步骤 3 仍可引用，
  步骤 6 从带样式版取全文还原，如 FAQ 折叠答案）。
- **`data-u2m-hidden` 属性取消**——token 即标记。
- 嵌套 hidden 取最外层；目标已被前序规则删除时容忍跳过。

### K6 table 折叠

`<table>` 整棵子树清空，只统计字数、无构成：

```html
<table data-u2m-id="1987">{{table>64_words}}</table>
```

表格内容对步骤 3 无判读价值（步骤 7 从带样式版读全表），行列表格标记是主要
体积来源。无条件折叠；单位规则同 K8（含汉字 → chars，否则 → words）。

### K7 pre 折叠

`data-language` 从 code 壳提升到 pre 元素，子树清空：

```html
<pre data-language="javascript" data-u2m-id="2231">{{pre>code>612_chars}}</pre>
```

代码一律按字符数计（不用词数）；行内 `<code>` 不动（属 K8 的行内集）。
无条件折叠。

### K8 行内 run token 化

块容器内**连续行内兄弟序列**为一个 run——裸文本节点与行内集元素
（a span code strong em b i u s mark small sub sup abbr cite q kbd samp time img br）
的任意混合，如 `text<span>text</span><a>link</a> text` 是一个 run：

- 合计文本（成员文本拼接、去首尾空白）超阈值 → **整段替换**为一个 token：
  `{{n_chars}}`（含汉字 run，如 `{{37_chars}}`）/ `{{n_words}}`（纯西文 run，
  如 `{{24_words;1_a/1_code}}`）；run 内含行内集元素时追加构成（按计数降序，
  至多 4 项）。button 的直接文本同理——长 FAQ 问题 token 化、短按钮文案保留。
- 阈值沿用 **16 汉字 / 12 词**（单位规则同 LONG_TEXT：run 文本含汉字 → 去首尾
  空白后字符数；否则 → 词数）。短 run（按钮文案、英文标题）自然保留原文。
- **媒体豁免**：run 含 `img` → 不折叠（图片的 data-u2m-id 需保持可引用——图注、
  hero 配图场景）；svg/iframe/canvas 不在行内集内、天然切断 run 并按 K3 保留。
- **病态切断**：行内集元素子树内出现行内集之外的标签 → 该元素视作块、切断 run
  （如含 `<svg>` 的 icon span）。保守方向：结构存疑即保留原样。
- 已折叠子树（K5/K6/K7 产物）内部不再计算 run。

### K9 保守空白压缩

今日 R5 原样：删纯空白文本节点当且仅当前后兄弟都非行内文本敏感节点。置于
K8 之后（run 已并单节点，行内间空白语义由 token 吞并）。

### 规则间顺序

K1 → K2 → K3 → K4 → K5 → K6 → K7 → K8 → K9。折叠类（K5/K6/K7）目标消失即
容忍跳过；K8 在全部折叠之后，只处理残余文本。

## 6. 不变量：清洗版是终端视图

> **清洗版的唯一消费者是步骤 3，且只消费其 id 引用产物（`3_key_ids.json`）。**
> 一切内容还原只经带样式版：LONG_TEXT_k 还原链（步骤 7 骨架引用 → 步骤 8 从
> `2_long_text.json` 回填）与 hidden/table/pre 子树全文还原（步骤 6 从带样式版
> 迁移）全部走 styled 路径。

由此钉死占位符体系分工（回应「`{{LONG_TEXT_k}}` 与 `{{162_chars;1_a}}` 冲突」）：

- run 与 LONG_TEXT 本无一一对应（一个 run 聚合多个文本节点与行内标记），清洗版
  token 为纯元数据、**只写不读**、不带 k。
- run/table/pre token **严禁**出现在带样式版；`{{LONG_TEXT_` **严禁**出现在
  清洗版（趟 2 不执行 LONG_TEXT 逻辑，出现即实现走样）。
- 两个守卫测试分别断言上述两点。

## 7. 实现重构

| 对象 | 动作 |
|---|---|
| `script/clean_snapshot.mjs` | 重写 main：单页 + route abort + 两趟 goto/evaluate；删 juice import、阶段 A/B/C（规范化/juice/页 2 检测/护栏），约 −60 行 |
| `script/lib/page-clean-snapshot.js` | 重写为 `__u2mCleanSnapshot({mode})`：共享结构清洗段 + mode 分叉（styled：今日 9-10；clean：今日 11-13 + K1-K9）。头注重写 |
| `script/lib/page-hidden-detect.js` | **整文件删除**（唯一消费者是步骤 2） |
| `script/lib/page-normalize-styles.js` | 保留不动（步骤 5 compute_styles 在用），仅步骤 2 停止引用 |
| package.json | juice 依赖保留（步骤 5 仍用） |

U2M_DEBUG：删 juice 耗时行与护栏警告行；保留/新增一行汇总
`[clean] hidden 折叠 N · run token M · 产物 X 字节`。stdout JSON 字段与语义
完全不变（`status`/`cleanedSnapshot`/`styledSnapshot`/`longText`/`longTextCount`）。

## 8. 文档同步

- `SKILL.md` 步骤 2 描述重写（两趟架构 + K1-K9 摘要）；步骤 3 指引中
  `data-u2m-hidden` 标记说明删除。
- `references/analyze_html_guide.md` 改写识别线索：无 URL、class 已语义过滤、
  四种 token 的读法——run `{{n;构成}}` / `{{table>n}}` / `{{pre>code>n}}` /
  hidden 折叠 `{{n;构成}}`——「规模 + 构成 → 是否值得纳入 listFlow」；
  hidden 折叠根的 id 可引用、原文在带样式版。
- `CLAUDE.md` / `README.md` 步骤 2 段落同步；CLAUDE.md 管线顺序描述更新
  （步骤 2 词条替换为两趟 + K 规则摘要）。

## 9. 测试计划

**语义测试**（浏览器直调页面脚本，沿用现有放置约定）：

- K1：tailwind/哈希/CSS-modules/`!` 变体/工具名删；BEM 语义（`page-copy-action__icon--copy`）
  留；混合部分过滤；全噪声删属性；拿不准保留。
- K2：白名单八属性存活；href/src/aria-*/style/width 删净；`<a>`/`<img>` URL 清空。
- K3：SVG 清空裸壳；媒体裸标签。
- K4：astro 包装上提。
- K5：最外层折叠、嵌套归属、任意 hidden 值、token 构成（计数降序 ≤4 项）、
  id 保留可引用、`data-u2m-hidden` 不存在。
- K6：整表折叠只统计字数。
- K7：data-language 提升、行内 code 不动。
- K8：阈值上下（16 汉字/12 词边界）、混合裸文本+行内、构成、img run 豁免、
  病态行内嵌块切断、pre/table/hidden 内部无 run。
- K9：行内间空白保留、块间空白删。
- **守卫**：带样式版无 run/table/pre token 且 LONG_TEXT 编号完整（既有测试保持）；
  清洗版无 `{{LONG_TEXT_`。

**集成**（CLI 子进程 + 夹具）：

- 既有夹具：`2_clean_style_snapshot.html` **逐字节不变**断言；stdout 单行 JSON。
- 新夹具：hidden 面板 + 表格 + shiki pre + 混合 run + 媒体 run 的组合页，断言
  token 落盘形态。
- 删除：juice 检测管线、雪崩护栏、@media 钉行为等既有用例。

**验收基准（参考页真跑）**

- `2_clean_snapshot.html` ≤ 70 KB（预估 62-67）。
- 步骤 3-9 全链路走通；`9_markdown.md` 与今日产物语义一致（长文、表格、代码、
  hidden 内容均不丢）。
- `grep -c juice script/clean_snapshot.mjs` 为 0。

## 10. 风险与边界

| 风险 | 缓解 |
|---|---|
| K1 漏网/误删 class | 拿不准保留；实测校准过滤表；体积影响有 K2 兜底（class 外属性已极简） |
| run 吞掉链接文本削弱步骤 3 对噪音流的语义判读 | 构成保留 `n_a` 计数；短 run 保留原文；阈值可经 cfg 调 |
| hidden="until-found"（可搜索隐藏）被折叠 | 方向安全：原文在带样式版，listFlow 引用即可还原 |
| 表格折叠丢失表头判读 | 步骤 7 从带样式版读全表；token 规模可判流价值 |
| 两趟加载同一 file:// 文档 | 子资源全 abort，纯本地解析；趟间无共享状态 |
| 步骤 3 指引未跟上 token 形态导致判读退化 | §8 guide 改写与实现同批交付，参考页验收兜底 |
