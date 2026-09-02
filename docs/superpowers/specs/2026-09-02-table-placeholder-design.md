# 表格占位符 + 预计算 Markdown 转换设计

> 日期：2026-09-02
> 状态：设计已批准，待落实施计划
> 相关：`docs/design/url-to-markdown-design.md` §3 契约、§8 分派表；`references/markdown_skeleton_guide.md` `table`/`trans2img` 判定；`.temp/cross_table/` 算法参考（禁止导入，仅重实现）

## 1. 背景与动机

当前表格→Markdown 的转换**全部由步骤 7 LLM 现场完成**：步骤 2 clean 趟把 `<table>` 折成 `{{TABLE_TAG|n_rows_rows|m_cols_cols}}` 形状 token（原文丢弃、仅留行列规模供步骤 3 读），styled 趟保留 live 表贯穿步骤 4→5→6，步骤 7 LLM 读 `6_article.html` 的 live 表自写 GFM 表格、或对"复杂跨行跨列/嵌套"降级 `trans2img`。

GFM Markdown 表格**不支持 rowspan/colspan**——跨行跨列表格只能靠 LLM 手动展开为规则网格。这是 LLM 最易出错的场景：列错位、漏格、内容丢失。`.temp/cross_table` 已证明一个确定性 `expandTableSpans` 算法能稳健展开跨格（被跨越位重复原内容、保持矩形），并经 8/8 测试与 snapshot 回归零差异验证。

本设计把表格转换从"LLM 现场写"前移为"步骤 2 确定性预计算 + 校验"：成功的表折叠为 `{{TABLE_k}}` 占位符、markdown 存 sidecar、步骤 8 还原；失败的表保留 live 经步骤 5 剥样式后落回步骤 7 LLM 语义还原。成功路径不再依赖 LLM、跨行跨列不再触发 trans2img。

## 2. 设计决策（已与用户确认）

| 决策点 | 选择 |
|---|---|
| 占位策略 | **A：双版条件折叠**——成功表在 clean 与 styled 两版都折叠为 `{{TABLE_k}}`；失败表在 styled 版保 live。成功路径不依赖 LLM 自觉。 |
| 转换引擎 | **双引擎可插拔，默认纯 Node 自实现**——`lib/table2md-self.mjs`（零重依赖）默认；`lib/table2md-turndown.mjs`（turndown+gfm+jsdom）备选。步骤 2 经参数选择，不满意可换。`.temp/cross_table` 禁止导入、算法重实现。 |
| 成功/失败判定 | **纯结构校验**——引擎产出结构合法 GFM 即成功；失败落 styled live + 步骤 7 LLM。 |
| 失败诊断 | 判定失败后，把表格原始结构与原因打印到工作目录 `logs/tables/` 下。 |
| 单测覆盖 | 必须包含**跨行跨列单元格**的处理（rowspan/colspan/0 值/越界/交叉/无跨越）。 |

## 3. 总览与数据流

