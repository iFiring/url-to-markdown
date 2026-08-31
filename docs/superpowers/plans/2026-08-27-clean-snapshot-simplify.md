# 清洗版极致简化实施计划（clean snapshot simplify）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把步骤 2 重构为「单页两趟 + 九条机械规则（K1-K9）」：删掉 juice 隐藏检测管线与全部边界补丁，清洗版变为带元数据 token 的纯结构终端视图，带样式版与步骤 4-9 逐字节不变。

**Architecture:** `clean_snapshot.mjs` 启动单浏览器单页面（route 只拦 http(s) 子资源），对 `file://1_snapshot.html` 跑两趟 evaluate：趟 1 `mode:'styled'` 复用今日步骤 1-10（结构删除 + 长文本占位 + SVG 瘦身）；趟 2 `mode:'clean'` 走结构删除 + SVG 清空 + K1-K9（class 语义过滤、属性白名单、astro 解包、hidden 裸属性折叠、table/pre 折叠、行内 run token 化、空白压缩）。两版自此完全独立，清洗版不再含 `{{LONG_TEXT_`。

**Tech Stack:** Node ≥20 ESM、playwright（chromium evaluate 注入共享页面脚本）、node --test。无 linter。

**Spec:** `docs/superpowers/specs/2026-08-27-clean-snapshot-simplify-design.md`（本计划的规范依据，执行者须同时读取）

## Global Constraints

- stdout 恰好一行 JSON；失败路径也不例外；日志走 stderr；退出码 0/1/2（usage_error=2）。
- **emit 延迟退出陷阱**：`emit()` 先写行、再在写回调里 `process.exit`，本身同步返回——`usage()`/`emitError()` 之后必须提前 return，不得让后续代码输出第二行。
- **硬约束：带样式版（`2_clean_style_snapshot.html`）与 `2_long_text.json` 产物逐字节不变**，步骤 4-9 契约零变化（Task 1 的 golden 测试全程守护）。
- 共享页面脚本是唯一事实源：清洗规则只写在 `script/lib/page-clean-snapshot.js`，严禁分叉进 `.mjs` 编排层。
- juice 依赖保留在 package.json（步骤 5 compute_styles 仍用），只是 `clean_snapshot.mjs` 不再 import。
- 测试命令：`pnpm test`（单测）、`pnpm run test:integration`（集成）、单文件 `node --test test/unit/clean-snapshot.test.mjs`。
- 提交信息用中文 conventional commits（`feat:`/`fix:`/`docs:`/`test:`/`refactor:`），结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 带样式版 golden 基线（重构安全网）

**Files:**
- Create: `test/fixtures/clean-simplify.html`
- Create: `test/fixtures/golden/article-1.styled.html`、`test/fixtures/golden/article-1.longtext.json`、`test/fixtures/golden/clean-simplify.styled.html`、`test/fixtures/golden/clean-simplify.longtext.json`
- Create: `test/unit/clean-snapshot-golden.test.mjs`

**Interfaces:**
- Consumes: 现行 `script/clean_snapshot.mjs`（未改动）
- Produces: golden 基线文件 + 常驻回归测试（后续所有任务跑 `pnpm test` 时守护「带样式版逐字节不变」）

- [ ] **Step 1: 写组合夹具**（覆盖长文本中英文、svg 文本、style 标签、shiki pre、table、hidden 属性、astro 包装——golden 只锁 styled 趟，但这些特征保证两趟都被真实锻炼）

创建 `test/fixtures/clean-simplify.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>组合夹具</title>
<style>.modal{display:none}</style></head>
<body>
<div data-idx="1">
  <h1 data-idx="2">组合夹具标题</h1>
  <p data-idx="3">这是一段足够长的中文文本，用来触发行内文本的占位行为与还原清单的生成逻辑。</p>
  <p data-idx="4">This paragraph contains a fairly long English sentence that exceeds twelve words to trigger the placeholder mechanism.</p>
  <pre data-idx="5" class="shiki overflow-auto"><code data-language="javascript" data-idx="6">const x = 1; console.log(x);</code></pre>
  <table data-idx="7"><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>值1</td><td>值2</td></tr></tbody></table>
  <div data-idx="8" hidden="true"><p>隐藏面板内容一</p><p>隐藏面板内容二</p></div>
  <astro-slot data-idx="9"><span data-idx="10">槽内容</span></astro-slot>
  <svg data-idx="11" width="10"><text>SVG 内长文本内容如果参与占位会导致编号错位的问题</text></svg>
  <p data-idx="12">短文本</p>
</div>
</body></html>
```

- [ ] **Step 2: 用现行实现生成 golden**（必须在任何代码改动之前执行——golden 记录的就是今日行为）

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/example.com_article-1" "$TMP/example.com_clean-simplify"
cp test/fixtures/article-1.html "$TMP/example.com_article-1/1_snapshot.html"
cp test/fixtures/clean-simplify.html "$TMP/example.com_clean-simplify/1_snapshot.html"
U2M_WORKING_ROOT="$TMP" node script/clean_snapshot.mjs --url https://example.com/article-1
U2M_WORKING_ROOT="$TMP" node script/clean_snapshot.mjs --url https://example.com/clean-simplify
mkdir -p test/fixtures/golden
cp "$TMP/example.com_article-1/2_clean_style_snapshot.html" test/fixtures/golden/article-1.styled.html
cp "$TMP/example.com_article-1/2_long_text.json" test/fixtures/golden/article-1.longtext.json
cp "$TMP/example.com_clean-simplify/2_clean_style_snapshot.html" test/fixtures/golden/clean-simplify.styled.html
cp "$TMP/example.com_clean-simplify/2_long_text.json" test/fixtures/golden/clean-simplify.longtext.json
ls -la test/fixtures/golden/
```

Expected: 四个 golden 文件生成；两次 CLI stdout 均为单行 `status:"ok"` JSON。

- [ ] **Step 3: 写 golden 回归测试**

创建 `test/unit/clean-snapshot-golden.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

