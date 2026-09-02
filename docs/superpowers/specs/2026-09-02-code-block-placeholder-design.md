# 代码块占位符 + 预计算 Markdown 转换设计

- 日期：2026-09-02
- 状态：已与用户确认设计（分节呈现逐节批准）
- 取代：`.docs/2026-08-29-code-block-placeholder-design.md`（旧备忘的 textContent 提取路线
  已被浏览器探针否定——mmh1 形态零 `\n`，textContent 塌缩为 1 行；见 §1）
- 前例：`docs/superpowers/specs/2026-09-02-table-placeholder-design.md`（表格占位符，
  本设计逐环节镜像其管线形状）

## 1. 背景与动机

代码块目前完全靠步骤 7 LLM 逐字转录进 `7_skeleton.json` 的 `code` 条目。三类实证代价
（参考页：`working/developers.openai.com_api_docs_guides_prompt-caching/`、
`working/mmh1.top_article_prompt-cache.html/`）：

1. **转录失真（最恶劣）**：代码要求字节精确（缩进/引号/换行位置）。OpenAI 页
   `6_article.html` 的 pre 2874 实测：DOM 中 `  "model"` 两格缩进，LLM 骨架转录成
   顶格 `"model"`——缩进丢失，且下游无任何纠错机会。
2. **换行语义靠猜**：mmh1 形态（行容器为 `display:grid` 的 span、零 `\n` 文本节点）
   流到 `6_article.html` 时换行信息已全部丢失（步骤 5 剥样式 + 步骤 6 拆包后为一条
   长行），LLM 纯语义猜行。本次猜对了，但无保证。
3. **序号污染**：OpenAI 页 14 个代码块中 9 个带行号槽（`syntax-highlighter-line-numbers`
   列），`6_article.html` 里是 `1<!-- -->\n2<!-- -->\n…26{` 共 26 行纯序号文本污染——
   LLM 需语义清理（费 token 且可错）。

设计目标：与表格占位符同构——步骤 2 浏览器侧结构化提取 + Node 校验，正常则预计算
JSON 侧车、步骤 8 机械还原；异常则保 live 流到步骤 7 由 LLM 语义还原（步骤 5 已有
的 pre 子树剥样式分支覆盖失败路径）。

### 1.1 探针验证的形态学（4 个参考块，真实 chromium 实测）

| 参考块 | DOM 形态 | textContent | walkLines | 渲染可见 |
|---|---|---|---|---|
| OpenAI 2242/2409 | shiki：行 = computed `inline` 的 span + 真实 `\n` 文本节点 | 39/48 行 ✅ | 39/48 行（含 1 空行）✅ | ❌ 祖先 `expn-content hidden` 折叠，Range rects = 0 |
| mmh1 237/539 | `ra-code__line`（`display:grid`，`min-height:1.6em`）行容器，**零 `\n`** | 1 行 ❌ | 22/19 行 ✅ | ✅ rects 114/36，distinctTops 21/18 |
| OpenAI 2874 等 9 块 | shiki + `line-numbers` 槽（`user-select:none` 数字 span，float 左列） | 序号混入 ❌ | 槽排除后干净（层 1 设计预期，CSS/user-select/纯数字结构已核实，带排除的完整提取未跑探针） | `data-wrap-long-lines="true"`（软换行域） |

关键算法结论（walkLines 优于 `innerText`/textContent 的理由）：

- `innerText` 在 `display:none` 祖先下退化为 textContent（mmh1 形态塌回 1 行）；
  `getComputedStyle().display` 在隐藏子树下仍返回计算值（grid/block 照常检出）——
  **OpenAI 的折叠展开器内也能提取**。
- textContent 对 mmh1 形态给出错误的 1 行（现状 `countPreLines` 同病：max(换行切分,
  div 行块) 对 span 行容器双落空，clean 版行数元数据错误）。

## 2. 设计决策（已与用户确认）

1. **方案**：完整镜像表格占位符管线（浏览器侧结构化提取 + Node 校验 + 条件折叠 +
   失败回退步骤 7）。极简侧车（无校验）与步骤 6 提取（旧备忘）路线否决——前者无
   失败安全网，后者所需信号（computed display/class/style）彼时已剥净。
2. **修正后的失败判据**：mmh1 形态（块级行容器）判定为**成功**走预计算 JSON；
   「非一行但缺少换行符」在结构化提取下几乎不触发（视觉多行必有 DOM 信号：`\n`
   文本节点 / `<br>` / 非行内容器），真正失败只剩 §6 所列七类。