```
步骤2 clean_snapshot.mjs
 ├─ shared 段：长文本折叠（含表内单元格 → {{LONG_TEXT_k|n_chars}}）
 ├─ 【新】收集每表 {k, dataIdx, outerHTML, rows, cols} —— 在任何折叠前
 ├─ 【新】Node 层跑转换引擎（可插拔：self 默认 / turndown）
 │     · 预展开表内 {{LONG_TEXT_k|n_chars}} → 原文（用 2_long_text 映射）
 │     · expandTableSpans 网格展开 → GFM 序列化 → 纯结构校验
 │     · 成功：存 markdown；失败：存 reason + 落 logs/tables/ 诊断
 ├─ clean 趟 K6：恒折叠每表 → {{TABLE_k|rows×cols}}（替换旧 TABLE_TAG 形状 token）
 ├─ styled 趟：【新】成功表折叠 → {{TABLE_k|rows×cols}}；失败表保 live + 标 data-u2m-table="fail"
 └─ 产物：2_clean_snapshot.html / 2_clean_style_snapshot.html
        / 2_long_text.json / 【新】2_tables.json / 【新】logs/tables/{k}_{dataIdx}.log

步骤3 [agent] → 步骤4 extract_styled.mjs：占位符表 / 失败表均按 paragraphIds 迁移整子树（不变）
步骤5 compute_styles.mjs
 └─ 【新】finalize 增规则：table 子树（th/td/tr/thead/tbody/caption/colgroup/col/table 自身）
     跳过白名单、删净全部内联 style（成功表已折叠无单元格 → no-op；仅命中失败 live 表）
步骤6 extract_article.mjs：占位符表 / 失败表按现有块迁移 + slim（不变）
步骤7 [agent] LLM 读 6_article.html
 ├─ 成功：见 {{TABLE_k|…}} → 发 {"table":"{{TABLE_k}}"} 引用（不自行转换）
 └─ 失败：见 live 无样式表 → 自转 GFM table 条 / 结构不可表达 → trans2img
步骤8 screenshot_trans.mjs
 └─ 【新】纯 Node 还原：skeleton 中 table 条值若为 {{TABLE_k[|…]}} → 查 2_tables.json 替换为 markdown
     （与 LONG_TEXT 还原同阶段、同正则风格；失败表值已是具体 markdown，透传）
步骤9 render_skeleton.mjs：table 透传（不变）
```

## 4. 占位符与 sidecar 契约

### 4.1 占位符语法

- **HTML 版**（clean + styled 成功表）：`{{TABLE_k|rows×cols}}`
  - `k` = 文档序编号（1 起，与 `{{LONG_TEXT_k}}` 同体系）。
  - `rows×cols` 形状后缀，同 `{{LONG_TEXT_k|n_chars}}` 的后缀约定——携带规模元数据、供步骤 3 LLM 读规模；步骤 8 正则吃掉后缀（`{{TABLE_k[|…]}}`）。
  - 替换旧 `{{TABLE_TAG|n_rows_rows|m_cols_cols}}`（旧 token 无 k、无原文存储、仅形状）。
- **骨架引用**（步骤 7 产出）：`{{TABLE_k}}`（无后缀，同 `{{LONG_TEXT_k}}` 骨架形态）。
- `k` 在 clean 版与 styled 版**同一表一致**（均按文档序），与 `2_tables.json` 的键对应。

### 4.2 `2_tables.json`（类比 `2_long_text.json`）

```json
{
  "1": {
    "dataIdx": "1998",
    "html": "<table…>…</table>",
    "markdown": "| Setting | Impact |\n| --- | --- |\n| model | … |",
    "status": "ok",
    "engine": "self",
    "rows": 8, "cols": 2
  },
  "2": {
    "dataIdx": "2761",
    "html": "<table…>…</table>",
    "markdown": null,
    "status": "failed",
    "reason": "no <th> header found",
    "engine": "self",
    "rows": 10, "cols": 4
  }
}
```

- `html`：折叠前抓取的原始 outerHTML（含 `{{LONG_TEXT_k|n}}` 占位符——诊断用）。
- `markdown`：成功 = 预计算 GFM markdown（长文本**已预展开为原文**，无占位符）；失败 = `null`。
- `status`：`ok` | `failed`。
- `engine`：`self` | `turndown`（记录用了哪个引擎）。
- `reason`：失败时填校验未过项。
- `rows`/`cols`：形状（网格列数 = colspan 展开后最大值，复用现有 `tableRowsCols` 语义）。

### 4.3 失败诊断日志

- 路径：`<url-dir>/logs/tables/{k}_{dataIdx}.log`。
- 内容：原始 outerHTML 片段（可截断超长者）+ 失败原因（纯结构校验未过项）+ 引擎名 + 行列规模。
- 用途：真表排障、回归对照。不影响 stdout 单行 JSON 契约（日志走文件、不进 stdout）。

## 5. 步骤 2 改动（clean_snapshot.mjs + 共享 page 脚本）

### 5.1 收集（折叠前）

在 shared 段执行完（长文本已折叠、`{{LONG_TEXT_k|n}}` 已就位）、K6 折叠前，新增一个收集 pass（浏览器侧 evaluate 或 page 脚本 `page-collect-tables.js`）：

