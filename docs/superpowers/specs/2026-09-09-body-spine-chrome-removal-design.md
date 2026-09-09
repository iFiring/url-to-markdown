# 步骤 2 边界 chrome 清除与折叠设计（脊柱占优删除 + 链限制折叠）

日期：2026-09-09
状态：待审阅
探针：`.temp/probe-clean-compress.mjs` / `.temp/probe-body-ratio.mjs`（throwaway，不入库）

## 1. 背景与动机

`2_clean_snapshot.html` 的唯一消费者是步骤 3（LLM 识别关键 ID）；步骤 4-9 全走带样式版。
对微信长文样本的区域切分显示：文章正文占 ~59%，**正文后的 chrome（弹窗群、底部栏、
留言 UI、二维码区、a11y span）占 ~38%**。这些内容步骤 3 永远不该选、步骤 4 迟早整枝
删除，却全额消耗步骤 3 的 token 并制造误选噪声。

六站点量化探查（微信 / OpenAI docs / mmh1 重定向内容页 / 极客时间 / 知乎）验证了一组
**站点无关**的结构性信号可以把 chrome 从两版（或清洗版）中移除/折叠，同时实证否决了
两类直觉方案：

- **全 DOM computed-hidden 检测不可做**：OpenAI docs 的深处隐藏节点里 10K+ 字节是真实
  正文（非激活 tab 面板 "For GPT-5.6 and later…" p:5、"JavaScript/Python" 代码 tab 组，
  d≥10）——隐藏 ≠ chrome，收起内容（FAQ/手风琴/tab）是管线的既定保护对象（步骤 5 前置
  隐藏声明剥离会把它们展开进文章）。
- **裸 position:fixed 规则不可做**：曾观测到 iframe 包装页把全文装在 fixed 容器里
  （19K = 清洗版 91.9%）。该场景已由步骤 1 重定向门在管线入口拦截（用户裁定：实际不会
  存在这种内嵌 iframe 的情况），但内容守卫仍作为第二道闸保留——非 iframe 的 SPA 用
  fixed 容器钉住 app shell 的形态理论上独立存在。

## 2. 用户裁定记录（2026-09-09）

| # | 裁定 |
|---|---|
| R1 | 方案必须通用，不吃站点 class 名；只用结构/语义/computed 信号 |
| R2 | 不做全 DOM hidden 检测——有些正文是隐藏的（收起内容必须保活） |
| R3 | hidden 检测限于 body 边界脚手架区：body 直接子元素逐个查 + 沿无兄弟独子链下探，`body>div>section[hidden]>div+header` 检测到 section 为止 |
| R4 | body 直下层豁免兄弟检查（浮层天然与 app root 并排——微信 body 63 个子元素实证）；「无兄弟」只约束下探 |
| R5 | 对 body 子元素做文本量排序占优比较：与最大者相差 ≥95%（ratio ≤5%）且 fixed/absolute/sticky 定位或带弹窗词汇 → **直接删除**（两趟共享段，带样式版同步瘦身） |
| R6 | 脊柱下探停止条件：占优子元素 p≥5 或匹配 main/article/[role=main] → 本层扫完不再进入（内容内部永不扫描） |
| R7 | 弹窗词汇表去掉 `overlay`（内容区图片浮层常用词，误删风险最高；实测无任何 kill 依赖它单独触发） |
| R8 | 删除/折叠双轨制：D1 用删除（R5 原话「直接删除掉」）；H 系用折叠（壳保留、带样式版保活、可恢复） |
| R9 | **每层文本量排名第 1 的子元素永远不进入判定范围**（并列第 1 一并排除；堵死全零文本页面 ratio 退化 0/0 的洞） |
| R10 | 内容守卫保留（p≤2 ∧ 无 main/article ∧ 无 pre/table 才可删/折）——六样本零触发的纯保险丝 |
| R11 | display 判定用共享段 getComputedStyle，不用 juice（juice 级联有 var()/@layer 已记录缺口，步骤 5 自身都需 page-resolve-computed 回浏览器兜底） |