3. **步骤 7 引用形态**：字符串引用 `{"code": "{{CODE_k}}"}`（与 `{"table":
   "{{TABLE_k}}"}` 同构）；lang 以 `data-language` 属性收集值为最高优先级
   （`data-language` > `language-*` class > `guessCodeLang(content)` > `""`），
   步骤 8 物化 `{lang, content}` 对象时以 JSON 值为准。
4. **失败形态从严（fail-closed）**：宁可多失败（LLM 兜底成本有限）不可静默失真
   （下游无纠错机会）。新增 content_loss 往返校验与 mixed_signal_mismatch 校验。
5. **序号清除两层防线**：浏览器侧槽元素排除（user-select:none + 纯数字文本）+
   Node 侧行首算术序号剥离（保守条件，防误剥 yaml 数字键）。

## 3. 总览与数据流

```
步骤 2 clean_snapshot.mjs（styled 趟 evaluate 内）
  ├─ LONG_TEXT 占位（共享段，先行——现状不变）
  ├─ __u2mCollectTables()（现状不变）
  └─ __u2mCollectCode()（新）→ [{k, dataIdx, lang, text, lines,
        renderedLines, hasNonText, textContentNoGutter}]
Node 层
  ├─ convertTables()（现状不变）→ 2_tables.json
  └─ convertCodes()（新 lib/code2md.mjs）：
        content_loss 往返校验 → LONG_TEXT 预展开 → unresolved 校验
        → 行首序号剥离（层 2）→ empty 校验 → 渲染交叉校验（#5/#6）
        → \r 归一 + 修剪首尾空行 + 重算 n_lines
        → 2_code.json + logs/codes/{k}_{dataIdx}.log（失败）
styled 折叠 evaluate（在 __u2mFoldTables 之后）
  └─ __u2mFoldCode(resultByDataIdx)（新）：ok → {{CODE_k|n_lines}}；
        failed → 保 live + data-u2m-code="fail"
clean 趟（cfg 增 codeFold map）
  └─ K7 改 map 驱动：全部非 hidden pre 折叠为 {{CODE_k|n_lines}}
步骤 3/4/5/6：占位符是普通文本节点，随块流动（失败块走现有剥样式/拆包路径）
步骤 7：占位符块 → {"code": "{{CODE_k}}"}（剥后缀裸引用）；
        失败块 → LLM 自转 {lang, content}
步骤 8：CODE 还原（LONG_TEXT → TABLE 之后）：精确匹配引用 → {lang, content}
步骤 9：围栏构建（backtick 自适应）+ 残留 {{CODE_ 守卫
```

## 4. 占位符与 sidecar 契约

### 4.1 占位符语法

- `{{CODE_k|n_lines}}`——k = 文档序编号（1 起、跳过 `[hidden]` pre，与收集/fold
  一致，语法对齐 `{{TABLE_k|rows×cols}}`）。
- n_lines = Node 层修剪首尾空行后的行数（与 2_code.json `lines` 同源）。
- `{{PRE_CODE_TAG|n_lines}}` 全面退役（消费者仅 K7 与两指南，已 grep 确认）。
- fold 时 `data-language` 提升到 pre 元素（含 lang 来自 class 推断的场景——单一
  属性通道，`6_article.html` 可见，供步骤 3/7 参考）。
- ok 与 failed 在 **clean 版中同为占位符**（clean 无条件折叠，镜像 K6 对表的处理）；
  **styled 版**仅 ok 折叠、failed 保 live（镜像 foldTables）。步骤 3 无需区分。

### 4.2 `2_code.json`（类比 `2_tables.json`）

```json
{
  "3": {
    "dataIdx": "237",
    "lang": "tsx",
    "content": "…完整代码文本（LONG_TEXT 已预展开、序号已剥、\\r 归一、首尾空行已修剪）…",
    "status": "ok | failed",
    "reason": "失败原因（ok 时缺省）",
    "lines": 22,
    "gutterStripped": true,
    "numberStripped": false
  }
}
```

### 4.3 失败诊断日志

`<url-dir>/logs/codes/{k}_{dataIdx}.log`：reason + 收集元数据（lines/renderedLines）
+ outerHTML 截断片段（>2000 字节截断），镜像 `logs/tables/`。

### 4.4 emit 契约

- 步骤 2 增：`codes: {total, ok, failed}`、`codeJson: <path>`；日志行追加代码块计数。
- 步骤 8 增：`codesResolved: N`、`failedCodes: [k…]`（失败不阻断，镜像 failedTables）。
- stdout 单行 JSON 契约与 emit 延迟退出陷阱模式（`lib/contract.mjs`）不变。