对每个 `<table>`（`data-idx` 在步骤 1 已打）记录 `{dataIdx, outerHTML, rows, cols}`，按文档序赋 `k`。`rows`/`cols` 复用 `page-clean-snapshot.js` 现有 `tableRowsCols`（colspan 展开为网格列数、嵌套表行归属最近 table）。结果挂元素 expando `__u2mTableInfo` 或返回 Node 层。

### 5.2 转换（Node 层，可插拔引擎）

Node 层拿到收集列表后，对每表：

1. **预展开长文本**：用 `2_long_text` 映射把 `html` 内 `{{LONG_TEXT_k|n_chars}}` 正则替换为原文（长文本映射在 shared 段已生成、此时可得）。
2. **跑引擎**：`convertTable(expandedHtml) → {markdown, status, reason}`。引擎内部 `expandTableSpans` → GFM 序列化 → 纯结构校验。
3. **存 `2_tables.json`**：按 §4.2 schema。
4. **失败落日志**：按 §4.3 写 `logs/tables/`。

引擎选择：`--table-engine self|turndown` 或 `U2M_TABLE_ENGINE` 环境变量，默认 `self`。两引擎共享接口 `convertTable(htmlString) → {markdown, status, reason}`，同输入同输出（`self` 的输出可被 `turndown` 复现校验）。

### 5.3 clean 趟 K6（改）

`page-clean-snapshot.js` 的 K6：恒折叠每表为 `{{TABLE_k|rows×cols}}`（替换旧 `{{TABLE_TAG|…}}`）。`k` 取自收集 pass 的文档序赋值。带 `hidden` 的表仍由 K5 独占折叠（不变）。原文存储由 Node 层负责，K6 只折叠。

### 5.4 styled 趟（新分支）

styled 趟原本不折叠表。新增：对每表读转换状态——
- `status === "ok"`：折叠为 `{{TABLE_k|rows×cols}}`（与 clean 趟同形）。
- `status === "failed"`：**保留 live**（不折叠），并在 `<table>` 元素打 `data-u2m-table="fail"` 属性供步骤 5 识别。

实现路径（择一，实施计划定）：Node 层转换后把 status 注入页面（expando 或 `data-u2m-table-status`），styled 趟 page 脚本读之折叠；或 styled 趟产出后由 Node 层对成功表做 DOM/字符串折叠。**必须保证 clean 与 styled 的 `k` 一致。**

### 5.5 产物与 emit

步骤 2 emit 在现有字段基础上增 `tables` 计数对象（`{total, ok, failed}`）。失败计数 > 0 **不报 error**（失败是合法分支、落步骤 7）。stdout 仍单行 JSON。

## 6. 步骤 5 改动（page-finalize-inline.js）

`page-finalize-inline.js` 的白名单过滤循环新增一条优先规则：**凡 `table` 子树元素**（`<table>` 自身与 `th/td/tr/thead/tbody/caption/colgroup/col`）——跳过 KEEP_PREFIX/KEEP 白名单、**直接删净全部内联 `style`**。

- 成功表在 styled 版已折叠为 `<table>{{TABLE_k|…}}</table>` 文本节点、无单元格子树 → 该规则对它们 **no-op**。
- 失败 live 表 → 剥净 border/background/box-shadow 等全部内联样式，到 `6_article.html` 时只剩结构 + 文本 + `{{LONG_TEXT_k|n}}` 占位符。

这不新增独立 pass、不改变步骤 5 的阶段顺序（strip-hidden → unwrap-layers → juice → collect-fn → resolve-computed → finalize）。table 子树删样式在 finalize 内完成，确保 juice 已内联的值也被清掉。

## 7. 步骤 7 骨架指南修订（references/markdown_skeleton_guide.md）

`### table 判定` 段改为：

- 见 `{{TABLE_k|…}}` 占位符 → 发 `{"table":"{{TABLE_k}}"}` 引用，**不要自行转换**（预计算 markdown 已就绪、步骤 8 还原）。
- 见 live 无样式表（失败路径，经步骤 5 剥样式）→ 自转 GFM `table` 条；仅当结构无法用 markdown 表格表达（嵌套表 / 单元格内块级内容 / 无法对齐）才降级 `trans2img`。
- **删除原"复杂跨行跨列 → trans2img"条款**——成功路径的跨行跨列已由确定性引擎展开为规则网格、不再触发 trans2img。
- 单元格内脚注锚点保留链接形式（不变）。