## 3. 目标 / 非目标

**目标**

- 步骤 3 输入瘦身：微信 ≈26%、OpenAI ≈27%、知乎 ≈10%（净省字节，含折叠与删除）
- chrome 误选风险下降：弹窗群/底部栏不再以完整形态出现在步骤 3 视野
- 带样式版同步受益于 D1 删除：步骤 4 输入变小、步骤 8 遮挡扫描的遮挡者变少
- 全部规则站点无关，六样本零误杀/零误折正文

**非目标（明确不做，各有裁定或实证依据）**

- button/[role=button] 折叠或删除——2026-08-25 既有决策（FAQ 折叠头/CTA/卡片按钮是
  内容载体），本轮数据再实证：OpenAI tab 标签按钮、mmh1 交互模块按钮均为内容信号
- `<header>/<aside>` 删除——规则 7 注释既有决策（hero 含主标题、章节 header+aside
  交替是正文结构）；body 直下 landmark 收益实测仅 OpenAI 543B
- aria-hidden 折叠——实测增量趋零（svg 已被 K3 清空）
- 全 DOM computed-hidden 折叠——§1 实证否决（R2）
- 输入框/`<dialog>` 标签/nav/footer/form——共享段规则 5/7 **已删**，非新增

## 4. 规则 D1：脊柱占优比较删除（两趟共享段，删除）

### 4.1 时机

共享段结构删除序列中，规则 7（控件/模态删除）之后、规则 8（空元素级联）之前——
文本量在噪声删除后的树上测量；D1 删除留下的空壳包装由规则 8 级联清除。新增编号 7.5。

### 4.2 算法

```
scanLevel(root, depth):
  kids = root 的元素子元素
  对每个 kid 计算 textLen = textContent 空白折叠后的长度
  max = 最大 textLen
  if max === 0: 停止（无占优信号，全零文本页面退化保护，R9）
  dominant = textLen === max 的 kids（并列全取，R9：它们恒不入候选）
  对每个非 dominant 的 kid：
    ratio = textLen / max
    if ratio ≤ 0.05
       ∧ (computed position ∈ {fixed, absolute, sticky} ∨ 弹窗词汇命中)
       ∧ 内容守卫通过（§8）
      → kid.remove()，chromeRemoved++，U2M_DEBUG 记录明细
  if depth ≥ 20: 停止（硬上限，防病态链）
  取 dominant 中第一个元素 d：
    if d 匹配 main/article/[role=main] ∨ d.querySelectorAll('p').length ≥ 5
      → 停止（R6：不进入内容根内部）
    else scanLevel(d, depth + 1)
scanLevel(document.body, 0)
```

### 4.3 弹窗词汇（R7）

- 词面：`/modal|dialog|popup|pop-?up|popover|drawer|lightbox|toast|snackbar/i`
  匹配候选元素自身的 class + id
- 结构：候选子树内含 `[role="dialog"]`/`[role="alertdialog"]`/`[aria-modal="true"]`
  （`<dialog>` 标签已被规则 7 删除，不参与）
- **不含 `overlay`**（R7 裁定）

### 4.4 实测证据（五有效样本，零误杀）

