# 表格占位符 + 预计算 Markdown 转换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把表格→Markdown 转换从步骤 7 LLM 现场写前移为步骤 2 确定性预计算——成功的表折成 `{{TABLE_k}}` 占位符、markdown 存 `2_tables.json`、步骤 8 还原；失败的表保 live、步骤 5 剥样式、步骤 7 LLM 语义还原 + 诊断日志。

**Architecture:** 双版条件折叠（Design A）。步骤 2 Node 层用可插拔引擎（self 默认 / turndown 备选，共享 `expandTableSpans`）跑纯结构校验；成功表在 clean + styled 两版都折叠、失败表在 styled 保 live 并打 `data-u2m-table="fail"`。步骤 5 finalize 对 table 子树删净内联样式。步骤 8 在 LONG_TEXT 还原后追加 `{{TABLE_k}}` 还原。

**Tech Stack:** Node ≥20 ESM、Playwright 1.62（步骤 2 已用）、jsdom（新，两引擎共享 DOM）、turndown + turndown-plugin-gfm（新，仅 turndown 引擎）。`node --test` 单测 + 子进程集成测。

**Spec:** `docs/superpowers/specs/2026-09-02-table-placeholder-design.md`（本计划据 spec 论证，executor 同时读两者）

## Global Constraints

- **stdout 单行 JSON 契约不破**——每个 CLI（含失败路径）向 stdout 输出恰好一行 JSON，日志走 stderr/文件，退出码 0/1/2（usage_error=2）。
- **emit 延迟退出陷阱**——`lib/contract.mjs` 的 `emit()` 先写行再在写回调里 `process.exit`、本身同步返回。`emit()`/`usage()` 之后继续执行会输出第二行或零行崩溃。所有新增 emit 路径用 `return emit(...)` / `return usage(...)` 提前 return 防护。
- **共享页面脚本是分类唯一事实源**——`script/lib/page-*.js` 是普通非模块文件，各含一个具名 `function __u2mXxx(...)`，Node 工作流当文本读入并注入页面（`readSharedScript` + evaluate）。表格**折叠/收集/剥样式**放 page 脚本；**转换引擎**放 `lib/` Node 模块（纯 Node、非页面分类规则）。
- **`.temp/cross_table` 禁止导入**——算法重写不导入。
- **引擎 DOM 选型（resolve spec §14）**：两引擎共享 `jsdom` 作 DOM（self 用 jsdom Document + 手写 GFM 序列化器；turndown 用 jsdom window + turndown+gfm）。self 引擎的"零重依赖"目标放宽为"单 jsdom 依赖"（spec §14 明确允许）。`expandTableSpans` 仅用标准 DOM API（`querySelectorAll` / `children` / `tagName` / `getAttribute` / `removeAttribute` / `createElement` / `innerHTML` / `textContent` / `appendChild` / `removeChild`），避免 `.rows`/`.cells`/`replaceChildren` 等 HTML 集合 API 差异，保证 jsdom 兼容。
- **占位符语法**：HTML 版 `{{TABLE_k|rows×cols}}`（k 文档序 1 起、`rows×cols` 形状后缀，替换旧 `{{TABLE_TAG|n_rows_rows|m_cols_cols}}`）；骨架引用 `{{TABLE_k}}`（无后缀）。
- **k 一致性**：clean 与 styled 同一表 k 一致（均按文档序、均跳过 `[hidden]` 表——hidden 表由 K5 独占折叠，不入 table 体系）。
- **表头判定**（resolve spec §10 vs §9.1）：只有**首行全部 `<th>`** 才作表头；无 `<th>` 或首行非全 `<th>` → 判 failed（不合成表头，与参考项目一致）。
- 测试命令：`pnpm test`（单测）、`pnpm run test:integration`（集成）、`node --test test/unit/<file>.test.mjs`（单文件）。

---

## File Structure

| 文件 | 职责 | 新/改 |
|---|---|---|
| `script/lib/expand-table-spans.mjs` | 共享 `expandTableSpans(document)`——rowspan/colspan 网格展开，两引擎共用 | 新 |
| `script/lib/table2md-self.mjs` | self 引擎 `convertTable(html) → {markdown,status,reason}`：jsdom DOM + expandTableSpans + 手写 GFM 序列化器 + 纯结构校验 | 新 |
| `script/lib/table2md-turndown.mjs` | turndown 引擎 `convertTable(html) → {markdown,status,reason}`：jsdom + expandTableSpans + turndown+gfm + 校验 | 新 |
| `script/lib/table2md.js` | 引擎选择器 `convertTables(list, {engine, longTextMap}) → {tables, logs}`：预展开长文本 + 分派引擎 + 落 `2_tables.json` 与 `logs/tables/` | 新 |
| `script/lib/page-collect-tables.js` | styled 趟收集 pass：`__u2mCollectTables()` → `[{k,dataIdx,outerHTML,rows,cols}]`（折叠前、跳过 hidden） | 新 |
| `script/lib/page-fold-tables.js` | styled 趟折叠 pass：`__u2mFoldTables(resultByDataIdx)`——成功表折叠为 `{{TABLE_k\|rows×cols}}`、失败表打 `data-u2m-table="fail"` | 新 |
| `script/lib/page-clean-snapshot.js` | K6 改 `{{TABLE_k\|rows×cols}}`（替换 TABLE_TAG）；styled 趟末尾调 `__u2mCollectTables` 并入返回 | 改 |
| `script/clean_snapshot.mjs` | 调度：styled 趟→收集→Node 转换→`2_tables.json`+logs→fold 趟→序列化；emit 增 `tables` 计数 | 改 |
| `script/lib/page-finalize-inline.js` | finalize 循环增 `closest('table')` 分支：table 子树删净全部内联 style | 改 |
| `script/screenshot_trans.mjs` | LONG_TEXT 还原后追加 `{{TABLE_k}}` 还原（查 `2_tables.json`）；emit 增 `tablesResolved`/`failedTables` | 改 |
| `references/markdown_skeleton_guide.md` | `table`/`trans2img` 判定修订：占位符发引用、删除"跨行跨列→trans2img" | 改 |
| `test/unit/expand-table-spans.test.mjs` | 跨行跨列展开单测（10 用例） | 新 |
| `test/unit/table2md-self.test.mjs` | self 引擎 GFM 序列化 + 校验单测 | 新 |
| `test/unit/table2md-turndown.test.mjs` | turndown 引擎与 self 输出对齐单测 | 新 |
| `test/unit/clean-snapshot.test.mjs` | 步骤 2 表格折叠/收集/fold/2_tables.json 单测（扩展） | 改 |
| `test/unit/screenshot-trans.test.mjs` | 步骤 8 `{{TABLE_k}}` 还原单测（扩展） | 改 |
| `test/unit/finalize-inline.test.mjs` | 步骤 5 table 子树剥样式单测 | 新 |
| `test/integration/table-pipeline.test.mjs` | 端到端：夹具表 → 9_markdown.md GFM 表格 + 失败诊断 | 新 |
| `test/fixtures/tables.html` | 含简单表/跨行跨列表/无表头表/嵌套块内容表 | 新 |
| `package.json` | 增 `jsdom`（两引擎）、`turndown`+`turndown-plugin-gfm`（turndown 引擎） | 改 |
| `CLAUDE.md` | 步骤 2/5/7/8 描述更新 | 改 |

---

## Task 1: 共享 expandTableSpans 算法

**Files:**
- Create: `script/lib/expand-table-spans.mjs`
- Test: `test/unit/expand-table-spans.test.mjs`

**Interfaces:**
- Produces: `export function expandTableSpans(document)` ——接收一个 Document（jsdom 或页面 document），对其中每个含 `[rowspan],[colspan]` 的 `<table>` 原地重写为规则矩形网格（被跨越位插入复制原内容的同标签填充格、参差行补空 `td`、原单元格移除 rowspan/colspan、多行 thead 第 2 行起降级为 tbody 数据行）。无跨越的表早退不动。还导出 `parseSpan(value)` 与 `parseRowspan(value, remainingRows)` 供测试直接调用。

- [ ] **Step 1: 写失败测试 `test/unit/expand-table-spans.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { expandTableSpans, parseSpan, parseRowspan } from '../../script/lib/expand-table-spans.mjs';

function docOf(html) { return new JSDOM(`<html><body>${html}</body></html>`).window.document; }
// 展开后取首个 table 的网格：返回 [[cellText, tag], ...] 行数组（tag = 'th'|'td'）
function grid(doc) {
  const tb = doc.querySelector('table');
  const trs = [...tb.querySelectorAll('tr')].filter((tr) => tr.closest('table') === tb);
  return trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName))
    .map((c) => [c.textContent, c.tagName.toLowerCase()]));
}

test('parseSpan: 非法值/0/负数按 1，正常值原样，上限 1000', () => {
  assert.equal(parseSpan('1'), 1);
  assert.equal(parseSpan('0'), 1);
  assert.equal(parseSpan('abc'), 1);
  assert.equal(parseSpan('-3'), 1);
  assert.equal(parseSpan('3'), 3);
  assert.equal(parseSpan('5000'), 1000);
});

test('parseRowspan: 0 延伸到表尾（remainingRows）', () => {
  assert.equal(parseRowspan('0', 4), 4);
  assert.equal(parseRowspan('2', 4), 2);
  assert.equal(parseRowspan('0', 1), 1);
});

test('纯 rowspan：跨行单元格内容重复填充到覆盖的每一行', () => {
  const d = docOf(`<table><tbody>
    <tr><td rowspan="2">Q1</td><td>150</td></tr>
    <tr><td>250</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['Q1','td'],['150','td']], [['Q1','td'],['250','td']]]);
});