`### trans2img 判定` 相应移除"复杂跨行跨列表格"作为 trans2img 理由的表述。

## 8. 步骤 8 改动（screenshot_trans.mjs）

纯 Node 还原阶段（现有 LONG_TEXT 全局替换的同类操作）新增：

- 读 `2_tables.json`。
- 扫描 skeleton 所有条目的 value，对 `{{TABLE_k[|…]}}`（`k` 为数字、可选形状后缀）正则匹配 → 查 `2_tables.json[k].markdown` 替换。
- 若 `k` 不在 `2_tables.json` 或其 `status !== "ok"` → 记入 `failedTables`（emit 增字段），**保留 `{{TABLE_k}}` 字面**（步骤 9 会以裸文本透出，可排障；不阻断）。
- 失败路径的 `table` 条 value 已是 LLM 写的具体 markdown（不含 `{{TABLE_k}}`）→ 不匹配、透传。
- 与 LONG_TEXT 还原的时序：LONG_TEXT 全局替换先跑（失败路径表 markdown 内的 `{{LONG_TEXT_k}}` 引用由它展开）；TABLE 替换后跑（成功路径表 markdown 已预展开、无 `{{LONG_TEXT_k}}`，不冲突）。

emit 增 `tablesResolved`/`failedTables` 计数。

## 9. 转换引擎模块

### 9.1 `lib/table2md-self.mjs`（默认，目标零重依赖）

- `expandTableSpans(document)`：取自 `.temp/cross_table` 报告 §4 算法，**重写不导入**。
  - 两遍网格展开：第一遍按 HTML 表格算法放置单元格、记录 rowspan/colspan 覆盖位；第二遍按列号重排、被跨越位插入复制原内容的同标签填充格、参差行补空 `td` 保证矩形。
  - `parseSpan`：非法值/0 按 1（colspan 0 按 1，与参考项目一致；rowspan 0 延伸到表尾）。
  - 跨度上限 1000。
  - 多行 thead：第 2 行起降级为 tbody 数据行（避免重复分隔行）。
- GFM 序列化器（自写）：网格 → 表头行 `| … |` + 分隔行 `| --- |` + 数据行；转义 `|`、`\n`；多行单元格空格化或折叠（与 gfm 行为对齐）。**表头判定与参考项目一致**：只有含 `<th>` 的首行才作表头；无 `<th>` 的表不合成表头、直接判 failed（落步骤 7 LLM）。
- `convertTable(htmlString) → {markdown, status, reason}`：内部建轻量 DOM（无需 jsdom——可用 `DOMParser`? Node 无原生；用极简正则/手写解析器或 `node:html` 无标准库 → **实施时定**：可引一个极小 DOM 实现，或复用 turndown 引擎的 jsdom 仅作 self 的 DOM 容器。本引擎目标是"零重依赖"，若手写 DOM 解析成本过高，则 self 引擎退而用 jsdom 单依赖、turndown 引擎用全套三依赖——实施计划复核）。
- 纯结构校验（§10）。

### 9.2 `lib/table2md-turndown.mjs`（备选）

- 引入 `turndown` + `turndown-plugin-gfm` + `jsdom` 三个运行时依赖。
- 薄封装：jsdom 建 DOM → `expandTableSpans`（同算法、同实现可共享 `lib/expand-table-spans.mjs`）→ DOMPurify 可选清洗 → turndown+gfm 转换。
- 同接口 `convertTable(htmlString) → {markdown, status, reason}`。
- 与 `.temp/cross_table` 同栈、转换质量一致。不满意 self 时切换。

### 9.3 共享算法

`expandTableSpans` 两引擎共用 → 抽到 `lib/expand-table-spans.mjs`（接收一个 document-like 对象，引擎各自提供 DOM 实现）。避免分叉。

## 10. 纯结构校验（成功/失败判定）