## 5. 步骤 2 改动

### 5.1 收集（`script/lib/page-collect-code.js` 新共享脚本）

与 `__u2mCollectTables` 同场注入（clean_snapshot.mjs 把源码拼在
`__u2mCleanSnapshot` 前，styled 分支末尾调用）。时机：LONG_TEXT 占位已就位、任何
折叠之前；行容器检测需要 class/style/computed display 完整在场——这是必须放
styled 趟的原因。

对每个文档序、attached、非 `[hidden]` 的 `<pre>` 收集：

```
{ k, dataIdx, lang, text, lines, renderedLines, hasNonText, textContentNoGutter,
  blockContainers, gutterStripped, outerHTML }
```

- `blockContainers`：code 壳直接子元素中 computed display 非行内且非 `<br>` 的个数
  （行容器计数——`mixed_signal_mismatch` 校验输入）。
- `gutterStripped`：层 1 是否命中过槽排除。
- `outerHTML`：pre 原始序列化（折叠前，含占位符），失败诊断日志用（写入时截断）。

**walkLines 结构化行重建**：

- 维护行缓冲 `lines = [""]`；断行函数 `brk(force)`：`force` 或当前行非空才追加新行
  （软断行的去重语义）。
- 文本节点：按 `\n` 切分，每个切分点强制断行（`force=true`），片段追加到当前行。
- `<br>`：强制断行。
- 元素：`getComputedStyle(el).display` 匹配 `/^(inline|contents|ruby)/` 视为行内
  （覆盖 inline / inline-block / inline-flex / inline-grid / contents / ruby*），递归
  不断行；否则进入前/后各一次软断行。块间纯空白文本节点天然被吞（当前行已空时
  切分不产生额外空行）——与 CSS 渲染语义一致。
- **槽元素排除（层 1）**：元素命中 `getComputedStyle(el).userSelect === 'none'`
  **且** 子树 textContent 去空白后匹配 `/^[\d\s.,;:)|·•\-–—]*$/`（纯数字 + 分隔符）
  → 整棵子树跳过（零贡献、零断行）。双条件缺一不可：只有 user-select 会误杀
  复制保护的整块代码（整 pre 都 none）；只有数字条件会误杀纯数字代码行。
  排除同时记 `gutterStripped` 元数据。
- 内部空行保留（代码保真）；首尾空行由 Node 层修剪。

**lang 探测**：`code[data-language]` → `pre[data-language]` → code/pre 的 class 中
首个 `language-*` token → `""`（Node 层以 `guessCodeLang(content)` 兜底空值，
已存在且带测试 `test/unit/code-lang.test.mjs`）。

**renderedLines**（渲染交叉校验用，仅可见时有值）：
`Range.selectNodeContents(code).getClientRects()` 的 distinct top 数（按 computed
lineHeight 分桶 `Math.round(top / lineHeight)` 去重，容纳 token 微高差；lineHeight
非数值时按整数 px 取整）。rects 为空（隐藏祖先）→ `null`，交叉校验跳过、只信结构
信号。溢出滚动（`h-[30rem] overflow-auto`）不影响——rects 在布局空间不受滚动裁剪。
软换行（`pre-wrap`）只会增加 distinctTops，方向上不与任何校验冲突。

**hasNonText**：`pre.querySelector('img,svg,math,iframe,canvas,object,embed,video,audio,table')`
命中即 true。

**textContentNoGutter**：pre 子树 textContent 减去被层 1 排除的槽元素文本——
content_loss 往返校验的比较基准。

### 5.2 Node 层转换（`script/lib/code2md.mjs` 新模块）

```
convertCodes(codeList, { longTextMap, logsDir })
  → { codes, counts: { total, ok, failed } }
```

无引擎插拔（提取在浏览器侧完成，Node 只做展开/校验/序列化——与表格的 self/turndown
可插拔有意不同，YAGNI）。处理流水（顺序即校验序，与 §6.1 表编号一致）：

1. `non_textual` 校验：收集时 `hasNonText === true` → fail。
2. `content_loss` 校验：`stripWs(text) !== stripWs(textContentNoGutter)` → fail
   （`stripWs` = 移除全部空白字符）。捕获一切丢文本的提取 bug——最恶劣的静默失真类。
3. LONG_TEXT 预展开：`text` 中的 `{{LONG_TEXT_k|…}}` 按 longTextMap 替换（正则与
   `table2md.js` 的 `expandLongText` 同一实现，从该模块导出复用）。
