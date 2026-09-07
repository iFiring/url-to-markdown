# 长文本行内 run 整段折叠 + 步骤 8 确定性 Markdown 还原设计

- 日期：2026-09-06
- 状态：已与用户确认设计（分节呈现逐节批准）；2026-09-07 自审修订：
  转义范围排除 code/math、行首中断符转义、span 多信号固定嵌套顺序
- 前例：`docs/superpowers/specs/2026-09-02-table-placeholder-design.md`、
  `docs/superpowers/specs/2026-09-02-code-block-placeholder-design.md`——本设计
  延续「浏览器侧结构化收集 + Node 侧序列化」的既有分工

## 1. 背景与动机

现状 `foldLongText`（`script/lib/page-clean-snapshot.js`）只折叠**单个文本节点**，
`2_long_text.json` 存纯文本；行内元素（strong/em/code/a/br/math）本体留在 DOM，
行内 Markdown 语法（`**bold**`、`` `code` ``、`$…$`、链接）由步骤 7 LLM 手写。
三类代价：

1. **token**：一个混排长段落流出 N 个占位符 + 元素标签，步骤 3（清洗版）与
   步骤 7（文章视图）双重付费。
2. **不确定性**：行内格式还原依赖 LLM 转录——漏加粗/漏链接/漏公式是真实风险，
   与代码块转录失真（缩进丢失，见代码块占位符设计 §1）同款动机：下游无纠错机会。
3. **math 链路绕行**：KaTeX `<math>` 要到步骤 6 瘦身规则②才转 `$…$`，步骤 2-5
   全程携带 katex-html 视觉孪生结构。

设计目标：折叠单位升级为「**极大纯行内 run**」——流容器内 text 与行内元素混排的
整段内容折成一个 `{{LONG_TEXT_k}}`，原文以**规范化 HTML 片段**入库；步骤 8 确定性
转换为 Markdown 行内语法（含 `<math>` → `$…$`）。

## 2. 设计决策（已与用户确认）

1. **折叠单位**：整段纯行内 run（元素含在占位符内）+ 步骤 8 确定性转换。
2. **容器范围**：所有极大纯行内流容器（p/li/blockquote/dd/dt/h4-h6/summary/div/
   span……由极大性判定自动覆盖，不枚举白名单）；h1-h3 整子树豁免不变；
   **table/pre 子树排除**（表格与代码块已有各自的占位符体系）。
3. **无源 math 兜底**：阻断折叠——含无源 math 的 run 不折，留在 DOM 走现状链路
   （步骤 6 保 MathML 原树、步骤 7 LLM 自行处置）。math 还原质量与现状完全一致，
   代价是带无源公式的段落整体不折。
4. **转换时机（方案 A）**：步骤 2 页内**规范化序列化** + 步骤 8 Node（jsdom）
   转 markdown。
   - 否决 B（收集时一路转到底）：markdown 决策烘焙在收集时（改规则要重跑快照）、
     转换逻辑进页面脚本只能浏览器测试、与表格/代码块「Node 序列化」分工相悖。
   - 否决 C（存原始 innerHTML、还原时 Node 全解释）：jsdom 无级联计算，
     `.emphasis{font-weight:700}` 这类 **class 驱动的强调会丢**——规范化必须
     发生在浏览器里。
5. **散文本节点**：非纯容器的散长文本（夹在块级子元素之间）维持现状逐节点折叠
   ——父容器不纯、没有「整段」可折。
6. **转义**：文本节点反斜杠转义 markdown 活动字符，渲染透明（用户确认：不影响
   显示即可）。
7. **display math**：run 内块级公式输出 `$$…$$`。

## 3. run 检测（两趟共享段执行）

### 3.1 时机与孪生守卫的构造性保证

检测放在**两趟共享段末尾**（空元素级联 + astro 解包之后、趟分支之前），此时两趟
DOM 完全一致，决策天然一致：

- **styled 趟**（分支开头）：按记录折叠；
- **clean 趟**（K11 之后）：按记录**成员资格**折叠（元素已被 K5 hidden 折叠 /
  K11 视图折叠删除或吞没则自然跳过）。

为什么必须共享段决策：clean 趟的 K 规则会**删除子树**（K5 hidden、K11 视图折叠）。
若两趟各自检测，clean 侧容器可能因元素被删而「变纯」、styled 侧不纯——孪生守卫
clean⊆styled 破坏。共享段决策后，两趟折叠集来自同一 DOM 快照，守卫**由构造保证**，
免疫全部 K 规则的纯性扰动。

### 3.2 判定条件

候选容器 E 需全部满足：

