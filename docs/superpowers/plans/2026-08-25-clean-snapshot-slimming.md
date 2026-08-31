# 清洗版瘦身（clean snapshot slimming）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把步骤 2 清洗版 `2_clean_snapshot.html` 从 352 KB 降到 ~32 KB（−91%），零正文丢失、带样式版与步骤 4-9 全链路产物不变。

**Architecture:** 六条规则全部加在 `page-clean-snapshot.js` 的 clean-only 分支（R1-R5 属性/文本级删减 + R6 隐藏子树折叠）；隐藏判定由 juice 级联计算（clean_snapshot.mjs 编排四阶段：normalize → juice → 页 2 检测 → 页 1 清洗），检测逻辑在新共享脚本 `page-hidden-detect.js`。

**Tech Stack:** juice v12（已依赖）、playwright chromium、node:test（子进程跑真 CLI）。

**Spec:** `docs/superpowers/specs/2026-08-25-clean-snapshot-slimming-design.md`（规则语义、安全设计、护栏阈值都以 spec 为准）

## Global Constraints

- stdout 单行 JSON 契约：每个 CLI 恰好一行 JSON（失败路径也不例外），日志走 stderr，退出码 0/1/2。
- emit() 延迟退出陷阱：emit 之后不执行任何代码；浏览器/viewer 在 emit 之前关闭。
- 共享页面脚本是唯一事实源：页面侧逻辑只在 `script/lib/page-*.js`；编排层 `.mjs` 不分叉该逻辑。
- 带样式版（`2_clean_style_snapshot.html`）除现状行为外零改动——所有新规则只作用于清洗版分支。
- 提交信息：中文 conventional commits，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 测试命令：`pnpm test`（单测）与 `pnpm run test:integration`；本计划的新测试在 `test/unit/clean-snapshot.test.mjs`（该文件虽在 unit 目录，实际以子进程跑真 CLI + chromium，是步骤 2 的既有惯例）。

---

### Task 1: 测试基座 runClean + R2 class 噪声过滤

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（clean-only 段尾部新增步骤 14）
- Test: `test/unit/clean-snapshot.test.mjs`（新增 runClean 助手 + 首个 R2 用例）

**Interfaces:**
- Produces: `runClean(snapshot, urlPath?)` → `{ out, cleaned, styled, stderr, cleanup() }`（后续所有任务复用；`out` 为 stdout 解析后的 JSON，`cleaned`/`styled` 为两版产物全文）。
- Produces: `__u2mCleanSnapshot` 的 clean-only 段新增内部助手 `isClassNoise(token)`（仅本文件使用）。

- [ ] **Step 1: 写失败测试（含共享基座）**

在 `test/unit/clean-snapshot.test.mjs` 顶部（现有 import 之后）加助手，文件末尾加用例：