test('纯 colspan：跨列单元格内容重复填充到覆盖的每一列', () => {
  const d = docOf(`<table><tbody><tr><td colspan="2">合并</td><td>B</td></tr></tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['合并','td'],['合并','td'],['B','td']]]);
});

test('rowspan × colspan 交叉：列对齐无错位', () => {
  const d = docOf(`<table><thead>
    <tr><th rowspan="2">时间</th><th colspan="2">上午</th></tr>
    <tr><th>第1节</th><th>第2节</th></tr>
  </thead><tbody><tr><td>周一</td><td>语文</td><td>数学</td></tr></tbody></table>`);
  expandTableSpans(d);
  // 首行: 时间 时间(跨列填充) 时间(跨列填充) —— colspan=2 占 2 列，加时间 1 列 = 3 列
  assert.deepEqual(grid(d), [
    [['时间','th'],['上午','th'],['上午','th']],
    [['第1节','th'],['第2节','th'],['','td']],   // 参差补空 td
    [['周一','td'],['语文','td'],['数学','td']],
  ]);
});

test('rowspan="0" 延伸到表格末尾', () => {
  const d = docOf(`<table><tbody>
    <tr><td rowspan="0">A</td><td>1</td></tr>
    <tr><td>2</td></tr>
    <tr><td>3</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['1','td']], [['A','td'],['2','td']], [['A','td'],['3','td']]]);
});

test('rowspan 超出剩余行数时截断到表尾', () => {
  const d = docOf(`<table><tbody><tr><td rowspan="9">A</td><td>1</td></tr><tr><td>2</td></tr></tbody></table>`);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['1','td']], [['A','td'],['2','td']]]);
});

test('无跨单元格的表不受预处理影响（早退）', () => {
  const html = `<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>`;
  const d = docOf(html);
  expandTableSpans(d);
  assert.deepEqual(grid(d), [[['A','td'],['B','td']]]);
});

test('多行 thead：第 2 行起降级为 tbody 数据行', () => {
  const d = docOf(`<table><thead>
    <tr><th>H1</th><th>H2</th></tr>
    <tr><th>S1</th><th>S2</th></tr>
  </thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`);
  expandTableSpans(d);
  // 无跨越 → 表本身不动，但多行 thead 降级逻辑对 >1 行 thead 仍执行
  const theadRows = d.querySelectorAll('thead tr').length;
  const tbodyRows = d.querySelectorAll('tbody tr').length;
  assert.equal(theadRows, 1, 'thead 只剩 1 行');
  assert.equal(tbodyRows, 2, '原 thead 第 2 行降级进 tbody（加原 tbody 1 行 = 2）');
});

test('参差行：各行单元格数不等时补空 td 保证矩形', () => {
  const d = docOf(`<table><tbody>
    <tr><td>A</td><td>B</td><td>C</td></tr>
    <tr><td>D</td></tr>
  </tbody></table>`);
  expandTableSpans(d);
  const g = grid(d);
  assert.equal(g[0].length, 3);
  assert.equal(g[1].length, 3, '参差行补齐到 3 列');
  assert.equal(g[1][2][0], '', '补位为空');
  assert.equal(g[1][2][1], 'td', '补位标签为 td');
});