成功 = 引擎产出**结构合法**的 GFM，全部满足：

1. 有表头行（至少一个 `<th>`，或首行可作表头）；
2. 有分隔行 + ≥1 数据行；
3. 所有数据行列数一致 = 表头列数（矩形）；
4. 输出无残留 HTML 标签、无未展开 `{{LONG_TEXT_k}}`；
5. 非空（有行有列、至少一个非空单元格）。

失败场景（落 styled live + 诊断日志）：
- 无可识别表头（无 `<th>` 且首行无法作表头）；
- 单元格内嵌 `<table>/<pre>/<ul>/<ol>` 等块级内容无法压成行内；
- colspan/rowspan 产出退化空网格或非矩形无法修复；
- 空表（无行或无列）；
- 序列化/展开抛错。

## 11. 长文本占位符交互

- **成功路径**：步骤 2 转换前用 `2_long_text` 映射预展开表内 `{{LONG_TEXT_k|n_chars}}` → 原文。存入 `2_tables.json` 的 markdown 是**完整真实文本、无占位符**。步骤 8 直接替换，不与 LONG_TEXT 全局替换时序冲突（LONG_TEXT 替换先跑、此时表 markdown 尚未注入 skeleton；TABLE 替换后跑、注入的已无占位符）。
- **失败路径**：styled live 表保留 `{{LONG_TEXT_k|n}}` 占位符（步骤 5 只剥样式、不碰占位符）。步骤 7 LLM 在自转的 markdown 里引用 `{{LONG_TEXT_k}}`，由现有步骤 8 LONG_TEXT 还原机制处理（不变）。

## 12. 测试

### 12.1 单测（`test/unit/`）

**`expand-table-spans.test.mjs`**（跨行跨列单元格处理——重点覆盖）：
1. 纯 rowspan：跨行单元格内容重复填充到覆盖的每一行。
2. 纯 colspan：跨列单元格内容重复填充到覆盖的每一列。
3. rowspan × colspan 交叉：跨行 + 跨列在同一表混合，列对齐无错位。
4. `rowspan="0"`：延伸到表格末尾（HTML 规范语义）。
5. `colspan="0"` 与非法值（`"abc"`、负数）：按 1 处理。
6. rowspan 超出剩余行数：截断到表尾。
7. 无跨单元格的表：不受预处理影响（早退）。
8. 多行 thead：第 2 行起降级为 tbody 数据行、只输出一个分隔行。
9. 参差行（各行单元格数不等）：补空 `td` 保证矩形。
10. 填充格保持原标签类型（`th`→`th`/`td`→`td`），不破坏表头行判定。

**`table2md-self.test.mjs`**（GFM 序列化 + 校验）：
- 正常表（thead+th、无跨格）→ ok、markdown 含表头/分隔/数据行。
- 跨行跨列表（`.temp/cross_table/cross_table.html` 同构夹具）→ ok、输出与 `cross_table.md` 同构（5 列、跨格内容重复填充）。
- `|` 转义、单元格内换行处理。
- 无 `<th>` 表 → failed（reason = no header）。
- 单元格嵌套 `<table>`/`<pre>` → failed（reason = nested block content）。
- 空表 → failed。
- 退化空网格 → failed。

**`table2md-turndown.test.mjs`**：同输入下与 self 引擎输出**一致或等价**（跨行跨列表两端对齐）。

**`clean-snapshot.test.mjs`**（扩展现有）：
- 成功表：clean + styled 两版均折叠为 `{{TABLE_k|rows×cols}}`、`2_tables.json` 存 markdown。
- 失败表：clean 折叠、styled 保 live + `data-u2m-table="fail"`。
- `k` 在两版一致。
- `logs/tables/{k}_{dataIdx}.log` 生成。

**`screenshot-trans.test.mjs` / `render-skeleton.test.mjs`**（扩展）：
- skeleton `table` 条值为 `{{TABLE_k}}` → 步骤 8 查 `2_tables.json` 替换为 markdown。
- `k` 缺失/失败 → 保留字面、记 `failedTables`、不阻断。
- 失败路径 concrete markdown 透传。