| 样本 | 删除节点 | clean 净省 | 代表性 kill | 关键存活（余量证据） |
|---|---|---|---|---|
| 微信 67K | 24 | 16.4K (24.5%) | body 层弹窗群 ×20（ratio ≤0.42%）、深层赞赏弹窗包装 content_bottom_area 4.8K、字号面板、QR(fixed)、toast | 正文链每层 100%；评论区(0.09%,static 无词汇)正确存活留给步骤 3 |
| OpenAI 41K | 7 | 3.1K (7.4%) | 公告条(absolute)、fixed header、搜索浮层、Ask AI widget、侧栏子导航 | **「Primary navigation」ratio=26% 逃脱**——文本量大的 chrome 归 H1-C（hidden）接住，两规则互补 |
| 知乎 45K | 2 | 2.0K (4.4%) | LoadingBar、顶栏(fixed)——都在 `body>div#3>div#4` 层，**纯 body 直下口径一无所获，下探必要** | 登录横幅(d=4 独子链 fixed，非脊柱路径)归 H3' |
| 极客 30K | 6 | 0.13K | svg 精灵、消息容器、author-modal(fixed+词汇)、工具栏(absolute) | 多数已被规则 5/7 删过，增量小 |
| mmh1 17K | 1 | 0B | sticky 目录 nav（规则 5 已删，D1 补刀无害） | **负控制通过**：article 100% 恒活，正文零触碰 |

阈值余量：全部 kill ≤2.73%，存活内容兄弟最低 12.65%——5% 阈值两侧有断崖。

## 5. 规则 H1-C：链限制 computed-hidden 折叠（仅清洗趟，折叠）

### 5.1 候选区（R3/R4）

`depth === 1`（body 直接子元素，豁免兄弟检查）∪ 独子链节点（自 body 下每一步都是
独元素子，遇分叉即出链）。**不做全 DOM 检测**（R2）：正文流深处的隐藏内容（FAQ 收起
答案、非激活 tab）保持现状全额存活于清洗版。

### 5.2 判定与折叠

- **既有 K5 裸 `[hidden]` 全文档折叠不变**（既定政策：属性是作者显式隐藏意图，
  壳可引用、带样式版保活、FAQ 收起答案可经 paragraphIds 还原）；链限制（R2/R3）
  只约束本规则新增的 **computed** 检测
- hidden 判定：computed `display:none` ∨ `visibility:hidden`，**含祖先累积**
  （display:none 的后代 computed 值不回传 none，必须自 body 向下文档序单趟累积）
- 折到**最外层**命中节点为止（R3「检测到 section 为止」；嵌套命中随外层吞并）
- 内容守卫（§8）不通过 → 不折（链位上的隐藏重物保活，如 p≥5 的隐藏抽屉）
- 折叠机制完全复用 K5：壳保留（K2 白名单属性含 data-idx 可引用）、子树清空、
  token `{{HIDDEN_TAG|n_unit;构成}}`——语义与裸 `[hidden]` 折叠一致（页面上不可见、
  可能是收起内容、步骤 3 可标壳 ID 进 paragraphIds、还原走带样式版），步骤 3 无需
  区分两种来源
- 规模 n 取共享段占位前预计算的原文（`__u2mHiddenSize` 同款机制扩展到本折叠集，
  量占位符语法串会虚高）；构成 topTags 折叠时现算（数标签不数文本，不受占位影响）

### 5.3 带样式版行为

**不折叠**——css-hidden 子树在带样式版全额保活（同裸 `[hidden]` 现状），步骤 5 前置
隐藏声明剥离照旧展开、步骤 4 按壳 ID 保留整枝。还原链零改动。

### 5.4 已知边界

- `visibility:hidden` 子代 `visibility:visible` 覆写：随最外层折叠一并吞没（罕见形态，
  接受；display:none 无此语义）
- 判定视口 = 抓取视口（1280×3000）：与快照所见一致，响应式隐藏以抓取时刻为准

## 6. 规则 H2：dialog 语义折叠（仅清洗趟，折叠）

- 候选：`[role="dialog"]`/`[role="alertdialog"]`/`[aria-modal="true"]`，**任意深度**
  ——role 是站点自我声明的浮层语义，与 hidden/位置无关（管线的登录检测、步骤 8 遮挡
  处理已信任同一信号）
- 与 D1 的关系：脊柱层的 dialog 多已被 D1 删除（词汇/定位 + ratio）；H2 接住**偏离
  脊柱**的（非占优分支内部，如留言区里嵌的弹层）与 ratio 超标的文本量大的 dialog
