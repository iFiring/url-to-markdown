# 步骤 6 文章视图分块 + 步骤 7 并行子代理 + 步骤 8 分片合并设计

- 日期：2026-09-09
- 状态：已与用户确认设计（分节呈现、逐节批准；用户两处关键细化：上下文构成 =
  文章开头 3 块 + 双向局部窗口、尾块不足 5 个段落块时并入前块）
- 前例：`docs/superpowers/specs/2026-09-02-table-placeholder-design.md`、
  `2026-09-02-code-block-placeholder-design.md`——延续「浏览器侧结构化收集 +
  Node 侧序列化」分工；stale marker 清理沿用 iframe 重定向设计
  （`2026-09-07-iframe-redirect-design.md`）的先例

## 1. 背景与动机

步骤 6 产物 `6_article.html` 是步骤 7 LLM 子代理的唯一输入。真实长文产物可达
239.5KB（SMOKE 记录）、372KB（微信案例
`working/mp.weixin.qq.com_s_lspwTyzxUnpbw1eHIoqluw/6_article.html`，509 个段落块），
超出子代理可完整读取/解析的规模——超大文件是步骤 7 的硬瓶颈。

设计：产物超过阈值时**物理分割**为多个完整 html 分块，步骤 7 按块**并行派发
子代理**各产骨架分片，步骤 8 入口**检测并合并**分片后走现有还原逻辑。

分割原子 = **段落块**（`<body>` 直接子元素）——它是步骤 7 指南的核心契约单位，
永不撕开。由此三个关键性质天然成立：

1. trans2img 截图边界链定义在段落块子树内 → **链永不跨块**；
2. `{{TABLE_k}}`/`{{CODE_k}}` 分派以段落块为单位 → 分派决策不跨块；
3. LONG_TEXT 编号全文档唯一且分块按文档序分区独占 → 每块局部「恰引用一次」
   ⇒ 合并后全局恰好一次，**结构性保证、无需运行时校验**。

## 2. 设计决策总览（均已与用户确认）

| # | 决策 | 内容 |
|---|---|---|
| 1 | 触发 | `6_article.html` 总字节 > 80KB 才分割；否则单文件照旧 |
| 2 | 块上限 | 每块 own + 开头/上文上下文 ≤ 50KB；下文侧豁免预算（自身 ≤ chunkMax/5，最坏 ≈60KB）。例外：单个段落块自身 >50KB 独立成块、允许溢出；尾块合并（#6）允许溢出至 80KB——贪心封边处恒有「前块 + 尾块首块 > 50KB」，50KB 守护会让尾块合并条件永假（死代码），故守护用 `splitThreshold` |
| 3 | 命名 | `6_article_chunk_X_of_N.html` / `7_skeleton_chunk_X_of_N.json`（X 从 1 起） |
| 4 | 原产物 | `6_article.html` 始终写盘（调试/smoke 对照） |
| 5 | 上下文 | 第 2 块起每块携带：📌开头上下文（body 前 3 块，标题/导语锚点）+ ⚠️上文（上一块尾部 ≤2 块）+ ⚠️下文（下一块开头 ≤2 块，最后一块无） |
| 6 | 尾块下限 | 最后一块段落块数 <5 时并入前一块（80KB 守护，见 §3.3） |
| 7 | 合并位置 | 步骤 8 入口（方案一）：glob 分片 → 校验 → 内存 concat，下游零改动 |
| 8 | 派发 | SKILL.md 由步骤 6 emit 的 `chunks` 字段驱动；split=true 时按文件并行派发，无并行上限 |

## 3. 步骤 6 分割器（extract_article.mjs）

### 3.1 触发与参数

- 触发：`6_article.html`（slimHtml 全串）UTF-8 字节 > `U2M_ARTICLE_SPLIT_THRESHOLD`
  （默认 81920 = 80KB，字节单位，测试可覆盖调低）
- 块上限 `U2M_ARTICLE_CHUNK_MAX`（默认 51200 = 50KB）
- 派生参数：上下文每侧字节帽 = `chunkMax / 5`（默认 10240）；尾块合并守护 =
  `splitThreshold`（联动 env 覆盖）
- ≤ 阈值时不分割：只写 `6_article.html`，emit `chunks.split=false`

### 3.2 收集与序列化

slim pass 之后、关浏览器之前，同页再 evaluate 一次（与 `6_article.html` 同一
DOM、同一序列化器——每块 markup 与原产物逐字节一致）：