test('填充格保持原标签类型（th→th / td→td），不破坏表头行判定', () => {
  const d = docOf(`<table><thead><tr><th colspan="2">合并头</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`);
  expandTableSpans(d);
  const g = grid(d);
  assert.equal(g[0][0][1], 'th', '原 th 保留');
  assert.equal(g[0][1][1], 'th', 'colspan 填充格也是 th（复制原标签）');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/expand-table-spans.test.mjs`
Expected: FAIL（`Cannot find module '../../script/lib/expand-table-spans.mjs'`）

- [ ] **Step 3: 实现 `script/lib/expand-table-spans.mjs`**

```js
// script/lib/expand-table-spans.mjs
// 共享 rowspan/colspan 网格展开——取自 .temp/cross_table 报告 §4 算法（重写不导入）。
// 接收任意标准 DOM Document（jsdom 或浏览器 page.document），对其内每个含
// [rowspan],[colspan] 的 <table> 原地重写为规则矩形网格：被跨越位插入复制
// 原单元格内容的新单元格（保持原 th/td 标签）、参差行补空 td、原单元格移除
// rowspan/colspan。无跨越的表早退。多行 thead 第 2 行起降级为 tbody 数据行。
// 仅用标准 DOM API（避免 .rows/.cells/replaceChildren 的实现差异）。

export function parseSpan(value) {
  const n = parseInt(value, 10);
  return n > 1 ? Math.min(n, 1000) : 1;
}

export function parseRowspan(value, remainingRows) {
  return parseInt(value, 10) === 0 ? remainingRows : parseSpan(value);
}

function isCell(el) { return el && /^(TH|TD)$/.test(el.tagName); }

export function expandTableSpans(document) {
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    if (!table.querySelector('[rowspan],[colspan]')) continue; // 无跨越早退

    // 仅取本表直接行（嵌套表的 tr 归属其最近 table）
    const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
    const occupied = new Map(); // 'r,c' -> 覆盖该位的原单元格
    const rowEntries = [];       // rowEntries[r] = [{col, cell}]
    let width = 0;

    // 第一遍：按 HTML 表格算法放置每个单元格、记录跨度覆盖位
    rows.forEach((tr, r) => {
      const entries = [];
      let c = 0;
      for (const cell of [...tr.children]) {
        if (!isCell(cell)) continue;
        while (occupied.has(`${r},${c}`)) c++; // 跳过被上方 rowspan 占用的列
        const cs = parseSpan(cell.getAttribute('colspan'));
        const rs = parseRowspan(cell.getAttribute('rowspan'), rows.length - r);
        entries.push({ col: c, cell });
        for (let dr = 0; dr < rs; dr++)
          for (let dc = 0; dc < cs; dc++)
            occupied.set(`${r + dr},${c + dc}`, cell);
        c += cs;
      }
      rowEntries.push(entries);
      if (c > width) width = c;
    });

    // 第二遍：按列号重排每行，跨越覆盖位插入内容副本
    rows.forEach((tr, r) => {
      const newCells = [];
      for (let c = 0; c < width; c++) {
        const entry = rowEntries[r].find((e) => e.col === c);
        if (entry) {
          entry.cell.removeAttribute('rowspan');
          entry.cell.removeAttribute('colspan');
          newCells.push(entry.cell);
        } else {
          const origin = occupied.get(`${r},${c}`);
          // 保持原标签（th→th/td→td），避免破坏表头行判定
          const filler = document.createElement(origin ? origin.tagName.toLowerCase() : 'td');
          if (origin) filler.innerHTML = origin.innerHTML;
          newCells.push(filler);
        }
      }
      while (tr.firstChild) tr.removeChild(tr.firstChild);
      for (const nc of newCells) tr.appendChild(nc);
    });

    // GFM 只支持单行表头：thead 第 2 行起降级为 tbody 数据行
    const thead = [...table.children].find((el) => el.tagName === 'THEAD');
    if (thead) {
      const theadRows = [...thead.children].filter((el) => el.tagName === 'TR');
      if (theadRows.length > 1) {
        let tbody = [...table.children].find((el) => el.tagName === 'TBODY');
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        for (const tr of theadRows.slice(1)) {
          for (const th of [...tr.children]) {
            if (th.tagName === 'TH') {
              const td = document.createElement('td');
              td.innerHTML = th.innerHTML;
              th.replaceWith(td);
            }
          }
          thead.removeChild(tr);
          tbody.insertBefore(tr, tbody.firstChild);
        }
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/expand-table-spans.test.mjs`
Expected: PASS（10/10）。若"交叉"用例的参差补位位置不符，调整第二遍补空格的列序逻辑（空位出现在跨列未覆盖处）——按算法 `occupied` 未覆盖即补空，用例期望的补空位应与算法一致；若不一致，以算法为准修正用例断言的补空位置（参差补空落在 rowspan 覆盖不到的列）。

- [ ] **Step 5: 提交**

```bash
git add script/lib/expand-table-spans.mjs test/unit/expand-table-spans.test.mjs
git commit -m "feat(table2md): 共享 expandTableSpans 网格展开算法 + 单测

跨行跨列单元格展开为规则矩形网格（被跨越位重复原内容、保持原
标签、参差补空 td、多行 thead 降级）。取自 .temp/cross_table 报告
§4 重写不导入。仅用标准 DOM API，jsdom 与浏览器 page 兼容。
"
```

---

## Task 2: self 引擎（jsdom + 手写 GFM 序列化器 + 校验）

**Files:**
- Create: `script/lib/table2md-self.mjs`
- Test: `test/unit/table2md-self.test.mjs`

**Interfaces:**
- Consumes: `expandTableSpans(document)` from Task 1。
- Produces: `export function convertTable(htmlString) → { markdown: string|null, status: 'ok'|'failed', reason?: string }`。内部：jsdom 建 DOM → `expandTableSpans` → 取网格 → 判表头（首行全 `<th>`） → 手写 GFM 序列化（行内格式：code/a/strong/em） → 纯结构校验。失败返 `{markdown:null, status:'failed', reason}`。

- [ ] **Step 1: 写失败测试 `test/unit/table2md-self.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertTable } from '../../script/lib/table2md-self.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const crossHtml = fs.readFileSync(
  path.resolve(thisDir, '../../.temp/cross_table/cross_table.html'), 'utf8');
// cross_table.html 整页含 <h1>/<p>/<table>；convertTable 只转首个 <table>

test('正常表（thead+th、无跨格）→ ok，含表头/分隔/数据行', () => {
  const r = convertTable(`<table><thead><tr><th>Setting</th><th>Impact</th></tr></thead>
    <tbody><tr><td>model</td><td>大</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  const lines = r.markdown.split('\n');
  assert.equal(lines[0], '| Setting | Impact |');
  assert.equal(lines[1], '| --- | --- |');
  assert.equal(lines[2], '| model | 大 |');
});

test('跨行跨列表 → ok，输出与 cross_table.md 同构（5 列、跨格内容重复填充）', () => {
  // 从整页 HTML 抽出 <table>...</table>
  const m = crossHtml.match(/<table[\s\S]*?<\/table>/);
  assert.ok(m, 'cross_table.html 应含一个 table');
  const r = convertTable(m[0]);
  assert.equal(r.status, 'ok');
  const rows = r.markdown.split('\n');
  // 表头行 5 列：时间 | 上午 | 上午 | 下午 | 下午
  assert.equal(rows[0], '| 时间 | 上午 | 上午 | 下午 | 下午 |');
  assert.equal(rows[1], '| --- | --- | --- | --- | --- |');
  // 数据行 5 列、周一重复 2 次（rowspan 填充）
  assert.equal(rows[2], '| 时间 | 第1节 | 第2节 | 第3节 | 第4节 |');
  assert.equal(rows[3], '| 周一 | 语文 | 数学 | 英语 | 体育 |');
  assert.equal(rows[4], '| 周一 | 物理 | 化学 | 生物 | 历史 |');
});

test('单元格内 | 被转义、换行被空格化', () => {
  const r = convertTable(`<table><thead><tr><th>A</th></tr></thead>
    <tbody><tr><td>x|y</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.ok(r.markdown.includes('\\|'), '管道符转义');
});

test('行内格式：<code>→反引号、<a href>→[text](url)、<strong>→**', () => {
  const r = convertTable(`<table><thead><tr><th>H</th></tr></thead><tbody>
    <tr><td><a href="/x"><code>model</code></a> <strong>重要</strong></td></tr>
    </tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.match(r.markdown, /\[`model`\]\(\/x\)/);
  assert.match(r.markdown, /\*\*重要\*\*/);
});

test('无 <th> 表 → failed（reason=no header）', () => {
  const r = convertTable(`<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /no.*header/i);
});

test('单元格嵌套 <table>/<pre> 块级内容 → failed', () => {
  const r = convertTable(`<table><thead><tr><th>H</th></tr></thead><tbody>
    <tr><td><pre>code</pre></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /nested|block/i);
});

test('空表 → failed', () => {
  const r = convertTable(`<table></table>`);
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /empty/i);
});

test('退化空网格（全空单元格）→ failed', () => {
  const r = convertTable(`<table><thead><tr><th></th></tr></thead><tbody><tr><td></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/table2md-self.test.mjs`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 `script/lib/table2md-self.mjs`**

```js
// script/lib/table2md-self.mjs
// self 引擎（默认）：jsdom 建 DOM → 共享 expandTableSpans → 手写 GFM 管道表
// 序列化（行内 code/a/strong/em）→ 纯结构校验。单 jsdom 依赖（spec §14）。
// 表头判定与参考项目一致：仅首行全 <th> 才作表头；否则判 failed（不合成）。
import { JSDOM } from 'jsdom';
import { expandTableSpans } from './expand-table-spans.mjs';

const BLOCK_LEVEL = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|PRE|DIV|P|H[1-6]|FIGURE|BLOCKQUOTE)$/;

// 行内格式序列化：递归遍历 cell 子节点，产出 GFM 行内 markdown
function inline(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' '); // 文本：折叠空白
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  const inner = [...node.childNodes].map(inline).join('');
  switch (tag) {
    case 'CODE': return '`' + inner + '`';
    case 'A': {
      const href = node.getAttribute('href') || '';
      return href ? `[${inner}](${href})` : inner;
    }
    case 'STRONG': case 'B': return `**${inner}**`;
    case 'EM': case 'I': return `*${inner}*`;
    case 'BR': return ' ';
    case 'IMG': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return src ? `![${alt}](${src})` : alt;
    }
    default:
      // 块级元素出现在单元格内 → 抛信号，外层判 failed
      if (BLOCK_LEVEL.test(tag)) throw new Error('nested block content');
      return inner;
  }
}

function cellText(cell) {
  // 转义管道符与换行
  return [...cell.childNodes].map(inline).join('').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

export function convertTable(htmlString) {
  let doc;
  try {
    doc = new JSDOM(`<html><body>${htmlString}</body></html>`).window.document;
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `parse error: ${e.message}` };
  }
  const table = doc.querySelector('table');
  if (!table) return { markdown: null, status: 'failed', reason: 'no <table>' };

  try { expandTableSpans(doc); } catch (e) {
    return { markdown: null, status: 'failed', reason: `expand error: ${e.message}` };
  }

  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (trs.length === 0) return { markdown: null, status: 'failed', reason: 'empty table (no rows)' };

  // 取每行单元格
  const rows = trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName)));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) return { markdown: null, status: 'failed', reason: 'empty table (no columns)' };

  // 表头判定：首行必须全 <th>
  const first = rows[0];
  const headerOk = first.length === width && first.every((c) => c.tagName === 'TH');
  if (!headerOk) return { markdown: null, status: 'failed', reason: 'no <th> header (first row not all th)' };

  // 矩形校验 + 非空校验
  for (const r of rows) {
    if (r.length !== width) return { markdown: null, status: 'failed', reason: `ragged row (got ${r.length}, want ${width})` };
  }
  const allEmpty = rows.every((r) => r.every((c) => !c.textContent.trim()));
  if (allEmpty) return { markdown: null, status: 'failed', reason: 'degenerate empty grid' };

  // 序列化（cellText 可能抛 nested block）
  let grid;
  try {
    grid = rows.map((r) => r.map(cellText));
  } catch (e) {
    return { markdown: null, status: 'failed', reason: e.message };
  }

  const lines = [];
  lines.push('| ' + grid[0].join(' | ') + ' |');
  lines.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < grid.length; i++) lines.push('| ' + grid[i].join(' | ') + ' |');
  const markdown = lines.join('\n');

  // 无残留 HTML 标签 / 无未展开占位符
  if (/<[a-zA-Z]/.test(markdown)) return { markdown: null, status: 'failed', reason: 'residual HTML tag in output' };
  if (/\{\{LONG_TEXT_\d+/.test(markdown)) return { markdown: null, status: 'failed', reason: 'unresolved LONG_TEXT placeholder' };

  return { markdown, status: 'ok' };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/table2md-self.test.mjs`
Expected: PASS。先 `pnpm add jsdom`（见 Task 3 统一加依赖；本任务先临时加 jsdom 让测试可跑，Task 3 补 turndown 系）。

- [ ] **Step 5: 提交**

```bash
git add script/lib/table2md-self.mjs test/unit/table2md-self.test.mjs package.json pnpm-lock.yaml
git commit -m "feat(table2md): self 引擎——jsdom+手写 GFM 序列化+纯结构校验

convertTable(html)→{markdown,status,reason}。首行全 <th> 才表头、
无 th 判 failed；行内 code/a/strong/em 保真；嵌套块级内容/空表/
退化网格判 failed。跨行跨列表输出与 .temp/cross_table 同构。
"
```

---

## Task 3: turndown 引擎（备选）+ 依赖

**Files:**
- Create: `script/lib/table2md-turndown.mjs`
- Test: `test/unit/table2md-turndown.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `expandTableSpans(document)` from Task 1。
- Produces: `export function convertTable(htmlString) → { markdown, status, reason }`——同 self 接口。内部：jsdom window + expandTableSpans + turndown+gfm 转换 + 校验（首行全 th 判表头，否则 failed；嵌套块级/空表 failed）。

- [ ] **Step 1: 加依赖**

```bash
pnpm add turndown turndown-plugin-gfm jsdom
```
（jsdom 已在 Task 2 加入；pnpm 会去重。）

- [ ] **Step 2: 写失败测试 `test/unit/table2md-turndown.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertTable as convertSelf } from '../../script/lib/table2md-self.mjs';
import { convertTable as convertTd } from '../../script/lib/table2md-turndown.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const crossHtml = fs.readFileSync(
  path.resolve(thisDir, '../../.temp/cross_table/cross_table.html'), 'utf8');

test('turndown 引擎：正常表 → ok 含表头/分隔/数据行', () => {
  const r = convertTd(`<table><thead><tr><th>S</th><th>I</th></tr></thead><tbody><tr><td>m</td><td>L</td></tr></tbody></table>`);
  assert.equal(r.status, 'ok');
  assert.match(r.markdown, /\| S \| I \|/);
  assert.match(r.markdown, /\| --- \| --- \|/);
});

test('turndown 引擎：跨行跨列表与 self 输出等价（5 列对齐）', () => {
  const m = crossHtml.match(/<table[\s\S]*?<\/table>/);
  const a = convertSelf(m[0]);
  const b = convertTd(m[0]);
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  // 列数一致（按 | 分隔的列数）
  const cols = (md) => md.split('\n')[0].split('|').filter((x) => x.trim() !== '').length;
  assert.equal(cols(a.markdown), cols(b.markdown));
  assert.equal(cols(b.markdown), 5);
});

test('turndown 引擎：无 <th> → failed', () => {
  const r = convertTd(`<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});