- 内容守卫（§8）通过才折——整站包在 role=dialog 里的聊天应用型 SPA 被守卫保活
- 折叠机制同 K5，token `{{DIALOG_TAG|n_unit;构成}}`——**独立 token**：步骤 3 的动作
  指引与 HIDDEN_TAG 相反（HIDDEN 可能是收起正文、可标壳进 paragraphIds；DIALOG 是
  chrome、不选），SKILL.md 步骤 3 决策表同步增补
- 规模预计算同 §5.2

## 7. 规则 H3'：链上可见浮层折叠（仅清洗趟，折叠）

- 候选：(`depth === 1` ∨ 独子链) ∧ computed position ∈ {fixed, absolute, sticky} ∧
  **可见**（hidden 的归 H1-C，token 语义更准）
- 内容守卫（§8）通过才折
- 补 D1 的射界：D1 只沿文本量占优分支下探，**挂在非占优分支独子链上的可见浮层**
  （知乎登录横幅：d=4、chain=1、fixed、p:1、文本 147 字符）D1 够不到，H3' 接住
- token `{{OVERLAY_TAG|n_unit;构成}}`，步骤 3 指引同 DIALOG（chrome、不选）
- 正文内 sticky 标题/吸顶章节头天然免疫：它们在内容流深处、不在 body 直下也不在
  独子链上（链在内容根处早已分叉）

### 7.1 规则优先级（同一节点命中多规则时）

`DIALOG > HIDDEN > OVERLAY`——语义声明最强、状态次之、位置最弱。最外层优先：任一
祖先已折则后代不再独立判定（随外层吞并）。

## 8. 统一内容守卫（D1/H1-C/H2/H3' 共用，R10）

候选子树满足任一条 → **不删不折**：

- `querySelectorAll('p').length > 2`
- 自身或后代匹配 `main, article, [role="main"]`
- `querySelectorAll('pre').length > 0` ∨ `querySelectorAll('table').length > 0`

守卫在标志预计算时求值一次（共享段，LT 占位之前——用原始结构计数，不用占位符存在
性）。六样本上守卫对全部 chrome 候选零拦截（chrome 天然 p≤2），纯保险丝；对
mmh1-iframe 型毒节点（p:30、main:1、pre:1）三重拦截。

## 9. 架构落点

### 9.1 共享段（`page-clean-snapshot.js`，两趟一致执行）

1. **步骤 7.5 = D1**（§4）：删除在两趟确定性一致 → 两版同步瘦身，data-idx 集合同步
   收缩，孪生不变量（clean ids ⊆ styled ids）平凡保持
2. **注释剥离**：TreeWalker SHOW_COMMENT 删除全部注释节点，**pre/code 子树内除外**
   （代码样本可能含 HTML 注释）；顺带消除原生 `<!---->` 与步骤 6 分块上下文标记
   （HTML 注释形态）的潜在混淆。实测每页 0.5-0.7K
3. **chrome 标志预计算**（astro 解包之后、折叠统计预计算同位）：自 body 文档序单趟，
   对每个元素累积计算并挂 expando：
   - `__u2mHidAcc`：display:none ∨ visibility:hidden ∨ 父累积（R11：getComputedStyle，
     此时 `<style>` 仍活——clean 趟删样式在 K2 区域，晚于共享段）
   - `__u2mDepth` / `__u2mOnChain`：body 距离 / 独子链成员资格
   - `__u2mPos`：computed position
   - 折叠集判定（H1-C/H2/H3' 候选 ∧ 守卫 ∧ 优先级 §7.1 ∧ 最外层）→ 命中的最外层
     节点挂 `__u2mChromeFold = 'hidden'|'dialog'|'overlay'`，**并给其全部后代挂
     `__u2mInChromeFold = true`**（累积传播，供收集 skip O(1) 判定）
   - 折叠集节点同时预计算 `__u2mHiddenSize`（复用既有 expando 名与 sizeSuffix）