4. `unresolved_long_text` 校验：预展开后仍匹配 `/\{\{LONG_TEXT_\d+/` → fail。
5. 层 2 行首序号剥离（详见 §6.2）。
6. `empty` 校验：剥离 + 修剪首尾空行后为空/纯空白 → fail。
7. 渲染交叉校验（renderedLines 非 null 才判）：`single_line_suspect` /
   `rendered_mismatch`（详见 §6.1；`text` 含 `{{LONG_TEXT_` 时跳过——纪元
   不可比，见 §6.1 补注）。
8. 序列化：`\r\n`/`\r` 归一为 `\n`；修剪首尾空行（内部空行保留）；重算 n_lines；
   存 raw content（**不存围栏**——围栏统一在步骤 9 构建）。
9. 失败落 `logs/codes/{k}_{dataIdx}.log`。

### 5.3 styled 折叠（`script/lib/page-fold-code.js` 新共享脚本）

镜像 `page-fold-tables.js`，在 `__u2mFoldTables` **之后**执行（同一或紧随的
evaluate；顺序保证：被成功折叠的表格吸收的 pre 已 detach，`!pre.parentNode` 守卫
自然跳过——且含 pre 的表本就会因嵌套块级内容判 failed 保 live，pre 照常折叠）：

- `status === 'ok'` → `data-language` 若可解析则提升到 pre → 清空子树 → 追加文本
  节点 `{{CODE_k|n_lines}}`（n_lines 取 2_code.json 修剪后行数）。
- failed → 保 live、打 `data-u2m-code="fail"`（诊断 + 步骤 7 信号；样式剥离由
  步骤 5 现有 `closest('pre')` 分支覆盖）。

### 5.4 clean 趟 K7 改造（map 驱动）

现状 K7 用 `countPreLines` 本地计数——对 mmh1 形态给出错误的 1 行；且 clean 趟
`<style>` 已删、computed display 退化为 UA 默认，无法本地重算 walkLines。改为：

- clean_snapshot.mjs 构造折叠映射 `codeFold: { dataIdx → {k, lines, lang} }`（来自
  收集结果，**含 failed 条目**——clean 无条件折叠全部非 hidden pre，镜像 K6），
  经 clean evaluate 的 cfg 传入。
- K7 按文档序遍历：`!parentNode` / `[hidden]` 跳过（现状守卫不变）；map 命中 →
  `{{CODE_k|n_lines}}` + data-language 提升；未命中（防御分支）→ 退回现行
  `{{PRE_CODE_TAG|n_lines}}` 局部计数，不占用 k 编号。
- map 恒命中论证：pre 在 clean K7 仍 attached ⟺ 收集时也 attached（两趟共享段后
  DOM 同构；clean K6 折叠会 detach 表内 pre，但收集发生在任何折叠前且 styled
  foldCode 对同批 pre 已处理；hidden pre 两侧一致由 K5 独占）。
- 附带收益：clean 版 mmh1 形态行数元数据从错误的 `1_lines` 修正为真实行数。

### 5.5 编排（`clean_snapshot.mjs`）

```
styled evaluate（注入 collectTables + collectCode）
  → Node: convertTables + convertCodes（写 2_tables.json / 2_code.json + logs/）
  → evaluate: foldTables → foldCode
  → 序列化 2_clean_style_snapshot.html（现有 '<!DOCTYPE html>\n' + outerHTML 形态）
clean evaluate（cfg 增 codeFold map）
emit 增: codes / codeJson
```

`__u2mPreLines` 共享段预计算保留（仅供防御分支）。`U2M_DEBUG` 增收集/折叠计数行。

## 6. 校验细则与序号清除（失败判据，fail-closed）

首个命中即 failed（reason 记录该判定）。原则：**宁可多失败（步骤 7 LLM 兜底，
成本有限）不可静默失真（下游无纠错机会）**。

### 6.1 七类失败判定