1. **位置**：E 及祖先不在 `table`/`pre`/`svg`/`style`/`h1`/`h2`/`h3` 子树内
   （`closest` 判定；h1-h3 整子树豁免沿用现状 `skipPlaceholder` 语义）。
2. **纯行内性**：E 整棵子树只含文本节点 + 行内允许集 =
   K9 `INLINE_TAGS`（`script/lib/page-clean-snapshot.js`，a/span/code/strong/em/
   b/i/u/s/mark/small/sub/sup/abbr/cite/q/kbd/samp/time/img/br）**剔 img**
   + 显式扩展 `del`（行内删除语义，映射 `~~…~~`）/`var`（行内变量语义）/
   `wbr`（零宽换行机会，转换时解包）+ `math`。
3. **阻断项**（任一命中即该 run 不折，整体留在 DOM）：
   - 允许集外元素（img/svg/button/iframe/canvas/audio/video/picture/input/
     select/textarea……由 2 自动覆盖，不另行枚举）；
   - `[hidden]` 属性或 computed `display:none` 的元素（隐藏内容不得随 run 折进
     恢复清单——styled 趟此时尚未剥隐藏，需显式检查）；
   - **取不到 LaTeX 源的 `<math>`**（决策 3）。
4. **极大性**：E 的父容器不满足 1-3 时 E 才算候选——避免在 `<strong>` 内部重复
   折叠、避免嵌套容器双重折叠。
5. **体量门槛**：整段 run 的 textContent（trim）按现状阈值计量——含汉字
   > 16 字符 / 不含汉字 > 12 词（`cfg.minChars`/`cfg.minWords` 可覆盖，与
   `sizeSuffix` 同源）。

注：纯行内容器整体低于阈值 ⇒ 内部任何文本节点也低于阈值（节点量 ≤ run 量），
全有或全无，语义自洽。

### 3.3 规范化序列化（检测通过当场执行，浏览器内）

对 E 的子节点递归序列化为 canonical HTML 片段：

| 输入形态 | 序列化结果 |
|---|---|
| 文本节点 | HTML 转义（`&<>`）照抄；空白保真不归一（文本与元素间的空格是内容） |
| `a[href]` | 只留 `href`，以 `document.baseURI` 绝对化（快照已注入 `<base>`）；`#`/`javascript:`/空 href → 解包丢弃 |
| span（按 `getComputedStyle`） | `font-weight≥600/bold` → `<strong>`；`font-style:italic` → `<em>`；`text-decoration:line-through` → `<del>`；多信号叠加按固定顺序 strong→em→del 嵌套（确定性输出，两趟/测试 golden 稳定）；无信号 → 透明丢弃（只递归子节点） |
| `strong/b` → `<strong>`；`em/i` → `<em>`；`del/s` → `<del>` | 语义归一 |
| `math` | 先经 `__u2mLatexText` 取源：无源 → 阻断该 run（见 3.2-3）；有源 → 极简形态 `<math display="block"?><annotation encoding="application/x-tex">源码</annotation></math>`（katex-html 视觉孪生**不入库**；display 判定 = `display="block"` 属性或 `closest('.katex-display')` 非空） |
| `code`/`br` 及行内同族（u/mark/small/sub/sup/abbr/cite/q/kbd/samp/time/var/wbr） | 保原名，属性剥净 |

`__u2mLatexText` 来自 `page-latex.js`——`clean_snapshot.mjs` 增加
`readSharedScript('page-latex.js')` 组合注入（与 `extract_article.mjs` 步骤 6
的 page-slim + page-latex 同款拼接方式），维持「共享页面脚本是唯一事实源」。

span 样式归一是本设计保真的关键：步骤 5 之前「样式驱动而非标签驱动的强调」
（`<span style="font-weight:700">` 或 class 驱动）只有浏览器 computed style 能
可靠识别；序列化时不归一，Node 侧永远无法补（方案 C 否决理由）。

### 3.4 两趟折叠执行

- **styled 趟**（分支开头）：统一递归 walk——
  - 元素命中检测记录 → `E.innerHTML` 替换为 `{{LONG_TEXT_k|n_unit}}`（文本节点
    形态）；**壳保留**（data-idx/class/aria-label 原样，机制同 K11 VIEW_TEXT——
    步骤 4 裁剪与步骤 8 trans2img 链的引用不断）；
  - 未命中 → 递归子元素；
  - 文本节点超阈值 → 现状散文本折叠（`{{LONG_TEXT_k|n_unit}}`，值入 `texts`）；
  - **k 全文档序连续单计数器**（run 与散文本共用）。
- **clean 趟**（K11 之后）：同一套 walk，无编号 `{{LONG_TEXT|n_unit}}`，按记录
  成员资格执行；散文本规则不变。