- `document.head.outerHTML`、`<html>` 属性（lang）、`<body>` 属性（style）
- `[...document.body.children].map(el => el.outerHTML)`（段落块序列）

Node 侧装箱/组装为纯函数模块 `script/lib/chunk-article.mjs`（输入收集结果与
参数，输出 `{split, chunks: [{x, n, html}]}`）——纯函数直接单测，不起浏览器。
每块组装为完整独立 html：

```
<!DOCTYPE html>\n<html lang="…"><head>…</head><body style="…">
[注释与段落块，见 §3.5]
</body></html>
```

### 3.3 装箱算法（顺序确定、无迭代收敛）

1. **贪心装箱**：按文档序累加段落块字节，加入下一块会超 `chunkMax` 即封块。
   单个段落块自身 > `chunkMax` 时独立成块（溢出例外）；该块与前后块的边界
   由贪心自然形成（前一块在它之前封块，它之后从下一块重新起块）。
2. **尾块合并**（循环，每轮重查）：最后一块段落块数 <5 且（前块 own +
   尾块 own）≤ `splitThreshold` → 并入前一块；守护不过则保留小块（5 个
   巨段落块的尾部可达 200KB+，无守护会合并出比不分割更糟的巨块）。循环
   必要——前块本身可能 <5 块（巨块独立成块后紧跟小尾块的形态），合并后
   仍 <5 时继续向前并。
   - **N=1 回退**：合并循环后仅剩 1 块 → 视为未分割（不写 chunk 文件、走
     §3.6 不分割清理、emit `split=false`）——own 合计 ≤80KB 而文件略超
     80KB 的薄片边界会走到这里，等效于「触发判定被尾块下限否决」，接受；
     env 覆盖出 `splitThreshold < chunkMax` 时也可达，属防御分支。
3. **上下文配置**（对最终分区逐块执行，见 §3.4）。

### 3.4 上下文窗口

第 2..N 块每块配三处上下文，全部**按文档序复制**段落块原文（引用共享，字节
计入本块文件）：

| 侧 | 选取 | 上限个数 | 字节帽 |
|---|---|---|---|
| 📌 开头 | body 前 min(3, 第 1 块段落块数) 个的前缀 | 3 | chunkMax/5 |
| ⚠️ 上文 | 从上一块末尾向前逐块 | 2 | chunkMax/5 |
| ⚠️ 下文 | 从下一块开头向后逐块（最后一块无此侧） | 2 | chunkMax/5 |

- **字节帽规则**（每侧独立）：从边缘逐块尝试，(已取累计 + 候选块) ≤ 帽 才取，
  否则停——每侧各可能 0/1/2（开头 0-3）个。上一块是单个巨块时上文侧自然取 0，
  避免把巨块复制进上下文。
- **去重**：上文侧选取时跳过已在开头上下文集内的段落块（第 1 块很短时二者
  重叠）；下文侧与开头侧不可能重叠（分属不同块）。开头侧取 `min(3, 块1块数)`
  本身就是防自指守护——绝不取到块 2 起的待转换内容。
- **超限削减（下文豁免）**：触发条件 =（文件总字节 − 下文侧字节）>
  `chunkMax`——下文侧不计入块预算。数学依据：贪心封边处恒有 own(i) + b₀ >
  `chunkMax`（b₀ = 下一块首块 = 下文侧首候选），下文若计入预算则任何非末块
  恒触发削减、下文恒被清空（结构性死代码，2026-09-09 计划期推演发现、用户
  裁定豁免）；豁免后下文侧仍受自身字节帽约束，块大小 ≤ chunkMax + chunkMax/5。
  削减顺序：**上文整侧 → 开头整侧 → 下文整侧**，直到触发条件不成立或上下文
  全空（own 自身超限的巨块/尾块合并块自然删光全部上下文，文件 = own + 头）。
- 第 1 块（N>1）只有下文侧，无开头/上文（它自己就是文章开头）；无任何一侧
  需要配的块不产生对应注释。

### 3.5 标记注释与文件结构

第 X 块（2 ≤ X ≤ N−1）完整结构（K 为动态数量；文案实现照抄，一句话中英双语）：

