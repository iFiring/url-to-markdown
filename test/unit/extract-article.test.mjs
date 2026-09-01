import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-extract-article.js');
const pageSlimScriptPath = path.resolve(thisDir, '../../script/lib/page-slim-article.js');

test('page-extract-article.js: 文件存在且包含 __u2mExtractArticle 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mExtractArticle'), '应定义 __u2mExtractArticle');
});

test('page-extract-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  const wrapped = `(${src})({titleId:null,descriptionIds:[],blockIds:[]})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-slim-article.js: 文件存在且包含 __u2mSlimArticle 函数', () => {
  const src = fs.readFileSync(pageSlimScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mSlimArticle'), '应定义 __u2mSlimArticle');
});

test('page-slim-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageSlimScriptPath, 'utf8');
  const wrapped = `(${src})([])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('extract_article.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 5 产物：纯内联样式（无 class、无 <style>）。块模型——
// 流容器 [4]/非流包装层 [20]/骨架 [10][11] 不在任何键、不入文章；
// [9] 为步骤 4 折叠的 dump 空壳（步骤 6 不消费 dumpIds）
const JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试文章</title></head><body><div data-idx="10"><main data-idx="11"><h1 style="font-size: 32px; font-weight: bold" data-idx="1">标题</h1><div style="color: rgb(102, 102, 102)" data-idx="2">作者</div></main><div style="margin: 0" data-idx="4"><p style="font-size: 18px" data-idx="5">段落一</p><nav class="toc" data-idx="9"></nav><figure data-idx="6"><img src="x.png" data-idx="7"></figure><div data-idx="20"><section data-idx="21"><p data-idx="22">小节</p></section><p data-idx="23">小节段落</p><p data-idx="24">尾段</p></div><p data-idx="8">段落二</p></div></div></body></html>`;

const URL = 'https://example.com/test-article';

function setupTmp(name, keyIds, { withJuiced = true } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-article-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (withJuiced) {
    fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), JUICED);
  }
  if (keyIds !== null) {
    fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(keyIds));
  }
  return { tmpRoot, urlDir };
}

async function runArticle(tmpRoot, juiced = null, urlDirForOverride = null) {
  const script = path.resolve('script/extract_article.mjs');
  if (juiced && urlDirForOverride) {
    fs.writeFileSync(path.join(urlDirForOverride, '5_juice_styles.html'), juiced);
  }
  return runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
}