test('turndown 引擎：嵌套块级内容 → failed', () => {
  const r = convertTd(`<table><thead><tr><th>H</th></tr></thead><tbody><tr><td><pre>x</pre></td></tr></tbody></table>`);
  assert.equal(r.status, 'failed');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test test/unit/table2md-turndown.test.mjs`
Expected: FAIL（module not found）

- [ ] **Step 4: 实现 `script/lib/table2md-turndown.mjs`**

```js
// script/lib/table2md-turndown.mjs
// turndown 引擎（备选）：jsdom window + 共享 expandTableSpans + turndown+
// turndown-plugin-gfm 转换。与 .temp/cross_table 同栈。同 self 接口。
// 表头判定同 self：首行全 <th> 才表头，否则 failed（不依赖 turndown 的
// isHeadingRow，统一由本层校验，保证两引擎判定一致）。
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { expandTableSpans } from './expand-table-spans.mjs';

const BLOCK_LEVEL = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|PRE|DIV|P|H[1-6]|FIGURE|BLOCKQUOTE)$/;

function hasNestedBlock(table) {
  for (const cell of table.querySelectorAll('td,th')) {
    if (cell.querySelector(BLOCK_LEVEL.source.replace(/[()^$]/g,'').split('|').join(','))) {}
    for (const el of cell.querySelectorAll('*')) {
      if (BLOCK_LEVEL.test(el.tagName)) return true;
    }
  }
  return false;
}

export function convertTable(htmlString) {
  let dom, window;
  try {
    dom = new JSDOM(`<html><body>${htmlString}</body></html>`);
    window = dom.window;
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `parse error: ${e.message}` };
  }
  const doc = window.document;
  const table = doc.querySelector('table');
  if (!table) return { markdown: null, status: 'failed', reason: 'no <table>' };

  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (trs.length === 0) return { markdown: null, status: 'failed', reason: 'empty table (no rows)' };
  const rows = trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName)));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) return { markdown: null, status: 'failed', reason: 'empty table (no columns)' };

  // 首行全 th 判定（两引擎一致）
  const first = rows[0];
  if (!(first.length === width && first.every((c) => c.tagName === 'TH')))
    return { markdown: null, status: 'failed', reason: 'no <th> header (first row not all th)' };

  if (hasNestedBlock(table)) return { markdown: null, status: 'failed', reason: 'nested block content in cell' };

  // 矩形校验
  for (const r of rows) if (r.length !== width)
    return { markdown: null, status: 'failed', reason: `ragged row (got ${r.length}, want ${width})` };

  try { expandTableSpans(doc); } catch (e) {
    return { markdown: null, status: 'failed', reason: `expand error: ${e.message}` };
  }

  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  turndown.use(gfm);
  let markdown;
  try {
    markdown = turndown.turndown(table.outerHTML).trim();
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `turndown error: ${e.message}` };
  }

  if (/\{\{LONG_TEXT_\d+/.test(markdown)) return { markdown: null, status: 'failed', reason: 'unresolved LONG_TEXT placeholder' };
  return { markdown, status: 'ok' };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/unit/table2md-turndown.test.mjs`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add script/lib/table2md-turndown.mjs test/unit/table2md-turndown.test.mjs package.json pnpm-lock.yaml
git commit -m "feat(table2md): turndown 备选引擎 + jsdom/turndown/gfm 依赖

与 self 同接口、同表头判定（首行全 th）。跨行跨列表与 self 输出
等价校验。默认仍用 self，不满意时切 turndown。
"
```

---

## Task 4: 引擎选择器 + 2_tables.json 与诊断日志

**Files:**
- Create: `script/lib/table2md.js`
- Test: `test/unit/table2md.test.mjs`

**Interfaces:**
- Consumes: `convertTable` from `table2md-self.mjs` / `table2md-turndown.mjs`（Task 2/3）；`longTextMap`（步骤 2 shared 段产出的 `2_long_text.json` 内容）。
- Produces: `export async function convertTables(tableList, { engine, longTextMap, logsDir }) → { tables: Object, counts: {total, ok, failed} }`——
  - `tableList` = `[{k, dataIdx, outerHTML, rows, cols}]`（来自 `page-collect-tables.js`）。
  - 对每表：正则预展开 `{{LONG_TEXT_k|n_chars}}`/`{{LONG_TEXT_k|n_words}}` → `longTextMap[k]` 原文；调 `convertTable(expandedHtml)`；按 spec §4.2 schema 存 `tables[String(k)]`。
  - 失败：写 `<logsDir>/{k}_{dataIdx}.log`（原始 outerHTML 截断 2000 字符 + reason + engine + rows×cols）。
  - `engine` 默认 `'self'`。

- [ ] **Step 1: 写失败测试 `test/unit/table2md.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertTables } from '../../script/lib/table2md.js';

test('convertTables：成功表存 markdown、失败表存 reason + 日志', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [
    { k: 1, dataIdx: '100', outerHTML: `<table><thead><tr><th>S</th><th>I</th></tr></thead><tbody><tr><td>m</td><td>L</td></tr></tbody></table>`, rows: 2, cols: 2 },
    { k: 2, dataIdx: '200', outerHTML: `<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>`, rows: 1, cols: 2 }, // 无 th
  ];
  const { tables, counts } = await convertTables(list, { engine: 'self', longTextMap: {}, logsDir });
  assert.equal(counts.total, 2);
  assert.equal(counts.ok, 1);
  assert.equal(counts.failed, 1);
  assert.equal(tables['1'].status, 'ok');
  assert.match(tables['1'].markdown, /\| S \| I \|/);
  assert.equal(tables['2'].status, 'failed');
  assert.equal(tables['2'].markdown, null);
  assert.match(tables['2'].reason, /no.*header/i);
  // 日志文件
  const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
  assert.ok(logFiles.some((f) => f.includes('2_200')), '失败表落日志');
  fs.rmSync(logsDir, { recursive: true, force: true });
});

test('convertTables：预展开表内 {{LONG_TEXT_k|n_chars}} → 原文', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [{ k: 1, dataIdx: '10', rows: 2, cols: 1,
    outerHTML: `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>{{LONG_TEXT_3|8_chars}}</td></tr></tbody></table>` }];
  const longTextMap = { '3': '长文本原文' };
  const { tables } = await convertTables(list, { engine: 'self', longTextMap, logsDir });
  assert.equal(tables['1'].status, 'ok');
  assert.match(tables['1'].markdown, /长文本原文/);
  fs.rmSync(logsDir, { recursive: true, force: true });
});

test('convertTables：engine 选 turndown', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-t2m-'));
  const list = [{ k: 1, dataIdx: '1', rows: 2, cols: 1,
    outerHTML: `<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>` }];
  const { tables } = await convertTables(list, { engine: 'turndown', longTextMap: {}, logsDir });
  assert.equal(tables['1'].status, 'ok');
  assert.equal(tables['1'].engine, 'turndown');
  fs.rmSync(logsDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/table2md.test.mjs`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 `script/lib/table2md.js`**

```js
// script/lib/table2md.js
// 引擎选择器：预展开表内 {{LONG_TEXT_k|...}} → 调 self|turndown 引擎 →
// 存 2_tables.json schema + 失败落 logs/tables/ 诊断日志。
import fs from 'node:fs/promises';
import path from 'node:path';

const LONG_TEXT_RE = /\{\{LONG_TEXT_(\d+)(?:\|[^}]*)?\}\}/g;

function expandLongText(html, longTextMap) {
  return html.replace(LONG_TEXT_RE, (match, id) =>
    Object.prototype.hasOwnProperty.call(longTextMap, id) ? longTextMap[id] : match);
}

export async function convertTables(tableList, { engine = 'self', longTextMap = {}, logsDir } = {}) {
  const mod = engine === 'turndown'
    ? await import('./table2md-turndown.mjs')
    : await import('./table2md-self.mjs');
  const convertTable = mod.convertTable;

  const tables = {};
  let ok = 0, failed = 0;
  for (const t of tableList) {
    const expanded = expandLongText(t.outerHTML, longTextMap);
    const r = convertTable(expanded);
    tables[String(t.k)] = {
      dataIdx: t.dataIdx,
      html: t.outerHTML, // 原始（含占位符，诊断用）
      markdown: r.status === 'ok' ? r.markdown : null,
      status: r.status,
      engine,
      rows: t.rows,
      cols: t.cols,
    };
    if (r.status === 'ok') ok++;
    else {
      failed++;
      if (logsDir) {
        const snippet = t.outerHTML.length > 2000 ? t.outerHTML.slice(0, 2000) + '\n…[truncated]' : t.outerHTML;
        const logText = `engine: ${engine}\ndataIdx: ${t.dataIdx}\nshape: ${t.rows}×${t.cols}\nreason: ${r.reason}\n\n--- outerHTML ---\n${snippet}\n`;
        await fs.mkdir(logsDir, { recursive: true });
        await fs.writeFile(path.join(logsDir, `${t.k}_${t.dataIdx}.log`), logText, 'utf8');
      }
    }
  }
  return { tables, counts: { total: tableList.length, ok, failed } };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/table2md.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/lib/table2md.js test/unit/table2md.test.mjs
git commit -m "feat(table2md): 引擎选择器——预展开长文本+落 2_tables.json+诊断日志

convertTables(list,{engine,longTextMap,logsDir})。成功存 markdown、
失败存 reason + 写 logs/tables/{k}_{dataIdx}.log。默认 self、可切 turndown。
"
```

---

## Task 5: page-collect-tables.js（收集 pass）

**Files:**
- Create: `script/lib/page-collect-tables.js`
- Test: `test/unit/page-collect-tables.test.mjs`

**Interfaces:**
- Produces: `function __u2mCollectTables()`——在浏览器 evaluate 中执行，返回 `[{k, dataIdx, outerHTML, rows, cols}]`（文档序、跳过 `[hidden]` 表）。`rows`/`cols` 用 `table.querySelectorAll('tr')`（filter 最近 table）行数 + 各行 colspan 之和最大值。复用 `page-clean-snapshot.js` 现有 `tableRowsCols` 语义但内联实现（独立 pass、不依赖 expando）。

- [ ] **Step 1: 写失败测试 `test/unit/page-collect-tables.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-collect-tables.js');

test('page-collect-tables.js: 文件存在且含 __u2mCollectTables', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mCollectTables'), '应定义 __u2mCollectTables');
});

test('__u2mCollectTables: 可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.doesNotThrow(() => new Function('return (' + src + ')()'));
});

// 用 jsdom 跑真实 DOM 验证收集逻辑
import { JSDOM } from 'jsdom';
function run(src, html) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'return (' + src + ')()');
  return fn(dom.window.document);
}

test('__u2mCollectTables: 文档序编号、跳过 [hidden] 表、colspan 展开列数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const html = `
    <table data-idx="10" hidden><thead><tr><th>H</th></tr></thead></table>
    <table data-idx="20"><thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td colspan="2">合并</td></tr></tbody></table>`;
  const list = run(src, html);
  assert.equal(list.length, 1, 'hidden 表跳过');
  assert.equal(list[0].k, 1, '编号从 1、跳过 hidden 后紧接');
  assert.equal(list[0].dataIdx, '20');
  assert.equal(list[0].rows, 2);
  assert.equal(list[0].cols, 2, 'colspan=2 展开为 2 列');
  assert.match(list[0].outerHTML, /<table[^>]*data-idx="20"/);
});

test('__u2mCollectTables: 嵌套表行归属最近 table（外层不计内层行）', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const html = `<table data-idx="1"><tbody><tr><td>外</td>
    <td><table data-idx="2"><tbody><tr><td>内</td></tr></tbody></table></td></tr></tbody></table>`;
  const list = run(src, html);
  assert.equal(list.length, 2);
  const outer = list.find((t) => t.dataIdx === '1');
  const inner = list.find((t) => t.dataIdx === '2');
  assert.equal(outer.rows, 1, '外层只 1 行（内层行不计）');
  assert.equal(inner.rows, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/page-collect-tables.test.mjs`
Expected: FAIL（file not found）

- [ ] **Step 3: 实现 `script/lib/page-collect-tables.js`**

```js
// script/lib/page-collect-tables.js
// styled 趟收集 pass：在长文本折叠后、任何 table 折叠前，按文档序收集每表
// {k, dataIdx, outerHTML, rows, cols}。跳过 [hidden] 表（由 K5 独占折叠）。
// rows = 本表直接 tr 数（嵌套表行归属最近 table）；cols = 各行 colspan 之和
// 的最大值。供 Node 层跑转换引擎。
function __u2mCollectTables() {
  var tables = document.querySelectorAll('table');
  var out = [];
  var k = 0;
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue; // K5 独占
    k++;
    var trs = tb.querySelectorAll('tr');
    var rows = 0, cols = 0;
    for (var r = 0; r < trs.length; r++) {
      if (trs[r].closest('table') !== tb) continue; // 行归属最近 table
      rows++;
      var c = 0;
      var cells = trs[r].children;
      for (var c2 = 0; c2 < cells.length; c2++) {
        var tag = cells[c2].tagName;
        if (tag !== 'TD' && tag !== 'TH') continue;
        var cs = parseInt(cells[c2].getAttribute('colspan'), 10);
        c += cs > 1 ? cs : 1;
      }
      if (c > cols) cols = c;
    }
    out.push({ k: k, dataIdx: tb.getAttribute('data-idx') || '', outerHTML: tb.outerHTML, rows: rows, cols: cols });
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/page-collect-tables.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/lib/page-collect-tables.js test/unit/page-collect-tables.test.mjs
git commit -m "feat(step2): page-collect-tables 收集 pass——文档序收集表元数据

跳过 [hidden] 表、嵌套表行归属最近 table、colspan 展开列数。
供 Node 层转换引擎消费。
"
```

---

## Task 6: page-fold-tables.js（styled 折叠 pass）

**Files:**
- Create: `script/lib/page-fold-tables.js`
- Test: `test/unit/page-fold-tables.test.mjs`

**Interfaces:**
- Consumes: `resultByDataIdx` = `{ "<dataIdx>": {k, status, rows, cols} }`（来自 Task 4 的转换结果，由 clean_snapshot.mjs 构造）。
- Produces: `function __u2mFoldTables(resultByDataIdx)`——在 styled 趟 DOM 上执行：对每个非 hidden 的 `<table>` 按 `data-idx` 查 status，`ok` → 清空子树、放 `{{TABLE_k|rows×cols}}` 文本节点；`failed`/缺失 → 保留 live、设 `data-u2m-table="fail"` 属性。

- [ ] **Step 1: 写失败测试 `test/unit/page-fold-tables.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-fold-tables.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFoldTables', () => {
  assert.ok(src().includes('function __u2mFoldTables'));
});

function run(html, resultByDataIdx) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'resultByDataIdx', 'return (' + src() + ')(resultByDataIdx)');
  fn(dom.window.document, resultByDataIdx);
  return dom.window.document;
}

test('成功表折叠为 {{TABLE_k|rows×cols}} 文本、失败表保 live + data-u2m-table=fail', () => {
  const html = `
    <table data-idx="10"><thead><tr><th>H</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>
    <table data-idx="20"><tbody><tr><td>无表头</td></tr></tbody></table>`;
  const doc = run(html, { '10': { k: 1, status: 'ok', rows: 2, cols: 1 }, '20': { k: 2, status: 'failed', rows: 1, cols: 1 } });
  const t1 = doc.querySelector('table[data-idx="10"]');
  const t2 = doc.querySelector('table[data-idx="20"]');
  assert.equal(t1.textContent, '{{TABLE_1|2×1}}');
  assert.equal(t1.children.length, 0, '成功表子树清空');
  assert.equal(t2.getAttribute('data-u2m-table'), 'fail');
  assert.ok(t2.querySelector('td'), '失败表保 live 子树');
});

test('[hidden] 表不被折叠（K5 独占）', () => {
  const html = `<table data-idx="30" hidden><tbody><tr><td>x</td></tr></tbody></table>`;
  const doc = run(html, { '30': { k: 1, status: 'ok', rows: 1, cols: 1 } });
  const t = doc.querySelector('table[data-idx="30"]');
  assert.ok(t.querySelector('td'), 'hidden 表子树保留');
  assert.equal(t.textContent.includes('{{TABLE'), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/page-fold-tables.test.mjs`
Expected: FAIL（file not found）

- [ ] **Step 3: 实现 `script/lib/page-fold-tables.js`**

```js
// script/lib/page-fold-tables.js
// styled 趟折叠 pass：在 Node 层转换完成后，对 styled DOM 的每个非 hidden
// <table> 按 data-idx 查 status：ok → 清空子树放 {{TABLE_k|rows×cols}} 文本
// 节点（与 clean 趟 K6 同形、k 一致）；failed/缺失 → 保 live、打
// data-u2m-table="fail" 供步骤 5 识别（步骤 5 用 closest('table') 统一剥
// 样式，标记主要供诊断/trans2img）。
function __u2mFoldTables(resultByDataIdx) {
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue; // K5 独占
    var dataIdx = tb.getAttribute('data-idx') || '';
    var r = resultByDataIdx[dataIdx];
    if (r && r.status === 'ok') {
      while (tb.firstChild) tb.removeChild(tb.firstChild);
      tb.appendChild(document.createTextNode('{{TABLE_' + r.k + '|' + r.rows + '×' + r.cols + '}}'));
    } else {
      tb.setAttribute('data-u2m-table', 'fail');
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/page-fold-tables.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/lib/page-fold-tables.js test/unit/page-fold-tables.test.mjs
git commit -m "feat(step2): page-fold-tables 折叠 pass——成功表折叠/失败表保live

ok→{{TABLE_k|rows×cols}} 文本（与 clean K6 同形、k 一致）；
failed/缺失→保 live + data-u2m-table=fail。hidden 表跳过。
"
```

---

## Task 7: page-clean-snapshot.js——K6 改占位符 + styled 趟收集并入返回

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（K6 段 ~L500-514；styled 趟 return ~L357-361）
- Test: `test/unit/clean-snapshot.test.mjs`（扩展）

**Interfaces:**
- 改 K6：`tb.appendChild(document.createTextNode('{{TABLE_' + k + '|' + shape.rows + '×' + shape.cols + '}}'))`，`k` 为本趟文档序计数器（跳过 hidden，与 `__u2mCollectTables` 一致）。
- 改 styled 趟 return：增 `tables` 字段——在 return 前调 `__u2mCollectTables()`（注入同页），把结果并入 `{html, longTextCount, longTexts, tables}`。

- [ ] **Step 1: 写失败测试（扩展 `test/unit/clean-snapshot.test.mjs`）**

在文件末尾追加（沿用现有 `runClean` 基座）：

```js
test('clean_snapshot: clean 趟 K6 折叠为 {{TABLE_k|rows×cols}}（替换 TABLE_TAG）', async () => {
  const snap = `<!DOCTYPE html><html><body>
    <table data-idx="5"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <table data-idx="6" hidden><tbody><tr><td>h</td></tr></tbody></table>
    <table data-idx="7"><thead><tr><th>C</th></tr></thead><tbody><tr><td>3</td></tr></tbody></table>
    </body></html>`;
  const r = await runClean(snap, 'k6-table');
  // clean 版：表 5 → {{TABLE_1|2×2}}，hidden 表 6 → {{HIDDEN_TAG...}}，表 7 → {{TABLE_2|2×1}}
  assert.match(r.cleaned, /\{\{TABLE_1\|2×2\}\}/);
  assert.match(r.cleaned, /\{\{TABLE_2\|2×1\}\}/);
  assert.equal(r.cleaned.includes('TABLE_TAG'), false, '旧 TABLE_TAG 不再出现');
  // hidden 表不被编入 k 序列
  assert.equal((r.cleaned.match(/\{\{TABLE_\d+/g) || []).length, 2);
  r.cleanup();
});

test('clean_snapshot: styled 趟返回 tables 收集列表（含 outerHTML/形状）', async () => {
  const snap = `<!DOCTYPE html><html><body>
    <table data-idx="5"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    </body></html>`;
  const r = await runClean(snap, 'styled-table');
  // styled 返回的 tables 由 clean_snapshot.mjs 消费；此处间接验证：
  // 2_tables.json 应生成（clean_snapshot.mjs 跑了转换）。见 Task 8 完整验证。
  // 本测只验 styled.html 仍含 live 表（折叠由 Task 8 的 fold 调度完成）。
  assert.match(r.styled, /data-idx="5"/);
  r.cleanup();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: FAIL（`{{TABLE_k|...}}` 不匹配——当前是 `{{TABLE_TAG|...}}`）

- [ ] **Step 3: 改 K6（`page-clean-snapshot.js` ~L500-514）**

把 K6 的 token 行：

```js
    tb.appendChild(document.createTextNode('{{TABLE_TAG|' + shape.rows + '_rows|' + shape.cols + '_cols}}'));
```

改为（外层 K6 循环前新增 `var tableK = 0;`，循环内 hidden 跳过后 `tableK++`）：

```js
  var tableK = 0;
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue;
    tableK++;
    var shape = tb.__u2mTableShape;
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    tb.appendChild(document.createTextNode('{{TABLE_' + tableK + '|' + shape.rows + '×' + shape.cols + '}}'));
  }
```

- [ ] **Step 4: 改 styled 趟 return（~L357-361），并入收集列表**

在 `return { html: ..., longTextCount: k, longTexts: longTexts };` 前，注入并调用 `__u2mCollectTables`。由于 `page-clean-snapshot.js` 是注入文本，需在文件顶部用 `readSharedScript` 同机制把 `page-collect-tables.js` 也读入并拼在 `__u2mCleanSnapshot` 可见作用域。**实现**：`clean_snapshot.mjs` 在 evaluate 前把 `page-collect-tables.js` 源码拼到 `pageCleanFn` 前（见 Task 8 Step 3），使 `__u2mCollectTables` 在 evaluate 作用域内可调。本步先在 styled return 前加调用：

```js
    var tablesCollected = (typeof __u2mCollectTables === 'function') ? __u2mCollectTables() : [];

    return {
      html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
      longTextCount: k,
      longTexts: longTexts,
      tables: tablesCollected
    };
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: PASS（K6 测试通过；styled-table 测试在 Task 8 注入 `__u2mCollectTables` 后才完整，本步先确保不破坏现有用例——若 styled 返回 tables 为空数组因函数未注入，styled-table 测仍过因其只检 styled.html 含 data-idx）。

- [ ] **Step 6: 提交**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "refactor(step2): K6 折叠改 {{TABLE_k|rows×cols}} + styled 趟收集 tables

K6 用文档序 k（跳过 hidden、与收集 pass 一致）替换旧 TABLE_TAG 形状
token。styled 趟 return 增 tables 收集列表供 Node 层转换。
"
```

---

## Task 8: clean_snapshot.mjs——转换调度 + 2_tables.json + fold + emit

**Files:**
- Modify: `script/clean_snapshot.mjs`
- Test: `test/unit/clean-snapshot.test.mjs`（扩展）

**Interfaces:**
- 读 `styled.tables`（Task 7）+ `styled.longTexts` → `convertTables`（Task 4）→ `2_tables.json` + `logs/tables/`。
- 构造 `resultByDataIdx`（`{dataIdx: {k,status,rows,cols}}`）→ 注入 `page-fold-tables.js` 在 styled DOM 上跑 fold → `page.content()` 序列化 folded styled HTML。
- 注入 `page-collect-tables.js` 与 `page-fold-tables.js` 源码到 evaluate 作用域（拼在 `pageCleanFn` 前，使 `__u2mCollectTables`/`__u2mFoldTables` 可见）。
- emit 增 `tables: {total, ok, failed}`、`tablesJson` 路径。
- `--table-engine` 参数 + `U2M_TABLE_ENGINE` 环境变量（默认 `self`）。

- [ ] **Step 1: 写失败测试（扩展 `test/unit/clean-snapshot.test.mjs`）**

```js
test('clean_snapshot: 成功表 styled 版折叠为占位、2_tables.json 存 markdown', async () => {
  const snap = `<!DOCTYPE html><html><body>
    <table data-idx="5"><thead><tr><th>S</th><th>I</th></tr></thead><tbody><tr><td>m</td><td>L</td></tr></tbody></table>
    </body></html>`;
  const r = await runClean(snap, 'ok-table', { U2M_TABLE_ENGINE: 'self' });
  assert.match(r.styled, /\{\{TABLE_1\|2×2\}\}/, 'styled 成功表折叠');
  const tablesJson = JSON.parse(fs.readFileSync(path.join(path.dirname(r.out.cleanedSnapshot), '2_tables.json'), 'utf8'));
  assert.equal(tablesJson['1'].status, 'ok');
  assert.match(tablesJson['1'].markdown, /\| S \| I \|/);
  assert.equal(r.out.tables.ok, 1);
  r.cleanup();
});

test('clean_snapshot: 失败表 styled 保 live + data-u2m-table=fail + 诊断日志', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-fail-'));
  const url = 'https://example.com/fail-table';
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    `<!DOCTYPE html><html><body><table data-idx="5"><tbody><tr><td>无表头</td></tr></tbody></table></body></html>`);
  const rs = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(rs.code, 0, `stderr: ${rs.stderr}`);
  const out = JSON.parse(rs.stdout);
  assert.equal(out.tables.failed, 1);
  const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
  assert.match(styled, /data-u2m-table="fail"/);
  assert.equal(styled.includes('{{TABLE_1'), false, '失败表未折叠');
  const logFiles = fs.readdirSync(path.join(dir, 'logs', 'tables')).filter((f) => f.endsWith('.log'));
  assert.ok(logFiles.length >= 1, '诊断日志生成');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot: k 在 clean 与 styled 两版一致', async () => {
  const snap = `<!DOCTYPE html><html><body>
    <table data-idx="5"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
    <table data-idx="6"><thead><tr><th>B</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>
    </body></html>`;
  const r = await runClean(snap, 'k-consistency', { U2M_TABLE_ENGINE: 'self' });
  assert.match(r.cleaned, /\{\{TABLE_1\|2×1\}\}/);
  assert.match(r.cleaned, /\{\{TABLE_2\|2×1\}\}/);
  assert.match(r.styled, /\{\{TABLE_1\|2×1\}\}/);
  assert.match(r.styled, /\{\{TABLE_2\|2×1\}\}/);
  r.cleanup();
});