**`finalize-inline.test.mjs`**（步骤 5）：
- 失败 live 表子树全部 style 删除。
- 成功折叠表（文本节点）→ no-op。

### 12.2 集成测试（`test/integration/`）

夹具 `test/fixtures/tables.html`：含
- 简单 2 列表（无跨格，类 data-idx 1998）、
- 4 列表（类 data-idx 2761）、
- **跨行跨列表**（rowspan×colspan 混合，类 `.temp/cross_table/cross_table.html`）、
- 无表头表（失败）、
- 单元格嵌套块内容表（失败）。

验证：
- 成功表在 `9_markdown.md` 为正确 GFM 表格、跨格内容重复填充、列对齐。
- 失败表落 styled live、`6_article.html` 无内联样式、诊断日志生成、步骤 7 走 LLM 路径（集成测可注入固定 skeleton 验步骤 8 还原）。
- emit `tables`/`tablesResolved`/`failedTables` 计数正确。

### 12.3 回归

`working/developers.openai.com_api_docs_guides_prompt-caching/` 两表（data-idx 1998/2761，简单无跨格）走成功路径，`9_markdown.md` 表格输出与现状一致或更优（行列对齐、内容完整）。

## 13. 影响面与不变量

**不变量**：
- stdout 单行 JSON 契约不破（日志走 stderr/文件）。
- 共享页面脚本是分类唯一事实源——表格转换逻辑放 `lib/` Node 模块（纯 Node 转换，非页面分类规则），折叠/收集放 page 脚本。
- 四键契约（titleId/descriptionIds/paragraphIds）不变——占位符表与失败表均按 paragraphIds 迁移。
- `2_long_text.json` 还原链不变——失败路径仍走它。

**改动文件**：
- `script/clean_snapshot.mjs`（收集 + 转换调度 + styled 分支 + emit 增字段）。
- `script/lib/page-clean-snapshot.js`（K6 改占位符语法 + 收集 pass）。
- `script/lib/page-collect-tables.js`（新）。
- `script/lib/page-finalize-inline.js`（table 子树剥样式规则）。
- `script/lib/table2md-self.mjs`（新）、`script/lib/table2md-turndown.mjs`（新）、`script/lib/expand-table-spans.mjs`（新共享）。
- `script/screenshot_trans.mjs`（TABLE 占位符还原 + emit 增字段）。
- `references/markdown_skeleton_guide.md`（table/trans2img 判定修订）。
- 测试：§12 列。
- `package.json`（turndown 系仅当用户选 turndown 引擎时加为依赖；self 默认零新依赖）。
- `CLAUDE.md`（步骤 2/5/7/8 描述更新）。

## 14. 已知限制与开放问题

- **self 引擎的 DOM 解析**：Node 无原生 DOMParser。self 引擎若坚持零依赖需手写极简表格 DOM 解析器（表格结构有限、可行但需测）；若成本过高，self 退用 jsdom 单依赖（仍轻于 turndown 三依赖）。实施计划复核决定，接口不变。
- **单元格富内容**：成功路径预展开长文本后，单元格内链接/行内 code 由 GFM 序列化器处理（self 需自写行内格式转换，或退化为纯文本——若退化则失败判定更严、更多表落步骤 7）。turndown 引擎天然支持富内容。两引擎在此点行为可能差异，需在 §12.1 对齐测试中明确。
- **嵌套表**：`expandTableSpans` 的 `querySelector('[rowspan],[colspan]')` 会命中最内层跨越连带展开外层表（参考项目已知限制）。本设计对嵌套表直接判 failed（落步骤 7），规避此问题。
- **`rowspan="0"` 跨 thead/tbody 边界**：规范严格定义为延伸到 row group 末尾，本设计简化为延伸到整表末尾（与参考项目一致）。罕见场景，接受。
- **无 `<th>` 表头**：与参考项目一致，不合成表头、直接判 failed 落步骤 7。现实大量无 `<th>` 表会走 LLM 路径（接受，因合成表头有信息损失风险、且 LLM 可结合上下文判首行是否表头）。若后续发现失败率过高，可加"首行可作表头"启发式升级，接口不变。
