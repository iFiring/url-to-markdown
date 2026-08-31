# 步骤 5/6 文章视图瘦身实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把参考页 `6_article.html` 从 239.5KB 瘦到 ≤140KB——步骤 5 finalize 加零值声明过滤，步骤 6 迁移后加六条结构规则的瘦身 pass，同时修复 codex:// 营销链接漏进终产物的质量 bug。

**Architecture:** 双落点收敛（spec §3 方案 A）——声明级零值过滤落在 `page-finalize-inline.js`（白名单同场），结构级六条规则落在新共享脚本 `page-slim-article.js`、由 `extract_article.mjs` 在迁移+噪音剔除之后同页 `setContent` 内存往返执行。保护集 = titleIds∪descriptionIds∪standaloneIds；`1_snapshot.html` 与步骤 1-4 产物零接触。

**Tech Stack:** Node ≥20、Playwright chromium（evaluate 注入共享页面脚本）、node --test。

**Spec:** `docs/superpowers/specs/2026-08-29-step6-article-slimming-design.md`（含 2026-08-29 规则③修订：无文本**或纯符号**）

## Global Constraints

- 每个 CLI 的 stdout **恰好一行 JSON**，日志走 stderr，退出码 0/1/2（usage_error=2）。emit 契约只做加法（新增 `slim` 字段）。
- **emit 延迟退出陷阱**：`emit()` 先写行、在写回调里 `process.exit`，本身同步返回——其后不得再执行任何代码。
- **共享页面脚本是分类唯一事实源**：结构规则全部住 `script/lib/page-*.js`（普通非模块文件、单一具名 `function __u2mXxx(...)`、不得 async），严禁分叉进 `.mjs` 编排层。
- **`1_snapshot.html` 与步骤 1-4 产物逐字节不动**。
- Playwright evaluate 语义：`(${src})(${args})` 完整表达式形式；解析后得到函数值的字符串不会被调用。
- 测试跑法：单文件 `node --test test/unit/<name>.test.mjs`；全量 `pnpm test`（unit）/ `pnpm run test:integration` / `pnpm test:all`。
- 所有测试夹具走 `setupTmp` + `U2M_WORKING_ROOT` 隔离 + `fs.rmSync` 清理（沿用两个测试文件现有模式）。
- 参考页（冒烟）：`https://developers.openai.com/api/docs/guides/prompt-caching`，工作目录 `working/developers.openai.com_api_docs_guides_prompt-caching/`。

---

### Task 1: 零值声明过滤（`page-finalize-inline.js`，步骤 5）

**Files:**
- Modify: `script/lib/page-finalize-inline.js`
- Modify: `script/compute_styles.mjs`（仅头注 stage 2 描述补一句）
- Test: `test/unit/compute-styles.test.mjs`（新增夹具与用例；修订 LAYERED 夹具一处）

**Interfaces:**
- Consumes: 现有 `__u2mFinalizeInline(computedMap)` 的逐元素 CSSOM 循环与 `dirty` 机制。
- Produces: finalize 终态多一条不变量——**值等于全元素初始值的声明不存在**。后续任务不消费它，但 Task 6 的空壳 span 判定依赖本任务把 `border: 0px solid` 等清空后 style 属性整体消失。

- [ ] **Step 1: 写失败测试**

在 `test/unit/compute-styles.test.mjs` 末尾（`缺步骤 4 产物` 用例之前）追加夹具与用例：

```js
// 零值声明过滤：值等于全元素初始值的声明删除（写与不写等价的非信息）。
// 边框按"边"语义：style none（显式或缺省——缺省即 initial none）或
// width ∈ {0px, 0} → 该边三件全删——宽 0 或样式 none 的边无论其余声明
// 什么都不可见；style 实值 + width 缺省 = medium+solid 可见边框，保留。
// 参考页 1,946 个元素的 style 值只有 border: 0px solid（Tailwind preflight
// 被 juice 内联的产物）。
const ZERO_VOID_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>零值</title><style>body{transition:opacity .2s}</style></head><body>
<div style="border: 0px solid" data-idx="1">零边框</div>
<div style="border-width: medium; border-style: none; border-color: currentcolor; border-image: none" data-idx="2">medium加none</div>
<div style="border: 1px solid red" data-idx="3">实边框</div>
<div style="border: solid" data-idx="4">style实值width缺省</div>
<div style="border-width: 5px" data-idx="5">width有值style缺省</div>
<div style="border-radius: 0px; background-color: rgb(249, 249, 249)" data-idx="6">零圆角实背景</div>
<div style="border-radius: 8px" data-idx="7">实圆角</div>
<div style="box-shadow: none" data-idx="8">阴影none</div>
<div style="background-color: transparent" data-idx="9">透明背景</div>
<div style="background-color: rgba(0, 0, 0, 0)" data-idx="10">alpha零背景</div>
<div style="overflow: visible" data-idx="11">溢出可见</div>
<div style="overflow: auto" data-idx="12">滚动裁剪</div>
<div style="flex: 0 0 auto" data-idx="13">flex信号</div>
<div style="outline: 1px solid blue" data-idx="14">实outline</div>
<div style="outline-width: 0px; outline-style: solid" data-idx="15">零宽outline</div>
</body></html>`;