- **散文本折叠不受 table/pre 排除影响**：3.2-1 的排除只限 run 折叠；表格单元格与
  pre 内部的长文本节点照旧逐节点折叠（`texts` 段），table2md/code2md 的
  `expandLongText` 预展开依赖这一形态。
- **边缘**：记录的 run 元素本身是 span 且被 K10 拆包（仅剩 data-idx 属性的
  span）→ 元素消失、文本上提为父容器的散文本节点，按散文本规则折叠——两趟折叠
  粒度不同，但 clean 占位符位置仍落在 styled 折叠区内，位置包含关系保持
  （既有孪生守卫测试裁决）。
- **trans2img 模块内**：run 折叠照常发生（styled 趟无 K11）；步骤 7 既有规则
  已覆盖——trans 标记子树内的 LONG_TEXT 编号不引用、原文随截图保留。

### 3.5 步骤 3 视角（clean 版）

`<p>{{LONG_TEXT|N_chars}}</p>` 整段形态成为常态；判读信号不变（段落位置与体量
仍可见，`analyze_html_guide.md` 相应更新措辞）。

## 4. Schema：`2_long_text.json` 分两段

```json
{
  "texts": { "3": "纯文本（散文本折叠，现状形态）" },
  "runs":  { "5": "<p 内 canonical HTML 片段>" }
}
```

- k 全局唯一、文档序连续（单一计数器）。
- **table2md / code2md 只收 `texts` 段**：表格/pre 子树被 3.2-1 排除、其内部永远
  只有散文本占位符，`expandLongText(html, longTextMap)` 的扁平 `{id: string}`
  形状不变、**零改动**。
- `clean_snapshot.mjs` emit：`longTextCount` 拆为 texts/runs 计数（总量语义
  保持）。

## 5. 步骤 8：`script/lib/inline2md.mjs`（Node + jsdom）

### 5.1 接线

- 纯函数 `inlineRunToMarkdown(html) → string`；jsdom 解析片段（依赖已有，
  table2md 同款）。
- `screenshot_trans.mjs` 纯 Node 阶段（LONG_TEXT 还原处）：读两段 JSON，先把
  `runs` 逐 k 转成 markdown 值，与 `texts` 合并为 `{k: 字符串}` 解析表；
  `resolveSkeletonString` 现有替换逻辑零改动；未定义 k 守卫天然覆盖合并表。
- emit 增 `runsResolved` 计数。

### 5.2 元素映射（递归下降）

| canonical 输入 | Markdown 输出 |
|---|---|
| `strong` / `em` / `del` | `**…**` / `*…*` / `~~…~~` |
| `code` | 反引号包裹；内容含反引号时双反引号 + 空格包裹（GFM 规则，与步骤 9 围栏自适应同哲学） |
| `a[href]` | `[…](href)`（href 收集时已绝对化；空/锚点已在序列化时解包） |
| `br` | `\` + 换行（GFM 硬换行；比两空格尾随式抗工具链剥空白） |
| `math` | `display="block"` → `$$源码$$`，否则 `$源码$`（源码读 annotation，收集时已保证存在） |
| `sub`/`sup`/`u`/`mark`/`kbd`/`samp`/`var` 等行内同族 | 原生 HTML 标签透传（GFM 允许行内 raw HTML；markdown 无对应语法，透传最保真）；`wbr` 例外 → 解包（零宽信号无输出） |
| 未知标签 | 解包（只递归子节点） |
| 文本节点 | 转义后照抄（见 5.3） |

### 5.3 转义策略（用户已确认）

文本节点对 `` \ ` * _ [ ] < $ ~ `` 一律反斜杠转义；`!` 仅在后随 `[` 时转义。

- **转义范围排除 code/math**：code span 内部文本与 math 源码**照抄不转义**——
  code span 内反斜杠/`$` 是字面字符（`C:\path` 转义成 `` `C:\\path` `` 可见损坏），
  math 源码 `\alpha` 同理不可翻倍；包含性由 code 反引号自适应（§5.2）与 math
  `$` 定界配对保证。
- **行首中断符转义**：处于输出行首的字符（run 值开头、文本节点 `\n` 之后、br
  硬换行之后）为 `#`/`>`/`-`/`+`/`=` 时直接转义，「数字 + `.`/`)` + 空白」时
  转义该定界符——防源码换行后随文本被解析为列表/setext 标题/引用/ATX 标题
  （§5.4 软折叠不覆盖这些块级中断构造）。

GFM 转义渲染透明。确定性通道内容千奇百怪（价格 `$`、代码名 `*`、阵列 `[i]`），
转义是廉价正确性；与 LLM 手写值（现状不转义）不一致是可接受代价——折叠 run
本就走确定性通道。

