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
`hidden`、`type`、`role`、`alt`、`aria-label`。**其余一律删除**——含
href/src/aria-\*（aria-label 除外）/style/width/height/tabindex 等。效果即
「a/img 等外部链接元素的 URL 一律清空」：`<a href="https://…">text</a>` →
`<a>text</a>`，`<img src="…">` → `<img data-u2m-id="7">`。aria-label 是
icon-only 控件/链接的唯一可达名信号，例外保留——值已在共享段截断为首末句
（见共享段 9b，2026-08-31 五次修订），其余 aria-\* 一并删。

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

## 11. 修订记录

- 2026-08-28（实施后修订）：带样式版 head 注入 `<meta charset="utf-8">`。动机：extract_styled 以 file:// 加载 `2_clean_style_snapshot.html`，共享清洗删除全部 meta 后无 charset 声明，解码依赖 chromium 嗅探——曾把 UTF-8 嗅成 Windows-1252 产出双重编码乱码（参考产物 4/5/6 实证）。§2「带样式版逐字节不变」约束按此修订：差异仅注入行。同批终审遗留清理：K6/K7 跳过带 hidden 的 table/pre（K5 独占折叠，防计数 token 被覆盖）、CSS-modules 尾段须含数字（`_tab_active` 类纯语义类保留）、K8 跳过已分离子树（runCount 不虚高）、行内标签集 K8/K9 合一、golden 测试按夹具拆分并改 Buffer 字节比较。
- 2026-08-28（二次修订）：带样式版进一步简化——astro 解包两趟共享 + styled 属性白名单。动机：K4 原仅清洗版执行，带样式版残留的 astro-island/astro-slot（参考页 66 个标签、33KB 序列化 props）一路流进 `6_article.html`（步骤 7 LLM 输入，实测 59 个标签、27KB 噪音）。§2「带样式版逐字节不变」约束再次修订：差异 = astro 解包 + 属性白名单 + 既有 charset 注入行。两项规则：
  - **astro 解包提升至共享段**（空元素级联后、mode 分叉前），枚举改 `astro-` 前缀匹配（框架保留命名空间，astro-island/slot/static-slot 及未来变体；永不外溢到真实 web component）。包装整体弃置含其 data-u2m-id——步骤 3 引用集来自清洗版从不引用包装 id，两版 id 集就此对齐。清洗版输出逐字节不变（新旧代码对参考页 414KB 产物 cmp 实证）；`2_long_text.json` 逐字节不变（解包不增删文本节点、文档序不变，golden 守护）。
  - **styled 属性白名单**（SVG 瘦身后、charset 注入前）：保留 13 属性 = clean K2 八属性 + style（juice 输入）/ href / src（步骤 7 URL 源）/ width / height（img 权重信号）；`<style>` 标签整体豁免（media 等级联线索）；data-v-*、aria-*、tabindex、target/rel、loading/srcset、lang 等删净。K1 class 过滤不迁移（juice 靠 class 匹配选择器）；K5-K9 折叠不迁移（带样式版是唯一还原源）。
  golden `*.styled.html` 按此再生成；参考页实测 styled 版 1461167 → 1386078 字节（-75KB），`6_article.html` astro 清零、剥标签后正文文本与改造前逐字相同（内容零丢失）。
  背景查证：主流框架中仅 Astro 在 SSR 产物留持久化自定义脚手架标签——Vue/Nuxt（属性 + `<NuxtIsland>` 为编译期组件）、React/Next（RSC payload 在 script，步骤 1 已剥）、Qwik（`q:` 属性）、Deno Fresh（HTML 注释占位）、htmx/Alpine/Livewire（纯属性）均由属性白名单或步骤 1 覆盖。
- 2026-08-28（三次修订，code-review 复核驱动）：styled 属性白名单两处收紧。
  - **动态选择器集**：初版静态删 data-theme/data-width/aria-*/lang 等属性，但保留的 `<style>` 规则以 attribute-selector 引用它们——删属性即断 juice 级联（article-1 实测丢 45 条 border/background/display/font-weight 声明，恰是步骤 5 finalize 白名单保留、喂步骤 7 的信号）。修复：白名单执行前扫 `<style>` 文本收集 `[…` 引用的属性名（`/\[([a-zA-Z][a-zA-Z0-9_-]*)/`），引用即保留（Vue scoped `[data-v-*]` 同覆盖）、未引用照删。修复后 article-1 juice 四项声明计数与改造前基线完全一致（156/236/216/119）。
  - **内容信号属性补集**（9 项）：colspan/rowspan（步骤 7 判「复杂跨行跨列表格→trans2img」的分派信号）、start（ol 起始编号）、aria-label（icon-only 控件/链接的唯一可达名——参考页实丢 21 处）、data-src/srcset（懒加载图片 URL 通道，步骤 1 只规范 img[src]）、datetime（time 日期原文）、open（details 展开态）、lang（extract_article 照抄 `<html lang>` 语言信号）。静态保留集 13 → 22。
  - 附带：属性剥除循环三处（svg 瘦身/styled 白名单/K2）合一为 `stripAttrsExcept(el, keep)` helper；K2 重构经真实页 clean 逐字节 cmp 验证零漂移。golden `*.styled.html` 随之再生成（article-1 恢复 data-theme/lang/aria-label）。