// 带样式版 golden 基线：步骤 2 重构（2026-08-27 极致简化）的硬约束是
// 2_clean_style_snapshot.html 与 2_long_text.json 逐字节不变、步骤 4-9 零影响。
test('golden: 带样式版与恢复清单在重构全程逐字节一致', async () => {
  for (const name of ['article-1', 'clean-simplify']) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-golden-'));
    try {
      const url = `https://example.com/${name}`;
      const dir = path.join(tmpRoot, urlToDirName(url));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '1_snapshot.html'),
        fs.readFileSync(path.resolve('test/fixtures', `${name}.html`))
      );
      const r = await runScript(
        process.execPath,
        [path.resolve('script/clean_snapshot.mjs'), '--url', url],
        { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 }
      );
      assert.equal(r.code, 0, `stderr: ${r.stderr}`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.status, 'ok');
      const styledGolden = fs.readFileSync(path.resolve('test/fixtures/golden', `${name}.styled.html`), 'utf8');
      const longGolden = fs.readFileSync(path.resolve('test/fixtures/golden', `${name}.longtext.json`), 'utf8');
      assert.equal(fs.readFileSync(out.styledSnapshot, 'utf8'), styledGolden, `${name} 带样式版应与 golden 逐字节一致`);
      assert.equal(fs.readFileSync(out.longText, 'utf8'), longGolden, `${name} 恢复清单应与 golden 逐字节一致`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
});
```

- [ ] **Step 4: 跑测试验证通过**

Run: `node --test test/unit/clean-snapshot-golden.test.mjs`
Expected: PASS（现行实现跑两遍当然一致——这正是安全网的意义）

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/clean-simplify.html test/fixtures/golden/ test/unit/clean-snapshot-golden.test.mjs
git commit -m "test: 带样式版 golden 基线——步骤 2 重构的逐字节安全网

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 两趟重构——mode 分叉、删 juice 管线与 page-hidden-detect.js

**Files:**
- Modify: `script/clean_snapshot.mjs`（整体重写 main 与头注）
- Modify: `script/lib/page-clean-snapshot.js`（结构重组为 mode 分叉）
- Delete: `script/lib/page-hidden-detect.js`
- Modify: `test/unit/clean-snapshot.test.mjs`（删 R6 组用例、改占位断言、加守卫）

**Interfaces:**
- Consumes: `runScript`/`urlToDirName`/`readSharedScript`（现有 helper，签名不变）
- Produces: `__u2mCleanSnapshot(cfg)` 新契约——`cfg = {mode: 'styled'|'clean'}`（缺省 `'styled'`）：
  - styled 返回 `{html: string, longTexts: {[k]: string}, longTextCount: number}`
  - clean 返回 `{html: string, stats: {hiddenCount: number, runCount: number}}`（本任务恒为 0，Task 4/5 填实）
  - mjs 侧 `clean.stats` 供 debug 汇总行（本任务写入，数值后续任务变真）

- [ ] **Step 1: 改造测试先行——删 R6 组、更新占位断言、加守卫用例**

对 `test/unit/clean-snapshot.test.mjs`：

1. 删除第 12 行 `const hiddenDetectPath = ...`。
2. 删除 `runInBrowser` 函数（第 36-42 行，死代码）。
3. 删除测试 `'page-hidden-detect.js: 文件存在且 __u2mDetectHidden 可被 evaluate 格式调用'`（第 55-59 行）。
4. 删除六个 R6/护栏用例：`'R6: juice 隐藏折叠——fixed 模态与流内 expander 折成标记…'`、`'R6: display:none !important 同样折叠…'`、`'R6: HTML hidden 属性按显式 display:none 折叠…'`、`'R6 边界钉住: @media 响应式隐藏不折叠…'`、`'护栏: 折叠后可见文本 <5% 且总量充足 → 放弃折叠并告警…'`、`'R6 语义: visibility:hidden 顶层折叠…'`。
5. `'对 article-1 快照执行清洗'` 中第 93 行：

```js
  assert.ok(!cleaned.includes('LONG_TEXT'), '清洗版不应再含 LONG_TEXT 占位（终端视图，一切还原走带样式版）');
```

6. `'带样式快照保留样式…'` 中第 526-529 行替换为：

```js
  // 占位体系分叉（2026-08-27）：styled 保留 LONG_TEXT；清洗版是终端视图、不再占位
  const ph = (h) => (h.match(/\{\{LONG_TEXT_\d+\|\d+_[a-z]+\}\}/g) || []).sort();
  assert.ok(ph(styled).length > 0, '带样式版 HTML 长文本应被占位');
  assert.ok(!cleaned.includes('{{LONG_TEXT_'), '清洗版不应含 LONG_TEXT 占位（守卫不变量）');
```

7. `'中英文分标准占位…'` 中第 457-461 行的三条 `cleaned.includes('|17_chars}}')` 等改为读带样式版（在读取 cleaned 之后补一行 styled 并替换目标）：

```js
  const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
  assert.ok(styled.includes('|17_chars}}'), '中文按字符数占位，后缀 _chars');
  assert.ok(styled.includes('|13_words}}'), '英文按单词数占位，后缀 _words');
  assert.ok(styled.includes('|18_chars}}'), '含汉字的混合文本按中文标准');
```

（`cleaned.includes(enShort)` / `cleaned.includes(zhShort)` 两条保留——本任务清洗版仍是原文，Task 5 后依然成立：16 字 / 12 词不超阈值。）

8. 文件末尾追加守卫用例：

```js
test('守卫: 清洗版是终端视图——不含 {{LONG_TEXT_，步骤 2 不再 import juice', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1"><p data-idx="2">这是一段超过十六个汉字的长文本，清洗版不应为其生成占位符。</p></div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'guard-terminal');
  try {
    assert.ok(!cleaned.includes('{{LONG_TEXT_'), '清洗版不应含 LONG_TEXT 占位');
    assert.ok(styled.includes('{{LONG_TEXT_'), '带样式版保留 LONG_TEXT 占位');
    assert.equal(out.longTextCount, 1, '恢复清单仍从带样式版产出');
    const src = fs.readFileSync(path.resolve('script/clean_snapshot.mjs'), 'utf8');
    assert.ok(!src.includes("from 'juice'"), '步骤 2 不再 import juice');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: FAIL——守卫用例 `步骤 2 不再 import juice` 断言失败；`article-1` 用例的「清洗版不应含 LONG_TEXT」失败（当前实现两版共享占位）。

- [ ] **Step 3: 重写 `script/lib/page-clean-snapshot.js` 为 mode 分叉**

保留共享结构清洗（今日步骤 1-8：link/meta/base 删除、骨架删除、播放器删除、控件删除、空元素级联 + KEEP_EMPTY），在空元素级联结束后插入分叉。改动要点：

- 头注重写（双产物说明改为「styled 趟 / clean 趟」+ K1-K9 摘要 + 终端视图不变量）。
- 函数签名 `function __u2mCleanSnapshot(cfg)`，`cfg.mode` 缺省 `'styled'`。
- clean 分支：今日步骤 11-13（SVG 清空、style 属性删除、`<style>` 删除）+ 今日步骤 14-18 原样保留（R2 class 过滤、R3 data 白名单、R1 pre→`code...`、R4 astro 解包、R5 空白压缩——K1/K2/K7 在 Task 3/4 逐个替换），**删除步骤 19（R6 折叠应用）**，返回：

```js
  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    stats: { hiddenCount: 0, runCount: 0 }
  };
```

- styled 分支：今日步骤 9（LONG_TEXT 占位）+ 10（SVG 瘦身）后返回：

```js
  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    longTextCount: k,
    longTexts: longTexts
  };
```

- [ ] **Step 4: 重写 `script/clean_snapshot.mjs`**

头注要点：单页两趟（趟 1 styled = 结构清洗 + 占位 + SVG 瘦身；趟 2 clean = 结构清洗 + K1-K9）、零样式计算、清洗版是终端视图。删除 juice/normalize/hidden 的 import 与读取。main 体替换为：

```js
async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args.url;
  if (!url) return usage('用法: clean_snapshot.mjs --url <url>');

  const dir = urlDir(url);
  const snapshotPath = path.join(dir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  debug(`读入快照 ${snapshotPath}（${fs.statSync(snapshotPath).size} 字节）`);

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    const page = await context.newPage();
    // 只拦 http(s) 子资源：DOM 解析不需要图片/字体，file:// 主文档导航不经路由
    await page.route(/^https?:/, (route) => route.abort());

    // 趟 1（styled）：结构清洗 + 长文本占位 + SVG 瘦身 → 带样式版 + 恢复清单
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const styled = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ mode: 'styled' })})`);

    // 趟 2（clean）：重新加载同一快照，结构清洗 + K1-K9 → 清洗版（终端视图）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const clean = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ mode: 'clean' })})`);

    const cleanedPath = path.join(dir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, clean.html, 'utf8');
    const styledPath = path.join(dir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, styled.html, 'utf8');
    const longTextPath = path.join(dir, '2_long_text.json');
    await fsPromises.writeFile(longTextPath, JSON.stringify(styled.longTexts), 'utf8');

    debug(`[clean] hidden 折叠 ${clean.stats.hiddenCount} · run token ${clean.stats.runCount} · 清洗版 ${Buffer.byteLength(clean.html, 'utf8')} 字节`);
    log(`清洗完成: ${cleanedPath} (${styled.longTextCount} 个长文本占位符)`);

    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      cleanedSnapshot: cleanedPath,
      styledSnapshot: styledPath,
      longText: longTextPath,
      longTextCount: styled.longTextCount,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}