```js
/** 瘦身规则测试基座：手写 1_snapshot 夹具 → 子进程跑真 clean_snapshot.mjs → 读回两版产物。 */
async function runClean(snapshot, urlPath = 'slim-article') {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-slim-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    stderr: r.stderr,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

test('R2: class 噪声过滤——工具/哈希 token 剥除，语义 token 保留，带样式版不受影响', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <section data-idx="2" class="article flex px-4 astro-3ef6ksr2 h-[30rem] text-xs hover:bg-x md:flex">正文内容</section>
    <div data-idx="3" class="page-header btn-primary expn-content shiki">语义类元素</div>
    <div data-idx="4" class="flex px-4 rounded">全是噪声</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r2-class');
  try {
    const sec = cleaned.match(/<section[^>]*>/)[0];
    assert.ok(sec.includes('class="article"'), `语义 token article 应保留: ${sec}`);
    assert.ok(!/(flex|px-4|astro-|30rem|text-xs|hover:|md:)/.test(sec), `噪声 token 应剥除: ${sec}`);
    const keep = cleaned.match(/<div data-idx="3"[^>]*>/)[0];
    for (const tok of ['page-header', 'btn-primary', 'expn-content', 'shiki']) {
      assert.ok(keep.includes(tok), `两词 kebab 语义 token ${tok} 应保留: ${keep}`);
    }
    assert.ok(!/<div data-idx="4"[^>]*class=/.test(cleaned), '全噪声 class 应连同属性删除');
    // 带样式版不受影响（硬约束）
    assert.ok(styled.includes('astro-3ef6ksr2') && styled.includes('h-[30rem]'), '带样式版保留原始 class');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 新用例 FAIL（`class="article flex px-4 …"` 原样残留），既有 11 个用例 PASS。

- [ ] **Step 3: 实现 R2（page-clean-snapshot.js clean-only 段）**

在现有步骤 13（删除 `<style>` 标签）之后、`return` 序列化之前插入：

```js
  // 14. R2 class 噪声过滤（仅清洗版）：class 值按空白切 token，剥工具/哈希 token、
  //     留语义 token。原则：拿不准保留——漏删只费字节，误删语义 token（步骤 3 的
  //     正式识别线索）才伤识别。带样式版不动。
  var HASH_PREFIX_RE = /^(?:astro|css|sc|jsx|chakra|emotion|styled|mui|next|module)-[-0-9a-zA-Z]+$/;
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
  ];
  function isClassNoise(tok) {
    if (tok.indexOf(':') !== -1 || tok.indexOf('[') !== -1 || tok.indexOf(']') !== -1) return true; // 变体前缀/任意值
    if (HASH_PREFIX_RE.test(tok)) return true;
    var dash = tok.lastIndexOf('-');
    if (dash !== -1 && isHashSuffix(tok.slice(dash + 1)) && /^[a-z][a-z0-9-]*$/i.test(tok.slice(0, dash))) return true;
    for (var i = 0; i < UTILITY_RES.length; i++) if (UTILITY_RES[i].test(tok)) return true;
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

同步把文件头注「单趟清洗产出两份快照」段补一行：`clean-only 段新增 R1-R6 瘦身规则，见各步骤注释与 spec`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat: R2 清洗版 class 噪声过滤——工具/哈希 token 剥除、语义 token 保留

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: R3 data-* 白名单

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（步骤 14 之后新增步骤 15）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `runClean`。
- Produces: 无对外接口（页面内清洗行为）。

- [ ] **Step 1: 写失败测试**

```js
test('R3: data-* 白名单——噪声 data 属性删除，data-idx/data-language 保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <div data-idx="2" data-1p-ignore="true" data-copy-ignore="true" data-syntax-highlighter-id="_r104R_9dd_" tabindex="0" data-language="javascript" aria-label="x">正文</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r3-data');
  try {
    const div = cleaned.match(/<div data-idx="2"[^>]*>/)[0];
    assert.ok(!div.includes('data-1p-ignore'), '噪声 data 属性应删除');
    assert.ok(!div.includes('data-copy-ignore'), '噪声 data 属性应删除');
    assert.ok(!div.includes('data-syntax-highlighter-id'), '噪声 data 属性应删除');
    assert.ok(div.includes('data-language="javascript"'), 'data-language 应保留');
    assert.ok(div.includes('data-idx="2"') && div.includes('aria-label'), 'data-idx 与 aria 保留');
    assert.ok(styled.includes('data-1p-ignore'), '带样式版不受影响');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 新用例 FAIL（data-1p-ignore 残留）。

- [ ] **Step 3: 实现 R3**

步骤 14（R2）之后插入：

```js
  // 15. R3 data-* 白名单（仅清洗版）：清洗版只留 data-idx / data-language /
  //     data-u2m-hidden（R6 折叠标记）；其余 data-* 全是埋点/框架噪声。
  var DATA_KEEP = { 'data-idx': 1, 'data-language': 1, 'data-u2m-hidden': 1 };
  var allEls = document.querySelectorAll('*');
  for (var i = 0; i < allEls.length; i++) {
    var el2 = allEls[i];
    var names = [];
    for (var j = 0; j < el2.attributes.length; j++) names.push(el2.attributes[j].name);
    for (var j = 0; j < names.length; j++) {
      var nm = names[j].toLowerCase();
      if (nm.indexOf('data-') === 0 && !DATA_KEEP[nm]) el2.removeAttribute(names[j]);
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat: R3 清洗版 data-* 白名单——只留 u2m-id/language/hidden

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: R1 pre 内容替换为 code...

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（步骤 15 之后新增步骤 16；R4/R5/R6 的编号在后续任务中顺延为 17/18/19——按实际插入顺序连续编号即可）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `runClean`。

- [ ] **Step 1: 写失败测试**

```js
test('R1: pre 内容替换为 code...——token span 全删，pre/code 壳与 id/language 保留，行内 code 不动', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <pre data-idx="2" class="shiki" tabindex="0"><code data-idx="3" data-language="javascript"><span data-idx="4" class="syntax-highlighter-line"><span data-idx="5" class="shiki-token">import</span><span data-idx="6" class="shiki-token"> OpenAI </span></span></code></pre>
    <p data-idx="7">行内 <code data-idx="8">client.create()</code> 代码</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r1-pre');
  try {
    assert.ok(/<pre[^>]*data-idx="2"[^>]*>[\s\S]*?<code[^>]*data-idx="3"[^>]*>code\.\.\.<\/code><\/pre>/.test(cleaned), `pre/code 壳应保留且内容为 code...: ${cleaned.match(/<pre[\s\S]*?<\/pre>/)?.[0]}`);
    assert.ok(!cleaned.includes('shiki-token') || !/<span[^>]*class="shiki-token"/.test(cleaned), 'token span 应删除');
    assert.ok(!cleaned.includes('data-idx="4"') && !cleaned.includes('data-idx="5"'), 'pre 内部 id 随内容删除');
    assert.ok(cleaned.includes('data-language="javascript"'), 'data-language 保留');
    assert.ok(cleaned.includes('<code data-idx="8">client.create()</code>'), '行内 code 不动');
    assert.ok(styled.includes('shiki-token') && styled.includes('import'), '带样式版完整保留代码');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 新用例 FAIL。

- [ ] **Step 3: 实现 R1**

```js
  // 16. R1 pre 内容替换（仅清洗版）：代码块对结构识别只是一个单元，内容全文在
  //     带样式版保真（步骤 7 于 6_article 写进骨架）。首个 code 壳保留（含
  //     data-language），其余子元素删除；行内 <code> 是句子成分，不动。
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    var codeShell = null;
    var nodes = Array.prototype.slice.call(pre.childNodes);
    for (var j = 0; j < nodes.length; j++) {
      if (!codeShell && nodes[j].nodeType === 1 && nodes[j].tagName === 'CODE') { codeShell = nodes[j]; continue; }
      pre.removeChild(nodes[j]);
    }
    var host = codeShell || pre;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(document.createTextNode('code...'));
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat: R1 清洗版 pre 内容替换为 code...——shiki token span 12 倍标记开销清零

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: R4 astro 解包 + R5 保守空白压缩

**Files:**
- Modify: `script/lib/page-clean-snapshot.js`（R1 之后新增两步）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `runClean`。

- [ ] **Step 1: 写失败测试**

```js
test('R4+R5: astro 包装解包；安全位置空白删除、行内间空白保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-idx="1">
    <astro-island data-idx="2" component-url="/x.js"><p data-idx="3">岛内容</p></astro-island>
    <astro-slot data-idx="4"><span data-idx="5">槽内容</span></astro-slot>
    <div data-idx="6">
      <p data-idx="7">a</p>
      <p data-idx="8">b</p>
    </div>
    <p data-idx="9">x <a data-idx="10" href="/y">链接</a> z</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r4r5');
  try {
    assert.ok(!/<astro-island[\s>]/.test(cleaned) && !/<astro-slot[\s>]/.test(cleaned), 'astro 包装应解包');
    assert.ok(!cleaned.includes('data-idx="2"') && !cleaned.includes('data-idx="4"'), '包装自身 id 随包装弃置');
    assert.ok(cleaned.includes('data-idx="3"') && cleaned.includes('岛内容'), '子元素上提保留');
    assert.ok(cleaned.includes('data-idx="5"') && cleaned.includes('槽内容'), 'slot 子元素上提保留');
    // 块级元素之间的换行缩进删除
    const block = cleaned.match(/<div data-idx="6">([\s\S]*?)<\/div>/)[1];
    assert.ok(!/\n\s/.test(block), `块级间空白应删除: ${JSON.stringify(block)}`);
    // 行内相邻文本/元素之间的空白保留
    const inline = cleaned.match(/<p data-idx="9">([\s\S]*?)<\/p>/)[1];
    assert.ok(inline.includes('x <a') && inline.includes('> z'), `行内间空白应保留: ${JSON.stringify(inline)}`);
    assert.ok(styled.includes('<astro-island'), '带样式版不受影响');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 新用例 FAIL。

- [ ] **Step 3: 实现 R4 + R5**

```js
  // 17. R4 astro 包装解包（仅清洗版）：astro-island/astro-slot 是框架脚手架标签，
  //     子元素原样上提，包装自身属性（含其 data-idx）弃置——清洗版不可见即
  //     不可引用，语义与 R6 折叠一致。带样式版保留（步骤 6 取子树不受影响）。
  var wraps = document.querySelectorAll('astro-island, astro-slot');
  for (var i = wraps.length - 1; i >= 0; i--) {
    var wrap = wraps[i];
    while (wrap.firstChild) wrap.parentNode.insertBefore(wrap.firstChild, wrap);
    wrap.parentNode.removeChild(wrap);
  }

  // 18. R5 保守空白压缩（仅清洗版）：删纯空白文本节点，当且仅当前后兄弟都不是
  //     行内文本敏感节点（非空白文本或行内元素）——行内相邻节点间的空白承载
  //     词间分隔，保留。pre 内部已被 R1 清空，天然不涉及。
  var INLINE_TAGS = { A: 1, SPAN: 1, CODE: 1, STRONG: 1, EM: 1, B: 1, I: 1, U: 1, S: 1,
    MARK: 1, SMALL: 1, SUB: 1, SUP: 1, ABBR: 1, CITE: 1, Q: 1, KBD: 1, SAMP: 1, TIME: 1, IMG: 1, BR: 1 };
  function inlineSensitive(node) {
    if (!node) return false;
    if (node.nodeType === 3) return node.textContent.trim() !== '';
    return node.nodeType === 1 && INLINE_TAGS[node.tagName.toUpperCase()] === 1;
  }
  var wsWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  var wsNodes = [];
  var wn;
  while ((wn = wsWalker.nextNode())) {
    if (wn.textContent.trim() === '' && !inlineSensitive(wn.previousSibling) && !inlineSensitive(wn.nextSibling)) {
      wsNodes.push(wn);
    }
  }
  for (var i = 0; i < wsNodes.length; i++) wsNodes[i].parentNode.removeChild(wsNodes[i]);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 全部 PASS（注意既有「纯空白文本节点不占位」等用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add script/lib/page-clean-snapshot.js test/unit/clean-snapshot.test.mjs
git commit -m "feat: R4 astro 包装解包 + R5 保守空白压缩（行内间空白保留）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: juice 隐藏检测管线（page-hidden-detect.js + 四阶段编排 + R6 折叠）

**Files:**
- Create: `script/lib/page-hidden-detect.js`
- Modify: `script/lib/page-clean-snapshot.js`（R5 之后新增 R6 折叠应用；cfg 增加 `hidden`）
- Modify: `script/clean_snapshot.mjs`（四阶段编排）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `runClean`。
- Produces: 共享脚本 `__u2mDetectHidden()`（无参，在 juiced DOM 上 evaluate）→ `{ items: [{id, chars, fixed}], totalChars, hiddenChars }`；`items[].id` 为 data-idx 字符串（无 id 的隐藏根不产出）、`chars` 为 `textContent.trim().length`、`fixed` 为布尔。
- Produces: `__u2mCleanSnapshot(cfg)` 的 `cfg.hidden`（默认 `[]`）消费上述 `items`。

- [ ] **Step 1: 写失败测试**

```js
const hiddenDetectPath = path.resolve(thisDir, '../../script/lib/page-hidden-detect.js');

test('page-hidden-detect.js: 文件存在且 __u2mDetectHidden 可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(hiddenDetectPath, 'utf8');
  assert.ok(src.includes('function __u2mDetectHidden'), '应定义 __u2mDetectHidden');
  assert.doesNotThrow(() => new Function('return (' + src + ')()'));
});

test('R6: juice 隐藏折叠——fixed 模态与流内 expander 折成标记，var() 按可见，带样式版/占位清单完整', async () => {
  const hiddenLong = '这是一段藏在折叠区里的超长中文文本内容，用来验证占位符只在带样式版出现。'; // >16 字 → 占位
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>.modal{display:none;position:fixed}.expn{display:none}.keepvar{display:var(--x)}</style>
</head>
<body>
  <div data-idx="1">
    <div data-idx="2" class="modal"><p data-idx="3">模态内容模态内容</p></div>
    <div data-idx="4" class="expn"><p data-idx="5">${hiddenLong}</p></div>
    <div data-idx="6" class="keepvar">按可见处理</div>
    <p data-idx="7">正文段落</p>
  </div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'r6-hidden');
  try {
    // 折叠标记：fixed 带 ,fixed 后缀，流内不带
    const modal = cleaned.match(/<div data-idx="2"[^>]*>/)[0];
    assert.ok(/data-u2m-hidden="\d+_chars,fixed"/.test(modal), `模态应折成 fixed 标记: ${modal}`);
    const expn = cleaned.match(/<div data-idx="4"[^>]*>/)[0];
    assert.ok(/data-u2m-hidden="\d+_chars"/.test(expn) && !/fixed/.test(expn), `expander 应折成无 fixed 标记: ${expn}`);
    // 子树内容与内部 id 从清洗版消失
    assert.ok(!cleaned.includes('模态内容') && !cleaned.includes('data-idx="3"') && !cleaned.includes('data-idx="5"'), '折叠子树内容应消失');
    // var() 不可解析 → 按可见处理
    assert.ok(cleaned.includes('按可见处理') && cleaned.includes('data-idx="6"'), 'var() 值按可见保留');
    assert.ok(cleaned.includes('正文段落'), '可见正文保留');
    // 带样式版完整保真
    assert.ok(styled.includes('模态内容') && styled.includes('data-idx="3"'), '带样式版模态内容完整');
    assert.ok(styled.includes('{{LONG_TEXT_'), '带样式版含折叠区长文本占位符');
    // 占位符语义分叉：清洗版折叠区占位符消失，但 2_long_text.json 完整
    assert.ok(!cleaned.includes('{{LONG_TEXT_'), '清洗版不应含折叠区长文本占位符');
    const longTexts = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    assert.ok(Object.values(longTexts).includes(hiddenLong), '恢复清单含折叠区原文');
    assert.equal(out.longTextCount, 1, '折叠区长文本仍计数占位');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs`
Expected: 第一个用例 FAIL（文件不存在）。

- [ ] **Step 3: 创建 script/lib/page-hidden-detect.js**

```js
/**
 * 步骤 2 隐藏子树检测。在浏览器 evaluate 中执行，跑在 juice 内联后的 DOM 上
 * （每元素的级联胜出声明已写入 style 属性、<style> 标签已移除）。
 * 语义（spec §4.2，按 CSS 规范补全 juice 不做的继承推导）：
 *   - display 不继承，但祖先 display:none 使整棵子树不生成盒 → 有效 display:none
 *     ⟺ 自身或任一祖先声明为 none；该子树不可被后代翻案，记录后停止下钻。
 *   - visibility 继承，后代可 visibility:visible 重新可见 → 有效值 = 自身显式
 *     声明，否则沿用父级有效值；visibility:hidden 顶层记录后继续下钻找翻案后代。
 *   - 顶层隐藏子树：有效隐藏且父级上下文未隐藏——折叠只打在最外层。
 *   - 读值只认字面声明：var() 等不可解析值按可见处理（失败方向安全——
 *     任何不完备都把元素推向保留，正文零误删）。
 * 返回 { items: [{id, chars, fixed}], totalChars, hiddenChars }：
 *   items[].id     data-idx（无 id 的隐藏根不可定位，不产出）
 *   items[].chars  textContent.trim().length（真实全文规模，供 R6 标记）
 *   fixed          根声明 position:fixed|absolute（UI 脚手架提示）
 *   totalChars/hiddenChars  非空白字符数（护栏用；body 全文 / 顶层隐藏子树合计）
 */
function __u2mDetectHidden() {
  function parseDecls(styleStr) {
    var out = {};
    if (!styleStr) return out;
    var parts = styleStr.split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].indexOf(':');
      if (c === -1) continue;
      var prop = parts[i].slice(0, c).trim().toLowerCase();
      var val = parts[i].slice(c + 1).trim().toLowerCase();
      if (prop) out[prop] = val;
    }
    return out;
  }
  function nonWsChars(el) {
    return (el.textContent || '').replace(/\s+/g, '').length;
  }
  var items = [];
  var hiddenChars = 0;
  function walk(el, ctx) {
    var d = parseDecls(el.getAttribute('style'));
    var displayNone = ctx.displayNone || d.display === 'none';
    var visHidden = d.visibility === 'hidden' ? true : (d.visibility === 'visible' ? false : ctx.visHidden);
    var hidden = displayNone || visHidden;
    if (hidden && !ctx.hidden) {
      hiddenChars += nonWsChars(el);
      var id = el.getAttribute('data-idx');
      if (id !== null) {
        items.push({
          id: id,
          chars: (el.textContent || '').trim().length,
          fixed: d.position === 'fixed' || d.position === 'absolute',
        });
      }
      if (displayNone) return; // display:none 子树不可翻案
      var cc = { displayNone: displayNone, visHidden: visHidden, hidden: true };
      for (var i = 0; i < el.children.length; i++) walk(el.children[i], cc);
      return;
    }
    var c2 = { displayNone: displayNone, visHidden: visHidden, hidden: hidden };
    for (var j = 0; j < el.children.length; j++) walk(el.children[j], c2);
  }
  var ctx0 = { displayNone: false, visHidden: false, hidden: false };
  var bodyChildren = document.body.children;
  for (var k = 0; k < bodyChildren.length; k++) walk(bodyChildren[k], ctx0);
  return { items: items, totalChars: nonWsChars(document.body), hiddenChars: hiddenChars };
}
```

- [ ] **Step 4: R6 折叠应用（page-clean-snapshot.js，R5 之后）**

```js
  // 19. R6 隐藏子树折叠（仅清洗版）：cfg.hidden = 检测管线的 items。统一折叠、
  //     不删除——根元素保留 data-idx（步骤 3 仍可引用，步骤 6 从带样式版取
  //     全文）；折叠发生在共享占位之后，占位符只从清洗版消失、恢复清单完整。
  //     应用容忍目标已被前序清洗删除（nav 内隐藏块等）——跳过。
  var collapse = Array.isArray(cfg.hidden) ? cfg.hidden : [];
  for (var i = 0; i < collapse.length; i++) {
    var ent = collapse[i];
    var target = document.querySelector('[data-idx="' + ent.id + '"]');
    if (!target || !document.body.contains(target)) continue;
    while (target.firstChild) target.removeChild(target.firstChild);
    target.setAttribute('data-u2m-hidden', ent.chars + '_chars' + (ent.fixed ? ',fixed' : ''));
  }
```

- [ ] **Step 5: 四阶段编排（clean_snapshot.mjs）**

import 区加 `import juice from 'juice';`；main() 改造（读入快照之后）：

```js
  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');
  const normalizeFn = await readSharedScript('page-normalize-styles.js');
  const hiddenFn = await readSharedScript('page-hidden-detect.js');
```

浏览器启动后（原 `await page.goto(...)` 处起替换为）：

```js
    // 阶段 A：加载快照 + style 属性字符串规范化（防 juice 引号改写损毁声明，
    // 机制见 page-normalize-styles.js 头注；页 1 DOM 保持规范化态供阶段 D 复用）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const htmlNorm = await page.evaluate(`(${normalizeFn})()`);

    // 阶段 B+C：juice 级联内联 → 页 2 检测隐藏子树。任何失败都降级为「不折叠」
    // （失败方向安全：清洗版变大，正文与带样式版不受影响），不阻断步骤 2。
    let hidden = [];
    try {
      const t0 = performance.now();
      const juiced = juice(htmlNorm, { removeStyleTags: true, decodeStyleAttributes: true });
      debug(`juice 内联 ${((performance.now() - t0) / 1000).toFixed(2)}s（${juiced.length} 字节）`);
      const page2 = await context.newPage();
      try {
        await page2.setContent(juiced, { waitUntil: 'domcontentloaded' });
        const detect = await page2.evaluate(`(${hiddenFn})()`);
        hidden = detect.items;
        debug(`[clean] 检测到 ${hidden.length} 个隐藏子树`);
      } finally {
        await page2.close();
      }
    } catch (e) {
      debug(`隐藏检测失败，跳过折叠: ${e.message}`);
    }

    // 阶段 D：清洗（页 1，规范化态 DOM；hidden 随 cfg 传入）
    const result = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ hidden })})`);
```

（其余写盘/emit/关闭顺序不变；`page.evaluate` 字符串完整表达式形式与 CLAUDE.md 记载的 Playwright 1.62 语义一致。）

- [ ] **Step 6: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 全部 PASS（既有 11 个用例不回归——夹具无隐藏规则时 R6 为 no-op）。

- [ ] **Step 7: Commit**

```bash
git add script/lib/page-hidden-detect.js script/lib/page-clean-snapshot.js script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs
git commit -m "feat: R6 juice 级联隐藏子树折叠——统一折叠不删除，正文零误删

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 雪崩护栏 + visibility 语义 + 回归不变量

**Files:**
- Modify: `script/clean_snapshot.mjs`（护栏判定）
- Test: `test/unit/clean-snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 5 的 `detect = { items, totalChars, hiddenChars }`。
- Produces: 护栏行为（触发时 `hidden = []`）。

- [ ] **Step 1: 写失败测试**

```js
test('护栏: 折叠后可见文本 <5% 且总量充足 → 放弃折叠并告警；visibility 翻案语义', async () => {
  const gated = '门'.repeat(2100); // 折叠区 2100 字
  const visLong = '外'.repeat(60);
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>.gate{display:none}.vis{visibility:hidden}.reshow{visibility:visible}</style>
</head>
<body>
  <div data-idx="1">
    <div data-idx="2" class="gate"><p data-idx="3">${gated}</p></div>
    <p data-idx="4">${visLong}</p>
    <div data-idx="5" class="vis">可见性隐藏祖先<span data-idx="6" class="reshow">翻案后代</span></div>
  </div>
</body></html>`;
  const { cleaned, stderr, cleanup } = await runClean(snapshot, 'r6-guard');
  try {
    // 可见文本 ≈ 60 字 vs 折叠 2100 字 → 护栏触发：内容原样保留在清洗版
    assert.ok(cleaned.includes(gated.slice(0, 30)), '护栏触发后折叠区内容应保留');
    assert.ok(!/data-u2m-hidden="/.test(cleaned), '不应产生折叠标记');
    assert.ok(stderr.includes('护栏') || stderr.includes('雪崩'), `stderr 应含护栏告警: ${stderr.slice(-300)}`);
  } finally { cleanup(); }
});

test('R6 语义: visibility:hidden 顶层折叠、visible 后代翻案仅入带样式版（已知边界）', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>.vis{visibility:hidden}</style>
</head>
<body>
  <div data-idx="1">
    <div data-idx="5" class="vis">可见性隐藏祖先<span data-idx="6" style="visibility:visible">翻案后代</span></div>
    <p data-idx="7">正文正文正文正文正文正文正文正文正文正文正文正文</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r6-vis');
  try {
    // .vis 顶层折叠：标记存在、文本消失（翻案后代随根折叠——spec 已记边界）
    const root = cleaned.match(/<div data-idx="5"[^>]*>/)[0];
    assert.ok(/data-u2m-hidden="\d+_chars"/.test(root), `visibility 顶层应折叠: ${root}`);
    assert.ok(!cleaned.includes('可见性隐藏祖先'), '折叠根文本应消失');
    // 带样式版完整
    assert.ok(styled.includes('翻案后代') && styled.includes('可见性隐藏祖先'), '带样式版完整保留');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 护栏用例 FAIL（内容被折叠、无告警）；visibility 用例此时应已 PASS（Task 5 语义已就位，作回归锚）。

- [ ] **Step 3: 实现护栏（clean_snapshot.mjs，Task 5 的 detect 之后）**

```js
        const detect = await page2.evaluate(`(${hiddenFn})()`);
        // 雪崩护栏：juiced DOM 上折叠后可见文本占比 <5% 且折叠前文本充足（≥2000
        // 非空白字符）→ 本轮放弃折叠（整页被 cookie 墙 display:none 类极端页面）
        const visibleChars = detect.totalChars - detect.hiddenChars;
        if (detect.totalChars >= 2000 && visibleChars < detect.totalChars * 0.05) {
          debug(`[clean] 雪崩护栏：折叠后可见文本 ${visibleChars}/${detect.totalChars} 字符，放弃折叠`);
          hidden = [];
        } else {
          hidden = detect.items;
          debug(`[clean] 检测到 ${hidden.length} 个隐藏子树`);
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/unit/clean-snapshot.test.mjs` → 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add script/clean_snapshot.mjs test/unit/clean-snapshot.test.mjs
git commit -m "feat: 雪崩护栏——折叠后可见文本占比过低时放弃折叠并告警

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 文档同步 + 全量回归 + 真实页验收

**Files:**
- Modify: `SKILL.md`（步骤 3 识别线索 + 步骤 2 产物说明）
- Modify: `CLAUDE.md`（管线顺序步骤 2 段）
- Modify: `README.md`（关键机制一节）

**Interfaces:**
- Consumes: Task 1-6 全部已合入。

- [ ] **Step 1: SKILL.md 步骤 3 补标记说明**

在步骤 3「读取 2_clean_snapshot.html」的识别线索列表（「仅根据 … DOM 结构（元素层级、标签类型、class 名称）和长文本占位符…分布」一条）之后补两条：

```markdown
- `data-u2m-hidden="N_chars"`（或 `N_chars,fixed`）标记：折叠的隐藏子树（模态/抽屉/折叠展开区/响应式隐藏）。根元素的 `data-idx` 可正常引用——原文完整保留在带样式版，纳入 listFlowIds 即可还原全文；值是该子树的真实文本规模，可据此判断是否值得纳入
- `<pre>` 内的 `code...`：代码块内容占位。完整代码在后续步骤保真，识别时把 pre 当作一个结构单元即可
```

- [ ] **Step 2: CLAUDE.md 管线顺序步骤 2 段补六规则**

把步骤 2 的括号描述「结构清洗（删 style/link/base、清空 SVG、长文本占位，产物 `2_clean_snapshot.html`）」改为：

```markdown
结构清洗（删 style/link/base、清空 SVG、长文本占位 + 清洗版六规则瘦身：pre→code...、class 噪声过滤、data-* 白名单、astro 解包、保守空白压缩、juice 级联隐藏子树折叠为 data-u2m-hidden 标记——统一折叠不删除，带样式版与步骤 4-9 不受影响，见 specs/2026-08-25-clean-snapshot-slimming-design.md；产物 `2_clean_snapshot.html`）
```

- [ ] **Step 3: README.md 关键机制补一行**

「关键机制」列表末尾加：

```markdown
- **清洗版瘦身**：步骤 2 对 `2_clean_snapshot.html` 施加六规则（代码块→`code...` 占位、class/data-* 噪声剥除、astro 解包、空白压缩、隐藏子树折叠为 `data-u2m-hidden` 标记），隐藏判定走 juice 级联（沿用步骤 5 引号防御），统一折叠不删除——正文与带样式版零丢失，清洗版实测 −91%
```

- [ ] **Step 4: 全量回归**

Run: `pnpm test:all`
Expected: 全部 PASS（含集成）。

- [ ] **Step 5: 真实页验收（prompt-caching，快照已在 working 目录）**

Run: `node script/clean_snapshot.mjs --url https://developers.openai.com/api/docs/guides/prompt-caching`
Expected: exit 0；`ls -la working/developers.openai.com_api_docs_guides_prompt-caching/2_clean_snapshot.html` 体积 ≤ 40 KB；抽查清洗版含 `data-u2m-hidden` 标记与 `code...`、标题全在。

- [ ] **Step 6: Commit**

```bash
git add SKILL.md CLAUDE.md README.md
git commit -m "docs: 步骤 2 六规则瘦身同步 SKILL/CLAUDE/README

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 自审记录

- **Spec 覆盖**：R1（Task 3）、R2（Task 1）、R3（Task 2）、R4/R5（Task 4）、R6+管线+语义（Task 5）、护栏（Task 6）、文档（Task 7）、验收基准（Task 7 Step 5）——全覆盖。spec 的「语义测试浏览器直调」落地为 CLI 子进程夹具（同一语义、覆盖更长的链路，且沿用仓库既有惯例）。
- **类型一致**：`detect.items[].{id,chars,fixed}` 与 `cfg.hidden` 消费端一致；`runClean` 返回 `{out, cleaned, styled, stderr, cleanup}` 各任务引用一致。
- **占位符扫描**：无 TBD/待定；所有代码步骤含完整代码。
- **已知边界（spec §4.2 落地）**：visibility:hidden 顶层折叠会连带翻案后代离开清洗版（Task 6 第二用例钉住该行为），带样式版完整——spec 风险表已记。