- 2026-08-31（四次修订）：**K8 废除、长文本占位回归两趟共享、K5 改命名式 token**。动机：run 整段折叠对行内混排段（每段低于阈值、合计超阈值，如链接/行内 code 密集的段落）确实省 token，但把 `<a>`/`<code>` 等行内元素一并吞进 token——步骤 3 看不到行内骨架，结构保真受损；且 `{{n_words;1_a/1_code}}` 这类匿名元数据 token 与 K6/K7 的命名式规模信号（TABLE_TAG/PRE_CODE_TAG）语法不统一。改动四项：
  - **长文本占位上移至共享段末尾**（astro 解包后、mode 分叉前，即 simplify 前的位置）：两趟同位执行，清洗版携带与带样式版**编号逐一对应**的 `{{LONG_TEXT_k|n_chars}}`/`{{LONG_TEXT_k|n_words}}`，行内结构保真（按文本节点占位，`<a>`/`<code>` 混排原样保留）。§6 不变量随之修订：「清洗版不含 LONG_TEXT」反转为「清洗版占位与带样式版逐一对应」（守卫测试同向反转，ph 集合比对）；还原链不变——步骤 7 引用来自 styled 路径的文章视图、步骤 8 从 `2_long_text.json` 回填，清洗版占位不被任何后续步骤消费。带样式版输出逐字节不变（golden 守护）。
  - **K8 行内 run token 化废除**：INLINE_TAGS 集保留（K9 空白敏感判断仍用），runCount 统计删除；title 容器豁免随之无意义（占位 treewalker 只走 body，`<title>` 天然不占位）。
  - **K5 token 改命名式**：`{{n;构成}}` → `{{HIDDEN_TAG|n_chars;构成}}`（如 `{{HIDDEN_TAG|200_chars;1_p}}`），与 TABLE_TAG/PRE_CODE_TAG 语法对齐；规模按**占位前原文**预计算（见下条）。
  - **折叠统计预计算上移**：K5 hidden 规模与 K7 pre 行数在占位**之前**于共享段量原文、挂 expando（`__u2mHiddenSize`/`__u2mPreLines`，仿表格形状预计算模式）——占位之后原文变成 `{{LONG_TEXT_k|N_unit}}` 语法串，届时再量会把语法当文本（规模虚高，如 23 字原文量成 26）或丢换行（行数塌缩为 1）。表格形状预计算不受占位影响（数 tr/td/colspan、不动文本），位置不变。
  测试：守卫两处反转（article-1 断言、ph 集合比对）；K8 四用例改写为「按文本节点占位 + 行内结构保留」语义；K5/K6K7-hidden 用例期望改 HIDDEN_TAG 精确值（兼证预计算——变异验证：去掉预计算得 26_chars/1_lines 即红）；新增 pre 行数预计算用例。`references/analyze_html_guide.md` 步骤 3 指引同步：恢复 `{{LONG_TEXT_k|n_chars}}` 读法（约束 6，行内结构保真说明），hidden 读法改 HIDDEN_TAG（约束 3），删 run token 读法，形态速览补 LONG_TEXT/HIDDEN_TAG 两例。
- 2026-08-31（五次修订）：**aria-label 入 clean 白名单 + 值首末句截断**。动机：clean 趟 K2 原把 aria-\* 一并删——icon-only 控件/链接丢失唯一可达名信号；而 styled 趟虽保留 aria-label 全量，某些站点把整段描述塞进 aria-label，全量流到步骤 7 LLM 输入费 token。改动两项：
  - **共享段 9b aria-label 值截断**（长文本占位后、mode 分叉前，两趟同位执行）：按完整句末标点切句，终止符 = `。！？；`与`.!?;`（**不含**逗号/顿号这类句中停顿）；≥3 句才截断为「首句 + `…` + 末句」，≤2 句（含无终止符的长单句）原样保留。共享段同位执行→两版截断值天然一致（孪生守卫不受影响）；aria-label 是元数据、不流入最终 markdown，不进 LONG_TEXT 恢复清单。
  - **clean K2 白名单补 `aria-label`**（八属性 → 九属性）：clean 版从「整删」变「保留截断值」；styled 趟白名单本已含 aria-label，现保留截断值。其余 aria-\* 仍删。
  测试：K2 用例断言由「aria-label 删净」反转为「aria-label 保留（短值原样）」；新增 K2b 用例覆盖中文 `。`/英文 `.`/分号 `；` 三类终止符的 ≥3 句截断、≤2 句原样、逗号不切句、两趟孪生一致。golden 未变（参考页 aria-label 均为短值，截断 no-op）。