| # | reason | 精确条件 | 说明 |
|---|---|---|---|
| 1 | `non_textual` | 收集时 `hasNonText === true` | 围栏无法表达图示/嵌套表；步骤 7 分派（trans2img/table） |
| 2 | `content_loss` | `stripWs(text) !== stripWs(textContentNoGutter)` | 提取丢文本（缺 token 的代码是静默失真）；空白不敏感比较容忍断行/空白判断差异，`<br>` 两边均零贡献 |
| 3 | `unresolved_long_text` | 预展开后仍匹配 `{{LONG_TEXT_\d+` | map 缺号 = 管线状态损坏；失败路径有步骤 7 的 LONG_TEXT 链兜底 |
| 4 | `empty` | 层 2 剥离 + 修剪首尾空行后为空/纯空白 | 空 pre 留 live 给步骤 7 看结构；序号-only 伪代码块在此兜住 |
| 5 | `single_line_suspect` | `trimmedLines === 1 && distinctTops > 1`（renderedLines 非 null 才判） | 结构零信号但视觉多行——软换行真单行或提取器漏检；步骤 7 语义重排 |
| 6 | `rendered_mismatch` | `trimmedLines − interiorBlankCount > distinctTops`（renderedLines 非 null 才判） | 提取行数扣除「空行无矩形」合法豁免后仍超出渲染行数 = 断行系发明 |
| 7 | `mixed_signal_mismatch` | `\n` 文本节点数 > 0 **且** 块级行容器数 > 0，但 `\|newlineCount+1 − blockContainers\| > 1` | 两套行约定互相矛盾 = 提取不可信；±1 容差吸收尾随 `\n`。单信号形态（mmh1：`\n`=0；OpenAI：computed inline 容器=0）天然跳过 |

`rendered_mismatch` 的空行豁免推导（复核实证）：元素行容器站点（ra-code
`display:grid` + `min-height:1.6em`）空行有盒子 → 实测 trimmed == distinctTops
（21=21、18=18）；文本 `\n` 分隔站点完全空行无字形无行盒 → distinctTops 少计
interiorBlankCount。按「空行**可能**不渲染」取下界补偿，只会放松判定、不会误杀。
软换行只增不减视觉行，`distinctTops ≥ trimmedLines − interiorBlanks` 是合法域。

**LONG_TEXT 纪元豁免（2026-09-02 执行期补注）**：收集发生在 LONG_TEXT 折叠之后
（§5.1 时机），`renderedLines` 量的是**占位符形态**的渲染行数（占位符是单行文本
节点），而交叉校验的对象是**预展开后**的行数——两纪元不可比：占位符展开为多行
原文时会虚假触发 `rendered_mismatch`。当收集 `text` 含 `{{LONG_TEXT_` 字面占位符时
**跳过渲染交叉校验**（`single_line_suspect` 与 `rendered_mismatch` 同跳）——展开
引入的换行逐字来自原始 DOM 文本节点、非提取器发明（该校验的打击目标）；结构信号
（`content_loss` / `mixed_signal`）仍全量在场。与 renderedLines=null 的隐藏祖先
豁免同款 rationale：不可比的信号不判，只信可比的。

### 6.2 序号清除两层防线

**层 1（浏览器侧，槽元素排除）**：见 §5.1——`userSelect === 'none'` 且子树纯
数字+分隔符文本 → 整棵跳过。OpenAI 实测：`.syntax-highlighter-line-number` CSS
带 `user-select:none`，span 文本 `"1\n"` 命中；容器 `line-numbers` 本身不带
user-select，但其子逐个命中、float 容器在空行上软断行被抑制 → 整槽零贡献。
ra-code 的 `ra-code__line-no`（同为 user-select:none 数字列）同路径覆盖。

**层 2（Node 侧，行首算术序号剥离）**——兜无 user-select 的框架：

- 逐非空行匹配 `^\s*(\d{1,3})` + 至多一个分隔符（`[.:;)|·•\-–—]` 或空白）。
- 剥离仅在**全部满足**时执行（保守——反例：yaml `1: foo` 数字键序列）：
  1. 非空行中带行首整数 token 的行 ≥ 3 行；
  2. 这些整数构成公差 1 的连续序列（起始任意——OpenAI 摘录槽有从 26 起的形态）；
  3. **所有**非空行都参与序列（一个不匹配即整体放弃）；
  4. 剥离后剩余内容非退化（≥ 1 行含非数字内容）。
- 剥离量 = 数字 + 至多一个分隔符 + 紧随的水平空白（不吞代码自身缩进）。
- 记 `numberStripped` 元数据。

### 6.3 成功路径完整变换

walkLines 原始行 → 层 1 槽排除（收集时）→ content_loss 校验 → LONG_TEXT 预展开
→ 层 2 序号剥离 → 修剪首尾空行 + `\r` 归一 → n_lines = trimmedLines →
`{{CODE_k|n_lines}}` 与 2_code.json `lines` 同源。