test('compute_styles.mjs: 零值声明过滤——等于全元素初始值的声明删除、实信号保留', async () => {
  const { tmpRoot } = setupTmp('zero-void', { extractHtml: ZERO_VOID_EXTRACT });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');
  const tagOf = (id) => juiced.match(new RegExp(`<[^>]*data-idx="${id}"[^>]*>`))?.[0] || '';

  // 只剩零值声明的元素：style 属性整体消失
  for (const id of [1, 2, 5, 8, 9, 10, 11, 15]) {
    assert.ok(!tagOf(id).includes('style='), `id ${id} 零值声明应清空 style 属性: ${tagOf(id)}`);
  }
  // 实信号保留
  assert.ok(tagOf(3).includes('1px solid'), `实边框应保留: ${tagOf(3)}`);
  assert.ok(tagOf(4).includes('border: solid') || tagOf(4).includes('border-style: solid'),
    `style 实值 + width 缺省（medium+solid 可见）应保留: ${tagOf(4)}`);
  assert.ok(tagOf(6).includes('rgb(249, 249, 249)') && !tagOf(6).includes('border-radius'),
    `零圆角删、实背景留: ${tagOf(6)}`);
  assert.ok(tagOf(7).includes('border-radius: 8px'), `非零圆角应保留: ${tagOf(7)}`);
  assert.ok(tagOf(12).includes('overflow: auto'), `overflow:auto 应保留: ${tagOf(12)}`);
  assert.ok(tagOf(13).includes('flex: 0 0 auto'), `flex 布局信号不是零值: ${tagOf(13)}`);
  assert.ok(tagOf(14).includes('outline') && tagOf(14).includes('1px'),
    `实 outline 应保留: ${tagOf(14)}`);
  assert.equal(out.styledCount, 7, `应剩 7 个带样式元素（3/4/6/7/12/13/14），实得 ${out.styledCount}`);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/compute-styles.test.mjs`
Expected: 新用例 FAIL（id 1 的 `border: 0px solid` 等仍残留 style 属性）；既有用例全部 PASS。

- [ ] **Step 3: 实现——finalize 循环加零值判定**

`script/lib/page-finalize-inline.js`：在 `keep()` 函数定义之后、`var styled = ...` 之前插入：

```js
  // 零值声明：值等于全元素初始值——写与不写等价，纯非信息（参考页
  // 1,946 个元素的 style 值只有 border: 0px solid——Tailwind preflight
  // 被 juice 内联的产物）。边框按"边"语义：style none（显式或缺省——
  // 缺省即 initial none）或 width 0 → 该边三件全删，宽 0 或样式 none
  // 的边无论其余声明什么都不可见；style 实值 + width 缺省 =
  // medium+solid 可见边框，保留。font-size/weight 的相对对比与
  // flex 布局信号不是零值，不在本表
  function sideVoid(st, side) {
    var style = st.getPropertyValue('border-' + side + '-style');
    var width = st.getPropertyValue('border-' + side + '-width');
    return style === 'none' || style === '' || width === '0px' || width === '0';
  }
  function outlineVoid(st) {
    var style = st.getPropertyValue('outline-style');
    var width = st.getPropertyValue('outline-width');
    return style === 'none' || style === '' || width === '0px' || width === '0';
  }
  function isVoidDeclaration(prop, val, st) {
    var m = /^border-(top|right|bottom|left)-(width|style|color)$/.exec(prop);
    if (m) return sideVoid(st, m[1]);
    if (prop === 'outline-style' || prop === 'outline-width' || prop === 'outline-color') {
      return outlineVoid(st);
    }
    if (prop === 'border-image' || prop.indexOf('border-image-') === 0) return val === 'none';
    if (prop === 'border-radius' ||
        /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.test(prop)) {
      return val === '0px';
    }
    if (prop === 'box-shadow') return val === 'none';
    if (prop === 'background-color') {
      return val === 'transparent' || val === 'rgba(0, 0, 0, 0)';
    }
    if (prop === 'background-image') return val === 'none';
    if (prop === 'overflow' || prop === 'overflow-x' || prop === 'overflow-y') {
      return val === 'visible';
    }
    return false;
  }
```

再把循环里的删除条件：

```js
      if (!keepThis || val === 'inherit') {
```

改为：

```js
      if (!keepThis || val === 'inherit' || isVoidDeclaration(prop, val, st)) {
```

头注（`1.5 函数值替换` 与 `2. 删除全部 <style>` 之间）插入一段：

```
 *  1.7 零值声明过滤：白名单内值等于全元素初始值的声明删除——边框按"边"
 *     语义（style none/缺省或 width 0 → 该边三件全删）、outline 同理、
 *     box-shadow:none、background-color:transparent（含 rgba(0,0,0,0)
 *     计算形）、background-image:none、border-image:none、radius:0px、
 *     overflow:visible。font-size/weight 的相对对比与 flex 布局信号不是
 *     零值，保留；<img> 宽高例外不受影响
```

`script/compute_styles.mjs` 头注 stage 2 描述（`- <style> 标签与 class 属性删净` 一行之前）加一行：

```
 *      - 零值声明过滤：白名单内值等于全元素初始值的声明删除（边框按
 *        "边"语义判无效——宽 0 或样式 none 的边无论其余声明什么都不可见）
```

- [ ] **Step 4: 修订 LAYERED 夹具的零值形状**

`test/unit/compute-styles.test.mjs` 的 `LAYERED_EXTRACT` 里 `.nested-deep` 只声明了 `border-width: 2px`（style 缺省 → 无效边，零值过滤会删 width，`border-width: 2px` 断言必挂）。给它补上 style：

```js
  @layer nested { .nested-deep { border-width: 2px; border-style: solid } }
```

（该用例的意图是递归 layer 解包内联，补 style 后意图不变、且不再依赖"width-only 边框保留"这个已被本任务推翻的行为。）

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test test/unit/compute-styles.test.mjs`
Expected: 全部 PASS（新用例 + 既有 8 个用例）。

- [ ] **Step 6: Commit**

```bash
git add script/lib/page-finalize-inline.js script/compute_styles.mjs test/unit/compute-styles.test.mjs
git commit -m "feat: 步骤 5 finalize 零值声明过滤——边框按边语义判无效 + 全元素初始值精确删除

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 瘦身 pass 骨架 + 接线 + 规则① data-\* 白名单清理

**Files:**
- Create: `script/lib/page-slim-article.js`
- Modify: `script/extract_article.mjs`
- Test: `test/unit/extract-article.test.mjs`

**Interfaces:**
- Consumes: `extract_article.mjs` 已解析的 `keyIds`（titleIds/descriptionIds/standaloneIds/listFlowIds/listFlowDeleteIds）；`readSharedScript`（`script/lib/placeholder.mjs`）。
- Produces: `__u2mSlimArticle(protectedIds)` —— evaluate 调用、操作 `document`、返回 `{html, attrsDropped, mathReplaced, buttonsRemoved, buttonsUnwrapped, svgsRemoved, linksStripped, spansUnwrapped}`（七计数恒在，零也出现）。`extract_article.mjs` 的 ok 行新增 `slim` 对象（七计数的同名键）。后续 Task 3-6 只在 `page-slim-article.js` 的 `return {` 之前按固定顺序插入各规则代码块。

- [ ] **Step 1: 写失败测试**

`test/unit/extract-article.test.mjs`：文件头 `pageScriptPath` 定义之后加：

```js
const pageSlimScriptPath = path.resolve(thisDir, '../../script/lib/page-slim-article.js');
```

在 `page-extract-article.js` 两个源级用例之后加：

```js
test('page-slim-article.js: 文件存在且包含 __u2mSlimArticle 函数', () => {
  const src = fs.readFileSync(pageSlimScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mSlimArticle'), '应定义 __u2mSlimArticle');
});

test('page-slim-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageSlimScriptPath, 'utf8');
  const wrapped = `(${src})([])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});
```

文件末尾加功能用例：

```js
// 瘦身规则① data-*：保留白名单 {data-idx, data-language}（后者是
// 步骤 7 判代码围栏语言的机械信号），其余 data-*（组件库脚手架/交互
// 状态）全删——白名单而非黑名单，陌上站点的 data-* 安全默认删除
const DATASTAR_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>瘦身</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-variant="lead" data-idx="5">段落<span data-color="accent" data-idx="6">行内</span></p><code data-language="python" data-wrap-long-lines="false" data-idx="7">print(1)</code></div></body></html>`;

test('extract_article.mjs: 瘦身规则①——data-* 只留 data-idx 与 data-language', async () => {
  const { tmpRoot, urlDir } = setupTmp('datastar', { titleIds: [1], descriptionIds: [], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), DATASTAR_JUICED);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(!html.includes('data-variant'), 'data-variant 应删除');
  assert.ok(!html.includes('data-color'), 'data-color 应删除');
  assert.ok(!html.includes('data-wrap-long-lines'), 'data-wrap-long-lines 应删除');
  assert.ok(html.includes('data-language="python"'), 'data-language 应保留');
  for (const id of [1, 5, 6, 7]) {
    assert.ok(html.includes(`data-idx="${id}"`), `id ${id} 应保留`);
  }
  // emit 新增 slim 统计（加法式契约，单行 JSON 不变）
  assert.equal(out.slim.attrsDropped, 3, '应删除 3 个非白名单 data-* 属性');
  assert.deepEqual(
    Object.keys(out.slim).sort(),
    ['attrsDropped', 'buttonsRemoved', 'buttonsUnwrapped', 'linksStripped', 'mathReplaced', 'spansUnwrapped', 'svgsRemoved'],
    'slim 应含七项计数'
  );
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 两个源级用例 FAIL（文件不存在）；功能用例 FAIL（`out.slim` 为 undefined）。既有用例全部 PASS。

- [ ] **Step 3: 创建 `script/lib/page-slim-article.js`**

```js
/**
 * 步骤 6 页面内瘦身函数。在浏览器 evaluate 中执行，签名
 * __u2mSlimArticle(protectedIds)——在 __u2mExtractArticle 迁移与噪音
 * 剔除之后、序列化之前对文章视图执行六条结构规则（spec：
 * docs/superpowers/specs/2026-08-29-step6-article-slimming-design.md §5，
 * 固定执行顺序——前面的规则改变后面规则看到的输入）：
 *  ① data-* 清理：保留 {data-idx, data-language}（后者是步骤 7 判
 *     代码语言的机械信号），其余 data-*（组件库脚手架/交互状态）全删。
 *     白名单而非黑名单——陌上站点的 data-* 安全默认删除
 *  ② MathML→LaTeX：annotation 有 LaTeX 源才替换（KaTeX 双胞胎结构整体
 *     替换消灭 katex-html 重复；结构不匹配只换 <math>；无源保留原树）
 *  ③ 无文本/纯符号 button 与无文本 svg 删除（/[\p{L}\p{N}]/u 不命中
 *     的纯符号交互件如 ⋮/✕ 同删；含字母数字者走 ④）
 *  ④ 有文本 button 降级（解包上提子节点，包装铬的 style 弃置）
 *  ⑤ 非白名单协议 href 剥除（scheme ∉ http/https/mailto/tel 的 <a>
 *     解包——参考页 codex:// 营销链接单个 ~1KB prompt 曾漏进 9_markdown）
 *  ⑥ 空壳 span 拆包（属性只剩 data-idx，迭代到不动点——pre 内语法
 *     高亮 token span 的样式已被步骤 5 清空，结构在、信息不在）
 * 保护集 protectedIds = titleIds ∪ descriptionIds ∪ standaloneIds
 * （listFlowIds 不入——容器本身不迁移）：删除/解包类（③④⑤⑥）跳过
 * 保护元素本身、其后代照常瘦身；保真替换类（②）不受约束——替换保留
 * 内容只换形态。id 随元素消失只影响 6/7 血统：步骤 8 用 1_snapshot/
 * live 的 id 对位，零影响。
 */
function __u2mSlimArticle(protectedIds) {
  var stats = {
    attrsDropped: 0, mathReplaced: 0, buttonsRemoved: 0,
    buttonsUnwrapped: 0, svgsRemoved: 0, linksStripped: 0, spansUnwrapped: 0
  };
  var protectedSet = {};
  for (var i = 0; i < (protectedIds || []).length; i++) protectedSet[protectedIds[i]] = true;
  function isProtected(el) {
    var id = el.getAttribute && el.getAttribute('data-idx');
    return !!(id && protectedSet[id]);
  }
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  // ① data-* 清理：白名单之外的 data-* 全删
  var KEEP_DATA = { 'data-idx': 1, 'data-language': 1 };
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    for (var j = el.attributes.length - 1; j >= 0; j--) {
      var name = el.attributes[j].name;
      if (name.indexOf('data-') === 0 && !KEEP_DATA[name]) {
        el.removeAttribute(name);
        stats.attrsDropped++;
      }
    }
  }

  return {
    html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML,
    attrsDropped: stats.attrsDropped,
    mathReplaced: stats.mathReplaced,
    buttonsRemoved: stats.buttonsRemoved,
    buttonsUnwrapped: stats.buttonsUnwrapped,
    svgsRemoved: stats.svgsRemoved,
    linksStripped: stats.linksStripped,
    spansUnwrapped: stats.spansUnwrapped
  };
}
```

- [ ] **Step 4: 接线 `script/extract_article.mjs`**

头注 `提取规则` 列表末尾（`- 排序：…` 之后）加两行：

```
 *   - 瘦身 pass：迁移与噪音剔除完成后，同页 setContent 内存往返执行
 *     lib/page-slim-article.js 的六条结构规则（见其头注），emit 增 slim
 *     计数对象（加法式契约）
```

`const pageExtractFn = ...` 之后加：

```js
  const pageSlimFn = await readSharedScript('page-slim-article.js');
```

把：

```js
    const articlePath = path.join(dir, '6_article.html');
    await fsPromises.writeFile(articlePath, result.html, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${result.count} 个元素, 剔除噪音 ${result.removedNoise} 个)`);
```

改为：

```js
    // 瘦身 pass：迁移后的文章视图在内存中重载（同页 setContent，不落盘），
    // 六条结构规则见 page-slim-article.js 头注。保护集 =
    // titleIds∪descriptionIds∪standaloneIds（listFlowIds 容器不迁移，不入）
    await page.setContent(result.html, { waitUntil: 'domcontentloaded' });
    const protectedIds = [
      ...(keyIds.titleIds || []),
      ...(keyIds.descriptionIds || []),
      ...(keyIds.standaloneIds || []),
    ];
    const { html: slimHtml, ...slimStats } = await page.evaluate(
      `(${pageSlimFn})(${JSON.stringify(protectedIds)})`
    );

    const articlePath = path.join(dir, '6_article.html');
    await fsPromises.writeFile(articlePath, slimHtml, 'utf8');
    log(`文章视图提取完成: ${articlePath} (${result.count} 个元素, 剔除噪音 ${result.removedNoise} 个, 瘦身 ${JSON.stringify(slimStats)})`);
```

emit 的 ok 对象（`removedNoiseCount: result.removedNoise,` 之后）加：

```js
      slim: slimStats,
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 全部 PASS（新 3 个 + 既有全部——既有用例的夹具不含 data-* 噪音，行为不变）。

- [ ] **Step 6: Commit**

```bash
git add script/lib/page-slim-article.js script/extract_article.mjs test/unit/extract-article.test.mjs
git commit -m "feat: 步骤 6 瘦身 pass 接线 + 规则① data-* 白名单清理

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 瘦身规则② MathML→LaTeX（复用 `page-latex.js`）

**Files:**
- Modify: `script/lib/page-slim-article.js`
- Modify: `script/extract_article.mjs`（evaluate 组合注入 latex）
- Test: `test/unit/extract-article.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `__u2mSlimArticle` 骨架（`isProtected`/`unwrap`/`stats`）；`script/lib/page-latex.js` 的 `__u2mLatexText(el)`（休眠共享助手，原样复用：查 `annotation[encoding="application/x-tex"]` / `script[type=math/tex]` / 前邻 script，返回 trim 后 LaTeX 或 null）。
- Produces: evaluate 表达式变为 `(function(){ ${latexFn} return (${slimFn})(${protectedIds}); })()`——`__u2mLatexText` 以函数声明进入同一作用域，slim 闭包内可见。`mathReplaced` 计数生效。

- [ ] **Step 1: 写失败测试**

`test/unit/extract-article.test.mjs` 末尾加：

```js
// 瘦身规则② MathML→LaTeX：KaTeX 双胞胎（父 span 仅含 math、祖父恰两
// 元素子其一为父另一为 span）整体替换消灭 katex-html 重复；裸 math 只换
// <math> 本身；无 annotation 保留原树。$…$ 单美元内联形式（与参考页
// 9_markdown 既有约定一致）。annotation 里的实体（&lt;）经 textContent
// 解码、序列化时重新转义
const MATH_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>公式</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">设 <span data-idx="60"><span data-idx="61"><math data-idx="62"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-idx="63"><span data-idx="64">M</span></span></span> 为最小长度，</p><p data-idx="8">裸公式 <math data-idx="70"><semantics><mrow><mi>L</mi></mrow><annotation encoding="application/x-tex">L &lt; M</annotation></semantics></math> 成立，</p><p data-idx="9">无源公式 <math data-idx="80"><mrow><mi>x</mi></mrow></math> 保留。</p></div></body></html>`;

test('extract_article.mjs: 瘦身规则②——MathML 按三档替换为 $LaTeX$', async () => {
  const { tmpRoot, urlDir } = setupTmp('math', { titleIds: [1], descriptionIds: [], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), MATH_JUICED);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.includes('设 $M$ 为最小长度'),
    `KaTeX 双胞胎应整体替换为 $M$: ${html.slice(html.indexOf('<body'))}`);
  for (const id of [60, 61, 62, 63, 64]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `katex 包装 id ${id} 应随整体替换消失`);
  }
  assert.ok(html.includes('裸公式 $L &lt; M$ 成立'), '裸 math 应替换为 LaTeX 文本');
  assert.ok(!html.includes('data-idx="70"'), '裸 math 的 id 应消失');
  assert.ok(html.includes('<math data-idx="80"'), '无 annotation 的 math 应保留原树');
  assert.equal(out.slim.mathReplaced, 2, '应替换 2 处（双胞胎整体 + 裸 math）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 新用例 FAIL（`设 $M$ 为最小长度` 不存在，mathReplaced 为 0）。

- [ ] **Step 3: 实现规则②**

`script/lib/page-slim-article.js`：规则①代码块之后、`return {` 之前插入：

```js
  // ② MathML→LaTeX：annotation 有 LaTeX 源才替换（__u2mLatexText 来自
  // page-latex.js，由 extract_article.mjs 组合注入同一作用域；独立
  // evaluate 时优雅降级跳过）。KaTeX 双胞胎结构识别：父 span 仅含 math
  // 一个元素子（空白文本子忽略）且祖父恰两元素子、另一为 span →
  // 祖父整体替换（katex-html 孪生一并消灭）；结构不匹配只换 <math>，
  // 孪生残留由规则⑥解体为文本（同今日现状，LLM 能正确择一）。
  // 不受保护集约束——保真替换保留内容只换形态
  function elementChildren(el) {
    var out = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
    return out;
  }
  var maths = document.querySelectorAll('math');
  for (var i = 0; i < maths.length; i++) {
    var el = maths[i];
    if (!el.parentNode) continue;
    var latex = typeof __u2mLatexText === 'function' ? __u2mLatexText(el) : null;
    if (!latex) continue;
    var target = el;
    var p = el.parentElement;
    var g = p ? p.parentElement : null;
    if (p && g && p.tagName === 'SPAN' && g.tagName === 'SPAN') {
      var pKids = elementChildren(p);
      var gKids = elementChildren(g);
      var twin = null;
      for (var k = 0; k < gKids.length; k++) if (gKids[k] !== p) twin = gKids[k];
      if (pKids.length === 1 && pKids[0] === el && gKids.length === 2 &&
          twin && twin.tagName === 'SPAN') {
        target = g;
      }
    }
    target.parentNode.replaceChild(document.createTextNode('$' + latex + '$'), target);
    stats.mathReplaced++;
  }
```

- [ ] **Step 4: 改接线为组合注入**

`script/extract_article.mjs`：`const pageSlimFn = ...` 之后加：

```js
  const latexFn = await readSharedScript('page-latex.js');
```

把 Task 2 的 evaluate：

```js
    const { html: slimHtml, ...slimStats } = await page.evaluate(
      `(${pageSlimFn})(${JSON.stringify(protectedIds)})`
    );
```

改为：

```js
    // page-latex.js 的 __u2mLatexText 以函数声明进入同一作用域，
    // page-slim-article.js 规则② 闭包内可见
    const { html: slimHtml, ...slimStats } = await page.evaluate(
      `(function(){ ${latexFn} return (${pageSlimFn})(${JSON.stringify(protectedIds)}); })()`
    );
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add script/lib/page-slim-article.js script/extract_article.mjs test/unit/extract-article.test.mjs
git commit -m "feat: 瘦身规则② MathML→LaTeX——KaTeX 双胞胎整体替换、复用 page-latex.js

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 瘦身规则③④ 无文本/纯符号 button 与空 svg 删除 + 有文本 button 解包

**Files:**
- Modify: `script/lib/page-slim-article.js`
- Test: `test/unit/extract-article.test.mjs`

**Interfaces:**
- Consumes: Task 2 骨架（`isProtected`/`unwrap`/`stats`）。
- Produces: `buttonsRemoved` / `svgsRemoved` / `buttonsUnwrapped` 计数生效。规则③的"纯符号"判定 `/[\p{L}\p{N}]/u` 不命中（spec 2026-08-29 修订——参考页 7 个 `⋮` 按钮实测有文本但零字母数字）。

- [ ] **Step 1: 写失败测试**

`test/unit/extract-article.test.mjs` 末尾加：

```js
// 瘦身规则③④：无文本/纯符号（/[\p{L}\p{N}]/u 不命中——⋮ 即此类）button
// 与无文本 svg 整删（随 button 删除的内部 svg 不重复计数）；有文本
// button（中文/字母数字）解包降级保留文本；保护集中的 button 不动
const BUTTON_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>按钮</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">正文</p><button data-idx="20"><svg data-idx="21"><path d="M0 0"/></svg></button><button data-idx="22">⋮</button><svg data-idx="28"><rect width="1"/></svg><button data-idx="23">JavaScript</button><button data-idx="24">查看答案</button></div></body></html>`;

test('extract_article.mjs: 瘦身规则③④——纯符号 button/空 svg 删除、文本 button 解包、保护集跳过', async () => {
  const { tmpRoot, urlDir } = setupTmp('button', { titleIds: [1], descriptionIds: [23], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), BUTTON_JUICED);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  for (const id of [20, 21, 22, 28]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `id ${id} 应删除`);
  }
  assert.ok(html.includes('data-idx="23">JavaScript</button>'),
    '保护集中的 button 应原样保留（不解包）');
  assert.ok(!/<button[^>]*data-idx="24"/.test(html), '有文本 button 应解包');
  assert.ok(html.includes('查看答案'), '解包后文本应保留');
  assert.equal(out.slim.buttonsRemoved, 2, '无文本/纯符号 button 删 2 个（20 图标钮 + 22 ⋮）');
  assert.equal(out.slim.svgsRemoved, 1, '独立空 svg 删 1 个（21 随 button 走不重复计数）');
  assert.equal(out.slim.buttonsUnwrapped, 1, '有文本 button 解包 1 个（24）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 新用例 FAIL（button 20/22 仍在，计数为 0）。

- [ ] **Step 3: 实现规则③④**

`script/lib/page-slim-article.js`：规则②代码块之后、`return {` 之前插入：

```js
  // ③ 无文本/纯符号 button 与无文本 svg 删除：textContent 无非空白文本、
  // 或无任何字母数字（/[\p{L}\p{N}]/u 不命中——⋮/✕/× 等纯符号交互件，
  // 参考页 7 个 ⋮ 溢出菜单实测即此类；中文与 GPT-5.6+ 等含字母数字者
  // 走 ④）。svg 的 <text> 后代算文本——带文字的图标保留
  function hasWordText(el) {
    var t = (el.textContent || '').trim();
    return t.length > 0 && (/\p{L}|\p{N}/u).test(t);
  }
  var interactive = document.querySelectorAll('button, svg');
  for (var i = 0; i < interactive.length; i++) {
    var el = interactive[i];
    if (!el.isConnected || isProtected(el) || hasWordText(el)) continue;
    if (el.parentNode) el.parentNode.removeChild(el);
    if (el.tagName === 'BUTTON') stats.buttonsRemoved++;
    else stats.svgsRemoved++;
  }

  // ④ 有文本 button 降级：解包上提子节点——按钮自身 style 弃置（包装铬
  // 是装饰），内部文本/span 的样式保留；tab/手风琴标题的文本有信息量
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    var el = buttons[i];
    if (!el.isConnected || isProtected(el)) continue;
    unwrap(el);
    stats.buttonsUnwrapped++;
  }
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-slim-article.js test/unit/extract-article.test.mjs
git commit -m "feat: 瘦身规则③④ 无文本/纯符号 button 与空 svg 删除 + 有文本 button 解包

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 瘦身规则⑤ 非白名单协议 href 剥除

**Files:**
- Modify: `script/lib/page-slim-article.js`
- Test: `test/unit/extract-article.test.mjs`

**Interfaces:**
- Consumes: Task 2 骨架（`isProtected`/`unwrap`/`stats`）。
- Produces: `linksStripped` 计数生效。scheme 白名单 = `http`/`https`/`mailto`/`tel`（spec §5.6——mailto/tel 短且 markdown 合法，是对分析文档"非 http(s) 全剥"的收窄）；无 scheme（相对/`#锚点`）保留。

- [ ] **Step 1: 写失败测试**

`test/unit/extract-article.test.mjs` 末尾加：

```js
// 瘦身规则⑤：scheme ∉ {http,https,mailto,tel} 的 <a> 解包（codex:/
// javascript: 等应用协议——参考页 codex:// 单个 ~1KB URL-encoded prompt
// 曾漏进 9_markdown.md）；http(s)/mailto 与无协议（相对/#锚点）保留
const HREF_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>链接</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5"><a href="codex://threads/new?prompt=%E6%8F%90%E7%A4%BA" data-idx="30">深问</a>、<a href="https://example.com/a" data-idx="31">正常链</a>、<a href="mailto:x@example.com" data-idx="32">邮件</a>、<a href="javascript:void(0)" data-idx="33">假链</a>、<a href="#anchor" data-idx="34">锚点</a>。</p></div></body></html>`;

test('extract_article.mjs: 瘦身规则⑤——非白名单协议 <a> 解包、合法链接保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('href', { titleIds: [1], descriptionIds: [], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), HREF_JUICED);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(!html.includes('codex:'), 'codex 协议 href 应随解包消失');
  assert.ok(!html.includes('javascript:'), 'javascript 协议应解包');
  assert.ok(html.includes('深问'), '解包后文本应保留');
  assert.ok(html.includes('href="https://example.com/a"'), 'https 链接应保留');
  assert.ok(html.includes('mailto:x@example.com'), 'mailto 应保留');
  assert.ok(html.includes('href="#anchor"'), '#锚点（无 scheme）应保留');
  assert.equal(out.slim.linksStripped, 2, '应解包 2 个（codex + javascript）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 新用例 FAIL（codex: 仍在，linksStripped 为 0）。

- [ ] **Step 3: 实现规则⑤**

`script/lib/page-slim-article.js`：规则④代码块之后、`return {` 之前插入：

```js
  // ⑤ 非白名单协议 href 剥除：scheme ∉ {http,https,mailto,tel} 的 <a>
  // 解包。mailto/tel 短且 markdown 合法，保留；无 scheme（相对/#锚点）
  // 不匹配正则、保留
  var SCHEME_KEEP = /^(https?|mailto|tel)$/i;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var el = links[i];
    if (!el.isConnected || isProtected(el)) continue;
    var href = el.getAttribute('href');
    var m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(href);
    if (m && !SCHEME_KEEP.test(m[1])) {
      unwrap(el);
      stats.linksStripped++;
    }
  }
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-slim-article.js test/unit/extract-article.test.mjs
git commit -m "feat: 瘦身规则⑤ 非白名单协议 href 解包——codex 营销链接不再漏进产物

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 瘦身规则⑥ 空壳 span 迭代拆包

**Files:**
- Modify: `script/lib/page-slim-article.js`
- Test: `test/unit/extract-article.test.mjs`

**Interfaces:**
- Consumes: Task 2 骨架（`isProtected`/`unwrap`/`stats`）；Task 1 的零值过滤（把 `border: 0px solid` 清空后 style 属性消失，span 才成为空壳——真实页上的主要来源即 pre 内语法高亮 token span，样式 color 不在步骤 5 白名单早已删净）。
- Produces: `spansUnwrapped` 计数生效；`page-slim-article.js` 六条规则齐备（执行顺序 ①②③④⑤⑥ 与 spec §5.0 一致）。

- [ ] **Step 1: 写失败测试**

`test/unit/extract-article.test.mjs` 末尾加：

```js
// 瘦身规则⑥：属性只剩 data-idx 的 span 解包，嵌套 token span 迭代
// 塌缩到不动点；带 style 的 span 与保护集中的 span 保留
const SPAN_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>空壳</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><pre data-idx="30"><code data-language="python" data-idx="31"><span data-idx="32"><span data-idx="33">print</span>(<span data-idx="34">1</span>)</span></code></pre><p data-idx="5">段落<span style="background-color: rgb(255, 255, 0)" data-idx="35">高亮</span>与<span data-idx="36">空壳</span></p></div></body></html>`;

test('extract_article.mjs: 瘦身规则⑥——空壳 span 塌缩为纯文本、带样式与保护集 span 保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('span', { titleIds: [1], descriptionIds: [36], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), SPAN_JUICED);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.includes('<pre data-idx="30"><code data-language="python" data-idx="31">print(1)</code></pre>'),
    `嵌套空壳 span 应塌缩为纯文本: ${html.slice(html.indexOf('<body'))}`);
  assert.ok(html.includes('background-color: rgb(255, 255, 0)'), '带 style 的 span 应保留');
  assert.ok(html.includes('data-idx="36"'), '保护集中的空壳 span 应保留');
  assert.equal(out.slim.spansUnwrapped, 3, '应解包 3 层（32/33/34）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/extract-article.test.mjs`
Expected: 新用例 FAIL（`print(1)` 纯文本形态不存在，spansUnwrapped 为 0）。

- [ ] **Step 3: 实现规则⑥**

`script/lib/page-slim-article.js`：规则⑤代码块之后、`return {` 之前插入：

```js
  // ⑥ 空壳 span 拆包：属性只剩 data-idx 的 span 解包。span 限定——
  // div 等块级可能承载 trans2img 模块边界，不碰。嵌套 token span 需
  // 迭代到不动点，防御性上限 10 轮（一轮内 parent 先解包、hoisted 的
  // 子 span 仍在静态列表内同轮处理，通常一轮收敛）
  for (var round = 0; round < 10; round++) {
    var spans = document.querySelectorAll('body span');
    var changed = false;
    for (var i = 0; i < spans.length; i++) {
      var el = spans[i];
      if (!el.isConnected || isProtected(el)) continue;
      var bare = true;
      for (var j = 0; j < el.attributes.length; j++) {
        if (el.attributes[j].name !== 'data-idx') { bare = false; break; }
      }
      if (!bare) continue;
      unwrap(el);
      stats.spansUnwrapped++;
      changed = true;
    }
    if (!changed) break;
  }
```

- [ ] **Step 4: 跑两个测试文件确认全绿**

Run: `node --test test/unit/extract-article.test.mjs test/unit/compute-styles.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-slim-article.js test/unit/extract-article.test.mjs
git commit -m "feat: 瘦身规则⑥ 空壳 span 迭代拆包——语法高亮 token 塌缩为纯文本

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 真实 URL 冒烟 + 全量回归 + 文档同步

**Files:**
- Modify: `test/smoke/SMOKE.md`（记录场景）
- Modify: `CLAUDE.md`（管线段步骤 5/6 措辞）
- Modify: `README.md`（关键机制 + 进度表）
- 产物（不入库，working/ 下）：参考页的 5/6/7/8/9 重跑

**Interfaces:**
- Consumes: Task 1-6 的全部产出；参考页既有 `working/developers.openai.com_api_docs_guides_prompt-caching/`（步骤 0-4 产物原样复用，`1_snapshot.html` 不重跑）。
- Produces: spec §8 四条验收的证据，记录进 SMOKE.md。

- [ ] **Step 1: 备份旧产物并记录基线**

```bash
cd /Volumes/Develop/Skills/MY-SKILL/url-to-markdown/working/developers.openai.com_api_docs_guides_prompt-caching
BAK=$(mktemp -d)
echo "$BAK" > /tmp/u2m-slim-bak-dir
cp 5_juice_styles.html 6_article.html 7_skeleton.json 8_resolved_skeleton.json 9_markdown.md "$BAK"/
shasum -a 256 1_snapshot.html | tee "$BAK"/1_snapshot.sha256
wc -c 5_juice_styles.html 6_article.html 9_markdown.md | tee "$BAK"/sizes-before.txt
```

Expected: 备份目录路径打印；sizes-before 记录 5≈241K、6≈239K、9≈34K。

- [ ] **Step 2: 重跑步骤 5 + 6（文件输入、无需网络）**

```bash
cd /Volumes/Develop/Skills/MY-SKILL/url-to-markdown
node script/compute_styles.mjs --url https://developers.openai.com/api/docs/guides/prompt-caching
node script/extract_article.mjs --url https://developers.openai.com/api/docs/guides/prompt-caching
```

Expected: 两行 ok JSON；extract_article 的 stdout 含 `slim` 计数（spansUnwrapped 应为千级——参考页 1,324 个 pre 内 token span）。

- [ ] **Step 3: 机械验收断言**

```bash
cd working/developers.openai.com_api_docs_guides_prompt-caching
wc -c 5_juice_styles.html 6_article.html
shasum -a 256 1_snapshot.html | diff - "$(cat /tmp/u2m-slim-bak-dir)/1_snapshot.sha256" && echo '1_snapshot 未动'
grep -c 'codex:' 6_article.html || echo 'codex 链接归零'
grep -c 'border: 0px' 6_article.html || echo '零值边框归零'
grep -o '<math' 6_article.html | wc -l
```

Expected（spec §8）：
- `6_article.html` ≤ 143,360 字节（140KB；预估 ~110-120KB）
- `5_juice_styles.html` 比基线小 ~20%
- `1_snapshot 未动`
- codex 计数 0；`border: 0px` 计数 0 或个位数（`||` 分支兜底 grep 无匹配时退出码 1）
- `<math` 剩余数 = 无 annotation 的裸 math 数（远小于原 19；被替换的不在）

若 6_article 超 140KB：把实际数字与 `slim` 计数记入 SMOKE.md 并向用户报告差距来源（如某规则在真实页命中数为 0），不得静默通过。

- [ ] **Step 4: 重跑步骤 7-9 并做内容不变性验收**

按 SKILL.md 步骤 7 执行（读 `6_article.html` 产 `7_skeleton.json`——执行 agent 即 LLM，可亲自做或派子智能体，遵循 `references/markdown_skeleton_guide.md`），然后：

```bash
node script/screenshot_trans.mjs --url https://developers.openai.com/api/docs/guides/prompt-caching
node script/render_skeleton.mjs --url https://developers.openai.com/api/docs/guides/prompt-caching
```

注意：screenshot_trans 的 live 页 B 需要网络；无网络时按设计走 `1_snapshot` 兜底（`source` 字段会如实标注），SMOKE.md 记录实际 `source`。

内容不变性（对比备份的旧 9_markdown.md）：

```bash
cd working/developers.openai.com_api_docs_guides_prompt-caching
BAK=$(cat /tmp/u2m-slim-bak-dir)
grep -c 'codex://' 9_markdown.md || echo '新 9_markdown codex 归零（修复生效）'
# 代码块逐字对比：新旧 9_markdown 的围栏代码块集合应一致
python3 - "$BAK/9_markdown.md" 9_markdown.md <<'EOF'
import re, sys
def fences(p):
    return re.findall(r'```[a-z]*\n(.*?)```', open(p).read(), re.S)
old, new = fences(sys.argv[1]), fences(sys.argv[2])
same = sum(1 for b in old if b in new)
print(f'旧 {len(old)} 块 / 新 {len(new)} 块 / 逐字相同 {same} 块')
EOF
grep -c '\$.*[A-Za-z].*\$' 9_markdown.md
```

Expected：codex 计数 0；代码块"逐字相同"数 = 旧块数（代码内容不经 LLM 改写的字节级证据）；公式 grep 命中数 > 0。公式措辞与骨架细节因 LLM 重跑可微差，不逐字断言。

- [ ] **Step 5: 全量回归**

Run: `pnpm test:all`
Expected: 全绿。若集成测试因环境（chromium 缺失等）失败，区分环境问题与回归——环境问题如实记录，不得跳过不报。

- [ ] **Step 6: 记录 SMOKE.md**

`test/smoke/SMOKE.md` 末尾追加（数字以实测填入）：

```markdown
## 2. 文章视图瘦身（步骤 5 零值过滤 + 步骤 6 瘦身 pass）

URL：https://developers.openai.com/api/docs/guides/prompt-caching（复用既有步骤 0-4 产物，1_snapshot 未重跑）

| 产物 | 改动前 | 改动后 |
|---|---|---|
| 5_juice_styles.html | 241.4KB | <实测> |
| 6_article.html | 239.5KB | <实测> |
| 9_markdown.md codex:// 链接 | 2 处 | 0 处 |

- 1_snapshot.html sha256 前后一致（步骤 8 零冲击）
- slim 计数：<spansUnwrapped/buttonsRemoved/... 实测值>
- 步骤 8 截图 source：<live|snapshot|mixed>
- 9_markdown 代码围栏逐字相同 <n>/<n> 块，公式 $…$ 命中 <n> 处
```

- [ ] **Step 7: 文档同步**

`CLAUDE.md` 管线段两处（其余不动）：

1. 步骤 5 的 finalize 描述，在 `——其余声明（含盒模型几何 margin/padding/宽高、定位、color 等）全删` 之后、`——唯一元素级例外` 之前插入：

```
；白名单内再过一场零值过滤——值等于全元素初始值的声明删除（边框按"边"语义：style none/缺省或 width 0 → 该边三件全删；box-shadow:none、background:transparent、radius:0px、overflow:visible 等精确值；font-size/weight 相对对比与 flex 布局信号不是零值、保留）
```

2. 步骤 6 的 `（不限深度；与 key id——含 standaloneIds——重叠或未命中报 error，emit 增 removedNoiseCount）` 之后插入：

```
；随后同页 setContent 内存往返跑瘦身 pass——共享 page-slim-article.js 六条结构规则（① data-* 只留 data-idx/data-language ② MathML→LaTeX——page-latex.js 的 __u2mLatexText 同作用域注入，KaTeX 双胞胎结构整体替换、无 annotation 保留原树 ③ 无文本/纯符号 button 与无文本 svg 整删 ④ 有文本 button 解包降级 ⑤ scheme ∉ http/https/mailto/tel 的 `<a>` 解包 ⑥ 属性只剩 data-idx 的 span 迭代拆包到不动点；保护集 = titleIds∪descriptionIds∪standaloneIds——删除/解包类跳过保护元素、替换类不设防；emit 增 slim 计数对象）
```

`README.md`：`### 关键机制` 列表（隐藏声明剥离条目之后）加两条：

```markdown
- **零值声明过滤（步骤 5 finalize）**：白名单内值等于全元素初始值的声明删除——边框按"边"语义判无效（宽 0 或样式 none 的边整条不可见，三件全删），Tailwind preflight 被 juice 内联出的海量 `border: 0px solid` 即此类；实信号（非零边框/圆角+背景、flex、font-size/weight 相对对比）全保留。实测参考页 5_juice 约 -20%
- **文章视图瘦身 pass（步骤 6）**：迁移后同页内存往返执行六条结构规则——data-* 白名单清理、MathML→LaTeX（KaTeX 双胞胎整体替换）、无文本/纯符号 button 与空 svg 删除、有文本 button 解包、非白名单协议 `<a>` 解包（codex:// 营销链接不再漏进产物）、空壳 span 迭代拆包（语法高亮 token 塌缩为纯文本）。保护集跳过 key 元素、`1_snapshot` 零接触。实测参考页 6_article 239.5KB → <实测值>
```

`## 开发进度` 表加一行（日期用实施当日）：`| 2026-08-XX | 步骤 5/6 文章视图瘦身（零值过滤 + 六条结构规则） | ✅ |`

SKILL.md 核查后**无需改动**（步骤 5/6 的命令与产物名均不变，机制文档归 CLAUDE.md/README）。

- [ ] **Step 8: Commit**

```bash
git add test/smoke/SMOKE.md CLAUDE.md README.md
git commit -m "test: 参考页瘦身冒烟记录（239.5KB → <实测>）+ 文档同步

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4 零值过滤 → Task 1；§5.2 规则① → Task 2；§5.3 规则② → Task 3；§5.4 规则③（含纯符号修订）→ Task 4；§5.5 规则④ → Task 4；§5.6 规则⑤ → Task 5；§5.7 规则⑥ → Task 6；§5.1 保护集两档 → Task 2（接线）+ 各规则 `isProtected` 跳过（③④⑤⑥）+ 规则②明确不设防（Task 3 代码注释）；§6 接线与 emit → Task 2/3；§7 测试计划 → 各任务 TDD 步骤；§8 验收四条 → Task 7 Step 3/4/5；§10 文档同步 → Task 7 Step 7。无缺口。
- **占位符扫描**：Task 7 Step 6/7 的 `<实测>` 是冒烟记录的运行期填入位（计划自身无 TBD）；其余任务步骤均含完整代码。
- **类型一致性**：`__u2mSlimArticle(protectedIds)` 返回七计数键名在 Task 2 定义、Task 2 测试的 `Object.keys(out.slim).sort()` 断言、各规则 `stats.xxx++`、emit `slim: slimStats` 四处一致（attrsDropped/mathReplaced/buttonsRemoved/buttonsUnwrapped/svgsRemoved/linksStripped/spansUnwrapped）。evaluate 组合形式在 Task 2（简单式）与 Task 3（组合式）均给出完整前后对照。