test('extract_article.mjs: 四键块迁移——子树一字不动，嵌套子流展开，壳/容器/骨架不入', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok', {
    titleId: 1,
    descriptionIds: [2],
    paragraphIds: [5, 6, [21, 23, 24], 8],
    dumpIds: [9],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.article, path.join(urlDir, '6_article.html'));
  assert.equal(out.elementCount, 8, '应迁移 8 个元素（标题 + 说明 + 6 个段落块）');
  assert.equal(out.removedNoiseCount, undefined, '四键契约下无迁移后剔除 pass，emit 不再有 removedNoiseCount');

  const html = fs.readFileSync(out.article, 'utf8');

  // key 元素子树一字不动（含段落块的后代与嵌套子流块）
  assert.ok(html.includes('<body style="max-width: 768px; margin: 4rem auto">'), 'body 应带居中布局内联样式');
  assert.ok(html.includes('<title>测试文章</title>'), '<title> 应保留');
  assert.ok(html.includes('<html lang="zh-CN">'), 'lang 应保留');
  assert.ok(html.includes('<h1 style="font-size: 32px; font-weight: bold" data-idx="1">标题</h1>'));
  assert.ok(html.includes('<div style="color: rgb(102, 102, 102)" data-idx="2">作者</div>'));
  assert.ok(html.includes('<p style="font-size: 18px" data-idx="5">段落一</p>'));
  assert.ok(html.includes('<figure data-idx="6"><img src="x.png" data-idx="7"></figure>'), '块的后代应完整');
  assert.ok(html.includes('<section data-idx="21"><p data-idx="22">小节</p></section>'), '子流块子树应完整');

  // 流容器/非流包装层/骨架/dump 壳不在任何键——不入文章
  for (const id of [4, 10, 11, 20, 9]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `id ${id} 应不入`);
  }
  assert.ok(!html.includes('class="toc"'), 'dump 空壳应不入文章');

  // 文档序：1 → 2 → 5 → 6 → 7 → 21 → 23 → 24 → 8（嵌套数组位置不影响顺序）
  const order = [1, 2, 5, 6, 7, 21, 23, 24, 8].map((id) => html.indexOf(`data-idx="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `id 顺序应递增: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: titleId 为 null 正常；description 落在段落块子树内随外层整块带入', async () => {
  const nestedDesc = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>嵌套说明</title></head><body><div data-idx="10"><div data-idx="3">作者 日期</div><section data-idx="4"><div data-idx="5"><p data-idx="51">作者行</p><p data-idx="52">正文</p></div><p data-idx="6">段落</p><p data-idx="7">尾段</p></section></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('nested-desc', {
    titleId: null,
    descriptionIds: [3, 51],
    paragraphIds: [5, 6, 7],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, nestedDesc, urlDir);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 4, '应迁移 4 个元素（desc 3 + 块 5/6/7），desc 51 随块 5 带入不单列');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.equal((html.match(/data-idx="51"/g) || []).length, 1,
    '嵌套 desc 应只出现一次（在最外层块的子树内，不被单独追加到文末）');
  assert.ok(html.includes('<div data-idx="5"><p data-idx="51">作者行</p><p data-idx="52">正文</p></div>'),
    '包含 desc 的块子树应原样');
  assert.ok(!html.includes('data-idx="4"'), '流容器应不入');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: paragraphIds 乱序列举时输出仍按文档序', async () => {
  const shuffled = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>乱序</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">前段</p><section data-idx="6"><p data-idx="7">小节</p></section><p data-idx="8">后段</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('order', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [8, 5, 6],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, shuffled, urlDir);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  const order = [1, 5, 6, 8].map((id) => html.indexOf(`data-idx="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `乱序列举不应打乱输出文档序: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: key id 未命中时报 error 并列出缺失 id', async () => {
  const { tmpRoot } = setupTmp('miss', {
    titleId: 1,
    descriptionIds: [99],
    paragraphIds: [5],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'test-article', '6_article.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: paragraphIds 为空或含非法成员时报 error', async () => {
  const empty = setupTmp('empty', { titleId: 1, descriptionIds: [], paragraphIds: [], dumpIds: [] });
  const r1 = await runArticle(empty.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('paragraphIds'), `reason 应指向 paragraphIds: ${JSON.parse(r1.stdout).reason}`);
  fs.rmSync(empty.tmpRoot, { recursive: true, force: true });

  const bad = setupTmp('badmember', { titleId: 1, descriptionIds: [], paragraphIds: [5, 'x'], dumpIds: [] });
  const r2 = await runArticle(bad.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('非法'), `reason 应指出非法成员: ${JSON.parse(r2.stdout).reason}`);
  fs.rmSync(bad.tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 四键标记重叠时报 error', async () => {
  // titleId 与 descriptionIds 重叠：仍互不相交（title/desc ∩ paragraphIds 已允许，见 key-ids 单测）
  const a = setupTmp('overlap-tp', { titleId: 5, descriptionIds: [5], paragraphIds: [6], dumpIds: [] });
  const r1 = await runArticle(a.tmpRoot);
  assert.equal(r1.code, 1);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.status, 'error');
  assert.ok(out1.reason.includes('重叠'), `reason 应说明重叠: ${out1.reason}`);
  fs.rmSync(a.tmpRoot, { recursive: true, force: true });

  // dumpIds 虽不被步骤 6 消费，仍参与互斥校验（与步骤 4 同一校验事实源）
  const b = setupTmp('overlap-pd', { titleId: null, descriptionIds: [], paragraphIds: [5], dumpIds: [5] });
  const r2 = await runArticle(b.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('重叠'));
  fs.rmSync(b.tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 缺步骤 5 产物 / 缺 key_ids 时报 error 并指路', async () => {
  const noJuiced = setupTmp('nojuice', { titleId: 1, descriptionIds: [], paragraphIds: [5], dumpIds: [] }, { withJuiced: false });
  const r1 = await runArticle(noJuiced.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 5'));
  fs.rmSync(noJuiced.tmpRoot, { recursive: true, force: true });

  const noKeyIds = setupTmp('nokey', null);
  const r2 = await runArticle(noKeyIds.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKeyIds.tmpRoot, { recursive: true, force: true });
});

// 瘦身规则① data-*：保留白名单 {data-idx, data-language}（后者是
// 步骤 7 判代码围栏语言的机械信号），其余 data-*（组件库脚手架/交互
// 状态）全删——白名单而非黑名单，陌上站点的 data-* 安全默认删除
// span 6 带 style 是刻意防拆——规则① 删 data-color 后裸 span 会成空壳被规则⑥ 拆掉（spec §5.7 设计行为），本用例只测 data-* 白名单
const DATASTAR_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>瘦身</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-variant="lead" data-idx="5">段落<span data-color="accent" style="background-color: rgb(255, 255, 0)" data-idx="6">行内</span></p><code data-language="python" data-wrap-long-lines="false" data-idx="7">print(1)</code></div></body></html>`;

test('extract_article.mjs: 瘦身规则①——data-* 只留 data-idx 与 data-language', async () => {
  const { tmpRoot, urlDir } = setupTmp('datastar', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [5, 7],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, DATASTAR_JUICED, urlDir);
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

// 瘦身规则② MathML→LaTeX：KaTeX 双胞胎（父 span 仅含 math、祖父恰两
// 元素子其一为父另一为 span）整体替换消灭 katex-html 重复；裸 math 只换
// <math> 本身；无 annotation 保留原树；带文字包装（p 91 直文本 "see "）
// 孪生守卫拦截整体替换、回退只换 <math>——文字不随整体替换丢失。
// $…$ 单美元内联形式（与参考页 9_markdown 既有约定一致）。annotation
// 里的实体（&lt;）经 textContent 解码、序列化时重新转义
const MATH_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>公式</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">设 <span data-idx="60"><span data-idx="61"><math data-idx="62"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-idx="63"><span data-idx="64">M</span></span></span> 为最小长度，</p><p data-idx="8">裸公式 <math data-idx="70"><semantics><mrow><mi>L</mi></mrow><annotation encoding="application/x-tex">L &lt; M</annotation></semantics></math> 成立，</p><p data-idx="9">无源公式 <math data-idx="80"><mrow><mi>x</mi></mrow></math> 保留。</p><p data-idx="10">带文字的包装 <span data-idx="90"><span data-idx="91">see <math data-idx="92"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-idx="93"><span data-idx="94">M</span></span></span> 尾部</p><p data-idx="11">未声明编码 <math data-idx="95"><semantics><mrow><mi>r</mi></mrow><annotation style="display: block;">r</annotation></semantics></math> 换，他声明 <math data-idx="96"><semantics><mrow><mi>q</mi></mrow><annotation encoding="application/mathml-presentation+xml">not-latex</annotation></semantics></math> 不换。</p></div></body></html>`;

test('extract_article.mjs: 瘦身规则②——MathML 按三档替换为 $LaTeX$', async () => {
  const { tmpRoot, urlDir } = setupTmp('math', {
    titleId: 1,
    descriptionIds: [70],
    paragraphIds: [5, 8, 9, 10, 11],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, MATH_JUICED, urlDir);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.includes('设 $M$ 为最小长度'),
    `KaTeX 双胞胎应整体替换为 $M$: ${html.slice(html.indexOf('<body'))}`);
  for (const id of [60, 61, 62, 63, 64]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `katex 包装 id ${id} 应随整体替换消失`);
  }
  // desc 70 落在块 8 子树内：随外层整块带入（不单列），且保真替换不受
  // 保护集约束——70 已入 descriptionIds（key id、被保护），公式照换不保留原树
  assert.ok(html.includes('裸公式 $L &lt; M$ 成立'), '裸 math 应替换为 LaTeX 文本');
  assert.ok(!html.includes('data-idx="70"'), '裸 math 的 id 应消失');
  assert.ok(html.includes('<math data-idx="80"'), '无 annotation 的 math 应保留原树');
  assert.ok(html.includes('see $M$') && html.includes('尾部'),
    '孪生守卫：带文字包装回退只换 <math>，前后文字不随整体替换丢失');
  // 分级信任（高度还原）：未声明 encoding 的裸 annotation 也信——参考页
  // 19 个公式全是此方言（style 无 encoding 属性）；显式声明非 TeX 编码
  // 的不信（内容可能是其他格式，当 LaTeX 替换即失真）
  assert.ok(html.includes('未声明编码 $r$ 换'), '裸 annotation（无 encoding）应替换');
  assert.ok(!html.includes('data-idx="95"'), '裸 annotation 的 math id 应消失');
  assert.ok(html.includes('<math data-idx="96"'), '声明非 TeX 编码的 annotation 不信、原树保留');
  assert.equal(out.slim.mathReplaced, 4, '应替换 4 处（双胞胎 + 裸 math + 守卫回退 + 裸 annotation）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 瘦身规则③④：无文本/纯符号（/[\p{L}\p{N}]/u 不命中——⋮ 即此类）button
// 与无文本 svg 整删（随 button 删除的内部 svg 不重复计数）；有文本
// button（中文/字母数字）解包降级保留文本。
// 四键下 button 可为块（成行展开钮）——被标为块的 button 入保护集、
// 原样保留；未标记的交互残留只可能存在于块内部（后代照常瘦身）
const BUTTON_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>按钮</title></head><body><h1 data-idx="1">标题</h1><button data-idx="23">JavaScript</button><div data-idx="5"><p data-idx="50">正文</p><button data-idx="20"><svg data-idx="21"><path d="M0 0"/></svg></button><button data-idx="22">⋮</button><svg data-idx="28"><rect width="1"/></svg><button data-idx="24">查看答案</button></div></body></html>`;

test('extract_article.mjs: 瘦身规则③④——块内残留按钮清理、button 块受保护不解包', async () => {
  const { tmpRoot, urlDir } = setupTmp('button', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [23, 5],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, BUTTON_JUICED, urlDir);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  for (const id of [20, 21, 22, 28]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `id ${id} 应删除`);
  }
  assert.ok(html.includes('data-idx="23">JavaScript</button>'),
    '被标为块的 button 应原样保留（保护集 = key 元素全集）');
  assert.ok(!/<button[^>]*data-idx="24"/.test(html), '块内未标记的有文本 button 应解包');
  assert.ok(html.includes('查看答案'), '解包后文本应保留');
  assert.equal(out.slim.buttonsRemoved, 2, '无文本/纯符号 button 删 2 个（20 图标钮 + 22 ⋮）');
  assert.equal(out.slim.svgsRemoved, 1, '独立空 svg 删 1 个（21 随 button 走不重复计数）');
  assert.equal(out.slim.buttonsUnwrapped, 1, '有文本 button 解包 1 个（24）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 瘦身规则⑤：scheme ∉ {http,https,mailto,tel} 的 <a> 解包（codex:/
// javascript: 等应用协议——参考页 codex:// 单个 ~1KB URL-encoded prompt
// 曾漏进 9_markdown.md）；http(s)/mailto 与无协议（相对/#锚点）保留
const HREF_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>链接</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5"><a href="codex://threads/new?prompt=%E6%8F%90%E7%A4%BA" data-idx="30">深问</a>、<a href="https://example.com/a" data-idx="31">正常链</a>、<a href="mailto:x@example.com" data-idx="32">邮件</a>、<a href="javascript:void(0)" data-idx="33">假链</a>、<a href="#anchor" data-idx="34">锚点</a>。</p></div></body></html>`;

test('extract_article.mjs: 瘦身规则⑤——非白名单协议 <a> 解包、合法链接保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('href', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [5],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, HREF_JUICED, urlDir);
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

// 瘦身规则⑥：属性只剩 data-idx 的 span 解包，嵌套 token span 迭代
// 塌缩到不动点；带 style 的 span 与保护集中的 span 保留
const SPAN_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>空壳</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><pre data-idx="30"><code data-language="python" data-idx="31"><span data-idx="32"><span data-idx="33">print</span>(<span data-idx="34">1</span>)</span></code></pre><p data-idx="5">段落<span style="background-color: rgb(255, 255, 0)" data-idx="35">高亮</span>与<span data-idx="36">空壳</span></p></div></body></html>`;

test('extract_article.mjs: 瘦身规则⑥——空壳 span 塌缩为纯文本、带样式与保护集 span 保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('span', {
    titleId: 1,
    descriptionIds: [36],
    paragraphIds: [30, 5],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot, SPAN_JUICED, urlDir);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.includes('<pre data-idx="30"><code data-language="python" data-idx="31">print(1)</code></pre>'),
    `嵌套空壳 span 应塌缩为纯文本: ${html.slice(html.indexOf('<body'))}`);
  assert.ok(html.includes('background-color: rgb(255, 255, 0)'), '带 style 的 span 应保留');
  assert.ok(html.includes('data-idx="36"'), '保护集中的空壳 span（嵌在块内的 desc）应保留');
  assert.equal(out.slim.spansUnwrapped, 3, '应解包 3 层（32/33/34）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