```

- [ ] **Step 5: 删除 `script/lib/page-hidden-detect.js`**

```bash
git rm script/lib/page-hidden-detect.js
```

（`page-normalize-styles.js` 保留——`compute_styles.mjs` 仍在用。）

- [ ] **Step 6: 跑单测全部通过（含 golden）**

Run: `pnpm test`
Expected: 全绿。golden 测试证明带样式版逐字节未变；守卫用例通过；R1-R5 既有用例不受伤（clean 趟仍保留旧规则）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: 步骤 2 单页两趟——mode 分叉、删 juice 检测管线与 page-hidden-detect.js

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: K1 class 语义过滤增强 + K2 属性白名单

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（clean 趟：替换今日步骤 14/15 为 K1/K2；步骤 11 改为只清子树）
- Modify: `test/unit/clean-snapshot.test.mjs`（R2/R3 用例改写为 K1/K2；svg 断言更新）

**Interfaces:**
- Consumes: Task 2 的 clean 分支结构
- Produces: 清洗版属性白名单定稿——`class`(过滤后)/`id`/`data-idx`/`data-language`/`hidden`/`type`/`role`/`alt`；页面脚本内新增共享函数 `isClassNoise(tok)`（Task 5 无依赖，仅本任务使用）

- [ ] **Step 1: 改写测试**

对 `test/unit/clean-snapshot.test.mjs`：

1. 旧 `'R2: class 噪声过滤…'` 用例整体替换为：

```js
test('K1: class 语义过滤——工具/哈希/CSS-modules/变体剥除，语义 token 保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <section data-idx="2" class="article flex px-4 astro-3ef6ksr2 h-[30rem] text-xs hover:bg-x md:flex -top-0.5 !h-9 _Button_6dmow_1 overflow-x-hidden shiki">正文内容</section>
    <div data-idx="3" class="page-header btn-primary expn-content">语义类元素</div>
    <div data-idx="4" class="flex px-4 rounded overflow-auto border">全是噪声</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k1-class');
  try {
    const sec = cleaned.match(/<section[^>]*>/)[0];
    assert.ok(sec.includes('class="article"'), `语义 token article 应保留: ${sec}`);
    assert.ok(!/(flex|px-4|astro-|30rem|text-xs|hover:|md:|top-0|!h-9|_Button_|overflow|shiki)/.test(sec), `噪声 token 应剥除: ${sec}`);
    const keep = cleaned.match(/<div data-idx="3"[^>]*>/)[0];
    for (const tok of ['page-header', 'btn-primary', 'expn-content']) {
      assert.ok(keep.includes(tok), `两词 kebab 语义 token ${tok} 应保留: ${keep}`);
    }
    assert.ok(!/<div data-idx="4"[^>]*class=/.test(cleaned), '全噪声 class 应连同属性删除');
    assert.ok(styled.includes('astro-3ef6ksr2') && styled.includes('h-[30rem]'), '带样式版保留原始 class');
  } finally { cleanup(); }
});
```

2. 旧 `'R3: data-* 白名单…'` 用例整体替换为：

```js
test('K2: 属性白名单——八属性存活，href/src/aria/style 等删净，URL 一律清空', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <a data-idx="2" href="https://example.com/x" aria-label="链接" target="_blank" data-1p-ignore="1">链接文本</a>
    <img data-idx="3" src="https://example.com/i.png" alt="示意图" width="10" height="10">
    <div data-idx="4" role="button" type="button" hidden="true" id="anchor" data-language="python" class="keep-me" tabindex="0" draggable="true">内容</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k2-attrs');
  try {
    const a = cleaned.match(/<a data-idx="2"[^>]*>/)[0];
    assert.ok(!/href|aria-label|target|data-1p/.test(a), `a 的 URL/aria/data 噪声应删净: ${a}`);
    const img = cleaned.match(/<img data-idx="3"[^>]*>/)[0];
    assert.ok(!/src|width|height/.test(img), `img 的 src/宽高应删净: ${img}`);
    assert.ok(img.includes('alt="示意图"'), 'img 的 alt 语义保留');
    const div = cleaned.match(/<div data-idx="4"[^>]*>/)[0];
    for (const attr of ['role="button"', 'type="button"', 'hidden="true"', 'id="anchor"', 'data-language="python"', 'class="keep-me"']) {
      assert.ok(div.includes(attr), `白名单属性 ${attr} 应保留: ${div}`);
    }
    assert.ok(!/tabindex|draggable/.test(div), `白名单外属性应删净: ${div}`);
    assert.ok(!cleaned.includes('lang='), 'html lang 应删（白名单外）');
    assert.ok(styled.includes('href="https://example.com/x"') && styled.includes('data-1p-ignore'), '带样式版不受影响');
  } finally { cleanup(); }
});
```

3. svg 断言更新（属性白名单后 svg 壳保留 `data-idx`）：
   - `'对 article-1 快照执行清洗'` 的 `assert.ok(!cleaned.match(/<svg[^>]+[a-z-]+=/i), 'SVG 不应有属性')` 删除，改 `assert.ok(/<svg data-idx="[0-9]+"><\/svg>/.test(cleaned) || !cleaned.includes('<svg'), 'SVG 壳保留 data-idx')`。
   - `'空元素级联删除…'` 的 `assert.ok(cleaned.includes('<svg></svg>'), 'svg 壳必须保留')` 改为 `assert.ok(cleaned.includes('<svg data-idx="11"></svg>'), 'svg 壳必须保留且带 id')`。
   - `'带样式快照保留样式…'` 的 `assert.ok(cleaned.includes('<svg></svg>'), '清洗版 SVG 应清空为壳')` 改为 `assert.ok(/<svg data-idx="3"><\/svg>/.test(cleaned), '清洗版 SVG 清空为壳且保留 id')`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: K1/K2 用例 FAIL（`-top-0.5`/`_Button_…`/`!h-9`/`overflow-x-hidden`/`shiki` 未剥、href/aria 未删）；svg 断言 FAIL。

- [ ] **Step 3: 实现 K1 与 K2**

`script/lib/page-clean-snapshot.js` clean 分支中：

1. 步骤 11（SVG 清空）改为只清子树、不再删属性（属性交 K2 白名单裁剪）：

```js
  // 11. SVG 清空子树（仅清洗版）：属性由 K2 白名单统一裁剪，data-idx 等存活
  for (var i = 0; i < svgs.length; i++) {
    while (svgs[i].firstChild) svgs[i].removeChild(svgs[i].firstChild);
  }