### 9.2 清洗趟（K5 扩展）

K5 现有 `[hidden]` 循环之后新增同构循环：消费 `__u2mChromeFold`，按值选 token
（hidden→`{{HIDDEN_TAG|…}}`、dialog→`{{DIALOG_TAG|…}}`、overlay→`{{OVERLAY_TAG|…}}`），
壳保留 + 子树清空 + 构成 topTags 机制逐字复用。K2 属性白名单先行不影响 expando
（先例：`__u2mHiddenSize` 跨 K2 存活至 K5）。

### 9.3 收集与 k 对齐（关键正确性约束）

**styled 侧收集（`page-collect-tables.js` / `page-collect-code.js`）与 clean 侧 K6/K7
的 skip 条件必须与折叠集同源**：现条件 `hasAttribute('hidden')` 扩展为
`hasAttribute('hidden') ∨ __u2mInChromeFold ∨ 自身在折叠集`。

理由：K6 表格折叠是**本地文档序计数**（非 K7 的 map 驱动）——若 styled 收集了某
dialog 内的表（占 k=5）而 clean 侧该表随 DIALOG_TAG 折叠消失，clean 的后续表从 k=5
起编 → **两版 k 错位，步骤 8 还原错表**。同源 skip 后：折叠集内的 table/pre 两版都
不入 k 编号、不入 `2_tables.json`/`2_code.json` 恢复清单（政策与既有「hidden 内容
不入恢复清单」一致）；带样式版中它们随子树保活为 live 表/live 代码块，若步骤 3
选中壳 ID，步骤 7 按失败 live 形态自转——现有路径，零新增。

D1 删除的 table/pre 同理天然不入收集（树上已不存在）。

### 9.4 长文本占位交互

- LT run 检测在共享段末尾（标志预计算之后）：run 守卫的 display:none 阻断逻辑不变；
  折叠集内的 run 照常入库（「FAQ hidden 块内 run 照折」既有政策——恢复清单服务于
  带样式版，带样式版折叠集内容保活）
- clean 趟 LT 占位在 K11 之后执行，晚于 K5 扩展 → 折叠集内的占位目标已随子树清空，
  walk 不可达自然跳过（既有「记录元素被 K5/K10/K11 删除或吞没则自然跳过」机制）
- 孪生守卫 clean LT ⊆ styled：clean 侧被折叠吞掉的占位只会更少，子集方向保持 ✓

### 9.5 emit 与调试

`clean_snapshot.mjs` emit 增 `chrome` 对象（恒定形状）：

```json
"chrome": {
  "removed": <D1 删除节点数>,
  "cssHiddenFolded": <n>, "dialogFolded": <n>, "overlayFolded": <n>,
  "commentsRemoved": <n>
}
```

既有 `hiddenCount` 语义不变（裸 `[hidden]`）。`U2M_DEBUG=1` 时 D1 逐条输出
kill 明细（层级路径、ratio、信号、守卫状态）到 stderr。stdout 单行 JSON 契约不变。

### 9.6 下游影响核对

- **步骤 3**：只见壳 token + 规模/构成；DIALOG/OVERLAY 指引「不选」，HIDDEN 指引
  不变（可标壳进 paragraphIds）
- **步骤 4**：删除/折叠的 ID 步骤 3 无从引用；壳 ID 可引用且带样式版子树完整 ✓
- **步骤 5**：带样式版隐藏子树照旧被前置剥离展开；D1 删除的 chrome 不再浪费 juice
- **步骤 8**：页 A（1_snapshot）不受步骤 2 影响，chrome 仍在——page-exclude-noncontent
  按 id 全集照旧隐藏它们；页 B live 重渲染同理。trans2img 签名按内容 ID 对位，
  chrome 存废不参与 ✓