### 5.4 边界与兜底

- **强调边界退化**：`**…**` 内容首/尾为空白或 `*`/`_` 时 GFM 强调不闭合 →
  该节点退化为原生 HTML 标签透传（`<strong>…</strong>`），保真优先。
- **转换异常兜底**：run 转换抛错不崩 CLI——退回 jsdom `textContent` 纯文本
  替换 + stderr warning，对应 k 照常出值（退出码不受影响）。
- **嵌套**：a 嵌强调/代码由递归天然支持（`[**bold**](url)`）；strong 嵌 br
  按映射各自输出（GFM 强调跨硬换行合法）。
- 转义后文本不会误触图片下载扫描（`![` 已被 `!` 转义拆开）。

### 5.5 步骤 9 确认无改动

`p` 值透传（换行/硬换行原样落盘）；`h4-h6`/`blockquote` 规范化重建剥 `#`/`>`
前缀时 converter 输出不以这些字符开头，无碰撞；`code` 围栏自适应逻辑只作用于
code 条目对象，与本设计无交集。

## 6. 文档同步

- **SKILL.md**：步骤 2 折叠单位描述（「单个文本节点」→「极大纯行内 run 或散文本
  节点」）、步骤 8 增 runs 转换、产物描述（`2_long_text.json` 两段）。
- **references/analyze_html_guide.md**（步骤 3 指南）：占位符语义更新——整段
  形态更常见；判读指引（段落体量/位置信号）不变。
- **references/markdown_skeleton_guide.md**（步骤 7 指南）：明确 run 编号引用后
  由步骤 8 确定性转换——LLM 写 `{"p": "{{LONG_TEXT_k}}"}` 即可、**不要**试图
  还原 run 内行内格式；未折叠内容（含无源 math 的 run、短文本）的行内格式照旧
  手写。
- **CLAUDE.md** 管线段同步。

## 7. 测试策略

- **单测**（`node --test`，无浏览器）：`inline2md` 逐元素映射、嵌套组合、转义
  （含 code/math 排除、行首中断符）、code 反引号自适应、math `$$`/`$`、br 硬换行、
  未知标签解包、强调边界退化、a 无 href 解包；两段 schema 读写。
- **集成**（真 chromium + 夹具）：夹具页覆盖——长段落混排 strong/em/code/a/br/
  KaTeX math（annotation）、span 样式驱动加粗归一（inline style 与 class 两种
  驱动）、无源 math 阻断折叠、表格/pre 内不 run 折叠、混合容器散文本照旧折叠、
  display math 输出 `$$…$$`；孪生守卫断言（clean ⊆ styled）；步骤 8→9 端到端
  断言 `9_markdown.md` 行内语法正确。
- **golden 重生**：working/ 产物有状态，收尾前用最终代码全量重跑。

## 8. 文件清单

| 动作 | 文件 | 内容 |
|---|---|---|
| 改 | `script/lib/page-clean-snapshot.js` | 共享段 run 检测 + 规范化序列化；`foldLongText` 改造为 run+散文本统一 walk |
| 改 | `script/clean_snapshot.mjs` | 组合注入 page-latex.js；写两段 JSON；emit 拆计数 |
| 新 | `script/lib/inline2md.mjs` | `inlineRunToMarkdown(html)` 转换器 |
| 改 | `script/screenshot_trans.mjs` | runs 转换 + 合并解析表；emit 增 `runsResolved` |
| 改 | SKILL.md / 两 references / CLAUDE.md | §6 文档同步 |
| 新/改 | `test/unit/inline2md.test.mjs`、集成测试、夹具页 | §7 场景 |

## 9. 边界与风险

- **run 元素为 span 被 K10 拆包**：两趟折叠粒度差异（§3.4），位置包含关系预期
  保持，由孪生守卫测试裁决；若测试暴露反例，收紧手段是记录集折叠在 clean 趟
  排在 K10 之前执行（实现期决策，不扩设计面）。
- **JSON 体积**：runs 段 HTML 比 texts 段大——属性已剥净、仅语义标签，实测
  在夹具与冒烟页观察；失控则收紧序列化（同族标签映射到更短形态）。
- **空白保真**：p 内源码缩进/换行原样保留，markdown 渲染按软换行折叠为空格
  ——与浏览器对行内流空白的处理一致，可接受；行首中断构造已由 §5.3 转义中和，
  源码换行不会改变块结构。
- **computed style 成本**：span 归一仅对检测通过的 run 内元素执行
  （候选先过纯性判定），量级受 run 数量约束。