test('clean_snapshot: --table-engine 参数 + U2M_TABLE_ENGINE 默认 self', async () => {
  const snap = `<!DOCTYPE html><html><body><table data-idx="5"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></body></html>`;
  const r = await runClean(snap, 'engine-flag', { U2M_TABLE_ENGINE: 'turndown' });
  const tablesJson = JSON.parse(fs.readFileSync(path.join(path.dirname(r.out.cleanedSnapshot), '2_tables.json'), 'utf8'));
  assert.equal(tablesJson['1'].engine, 'turndown');
  r.cleanup();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: FAIL（`out.tables` 不存在、styled 未折叠）

- [ ] **Step 3: 实现 `script/clean_snapshot.mjs` 改动**

(a) 顶部 import：
```js
import { convertTables } from './lib/table2md.js';
```

(b) `parseArgs` 已支持 `--table-engine`（通用 `--key val` 解析）。engine 解析（在 main 内）：
```js
  const engine = args['table-engine'] || process.env.U2M_TABLE_ENGINE || 'self';
  if (engine !== 'self' && engine !== 'turndown') return usage(`--table-engine 仅支持 self|turndown`);
```

(c) 读入两个新 page 脚本源码，拼到 `pageCleanFn` 前使函数在 evaluate 作用域可见：
```js
  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');
  const collectTablesFn = await readSharedScript('page-collect-tables.js');
  const foldTablesFn = await readSharedScript('page-fold-tables.js');
  // 拼接：collect/fold 定义在前，clean 函数体引用它们时可见
  const combinedStyled = collectTablesFn + '\n' + pageCleanFn;
  const combinedFold = foldTablesFn; // 单独 evaluate fold
```

(d) styled 趟改为用 `combinedStyled` 并在返回后跑转换 + fold + 序列化：
```js
    // 趟 1（styled）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const styled = await page.evaluate(`(${combinedStyled})(${JSON.stringify({ mode: 'styled' })})`);
    // 注意：pageCleanFn 内 return 处调 __u2mCollectTables（已由拼接注入）

    // ── Node 层转换 ──
    const longTextMap = styled.longTexts || {};
    const logsDir = path.join(dir, 'logs', 'tables');
    const { tables: tablesJson, counts: tableCounts } = await convertTables(styled.tables || [], { engine, longTextMap, logsDir });
    const tablesJsonPath = path.join(dir, '2_tables.json');
    await fsPromises.writeFile(tablesJsonPath, JSON.stringify(tablesJson, null, 2), 'utf8');

    // 构造 resultByDataIdx 供 fold
    const resultByDataIdx = {};
    for (const [k, info] of Object.entries(tablesJson)) {
      resultByDataIdx[info.dataIdx] = { k: Number(k), status: info.status, rows: info.rows, cols: info.cols };
    }

    // ── styled fold（同页 DOM、evaluate 间状态保留）──
    await page.evaluate(`(${combinedFold})(${JSON.stringify(resultByDataIdx)})`);
    const styledHtml = await page.content();

    const styledPath = path.join(dir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, styledHtml, 'utf8');
    const longTextPath = path.join(dir, '2_long_text.json');
    await fsPromises.writeFile(longTextPath, JSON.stringify(styled.longTexts), 'utf8');
```

(e) clean 趟不变（goto 重载、`pageCleanFn` 原 script + K6 已改）：
```js
    // 趟 2（clean）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const clean = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ mode: 'clean' })})`);
    const cleanedPath = path.join(dir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, clean.html, 'utf8');
```

(f) emit 增字段：
```js
    emit({
      status: 'ok',
      cleanedSnapshot: cleanedPath,
      styledSnapshot: styledPath,
      longText: longTextPath,
      longTextCount: styled.longTextCount,
      tables: tableCounts,
      tablesJson: tablesJsonPath,
    });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs
git commit -m "feat(step2): 转换调度+2_tables.json+fold+emit tables 计数

styled 趟→收集→Node 转换→2_tables.json/logs→fold 折叠成功表/
标记失败表→序列化。--table-engine + U2M_TABLE_ENGINE 默认 self。
emit 增 tables{total,ok,failed} + tablesJson。失败不报 error。
"
```

---

## Task 9: page-finalize-inline.js——table 子树删净样式

**Files:**
- Modify: `script/lib/page-finalize-inline.js`（[style] 遍历循环 ~L134-145，仿 `closest('pre')` 加 `closest('table')`）
- Test: `test/unit/finalize-inline.test.mjs`（新）

**Interfaces:**
- 在 finalize 的 `document.querySelectorAll('[style]')` 循环里，`closest('pre')` 分支后新增 `closest('table')` 分支：若元素在 table 子树内（含 table 自身）→ `removeAttribute('style')`、`continue`（跳过白名单/函数值/零值三趟）。成功折叠表已无 `[style]` 单元格子树 → no-op；仅命中失败 live 表。

- [ ] **Step 1: 写失败测试 `test/unit/finalize-inline.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFinalizeInline', () => {
  assert.ok(src().includes('function __u2mFinalizeInline'));
});