```html
<body style="…">
<!-- 📌 开头上下文（勿转换）/ OPENING CONTEXT (do NOT convert): 以下 K 个段落块是文章开头的标题/导语，仅供建立标题层级与字号基准。勿为它们产出条目；其中出现的 LONG_TEXT/TABLE/CODE 编号一律勿引用（由第 1 块负责）。 -->
[开头段落块 ×K]
<!-- ⚠️ 上文上下文（勿转换）/ PRECEDING CONTEXT (do NOT convert): 以下 K 个段落块紧邻本块待转换内容之前，仅供衔接语境（标题层级/列表延续/字号基准）。勿为它们产出条目；其中的编号一律勿引用（由上一块负责）。 -->
[上文段落块 ×K]
<!-- ✅ 待转换内容自此开始 / Convert ONLY the content below this marker -->
[本块自己的段落块]
<!-- ❌ 待转换内容自此结束 / Convertible content ENDS here（下方为下文上下文，勿转换） -->
<!-- ⚠️ 下文上下文（勿转换）/ FOLLOWING CONTEXT (do NOT convert): 以上 K 个段落块紧邻本块待转换内容之后，仅供衔接语境。勿为它们产出条目；其中的编号一律勿引用（由下一块负责）。 -->
[下文段落块 ×K]
</body>
```

- 第 1 块：无 📌/⚠️上文/✅，body 直接以 own 开始；尾部有 ❌ + ⚠️下文（有下文时）
- 最后一块：无 ❌/⚠️下文，以 own 收尾
- 注释省略规则：某侧削减/帽取后为 0 块 → 该侧注释整体省略；✅ 出现当且仅当
  own 之前有任一上下文侧存在；❌ 出现当且仅当下文侧存在
- 每侧注释中的 K 写实际块数

### 3.6 stale 清理

步骤 6 成功写产物后：

- **删全部旧骨架产物**：`7_skeleton.json` 与 `7_skeleton_chunk_*.json`——
  6 重写后旧骨架必然失效（现状本就存在重跑 6 后旧 `7_skeleton.json` 被 8 消费
  的 staleness，顺手根治）
- 不分割时：删旧 `6_article_chunk_*.html`
- 分割时：写 1..N 覆盖，另删 X > N 的多余旧 chunk 文件

配合步骤 8 的优先级规则（§5），两种模式的骨架并存误选不可能发生。

### 3.7 emit 契约（加法式，现有字段不动）

```json
{
  "status": "ok",
  "article": "/…/6_article.html",
  "elementCount": 509,
  "slim": {…},
  "chunks": {
    "split": true,
    "count": 8,
    "files": ["/…/6_article_chunk_1_of_8.html", "…"]
  }
}
```

`split=false` 时 `count: 1, files: [article]`——恒定形状，SKILL.md 决策表无歧义。

## 4. SKILL.md 与指南改动

### 4.1 SKILL.md

- **步骤 6 决策表** `ok` 行增分支：
  - `chunks.split=false` → 步骤 7 照旧：单子代理读 `6_article.html`、写
    `7_skeleton.json`
  - `chunks.split=true` → 步骤 7 按 `chunks.files` **单条消息并行派发 count 个
    子代理**；子代理 X 的提示词写明：完整读取 `6_article_chunk_X_of_N.html`、
    一次性写入 `7_skeleton_chunk_X_of_N.json`（其余约束与现状相同：只可用
    Read/Write/Edit、严格按手册、不写总结报告）
- **步骤 7 完成判定**：count 个分片文件全部存在才进步骤 8；个别分片失败/
  缺失 → 重派该分片一次，仍失败反馈用户终止
- 步骤 8 产物描述不变（`8_resolved_skeleton.json` 仍是唯一合并产物）
- 不设并行上限：真实文章约 8 块；虚拟列表门已挡住无限长页

### 4.2 指南 references/markdown_skeleton_guide.md

- **路径参数化**：开头「读取 HTML」与「输出要求」改为「以任务指定为准
  （未分割 = `6_article.html`/`7_skeleton.json`；分割 =
  `6_article_chunk_X_of_N.html`/`7_skeleton_chunk_X_of_N.json`）」
- **新增「上下文区域」判定节**（指南唯一新判定规则）：body 内出现 📌/⚠️
  标记注释时，标记之间的段落块是上下文——**不产条目、不引用其中的
  LONG_TEXT/TABLE/CODE 编号**；只转换 ✅ 与 ❌ 之间（无任何标记时转换全部）。
  与 chrome 豁免同款定位：上下文段落块不算「不重不漏」的漏