```

2. 今日步骤 14（R2）整体替换为 K1：

```js
  // K1. class 语义过滤（仅清洗版）：样式强相关 token 删、语义 token 留。
  //     原则：拿不准保留——漏删只费字节，误删语义 token 才伤步骤 3 判读。
  //     2026-08-27 在旧 R2 基础上补漏：负号前缀位移类、CSS-modules、!
  //     important 变体、overflow/appearance、裸 border/shadow/prose、工具名类。
  var HASH_PREFIX_RE = /^(?:astro|css|sc|jsx|chakra|emotion|styled|mui|next|module)-[-0-9a-zA-Z]+$/;
  var CSS_MODULE_RE = /^_[A-Za-z][A-Za-z0-9]*_[a-z0-9]+(?:_\d+)?$/;
  function isHashSuffix(s) {
    return s.length >= 5 && /^[0-9a-zA-Z]+$/.test(s) && /[0-9]/.test(s) && /[a-zA-Z]/.test(s);
  }
  var UTILITY_RES = [
    /^(?:[mp][trblxy]?)-.+$/, /^-(?:[mp][trblxy]?)-.+$/,
    /^(?:w|h|min-w|min-h|max-w|max-h|size|basis|top|bottom|left|right|inset|z|order|gap|gap-x|gap-y|grow|shrink|flex|grid-cols|grid-rows|col-span|col-start|col-end|row-span|row-start|row-end)-.+$/,
    /^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|table|contents|flow-root|list-item|isolate)$/,
    /^(?:relative|absolute|fixed|sticky|static)$/,
    /^(?:items|justify|self|content|place|place-items|place-content|place-self|align)-.+$/,
    /^(?:rounded|shadow|opacity|ring|outline|divide|space)-?.*$/,
    /^(?:text|bg|border|from|to|via)-.+$/,
    /^(?:font|leading|tracking|indent|line-clamp|aspect|object|will-change|fill|stroke|transition|duration|ease|delay|animate|transform|scale|translate|rotate|origin|skew|pointer-events|cursor|select|resize|whitespace|break|overscroll|scroll|snap)-?.*$/,
    /^(?:uppercase|lowercase|capitalize|underline|overline|line-through|truncate|antialiased|italic|visible|invisible|collapse|sr-only|not-sr-only)$/,
    /^(?:overflow|appearance)-?[a-z0-9-]*$/,
    /^(?:prose|not-prose|border|shadow|shiki|shiki-themes|syntax-highlighter)(?:-[a-z0-9-]+)?$/
  ];
  function isClassNoise(tok) {
    if (tok.indexOf(':') !== -1 || tok.indexOf('[') !== -1 || tok.indexOf(']') !== -1) return true; // 变体前缀/任意值
    if (tok.charAt(0) === '!') return true;                    // !h-9 等 important 变体
    var body = tok.charAt(0) === '-' ? tok.slice(1) : tok;     // 负号前缀剥离后再判
    if (HASH_PREFIX_RE.test(tok) || CSS_MODULE_RE.test(tok)) return true;
    var dash = body.lastIndexOf('-');
    if (dash !== -1 && isHashSuffix(body.slice(dash + 1)) && /^[a-z][a-z0-9-]*$/i.test(body.slice(0, dash))) return true;
    for (var i = 0; i < UTILITY_RES.length; i++) if (UTILITY_RES[i].test(body)) return true;
    return false;
  }
  var withClass = document.querySelectorAll('[class]');
  for (var i = 0; i < withClass.length; i++) {
    var el = withClass[i];
    var kept = el.getAttribute('class').split(/\s+/).filter(function (t) { return t && !isClassNoise(t); });
    if (kept.length) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }
```

3. 今日步骤 15（R3 data-* 白名单）整体替换为 K2：

```js
  // K2. 属性白名单（仅清洗版）：全文档只留 LLM 可理解的最小属性集；
  //     href/src/aria-*/style/tabindex 等一律删除——a/img 的 URL 就此清空
  var ATTR_KEEP = { 'class': 1, 'id': 1, 'data-idx': 1, 'data-language': 1, 'hidden': 1, 'type': 1, 'role': 1, 'alt': 1 };
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el2 = allEls[i];
    var attrNames = [];
    for (var j = 0; j < el2.attributes.length; j++) attrNames.push(el2.attributes[j].name);
    for (var j = 0; j < attrNames.length; j++) {
      if (!ATTR_KEEP[attrNames[j].toLowerCase()]) el2.removeAttribute(attrNames[j]);
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全绿（含 golden——K1/K2 只动 clean 趟）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: K1 class 语义过滤增强 + K2 属性白名单——URL/aria 清空、svg 壳保留 id

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: K5 hidden 裸属性折叠 + K6 table 折叠 + K7 pre 折叠

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（clean 趟：R1 pre→code... 替换为 K7；astro 移前为 K4；新增 K5/K6）
- Modify: `test/unit/clean-snapshot.test.mjs`（R1 用例改写为 K7；表格保留用例改写；新增 K5/K6 用例）

**Interfaces:**
- Consumes: Task 3 的 K1/K2
- Produces: 页面脚本共享函数 `sizeSuffix(text)` → `{n, unit}`（unit ∈ 'chars'|'words'，含汉字按去首尾空白后字符数、否则按词数——Task 5 复用）、`topTags(counts)` → `'3_p/2_a'` 形态（计数降序至多 4 项）；`stats.hiddenCount` 填实

- [ ] **Step 1: 改写与新增测试**

对 `test/unit/clean-snapshot.test.mjs`：

1. 旧 `'R1: pre 内容替换为 code...…'` 用例替换为：

```js
test('K7: pre 折叠为 {{pre>code>N_chars}}——data-language 提升到 pre，行内 code 不动', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <pre data-idx="2" class="shiki" tabindex="0"><code data-idx="3" data-language="javascript"><span data-idx="4" class="syntax-highlighter-line"><span data-idx="5" class="shiki-token">import</span><span data-idx="6" class="shiki-token"> OpenAI </span></span></code></pre>
    <p data-idx="7">行内 <code data-idx="8">client.create()</code> 代码</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k7-pre');
  try {
    assert.ok(
      /<pre[^>]*data-idx="2"[^>]*data-language="javascript"[^>]*>\{\{pre>code>\d+_chars\}\}<\/pre>/.test(cleaned),
      `pre 应折叠为 token 且 data-language 提升: ${cleaned.match(/<pre[\s\S]*?<\/pre>/)?.[0]}`
    );
    assert.ok(!cleaned.includes('data-idx="3"') && !cleaned.includes('data-idx="4"'), 'pre 内部 id 随子树删除');
    assert.ok(!cleaned.includes('shiki-token'), 'token span 应删除');
    assert.ok(cleaned.includes('<code data-idx="8">client.create()</code>'), '行内 code 不动');
    assert.ok(styled.includes('shiki-token') && styled.includes('import'), '带样式版完整保留代码');
    assert.ok(!styled.includes('{{pre>'), '守卫: 带样式版不得出现新 token');
  } finally { cleanup(); }
});
```

2. 旧 `'表格结构整体保留（含空单元格）…'` 用例替换为（表格结构守护转为带样式版断言；清洗版断言 K6 折叠）：

```js
test('K6: table 整树折叠为 {{table>N}}——带样式版结构完整（含空单元格）', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <table data-idx="2">
      <colgroup data-idx="3"><col data-idx="4"><col data-idx="5"></colgroup>
      <thead data-idx="6"><tr data-idx="7"><th data-idx="8">列A</th><th data-idx="9"></th></tr></thead>
      <tbody data-idx="10">
        <tr data-idx="11"><td data-idx="12">有值</td><td data-idx="13"></td></tr>
      </tbody>
    </table>
    <p data-idx="14">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k6-table');
  try {
    const seg = cleaned.match(/<table data-idx="2"[^>]*>([\s\S]*?)<\/table>/)[1];
    assert.ok(/^\{\{table>\d+_(chars|words)\}\}$/.test(seg), `table 应折叠为字数 token: ${seg}`);
    assert.ok(!cleaned.includes('列A') && !cleaned.includes('data-idx="3"'), '表格内部结构与内容从清洗版消失');
    assert.ok(cleaned.includes('正文段落'), '表外正文保留');
    // 带样式版：表格结构全体保留（含空 th/td/col——删空单元格会让行列错位）
    for (const [tid, what] of [
      ['3', 'colgroup'], ['4', 'col'], ['6', 'thead'], ['8', '有值的 th'], ['9', '空 th'],
      ['12', '有值的 td'], ['13', '空 td'],
    ]) {
      assert.ok(styled.includes(`data-idx="${tid}"`), `${what} (id=${tid}) 带样式版必须保留`);
    }
    assert.ok(!styled.includes('{{table>'), '守卫: 带样式版不得出现新 token');
  } finally { cleanup(); }
});
```

3. 新增 K5 用例：

```js
test('K5: hidden 裸属性折叠——最外层折为构成 token，嵌套取外层，data-u2m-hidden 属性取消', async () => {
  const attrLong = '这是一段仅靠 hidden 属性隐藏的中文文本';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <div data-idx="2" hidden="true"><p data-idx="3">${attrLong}</p><a data-idx="4" href="/x">链接</a></div>
    <div data-idx="5" hidden><div data-idx="6" hidden="until-found"><p data-idx="7">嵌套隐藏</p></div></div>
    <p data-idx="8">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k5-hidden');
  try {
    const seg1 = cleaned.match(/<div data-idx="2"[^>]*>([\s\S]*?)<\/div>/)[1];
    assert.ok(/^\{\{\d+_(chars|words);1_p\/1_a\}\}$/.test(seg1), `子树应折为构成 token: ${seg1}`);
    assert.ok(cleaned.match(/<div data-idx="2"[^>]*>/)[0].includes('hidden'), 'hidden 属性保留（触发信号）');
    assert.ok(!cleaned.includes(attrLong) && !cleaned.includes('data-idx="3"') && !cleaned.includes('data-idx="4"'), '折叠子树内容应消失');
    const seg2 = cleaned.match(/<div data-idx="5"[^>]*>([\s\S]*?)<\/div>/)[1];
    assert.ok(/^\{\{\d+_(chars|words);1_div\/1_p\}\}$/.test(seg2), `嵌套 hidden 只折最外层: ${seg2}`);
    assert.ok(!cleaned.includes('data-idx="6"') && !cleaned.includes('data-idx="7"'), '内层 id 随外层折叠消失');
    assert.ok(!cleaned.includes('data-u2m-hidden'), 'data-u2m-hidden 属性应取消');
    assert.ok(cleaned.includes('正文段落'), '可见正文保留');
    assert.ok(styled.includes(attrLong) && styled.includes('data-idx="3"'), '带样式版原文完整');
    assert.ok(!styled.includes(';1_p'), '守卫: 带样式版不得出现新 token');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: K5/K6/K7 用例 FAIL（折叠未实现、pre 还是 `code...`）。

- [ ] **Step 3: 实现 K4/K5/K6/K7**

`script/lib/page-clean-snapshot.js` clean 分支中，在 K2 之后（今日 R3 位置后）：

1. 今日步骤 17（R4 astro 解包）从原位置**整体前移**到此处（代码不变，编号注释改 K4），保证解包先于折叠。
2. 删除今日步骤 16（R1 pre→`code...`），按 spec 顺序新增 K5/K6/K7：

```js
  // K5. hidden 裸属性折叠（仅清洗版）：HTML 规范里属性存在即隐藏（任意值），
  //     无需样式计算。最外层折叠、子树清空放构成 token；根保留 id 可引用，
  //     原文在带样式版（listFlow 引用即可还原 FAQ 折叠答案等）。
  var CJK_RE = /[一-鿿]/;
  function sizeSuffix(text) {
    var t = (text || '').trim();
    var cjk = CJK_RE.test(t);
    var n = cjk ? t.length : t.split(/\s+/).filter(Boolean).length;
    return { n: n, unit: cjk ? 'chars' : 'words' };
  }
  function topTags(counts) {
    return Object.keys(counts)
      .map(function (t) { return counts[t] + '_' + t; })
      .sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); })
      .slice(0, 4).join('/');
  }
  var hiddenCount = 0;
  var hiddenEls = Array.prototype.slice.call(document.querySelectorAll('[hidden]'));
  for (var i = 0; i < hiddenEls.length; i++) {
    var he = hiddenEls[i];
    if (!he.parentNode || !document.body.contains(he)) continue;   // 已被前序折叠删除
    var anc = he.parentElement, nested = false;
    while (anc) { if (anc.hasAttribute && anc.hasAttribute('hidden')) { nested = true; break; } anc = anc.parentElement; }
    if (nested) continue;                                          // 只折最外层
    var tagCounts = {};
    var desc = he.querySelectorAll('*');
    for (var j = 0; j < desc.length; j++) {
      var dt = desc[j].tagName.toLowerCase();
      tagCounts[dt] = (tagCounts[dt] || 0) + 1;
    }
    var sz = sizeSuffix(he.textContent);
    var comp = topTags(tagCounts);
    var token = '{{' + sz.n + '_' + sz.unit + (comp ? ';' + comp : '') + '}}';
    while (he.firstChild) he.removeChild(he.firstChild);
    he.appendChild(document.createTextNode(token));
    hiddenCount++;
  }

  // K6. table 折叠（仅清洗版）：整树清空、只统计字数；步骤 7 从带样式版读全表
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    var tsz = sizeSuffix(tb.textContent);
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    tb.appendChild(document.createTextNode('{{table>' + tsz.n + '_' + tsz.unit + '}}'));
  }

  // K7. pre 折叠（仅清洗版）：data-language 从 code 壳提升到 pre；代码一律按字符数
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    var langShell = pre.querySelector('code[data-language]');
    if (langShell && !pre.hasAttribute('data-language')) {
      pre.setAttribute('data-language', langShell.getAttribute('data-language'));
    }
    var codeChars = (pre.textContent || '').trim().length;
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    pre.appendChild(document.createTextNode('{{pre>code>' + codeChars + '_chars}}'));
  }