**参考站判定预测（验收基准）**：OpenAI 14 块全 ok（9 块 `gutterStripped`、
`  "model"` 缩进在产物保留——现状 LLM 转录已丢缩进，确定性修复实证）；mmh1
237/539 ok（grid 行容器 + 渲染交叉校验通过：trimmed 21/18 == distinctTops 21/18）。

## 7. 步骤 8 改动（`screenshot_trans.mjs`）

在现有 LONG_TEXT 还原 → TABLE 还原之后、`8_resolved_skeleton.json` 重写之前插入
CODE 还原阶段（三个侧车还原同场；CODE 内容已预展开，与 LONG_TEXT 阶段无数据依赖，
排序仅为统一）。

**精确匹配语义（与 TABLE 的子串扫描有意分叉）**：只处理 `key === 'code'` 的条目，
且值必须**整体**等于引用串。理由：代码内容字面包含 `{{CODE_n}}` 形态文本是真实
场景（介绍本管线的文档），子串扫描会把 A 块内容错替成 B 块代码；表格 markdown
无此嵌套自指风险，沿用子串无妨。

| 条目形态 | 动作 |
|---|---|
| `{"code": "{{CODE_k}}"}`（整体匹配 `/^\{\{CODE_\d+\}\}$/`） | 查 `2_code.json[k]`：`status === 'ok'` → `codesResolved++`，整个 value 替换为 `{lang, content}`（lang 取 JSON 值——收集时 `data-language` 优先链结果）；缺失/failed → `failedCodes.push(k)`，保留字面 |
| `{"code": {"lang": "x", "content": "{{CODE_k}}"}}`（content 整体匹配） | 防御性兼容：替换 content 为 JSON 原文，lang 以 JSON 值覆写 |
| 其他（LLM 已自转 / 失败块转录） | 不动 |

emit 增 `codesResolved` / `failedCodes`；`U2M_DEBUG` 增计数行。

## 8. 步骤 9 改动（`render_skeleton.mjs`）

**残留守卫**：`code` 条目 value 仍为字符串（含 `{{CODE_` 残留）→ error 退出，
消息提示「引用了未还原的代码占位符，请先运行步骤 8 / 按步骤 7 指南修正」（镜像
trans2img 形状守卫；比 TABLE 的字面透传更严——残留引用流到最终 markdown 是静默
损坏的代码块，宁可响亮失败）。现状 `return null` 静默跳过一并改为该 error。

**围栏 backtick 安全化**（占位符还原与 LLM 转录两路统一生效——存量缺陷顺带修复）：