- **步骤 6 分块**：`6_article.html` 来自 styled 路径，D1 删除使其略瘦，分块逻辑零改动

## 10. 已知漏网（接受的代价，全部实测量化）

| 漏网 | 规模 | 为何不追 |
|---|---|---|
| 微信评论区容器(4569)、AI 提示(4562) | ~2.1K | static 定位、无词汇、p≤2 但 ratio 0.09%——差一个信号；放宽任一条件都会伤及正文边缘形态，留给步骤 3（本就是它的语义职责） |
| 极客荧光笔工具栏/倍速菜单（d=15 深处 hidden） | ~2.6K | 在内容流深处的非链位 hidden——R2 红线（追它就要全 DOM 检测） |
| OpenAI main 内 sticky TOC | 381B | R6 停止条件的直接代价（不进入内容根） |
| 知乎深处按钮群（关注/写回答等） | ~7K | button 保留既有决策（非目标 §3） |

## 11. 测试计划

**单元（`test/unit/`，夹具 `test/fixtures/chrome-*.html`）**

- D1：脊柱 kill（fixed/absolute/sticky × 词汇两信号独立命中）；rank-1 排除（含并列、
  含全零文本 max=0 退化）；ratio 5% 边界；p≥5 / main 停止条件；守卫三条件各自拦截；
  删除后空壳由规则 8 级联清除；深度上限
- H1-C：body 直下 hidden（有兄弟）折叠；独子链 hidden 折叠；分叉后深处 hidden
  **不折**（R2 红线断言）；守卫拦截；最外层吞并嵌套
- H2：任意深度 dialog 折叠、守卫拦截、优先级（hidden dialog → DIALOG token）
- H3'：链上可见 fixed 折叠；hidden fixed 归 HIDDEN 不归 OVERLAY；非链 fixed 不折；
  正文内 sticky 标题不折
- 注释：普通注释删除、pre 内注释保留
- k 对齐：折叠集内含 table/pre 的夹具 → 两版 k 编号一致、恢复清单不含折叠集条目
- 孪生不变量：clean ids ⊆ styled ids、clean LT ⊆ styled LT

**集成（`test/integration/`）**：`clean_snapshot.mjs` 端到端跑夹具页，断言 emit
`chrome` 对象形状与计数、stdout 单行 JSON 契约。

**冒烟回归（手动，隔离协议）**：五真实样本的 `1_snapshot.html` 复制到
`U2M_WORKING_ROOT=$(mktemp -d)` 隔离目录（**不覆盖 working/ 现有产物**——auto-memory
告诫），重跑步骤 2 对照本 spec §4.4 数字；再跑步骤 3 对比 `3_key_ids.json` 与改动前
的选择质量（chrome ID 应消失、内容 ID 应不变）。

## 12. 文档更新点

- `SKILL.md` 步骤 3：DIALOG_TAG/OVERLAY_TAG 判读指引（chrome、不选）；HIDDEN_TAG
  说明补充「含 CSS 隐藏来源」
- `CLAUDE.md` 步骤 2 段：共享段新增 7.5/注释剥离/标志预计算，K5 扩展，收集 skip
  同源，emit `chrome` 对象
- `docs/design/url-to-markdown-design.md` §6 步骤 2 对应小节同步

## 13. 预期收益汇总

| 样本 | D1 删除 | H 系折叠+注释 | 合计净省 |
|---|---|---|---|
| 微信 67K | 16.4K | ~1.3K | ≈26% |
| OpenAI 41K | 3.1K | ~7.9K（26% 侧栏靠 H1-C） | ≈27% |
| 知乎 45K | 2.0K | ~2.4K | ≈10% |
| 极客 30K | 0.1K | ~0.7K | ≈3% |
| mmh1 17K | 0 | ~0 | 0（负控制） |

带样式版额外受益于 D1 删除（微信 −16K+），步骤 4/5/8 输入同步变瘦。