```

3. clean 分支返回值把 `stats.hiddenCount` 改为 `hiddenCount`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全绿（含 golden；组合夹具 clean-simplify 的 styled 不含 token 由 golden 守护）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: K5 hidden 裸属性折叠 + K6 table 折叠 + K7 pre 折叠——构成 token 取代 code... 与 data-u2m-hidden

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: K8 行内 run token 化（+K9 空白压缩移后）

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（clean 趟：新增 K8；R5 空白压缩移到 K8 之后）
- Modify: `test/unit/clean-snapshot.test.mjs`（新增 K8 用例）

**Interfaces:**
- Consumes: `sizeSuffix`（Task 4）、`MIN_CHARS`/`MIN_WORDS`（既有 cfg 默认 16/12）
- Produces: `stats.runCount` 填实；run token 语义定稿——`{{n_chars}}`/`{{n_words}}`（超阈值 16 汉字/12 词），含行内元素时 `{{n;2_a/1_code}}`（成员元素按标签计数、降序至多 4 项）

- [ ] **Step 1: 写失败测试**

对 `test/unit/clean-snapshot.test.mjs` 追加：

```js
test('K8: 行内 run token 化——阈值边界、构成、链接 run 整段吞噬、短 run 保留', async () => {
  const zh17 = '汉'.repeat(17);                       // 17 字 > 16 → token
  const zh16 = '汉'.repeat(16);                       // 16 字 → 保留
  const en13 = Array(13).fill('word').join(' ');      // 13 词 > 12 → token
  const en12 = Array(12).fill('word').join(' ');      // 12 词 → 保留
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <p data-idx="2">${zh17}</p>
    <p data-idx="3">${zh16}</p>
    <p data-idx="4">${en13}</p>
    <p data-idx="5">${en12}</p>
    <p data-idx="6">Use the <a data-idx="7" href="/x">Prompt Caching Dashboard</a> to monitor cache hit rates and usage over time.</p>
    <p data-idx="8">x <a data-idx="9">链接</a> y</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k8-run');
  try {
    assert.ok(/<p data-idx="2">\{\{17_chars\}\}<\/p>/.test(cleaned), '17 字 run 应折叠');
    assert.ok(cleaned.includes(zh16), '16 字 run 保留原文');
    assert.ok(/<p data-idx="4">\{\{13_words\}\}<\/p>/.test(cleaned), '13 词 run 折叠');
    assert.ok(cleaned.includes(en12), '12 词 run 保留原文');
    const mixed = cleaned.match(/<p data-idx="6">([\s\S]*?)<\/p>/)[1];
    assert.ok(/^\{\{14_words;1_a\}\}$/.test(mixed), `混合 run 整段折叠为 {{n;1_a}}: ${mixed}`);
    const short = cleaned.match(/<p data-idx="8">([\s\S]*?)<\/p>/)[1];
    assert.ok(short.includes('x <a') && short.includes('> y'), `短 run 保留原文与行内间空白: ${JSON.stringify(short)}`);
    assert.ok(styled.includes('Prompt Caching Dashboard') && styled.includes('href="/x"'), '带样式版不受影响');
  } finally { cleanup(); }
});

test('K8: 含 img 的 run 不折叠——图片 id 与 alt 保持可引用', async () => {
  const long = '这是一段超过十六个汉字的长文本配上图片，构成图注场景。';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <p data-idx="2">${long}<img data-idx="3" src="x.png" alt="配图"></p>
    <p data-idx="4">正文对照段落。</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k8-img');
  try {
    const seg = cleaned.match(/<p data-idx="2">([\s\S]*?)<\/p>/)[1];
    assert.ok(seg.includes(long), '含 img 的 run 保留原文');
    assert.ok(seg.includes('<img data-idx="3" alt="配图">') || /<img data-idx="3"[^>]*alt="配图"[^>]*>/.test(seg), 'img 元素与 alt 保留');
  } finally { cleanup(); }
});