```js
const maxRun = (content.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
const fence = '`'.repeat(Math.max(3, maxRun + 1));
return `${fence}${lang}\n${content}\n${fence}`;
```

GFM 闭合规则下围栏严格长于内容中任何反引号串即安全；内容以反引号结尾亦无碍。

**lang 清洗**：lang 来自 `data-language` 属性，可能携垃圾字符——序列化前剥离
`[^a-zA-Z0-9._+-]`，空则裸围栏。

## 9. 失败路径全链路（步骤 4-6 零新代码，已逐环核实）

| 步骤 | 行为 | 依据 |
|---|---|---|
| 4 裁剪 | pre 随所属 key 子树整体保留 | 块模型不变；占位符/失败块对步骤 4 无差别 |
| 5 剥样式 | pre 子树内全部内联样式删净（跳过白名单/函数值/零值三趟） | `page-finalize-inline.js` 现有 `closest('pre')` 分支——用户需求的「步骤 5 剥离」已存在，本设计确认覆盖失败路径 |
| 6 瘦身 | bare span（仅剩 data-idx）迭代拆包 → 扁平文本 + LONG_TEXT 占位符 | slim 规则⑥ 现状；失败块本就无可用行结构（失败原因即结构信号缺失/不可信），拆包不损失信息 |
| 7 LLM | 读扁平代码文本自转 `{lang, content}`，lang 看 `data-language` 属性 | mmh1 实证 LLM 已能语义重建换行；失败路径保留此能力作安全网 |

成功路径同样零改动：`{{CODE_k|n_lines}}` 是 pre 内普通文本节点，随块流到
`6_article.html`（形态 `<pre data-language="tsx" data-idx="237">{{CODE_3|22_lines}}</pre>`）。

## 10. 指南与文档同步

| 文件 | 改动 |
|---|---|
| `references/markdown_skeleton_guide.md` | 新增引用形态规则：pre 含 `{{CODE_k\|n_lines}}` → `{"code": "{{CODE_k}}"}`（剥 `|n_lines` 后缀裸引用，与 LONG_TEXT 同款约定）；每个 `{{CODE_k}}` 恰用一次；明确「不要自转占位符块内容」；失败块照旧自转、lang 优先抄 `data-language`；清除 `{{PRE_CODE_TAG}}` 残留提及 |
| `references/analyze_html_guide.md` | 占位符 token 速览：`{{PRE_CODE_TAG\|n_lines}}` → `{{CODE_k\|n_lines}}`（编号 + 行数语义；ok/failed 在 clean 版同为占位符，步骤 3 标 paragraphIds 方式与表格一致） |
| `SKILL.md` | 步骤 2 产物清单（`2_code.json` / `logs/codes/`）+ emit 字段；步骤 7 增 code 引用形态；步骤 8 emit 增字段——镜像表格落地 commit b099d7c 同款同步 |
| `CLAUDE.md` | 管线大段步骤 2/7/8/9 描述同步 |
| `docs/design/url-to-markdown-design.md` | §6 步骤 2 脚本设计、§8 分派表补 code 占位符 |
| `.docs/2026-08-29-code-block-placeholder-design.md` | 头部加「已被本 spec 取代」注记 |

SKILL.md 决策表不变：`codes.failed > 0` 与 `tables.failed > 0` 同为合法分支，
日志提示不引导中断。

## 11. 与 LONG_TEXT 占位符的交互

- 收集发生在 LONG_TEXT 折叠**之后**（styled 趟末）——收集到的 text 含
  `{{LONG_TEXT_k|…}}` 字面占位符，Node 层预展开还原原文（与 table2md 同构）。
- 成功折叠后占位符从两版 HTML 消失，对应 LONG_TEXT 条目成为永久未引用——无害
  （trans2img 未引用条目同款先例）；步骤 8 的 undefinedRefs 校验只查骨架实际
  发出的引用。
- 步骤 7 看到的成功块是 `{{CODE_k|n_lines}}`，不含 LONG_TEXT 引用——「每个恰用
  一次」约束对 CODE 引用同款适用。
- 失败块内的 LONG_TEXT 占位符照常流到步骤 7/8 还原链，不受本设计影响。

## 12. 测试

### 12.1 单测（`test/unit/`）

| 文件 | 覆盖 |
|---|---|
| `code2md.test.mjs`（新） | convertCodes 全流水：七类 reason 逐一构造触发；层 2 边界（≥3 行 / 序列中断不剥 / 剥后退化不剥 / yaml `1:` 键不剥）；`\r\n`/`\r` 归一；首尾空行修剪 + 内部空行保留；n_lines 重算；counts；logs 落盘 |
| `page-collect-code.test.mjs`（新） | walkLines（jsdom——其对 `<style>` 规则级联支持有限，display/user-select 关键用例以**行内样式**提供，`<style>` 规则形态留给集成）：`\n` 切分 / grid 容器边界 / `<br>` / 块间空白吞掉 / 行内不断行 / 内部空行保留；层 1 槽排除（user-select:none + 数字、单条件不杀）；lang 三级探测；hasNonText；hidden/detached 跳过 + k 编号 |
| `page-fold-code.test.mjs`（新） | ok → 占位符 + data-language 提升；failed → live + 标记；`!parentNode`/`[hidden]` 跳过 |
| `clean-snapshot.test.mjs`（扩） | K7 map 驱动（含 failed 条目折叠）；防御分支；现有 PRE_CODE_TAG 断言改 CODE 形态 |
| `screenshot-trans.test.mjs`（扩） | 字符串引用整体替换（lang 取 JSON）；对象形态兼容 + 覆写；failed k 保留字面；**精确匹配**——content 中段子串不替换；emit 字段 |
| `render-skeleton.test.mjs`（扩） | 残留守卫 error；自适应围栏（``` → ````、```` → `````、反引号结尾）；lang 清洗；LLM 自转路径同享围栏安全化 |
| `clean-snapshot-golden.test.mjs`（扩） | golden 重生：两版 pre 折叠为 `{{CODE_k\|n_lines}}` |

### 12.2 夹具（`test/fixtures/code-blocks.html` 新）

- shiki 形态：inline 行 span + 真实 `\n`（可见）
- ra 形态：`.code-line { display: grid }` 行容器、零 `\n`、含超阈值长注释行
  （触发 LONG_TEXT 折叠再预展开）
- OpenAI 槽形态：`user-select:none` 数字列 + `<!-- -->` 注释节点 + 摘录式 26 起
- 行首内联序号形态（层 2 命中）；yaml `1:` 键序列（层 2 不剥）
- 复制保护整块（user-select:none 非数字内容——层 1 不杀）
- `<br>` 分行形态
- 失败形态：pre 内嵌 img（non_textual）、空 pre（empty）
- `white-space: pre-wrap` 窄容器真单行（集成验证 single_line_suspect；jsdom 无
  布局走 renderedLines=null 分支）
- 内容含 ``` 与字面 `{{CODE_3}}` 的代码（围栏安全 + 精确匹配）
- `[hidden]` pre（K5 独占，不占 k 编号）
- 双信号矛盾形态（块容器 + 错位 `\n`，mixed_signal_mismatch）