- **「恰引用一次」表述**：「每个编号在整个骨架中恰引用一次」改为「每个编号
  **全局唯一**，恰引用一次」——编号全文档唯一、分块不产生重复，无需作用域
  限定（「trans2img 子树内除外」括注不变）
- 标题定级节**不改**——上下文段落块本身在 DOM 内携带字号/层级信息，子代理
  自然可见，无需提示

## 5. 步骤 8 合并入口（screenshot_trans.mjs）

在读骨架处（现 `7_skeleton.json` 直读）替换为：

```
7_skeleton.json 存在？
  ├─ 是 → 照旧直读（防御优先级：升级前跑了一半的目录）
  └─ 否 → readdir 过滤 ^7_skeleton_chunk_(\d+)_of_(\d+)\.json$
        ├─ 无匹配 → error「找不到 7_skeleton.json 也找不到分片，请先运行步骤 7」
        └─ 有匹配 → 校验（任一失败 error，exit 1，文案列明细节）：
             ① 各文件名 N 一致（不一致列出冲突文件）
             ② X 恰为 1..N（缺号列出缺失清单）
             ③ 每个文件 JSON.parse 为数组（失败指明文件与原因）
           → 按 X 升序 concat 为 skeleton 数组，emit 增 chunksMerged: N
```

- 合并后数组进入现有 LONG_TEXT → TABLE → CODE 还原、图片下载、trans2img
  keepIds/截图/择优——**下游一行不改**（它们只消费数组）
- 未定义 LONG_TEXT 编号检测本就在合并后的数组上全局执行，语义不变

## 6. 错误处理

| 场景 | 处置 |
|---|---|
| 单个分片子代理失败/写坏 | SKILL.md：重派该分片一次；仍失败反馈用户终止 |
| 分片缺失 / N 不一致 / 坏 JSON | 步骤 8 入口校验 error（exit 1），文案列明缺失号或坏文件 |
| 重跑步骤 6 后的 stale 骨架 | §3.6 清理根治；步骤 8 优先级规则兜底 |
| 两种模式骨架并存 | 不可能（§3.6 清理 + 写入时序）；防御优先级 = `7_skeleton.json` 优先 |
| LONG_TEXT 跨块恰一次 | 编号唯一 + 分区独占，结构性保证（§1） |

## 7. 测试计划

- **纯函数单测**（`lib/chunk-article.mjs`，不起浏览器）：
  - ≤阈值不分割（split=false、无 chunk 文件）
  - 贪心装箱每块 ≤ chunkMax；单个巨块独立成块且溢出豁免
  - 尾块合并：<5 块并入；80KB 守护不过则保留
  - 上下文：三侧数量/字节帽/去重/超限削减顺序（下文→上文→开头）
  - 标记注释：省略规则（✅/❌/各侧注释的条件出现）、K 动态数量、中英文案
  - 第 1 块与最后一块的特殊结构
- **CLI 单测**（沿用现有 extract-article / screenshot-trans 测试的 fixture
  与 runScript 模式，`U2M_ARTICLE_SPLIT_THRESHOLD`/`U2M_ARTICLE_CHUNK_MAX`
  调低触发）：
  - extract_article：分割落盘文件可被独立解析（完整 html/head/body）、emit
    `chunks` 契约、stale 清理（预置旧 `7_skeleton.json`/旧 chunk → 清）
  - screenshot_trans：按 X 序 concat、缺片/N 不一致/坏 JSON 各自 error 文案、
    `7_skeleton.json` 存在时优先、emit `chunksMerged`
- **集成**：阈值调低跑 6→8→9 全链（fixture 含 img、无 trans 的路径）
- **SMOKE**：真实重跑微信参考案例（372KB → ~8 块），手动核验分块结构与
  最终 markdown 与不分块基线一致性

## 8. 文档同步与已知边界

- 同步：CLAUDE.md（步骤 6/7/8 描述、产物清单、环境变量）、README（进度表）、
  SKILL.md、指南
- 已知边界（接受，不处理）：
  - 无 h 标签的语义标题（纯 div+字号定级）不在开头上下文的锚点覆盖内——
    上文窗口的字号/层级信号部分缓解
  - 跨块的连续列表会输出为两个列表条目（两块各转各的）——markdown 渲染语义
    等价，接受
  - 段落块数 <5 且无法合并（守护不过）时仍会有小块——可读性优先于派发开销