test('K8: 行内元素嵌行内集外标签（含 svg）切断 run、保守保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <button data-idx="2"><span data-idx="3"><svg data-idx="4"></svg></span> <span data-idx="5">Copy Page</span></button>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k8-break');
  try {
    const seg = cleaned.match(/<button data-idx="2">([\s\S]*?)<\/button>/)[1];
    assert.ok(seg.includes('<svg data-idx="4"></svg>'), 'icon span 内的 svg 保留');
    assert.ok(seg.includes('Copy Page'), '短文本保留原文');
    assert.ok(!/\{\{\d+_/.test(seg), `病态结构不折叠: ${seg}`);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: K8 用例 FAIL（无折叠逻辑）。

- [ ] **Step 3: 实现 K8 并把空白压缩移到其后**

`script/lib/page-clean-snapshot.js` clean 分支，K7 之后、今日 R5（空白压缩）之前插入：

```js
  // K8. 行内 run token 化（仅清洗版）：块容器内连续行内兄弟序列（裸文本 +
  //     行内集元素），合计文本超阈值 → 整段替换为一个元数据 token（构成按
  //     成员元素标签计数、降序至多 4 项）。含 img 的 run 不折叠（图片 id 需
  //     可引用）；行内元素子树内出现行内集外标签（病态）→ 该元素视作块、
  //     切断 run（保守保留）。svg/iframe/canvas 不在行内集内、天然切断。
  var INLINE_TAGS_RUN = { A: 1, SPAN: 1, CODE: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1,
    MARK: 1, SMALL: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1, SAMP: 1, TIME: 1, IMG: 1, BR: 1 };
  function isInlineUnit(el) {
    if (!INLINE_TAGS_RUN[el.tagName.toUpperCase()]) return false;
    var inner = el.querySelectorAll('*');
    for (var i = 0; i < inner.length; i++) {
      if (!INLINE_TAGS_RUN[inner[i].tagName.toUpperCase()]) return false;
    }
    return true;
  }
  var runCount = 0;
  var containers = Array.prototype.slice.call(document.querySelectorAll('*'));
  for (var ci = 0; ci < containers.length; ci++) {
    var cont = containers[ci];
    if (!cont.parentNode) continue;
    var snapNodes = Array.prototype.slice.call(cont.childNodes);
    var runsList = [];
    var current = [];
    function flushRun() { if (current.length) { runsList.push(current); current = []; } }
    for (var ni = 0; ni < snapNodes.length; ni++) {
      var nd = snapNodes[ni];
      var member = nd.nodeType === 3 || (nd.nodeType === 1 && isInlineUnit(nd));
      if (member) current.push(nd); else flushRun();
    }
    flushRun();
    for (var ri = 0; ri < runsList.length; ri++) {
      var run = runsList[ri];
      var text = '';
      var imgHit = false;
      var memberCounts = {};
      for (var mi = 0; mi < run.length; mi++) {
        var m = run[mi];
        text += m.textContent;
        if (m.nodeType === 1) {
          var mt = m.tagName.toLowerCase();
          memberCounts[mt] = (memberCounts[mt] || 0) + 1;
          if (mt === 'img' || m.querySelector('img')) imgHit = true;
        }
      }
      if (text.trim() === '' || imgHit) continue;      // 纯空白交 K9；img run 豁免
      var cjk = CJK_RE.test(text.trim());
      var n = cjk ? text.trim().length : text.trim().split(/\s+/).filter(Boolean).length;
      if (n <= (cjk ? MIN_CHARS : MIN_WORDS)) continue; // 阈值下保留原文
      var mcomp = topTags(memberCounts);
      var mtoken = '{{' + n + '_' + (cjk ? 'chars' : 'words') + (mcomp ? ';' + mcomp : '') + '}}';
      var parent = run[0].parentNode;
      if (!parent) continue;
      var insertBefore = run[run.length - 1].nextSibling;
      for (var di = 0; di < run.length; di++) {
        if (run[di].parentNode) run[di].parentNode.removeChild(run[di]);
      }
      parent.insertBefore(document.createTextNode(mtoken), insertBefore);
      runCount++;
    }
  }
```

注：`MIN_CHARS`/`MIN_WORDS`/`CJK_RE`/`topTags` 均为 clean 分支既有变量（今日步骤 9 头部声明的是 styled 分支局部——若分叉后 clean 分支缺这两个阈值变量，在 clean 分支头部补 `var MIN_CHARS = typeof cfg.minChars === 'number' ? cfg.minChars : 16; var MIN_WORDS = typeof cfg.minWords === 'number' ? cfg.minWords : 12;`）。随后把今日 R5 空白压缩代码块（不动内容）移到 K8 之后，编号注释改 K9。clean 分支返回值 `stats.runCount` 改为 `runCount`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全绿。重点观察 `'中英文分标准占位…'`（enShort/zhShort 保留原文断言依然成立）、`'纯空白文本节点…'`、`'R4+R5: astro…'`（空白断言不受伤）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: K8 行内 run token 化——超阈值连续行内段整段折叠为元数据 token

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 集成回归 + 参考页真跑验收

**Files:**
- Modify: 无代码（验证任务；若验收暴露缺陷，修复后重跑本任务全部步骤）

**Interfaces:**
- Consumes: Task 1-5 全部产出
- Produces: 验收结论（参考页清洗版 ≤ 70 KB、styled 逐字节一致、步骤 4-6 回放一致、juice 引用为 0）

- [ ] **Step 1: 全量测试**

Run: `pnpm test:all`
Expected: 单测 + 集成全绿（集成测试不触碰步骤 2 内部，理应不受影响——若有失败，先判定是否与本改造相关再修）。

- [ ] **Step 2: 参考页重跑步骤 2**

```bash
REF=working/developers.openai.com_api_docs_guides_prompt-caching
URL='https://developers.openai.com/api/docs/guides/prompt-caching'
cp "$REF/2_clean_style_snapshot.html" /tmp/styled-before.html
U2M_DEBUG=1 node script/clean_snapshot.mjs --url "$URL"
cmp /tmp/styled-before.html "$REF/2_clean_style_snapshot.html" && echo 'OK styled 逐字节一致'
stat -f%z "$REF/2_clean_snapshot.html"
grep -c juice script/clean_snapshot.mjs || echo 'OK juice 引用为 0'
```

Expected: styled 逐字节一致；清洗版字节数 ≤ 70000（spec 预估 62-67 KB；若超 70 KB，把字节数与 `[clean]` 汇总行报告给用户定夺，不擅自加规则）；grep 计数为 0。

- [ ] **Step 3: 步骤 4-6 确定性回放**

```bash
cp "$REF/5_juice_styles.html" /tmp/5-before.html
cp "$REF/6_article.html" /tmp/6-before.html
node script/extract_styled.mjs --url "$URL"
node script/compute_styles.mjs --url "$URL"
node script/extract_article.mjs --url "$URL"
cmp /tmp/5-before.html "$REF/5_juice_styles.html" && cmp /tmp/6-before.html "$REF/6_article.html" && echo 'OK 4-6 产物一致'
```

Expected: 两文件与回放前逐字节一致（输入是 styled 版 + 既有 3_key_ids.json，均未变）。步骤 8/9 依赖步骤 7 的 LLM 产物与线上重渲染，不做回放——styled 逐字节一致已蕴含其输入不变。

- [ ] **Step 4: Commit（仅当本任务产生了修复）**

```bash
git add -A
git commit -m "fix: 参考页验收暴露问题的修复（如有）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 文档同步

**Files:**
- Modify: `references/analyze_html_guide.md`（步骤 3 识别线索重写）
- Modify: `README.md:88,91,118`
- Modify: `CLAUDE.md`（管线顺序段步骤 2 词条）
- 不动: `SKILL.md`（其步骤 2 段落本就不含规则细节、无 data-u2m-hidden 字样——spec §8 的「SKILL.md 重写」按实际情况落空，规则语义全部在 guide 与脚本头注）

**Interfaces:**
- Consumes: Task 1-6 的最终行为
- Produces: 与实现一致的文档

- [ ] **Step 1: 改写 `references/analyze_html_guide.md`**

1. 第 3 行「读取 …DOM 结构（元素层级、标签类型、class 名称）和长文本占位符（`{{LONG_TEXT_k|...}}`）分布」改为：

```markdown
这是**一篇文章页面**， 读取 `<url-working-path>/2_clean_snapshot.html` 的 DOM 结构（元素层级、标签类型、语义 class）与**文本规模 token** 分布，找到以下四类关键元素与列表流噪音的 `data-idx` (ID)：
```

2. 第 9 行 `预格式块 <pre>（步骤 2 清洗后内容为 code... 占位）` 改为 `预格式块 <pre>（内容折叠为 {{pre>code>N_chars}} 占位）`。

3. 约束第 3 条（data-u2m-hidden）替换为：

```markdown
  3. **`hidden` 属性元素 + `{{n_chars;n_a/n_div/...}}` 内容 token**：折叠的隐藏子树（模态/抽屉/移动端导航等）。根元素的 `data-idx` 可正常引用——原文完整保留在带样式版，纳入 listFlowIds 即可还原全文（FAQ 折叠答案、tab 变体面板是典型可纳入场景）；token 值是真实文本规模与标签构成（计数降序），可据此判断是否值得纳入
```

4. 约束第 4 条（code...）替换，并追加第 5/6 条：

```markdown
  4. `{{pre>code>N_chars}}`：pre 代码块内容占位（`data-language` 在 pre 上）。完整代码在后续步骤保真，识别时把 pre 当作一个结构单元即可
  5. `{{table>N_chars}}` / `{{table>N_words}}`：表格整体占位。完整表格在后续步骤从带样式版保真，判定容器是否为流时把 table 当复合单元即可
  6. 链接与图片元素**不带 URL**（href/src 已清空，链接文本与 alt 保留）；超阈值的连续行内文本段（含链接混排）整段折叠为 `{{n_chars;n_a/...}}` token——文本规模与构成是判读流价值的线索，短文本（≤16 汉字 / ≤12 词）保留原文
```

5. 结构示例同步：`<pre data-idx="23">code...</pre>` → `<pre data-idx="23" data-language="tsx">{{pre>code>412_chars}}</pre>`；`<div data-u2m-hidden="120_chars" data-idx="26">…</div>` → `<div hidden data-idx="26">{{120_chars;3_p}}</div>`（注释一并改）；手风琴块 `<button data-idx="43">{{LONG_TEXT_1|80_chars}}</button>` → `<button data-idx="43">{{80_chars}}</button>`，其后的 `<div data-u2m-hidden="200_chars" data-idx="44"><p data-idx="45">折叠的正文段落...</p></div>` → `<div hidden data-idx="44">{{200_chars;1_p}}</div>`（id 45 随折叠消失，注释里对 45 的引用同步删除）。

- [ ] **Step 2: 更新 `README.md`**

第 88 行「长文本占位」句尾追加一句；第 91 行整句替换：

```markdown
- **清洗版瘦身**：步骤 2 对 `2_clean_snapshot.html` 走「单页两趟 + 九条机械规则」（K1 class 语义过滤、K2 属性白名单——URL/aria 清空、astro 解包、hidden 裸属性折叠 `{{n;构成}}`、table/pre 折叠、行内 run token 化、空白压缩），零样式计算、无检测管线；清洗版是终端视图（唯一消费者是步骤 3，不含 LONG_TEXT 占位），一切还原走带样式版——正文与带样式版零丢失
```

第 118 行表格步骤 2 行改为 `| 步骤 2 \`clean_snapshot.mjs\` | 结构清洗（单页两趟：带样式版保真 + 清洗版 K1-K9 极致瘦身） | 已完成 |`。

- [ ] **Step 3: 更新 `CLAUDE.md` 管线顺序段的步骤 2 词条**

旧文本（一整段）：

```markdown
→ 步骤 2 `clean_snapshot.mjs` 结构清洗（删 style/link/base、清空 SVG、长文本占位 + 清洗版六规则瘦身：pre→code...、class 噪声过滤、data-* 白名单、astro 解包、保守空白压缩、juice 级联隐藏子树折叠为 data-u2m-hidden 标记——统一折叠不删除，带样式版与步骤 4-9 不受影响，见 docs/superpowers/specs/2026-08-25-clean-snapshot-slimming-design.md；产物 `2_clean_snapshot.html`）
```

替换为：

```markdown
→ 步骤 2 `clean_snapshot.mjs` 结构清洗（单页两趟、零样式计算：趟 1 styled = 结构删除 + 长文本占位 + SVG 瘦身，产物与历史逐字节一致；趟 2 clean = 结构删除 + K1-K9 机械规则——class 语义过滤、属性白名单（class/id/data-idx/data-language/hidden/type/role/alt，href/src/aria 全删）、SVG 清空、astro 解包、hidden 裸属性折叠 `{{n;构成}}`、table/pre 折叠 `{{table>n}}`/`{{pre>code>n}}`、行内 run token 化（阈值 16 汉字/12 词）、空白压缩；**清洗版是终端视图**——唯一消费者是步骤 3、不含 LONG_TEXT 占位、一切还原走带样式版，见 docs/superpowers/specs/2026-08-27-clean-snapshot-simplify-design.md；产物 `2_clean_snapshot.html`/`2_clean_style_snapshot.html`/`2_long_text.json`）
```

- [ ] **Step 4: 跑全量测试确认文档未破坏任何引用**

Run: `pnpm test:all`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add references/analyze_html_guide.md README.md CLAUDE.md
git commit -m "docs: 步骤 2 极致简化同步——guide token 语义、README、CLAUDE.md 管线词条

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 两趟架构→Task 2；§5 K1/K2→Task 3、K4/K5/K6/K7→Task 4、K8/K9→Task 5（K3 svg 清空在 Task 2 保留、Task 3 调整属性处理）；§6 两个守卫→Task 2（LONG_TEXT 守卫）+ Task 4/5（styled 无新 token 守卫，golden 逐字节一致更强）；§7 删除清单→Task 2、debug 汇总→Task 2 写入（数值 Task 4/5 变真）；§8 文档→Task 7（SKILL.md 经核实无需改动，已在任务内说明）；§9 测试→各任务 Step 1；§9 验收→Task 6。无缺口。
- **占位符扫描**：所有步骤含实际代码/命令/文本，无 TBD。
- **类型一致性**：`__u2mCleanSnapshot(cfg)` 返回契约（styled `{html,longTexts,longTextCount}` / clean `{html,stats}`）在 Task 2 定义、Task 4/5 填实 stats 字段名一致（`hiddenCount`/`runCount`）；`sizeSuffix`/`topTags`/`CJK_RE` Task 4 定义、Task 5 复用；测试 helper `runClean(snapshot, urlPath, env)` 沿用现有签名。