// finalize 需 computedMap 参数；传 {} 即可（table 分支在 computedMap 之前）
function run(html) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'return (' + src() + ')({})');
  fn(dom.window.document);
  return dom.window.document;
}

test('失败 live 表子树全部 style 删除', () => {
  const html = `<table data-u2m-table="fail" style="border:1px solid red">
    <thead><tr><th style="background:#eef;font-weight:bold">H</th></tr></thead>
    <tbody><tr><td style="border:1px solid blue;color:red">a</td></tr></tbody></table>`;
  const doc = run(html);
  const table = doc.querySelector('table');
  const th = doc.querySelector('th');
  const td = doc.querySelector('td');
  assert.equal(table.getAttribute('style'), null, 'table 自身 style 删除');
  assert.equal(th.getAttribute('style'), null, 'th style 删除');
  assert.equal(td.getAttribute('style'), null, 'td style 删除');
});

test('成功折叠表（仅文本节点、无 [style] 子树）→ no-op', () => {
  const html = `<table data-idx="5">{{TABLE_1|2×2}}</table>`;
  const doc = run(html);
  // table 无 style 属性 → 循环不命中、无变化
  assert.equal(doc.querySelector('table').getAttribute('style'), null);
  assert.match(doc.body.textContent, /\{\{TABLE_1/);
});

test('表外元素样式不受影响（仍走白名单）', () => {
  const html = `<div style="display:flex;border:1px solid green"><p style="font-size:14px">x</p></div>
    <table><tbody><tr><td style="border:1px solid red">y</td></tr></tbody></table>`;
  const doc = run(html);
  // div 的 display:flex/border 在白名单内、保留
  const div = doc.querySelector('div');
  assert.match(div.getAttribute('style') || '', /display/i);
  assert.match(div.getAttribute('style') || '', /border/i);
  // td 在 table 内 → 删除
  assert.equal(doc.querySelector('td').getAttribute('style'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/finalize-inline.test.mjs`
Expected: FAIL（table 子树 style 未删——当前走白名单保留 border/background）

- [ ] **Step 3: 改 `page-finalize-inline.js`（~L142-145）**

在 `closest('pre')` 分支后、`var st = styled[i].style;` 前新增：

```js
    // table 子树内全部内联样式删净（步骤 2 表格占位符设计）：成功表已折叠为
    // 文本节点、无 [style] 单元格子树 → 此分支对它们 no-op；仅命中失败 live
    // 表（data-u2m-table="fail" 或 styled 趟保留 live 的表）——剥净 border/
    // background/box-shadow 等，到 6_article.html 只剩结构+文本+长文本占位符。
    if (styled[i].closest('table')) {
      styled[i].removeAttribute('style');
      continue;
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/finalize-inline.test.mjs`
Expected: PASS

- [ ] **Step 5: 跑 compute-styles 既有测试防回归**

Run: `node --test test/unit/compute-styles.test.mjs`
Expected: PASS（table 子树样式本就不影响 compute-styles 的布局/标题信号判定；若有用例依赖表内 border 存活则据实修正——但本仓库无此类用例）

- [ ] **Step 6: 提交**

```bash
git add script/lib/page-finalize-inline.js test/unit/finalize-inline.test.mjs
git commit -m "feat(step5): finalize 对 table 子树删净全部内联样式

仿 closest('pre') 分支加 closest('table')：成功折叠表 no-op、
失败 live 表剥净 border/background/box-shadow，只剩结构+文本+
长文本占位符供步骤 7 LLM 语义还原。
"
```

---

## Task 10: screenshot_trans.mjs——{{TABLE_k}} 还原

**Files:**
- Modify: `script/screenshot_trans.mjs`（resolveSkeleton 段 ~L194-213；`resolveSkeletonString` ~L103-125；emit ~L297）
- Test: `test/unit/screenshot-trans.test.mjs`（扩展）

**Interfaces:**
- 在 LONG_TEXT 还原循环后，新增 TABLE 还原：读 `2_tables.json`，对 `resolvedSkeleton` 每条 value 用正则 `/\{\{TABLE_(\d+)(?:\|[^}]*)?\}\}/g` 替换为 `tablesJson[k].markdown`（仅 `status==='ok'`）；未定义/失败 → 保留字面、记入 `failedTables` Set。
- emit 增 `tablesResolved` 计数 + `failedTables` 数组。

- [ ] **Step 1: 写失败测试（扩展 `test/unit/screenshot-trans.test.mjs`）**

在文件末尾追加（沿用现有 runScript + 临时目录模式，参考该文件 `runClean`-like 基座；此处给最小夹具）：

```js
test('screenshot_trans: {{TABLE_k}} 还原为 2_tables.json 的 markdown', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-st-table-'));
  const url = 'https://example.com/table-restore';
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  // 1_snapshot（步骤 8 live 重渲染用死端口兜底——无 trans2img 条目即可跳过浏览器）
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), `<!DOCTYPE html><html><body><h1 data-idx="1">t</h1></body></html>`);
  fs.writeFileSync(path.join(dir, '2_long_text.json'), '{}');
  fs.writeFileSync(path.join(dir, '2_tables.json'), JSON.stringify({
    '1': { dataIdx: '5', markdown: '| S | I |\n| --- | --- |\n| m | L |', status: 'ok', engine: 'self', rows: 2, cols: 2 },
    '2': { dataIdx: '6', markdown: null, status: 'failed', reason: 'no header', engine: 'self', rows: 1, cols: 1 },
  }, null, 2));
  fs.writeFileSync(path.join(dir, '3_key_ids.json'), JSON.stringify({ titleId: '1', descriptionIds: [], paragraphIds: [], dumpIds: [] }));
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
    { h1: '# t' },
    { table: '{{TABLE_1}}' },
    { table: '{{TABLE_2}}' },
    { table: '| 已是 | 具体 |\n| --- | --- |\n| md | ! |' },
  ], null, 2));
  const r = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tablesResolved, 1);
  assert.deepEqual(out.failedTables, ['2']);
  const resolved = JSON.parse(fs.readFileSync(out.resolvedSkeleton, 'utf8'));
  assert.match(resolved[1].table, /\| S \| I \|/);
  assert.equal(resolved[2].table, '{{TABLE_2}}', '失败 k 保留字面');
  assert.match(resolved[3].table, /\| 已是 \| 具体 \|/);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: FAIL（`out.tablesResolved` undefined）

- [ ] **Step 3: 实现 `script/screenshot_trans.mjs` 改动**

(a) 顶部读 `2_tables.json`（在 longText 读取后 ~L192）：
```js
  const tablesJsonPath = path.join(dir, '2_tables.json');
  // 2_tables.json 可选——旧产物可能无（回归兼容）
  const tablesJson = fs.existsSync(tablesJsonPath)
    ? JSON.parse(await fsPromises.readFile(tablesJsonPath, 'utf8'))
    : {};
```

(b) 在 LONG_TEXT 还原循环后（~L203 后、写 resolvedPath 前）新增 TABLE 还原：
```js
  // ── {{TABLE_k[|...]}} 还原（LONG_TEXT 之后；成功路径表 markdown 已预展开
  //    无 LONG_TEXT 占位，失败路径表值已是具体 markdown 不匹配）──
  const TABLE_PH_RE = /\{\{TABLE_(\d+)(?:\|[^}]*)?\}\}/g;
  const failedTables = [];
  let tablesResolved = 0;
  for (const entry of resolvedSkeleton) {
    const key = Object.keys(entry)[0];
    const val = entry[key];
    if (typeof val !== 'string') continue;
    if (!val.includes('{{TABLE_')) continue;
    entry[key] = val.replace(TABLE_PH_RE, (match, id) => {
      const t = tablesJson[id];
      if (t && t.status === 'ok' && t.markdown) { tablesResolved++; return t.markdown; }
      failedTables.push(id);
      return match; // 保留字面
    });
  }
  // 写回 resolved skeleton（含 TABLE 还原）
  await fsPromises.writeFile(resolvedPath, JSON.stringify(resolvedSkeleton, null, 2));
```

注意：原代码在 ~L205-206 写了一次 resolvedPath（LONG_TEXT 后）。本步把那次写移除/保留——保留那次写无妨，本步在其后再写一次（含 TABLE）。为避免双写混乱：把原 L205-206 的 writeFile 保留（LONG_TEXT 版），本步新增的 writeFile 覆盖（TABLE 版）。最终文件含 TABLE 还原。

(c) emit 增字段——在所有 `emit({...})` 调用（~L249 无 trans2img 早返、~L297 主路径）增 `tablesResolved` 与 `failedTables`：
```js
    return emit({ status: 'ok', skipped: 'no_trans2img', resolvedSkeleton: resolvedPath, tablesResolved, failedTables });
```
主路径 emit 同样追加 `tablesResolved, failedTables`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/unit/screenshot-trans.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add script/screenshot_trans.mjs test/unit/screenshot-trans.test.mjs
git commit -m "feat(step8): {{TABLE_k}} 占位符还原——查 2_tables.json 替换 markdown

LONG_TEXT 还原后追加 TABLE 还原。成功 k 替换为预计算 markdown、
失败/缺失 k 保留字面记 failedTables（不阻断）。emit 增
tablesResolved/failedTables。
"
```

---

## Task 11: references/markdown_skeleton_guide.md 修订

**Files:**
- Modify: `references/markdown_skeleton_guide.md`（`### table 判定` ~L271-275；`### trans2img 判定` ~L285）

**Interfaces:** 无代码；契约文档修订供步骤 7 LLM 读。

- [ ] **Step 1: 改 `### table 判定` 段**

把现有：
```
- 真实 `<table>`（thead/tbody/th/td）**一律走 `table`**，无论带多重的背景/边框装饰；分组行用粗体行表达，markdown 表格可直接承载宽内容
- 单元格内的脚注锚点（如 `[*](#...)`）保留链接形式，不退化为裸 `*`
- 仅当结构无法用 markdown 表格表达（复杂跨行跨列/嵌套）才降级 `trans2img`
```
改为：
```
- 见 `{{TABLE_k|rows×cols}}` 占位符（步骤 2 预计算成功的表）→ 发 `{"table":"{{TABLE_k}}"}` 引用，**不要自行转换**——预计算 GFM markdown 已就绪、步骤 8 还原。每个 `k` 在骨架中恰引用一次
- 见 live 无样式表（步骤 2 转换失败、经步骤 5 剥样式保 live 的表）→ 自转 GFM `table` 条；仅当结构无法用 markdown 表格表达（嵌套表 / 单元格内块级内容 / 无法对齐）才降级 `trans2img`
- 单元格内的脚注锚点（如 `[*](#...)`）保留链接形式，不退化为裸 `*`
- **跨行跨列不再触发 `trans2img`**——成功的跨格表已由步骤 2 确定性引擎展开为规则网格、折成 `{{TABLE_k}}`；仅转换失败的表（无 `<th>` / 嵌套块级内容）可能落 `trans2img`
```

- [ ] **Step 2: 改 `### trans2img 判定` 段**

移除"复杂跨行跨列表格"作为 trans2img 理由的表述（~L285 一带若有"跨行跨列"字样则删该子项；当前文本是"所有无法用 markdown 段落表达的元素 → 一律走 trans2img 兜底"，无需改，但确认无"复杂跨行跨列表格"独立子项）。

- [ ] **Step 3: 验证无残留旧契约**

Run: `grep -n '跨行跨列.*trans2img\|TABLE_TAG' references/markdown_skeleton_guide.md`
Expected: 无输出（或仅本仓库他处，指南内无）。

- [ ] **Step 4: 提交**

```bash
git add references/markdown_skeleton_guide.md
git commit -m "docs(step7): 骨架指南 table/trans2img 判定修订

{{TABLE_k}} 占位符发引用不自转；跨行跨列成功路径不再触发
trans2img（确定性引擎已展开）；仅失败表可能落 trans2img。
"
```

---

## Task 12: 集成测试 + 夹具 + 回归

**Files:**
- Create: `test/fixtures/tables.html`
- Create: `test/integration/table-pipeline.test.mjs`

**Interfaces:** 端到端验证步骤 2→9 全链路。

- [ ] **Step 1: 写夹具 `test/fixtures/tables.html`**

```html
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>表格测试</title>
<style>th,td{border:1px solid #999;padding:6px}thead th{background:#eef}</style></head><body>
<h1>表格测试</h1>
<p>简单 2 列表（类 data-idx 1998）：</p>
<table class="w-full"><thead><tr><th>Setting</th><th>Impact</th></tr></thead>
<tbody><tr><td>model</td><td>大</td></tr><tr><td>temperature</td><td>中</td></tr></tbody></table>
<p>跨行跨列表（rowspan×colspan）：</p>
<table><thead><tr><th rowspan="2">时间</th><th colspan="2">上午</th></tr>
<tr><th>第1节</th><th>第2节</th></tr></thead>
<tbody><tr><td rowspan="2">周一</td><td>语文</td><td>数学</td></tr>
<tr><td>物理</td><td>化学</td></tr></tbody></table>
<p>无表头表（应失败落步骤 7）：</p>
<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>
</body></html>
```

- [ ] **Step 2: 写集成测试 `test/integration/table-pipeline.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(thisDir, '..', 'fixtures', 'tables.html'), 'utf8');

async function runPipeline(env) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-table-'));
  const url = 'https://example.com/tables';
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), fixture);
  return { tmpRoot, dir, url };
}

test('表格管线：步骤 2 产 2_tables.json + logs，成功/失败计数正确', async () => {
  const { tmpRoot, dir, url } = await runPipeline();
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tables.total, 3);
  assert.equal(out.tables.ok, 2); // 简单表 + 跨行跨列表
  assert.equal(out.tables.failed, 1); // 无表头表
  assert.ok(fs.existsSync(path.join(dir, '2_tables.json')));
  const tj = JSON.parse(fs.readFileSync(path.join(dir, '2_tables.json'), 'utf8'));
  // 跨行跨列表成功、5 列
  const cross = Object.values(tj).find((t) => t.rows >= 4);
  assert.equal(cross.status, 'ok');
  assert.equal(cross.cols, 3);
  // 失败诊断日志
  assert.ok(fs.readdirSync(path.join(dir, 'logs', 'tables')).length >= 1);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('表格管线：成功表 styled 折叠、失败表 styled 保 live + data-u2m-table=fail', async () => {
  const { tmpRoot, dir, url } = await runPipeline();
  await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  const styled = fs.readFileSync(path.join(dir, '2_clean_style_snapshot.html'), 'utf8');
  const okCount = (styled.match(/\{\{TABLE_\d+\|\d+×\d+\}\}/g) || []).length;
  assert.equal(okCount, 2, '两成功表折叠');
  assert.match(styled, /data-u2m-table="fail"/);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('表格管线：步骤 8 {{TABLE_k}} 还原为 GFM markdown', async () => {
  const { tmpRoot, dir, url } = await runPipeline();
  await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  // 注入 7_skeleton（模拟步骤 7 LLM 对成功表发引用、失败表发 trans2img 兜底）
  fs.writeFileSync(path.join(dir, '3_key_ids.json'), JSON.stringify({ titleId: '1', descriptionIds: [], paragraphIds: [], dumpIds: [] }));
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
    { h1: '# 表格测试' },
    { table: '{{TABLE_1}}' },
    { table: '{{TABLE_2}}' },
    { trans2img: [99] }, // 失败表兜底（id 99 不存在、步骤 8 会报错——改为无 trans2img 跳过）
  ], null, 2));
  // 为避免 trans2img 启浏览器，去掉 trans2img 条目
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
    { h1: '# 表格测试' },
    { table: '{{TABLE_1}}' },
    { table: '{{TABLE_2}}' },
    { p: '无表头表落步骤7 LLM 自转' },
  ], null, 2));
  const r = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tablesResolved, 2);
  const resolved = JSON.parse(fs.readFileSync(out.resolvedSkeleton, 'utf8'));
  assert.match(resolved[1].table, /\| Setting \| Impact \|/);
  assert.match(resolved[2].table, /\| 时间 \| 上午 \| 上午 \|/); // 跨格表 3 列
  // 步骤 9
  const r2 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r2.code, 0, `stderr: ${r2.stderr}`);
  const md = fs.readFileSync(JSON.parse(r2.stdout).markdownPath, 'utf8');
  assert.match(md, /\| Setting \| Impact \|/);
  assert.match(md, /\| 时间 \| 上午 \| 上午 \|/);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 3: 运行集成测试**

Run: `node --test test/integration/table-pipeline.test.mjs`
Expected: PASS

- [ ] **Step 4: 跑全量回归**

Run: `pnpm test:all`
Expected: PASS（含既有用例 + 新增）。若有既有用例因 K6 占位符改名（`TABLE_TAG` → `TABLE_k|...`）失败，据实更新该用例断言。

- [ ] **Step 5: 提交**

```bash
git add test/fixtures/tables.html test/integration/table-pipeline.test.mjs
git commit -m "test(table): 端到端集成——夹具表经步骤2→8→9全链路

含简单表/跨行跨列表/无表头表。验 2_tables.json+logs、styled
折叠/保live、步骤8 {{TABLE_k}} 还原、步骤9 GFM markdown 输出。
"
```

---

## Task 13: CLAUDE.md 更新

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** 文档同步，无代码。

- [ ] **Step 1: 更新步骤 2 段**

在步骤 2 描述中：
- 把 `{{TABLE_TAG|n_rows|m_cols}}` 改述为 `{{TABLE_k|rows×cols}}`（k 文档序、原文存 `2_tables.json`）。
- 增：步骤 2 Node 层跑可插拔表格转换引擎（`self` 默认 / `turndown` 备选，`--table-engine` 或 `U2M_TABLE_ENGINE`）→ 纯结构校验 → 成功存 `2_tables.json` markdown + 两版折叠；失败 styled 保 live + `data-u2m-table="fail"` + 落 `logs/tables/` 诊断。emit 增 `tables:{total,ok,failed}`、`tablesJson`。

- [ ] **Step 2: 更新步骤 5 段**

增：finalize 对 `table` 子树删净全部内联样式（成功折叠表 no-op、失败 live 表剥净）。

- [ ] **Step 3: 更新步骤 7 段**

`table` 分派：见 `{{TABLE_k}}` 占位符发引用不自转；失败 live 表自转/trans2img；跨行跨列成功路径不再触发 trans2img。

- [ ] **Step 4: 更新步骤 8 段**

增：`{{TABLE_k[|...]}}` 还原——LONG_TEXT 还原后查 `2_tables.json` 替换为 markdown；失败/缺失 k 保留字面记 `failedTables`。emit 增 `tablesResolved`/`failedTables`。

- [ ] **Step 5: 更新产物清单**

工作目录产物增 `2_tables.json`、`logs/tables/{k}_{dataIdx}.log`。

- [ ] **Step 6: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 步骤2/5/7/8 表格占位符管线同步

K6 改 {{TABLE_k|rows×cols}}、步骤2 转换引擎+2_tables.json+logs、
步骤5 table 子树剥样式、步骤7 占位符发引用、步骤8 {{TABLE_k}} 还原。
"
```

---

## Self-Review

**1. Spec coverage**（逐节核对）：
- §2 决策表：A 双版条件折叠（Task 7/8）、双引擎（Task 2/3/4）、纯结构校验（Task 2/3）、失败诊断日志（Task 4）、跨行跨列单测（Task 1）——✓
- §3 数据流：每节点均有 Task 对应——✓
- §4 占位符与 sidecar：`{{TABLE_k|rows×cols}}`（Task 6/7）、`2_tables.json` schema（Task 4/8）、`logs/tables/`（Task 4）——✓
- §5 步骤 2：收集（Task 5）、转换（Task 4/8）、K6（Task 7）、styled 分支（Task 6/8）、emit（Task 8）——✓
- §6 步骤 5：table 子树删样式（Task 9）——✓
- §7 步骤 7 指南：Task 11——✓
- §8 步骤 8：TABLE 还原 + emit（Task 10）——✓
- §9 引擎模块：self（Task 2）、turndown（Task 3）、共享 expand（Task 1）——✓
- §10 校验：Task 2/3 实现——✓
- §11 长文本交互：预展开（Task 4 `expandLongText`）——✓
- §12 测试：单测（Task 1/2/3/4/5/6/9/10）、集成（Task 12）、回归（Task 12 Step 4）——✓
- §13 影响面：所有改动文件均有 Task——✓
- §14 开放问题：DOM 选型（Global Constraints resolve jsdom）、富内容（self 行内序列化器 Task 2、turndown 备选）、嵌套表（self/turndown 均判 failed）、no-th（Task 2/3 判 failed）——✓

**2. Placeholder scan**：无 TBD/TODO/"add error handling" 裸述。每个 code step 有实代码。`page-clean-snapshot.js` 改动标了行号区间。✓

**3. Type consistency**：
- `convertTable(htmlString) → {markdown, status, reason}` ——Task 2/3 一致，Task 4 调用一致。✓
- `convertTables(tableList, {engine, longTextMap, logsDir}) → {tables, counts}` ——Task 4 定义、Task 8 消费一致。✓
- `__u2mCollectTables()` → `[{k,dataIdx,outerHTML,rows,cols}]`——Task 5 定义、Task 7/8 消费一致。✓
- `__u2mFoldTables(resultByDataIdx)` ——Task 6 定义、Task 8 调用（`resultByDataIdx[dataIdx]={k,status,rows,cols}`）一致。✓
- 占位符 `{{TABLE_k|rows×cols}}`（HTML）/ `{{TABLE_k}}`（骨架）——Task 6/7（HTML）、Task 10（骨架正则 `{{TABLE_(\d+)(?:\|[^}]*)?\}\}`）一致。✓
- emit 字段 `tables:{total,ok,failed}`、`tablesJson`（Task 8）、`tablesResolved`/`failedTables`（Task 10）——✓

**4. 注意点**：Task 7 Step 3 注入 `__u2mCollectTables` 的拼接方式（`collectTablesFn + '\n' + pageCleanFn`）依赖 `readSharedScript` 返回纯函数文本、evaluate 时同作用域可见——与现有 `page-clean-snapshot.js` 单函数注入模式一致（`readSharedScript` + evaluate `(${src})()`），多函数拼接同理。Task 8 Step 3(c) 的 `combinedStyled`/`combinedFold` 沿用此模式。✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-table-placeholder.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