### 12.3 集成（`test/integration/code-pipeline.test.mjs` 新，真 chromium + 夹具服务器）

镜像 `table-pipeline.test.mjs`：

1. `clean_snapshot.mjs` 跑夹具页 → 断言 `2_code.json`（各块 status/reason/lang/
   content 修剪形态/元数据）、两版折叠形态、**ra 形态行数 = 真实行数**（对照旧
   countPreLines 的 1 行错误）、k 对齐、data-language 提升、`logs/codes/` 诊断。
2. 真实布局断言：可见块 distinctTops 交叉校验生效、隐藏祖先块 renderedLines=null
   跳过、软换行块 single_line_suspect 触发。
3. 手写含引用的 `7_skeleton.json` → `screenshot_trans.mjs` → 断言
   `8_resolved_skeleton.json` 对象物化 / failedCodes → `render_skeleton.mjs` →
   断言 `9_markdown.md` 围栏正确。
4. emit 契约：新字段在、stdout 单行 JSON 不破坏。

### 12.4 回归与验收

- `pnpm test` + `pnpm run test:integration` 全绿；golden 重生后逐字节 diff 审查
  （styled golden 变化 = ok 代码折叠，预期内）。
- **参考站验收**（§6.3 预测落地）：对两个 working URL 重跑步骤 2-9——OpenAI 14 块
  全 ok（9 块 gutterStripped、缩进保留）、mmh1 2 块（237/539）引用内容与现状 LLM
  语义重建结果逐字一致、`9_markdown.md` 代码块 diff 干净。记入
  `test/smoke/SMOKE.md`。

## 13. 影响面与不变量

**新文件**：`script/lib/page-collect-code.js`、`script/lib/page-fold-code.js`、
`script/lib/code2md.mjs`；测试 5 个新/扩单测 + 1 集成 + 1 夹具。

**改动文件**：`clean_snapshot.mjs`、`script/lib/page-clean-snapshot.js`（K7）、
`screenshot_trans.mjs`、`render_skeleton.mjs`、`script/lib/table2md.js`
（导出 `expandLongText`）、两指南、SKILL.md、CLAUDE.md、设计文档、golden。

**不动**：步骤 4/5/6（§9 已逐环论证）、`1_snapshot.html`、契约失败路径语义。

**不变量**：

- stdout 恰一行 JSON；emit 延迟退出陷阱防护模式延续。
- `{{PRE_CODE_TAG}}` 退役后无残留消费者。
- LONG_TEXT 编号与还原链不变。
- 共享页面脚本是唯一逻辑源：walkLines/槽排除只存在于 `page-collect-code.js`，
  Node 编排层不分叉。
- k 编号三处一致（收集 / styled fold / clean map）——同 dataIdx 同 k。

## 14. 已知限制与边界

- **隐藏祖先无渲染交叉校验**：结构信号独撑（探针验证可行；OpenAI 折叠展开器内
  9 块中带槽块经层 1 + walkLines 正常提取）。
- **`pre-wrap` 真单行判 failed 交 LLM**：语义重排无客观正确答案，LLM 判断即终审。
- **`rendered_mismatch` 空行豁免取下界**：只会放松不会误杀。
- **层 2 对全行数字序列的代码不设防**：每行都以连续整数开头的真实代码（构造性
  yaml/properties）会被剥——全行覆盖 + ≥3 行 + 非退化条件已把误杀面压到构造性
  场景；接受并记录。
- **防御分支（K7 未命中退回 PRE_CODE_TAG）理论不可达**：保留护栏（map 恒命中
  论证见 §5.4），触发即管线状态异常，字面 token 不参与还原链、无害。
- **trans2img 模块内的 pre**：若 LLM 判整模块截图，对应 CODE 条目未被引用——
  无害（未引用 LONG_TEXT 同款）。
- **`<pre>` 外的裸 `<code>` 块不收**：先观察真实站点（旧备忘同款边界）。
