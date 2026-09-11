import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

// render_article.mjs（原步骤 4/5/6 合并，2026-09-11）单测。
// 夹具一律注入为 1_clean_style_snapshot.html + 2_key_ids.json：body 顶层
// 元素全部标进 paragraphIds ⇒ 轮 A 裁剪近似恒等（removedCount=0），用例
// 聚焦各自阶段的断言对象——轮 A 断言 3_extract.html；轮 B 断言
// 3_juice.html（轮 C 之前落盘，不受迁移/瘦身影响）；轮 C 断言
// 3_article.html + emit。
// 注意：夹具经轮 B 白名单清理，color/margin 等白名单外样式不再存活——
// 相关断言为「应删」方向；font-size/font-weight/background/边框类存活。
// 轮 C 的 key id 未命中分支按构造不可达（轮 A 已校验同批 id），为防御
// 性代码，不造用例。

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageExtractStyledPath = path.resolve(thisDir, '../../script/lib/page-extract-styled.js');
const pageFinalizePath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');
const pageUnwrapPath = path.resolve(thisDir, '../../script/lib/page-unwrap-layers.js');
const pageExtractArticlePath = path.resolve(thisDir, '../../script/lib/page-extract-article.js');
const pageSlimPath = path.resolve(thisDir, '../../script/lib/page-slim-article.js');

test('page-extract-styled.js: 文件存在且包含 __u2mExtractStyled 函数', () => {
  const src = fs.readFileSync(pageExtractStyledPath, 'utf8');
  assert.ok(src.includes('function __u2mExtractStyled'), '应定义 __u2mExtractStyled');
});

test('page-extract-styled.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageExtractStyledPath, 'utf8');
  const wrapped = `(${src})({titleId:null,descriptionIds:[],blockIds:[1],dumpIds:[]})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-finalize-inline.js: 文件存在且包含 __u2mFinalizeInline 函数', () => {
  const src = fs.readFileSync(pageFinalizePath, 'utf8');
  assert.ok(src.includes('function __u2mFinalizeInline'), '应定义 __u2mFinalizeInline');
});

test('page-finalize-inline.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageFinalizePath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-unwrap-layers.js: 文件存在且包含 __u2mUnwrapLayers 函数', () => {
  const src = fs.readFileSync(pageUnwrapPath, 'utf8');
  assert.ok(src.includes('function __u2mUnwrapLayers'), '应定义 __u2mUnwrapLayers');
});

test('page-unwrap-layers.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageUnwrapPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-extract-article.js: 文件存在且包含 __u2mExtractArticle 函数', () => {
  const src = fs.readFileSync(pageExtractArticlePath, 'utf8');
  assert.ok(src.includes('function __u2mExtractArticle'), '应定义 __u2mExtractArticle');
});

test('page-extract-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageExtractArticlePath, 'utf8');
  const wrapped = `(${src})({titleId:null,descriptionIds:[],blockIds:[]})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-slim-article.js: 文件存在且包含 __u2mSlimArticle 函数', () => {
  const src = fs.readFileSync(pageSlimPath, 'utf8');
  assert.ok(src.includes('function __u2mSlimArticle'), '应定义 __u2mSlimArticle');
});

test('page-slim-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageSlimPath, 'utf8');
  const wrapped = `(${src})([])`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('render_article.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/render_article.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 1 带样式版快照：style 属性 + head/body 两处 <style> + 噪声分支。
// [8] 为段落流内的 dump（toc 导航，内含 <style>），[14]/[16] 为流外噪音分支
const STYLED_SNAPSHOT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试页</title><style>.hero{color:red}</style></head><body><div class="main" data-idx="1"><header class="hero" style="margin:0" data-idx="2"><h1 data-idx="3">标题</h1><p data-idx="4">作者 日期</p></header><section class="content" style="padding:10px" data-idx="5"><p data-idx="6">段落一</p><div style="border:1px solid" data-idx="7">图容器<span data-idx="71">内嵌</span></div><nav class="toc" id="nav-toc" data-idx="8" role="navigation" aria-label="目录"><style>.deep{color:blue}</style><p data-idx="9">推荐阅读</p></nav><div class="chapter" data-idx="10"><h3 data-idx="11">章节标题</h3><p data-idx="12">段落二</p><ul data-idx="13"><li data-idx="131">条目</li></ul></div></section></div><div class="ads" data-idx="14"><p data-idx="15">广告</p></div><nav class="breadcrumb" data-idx="16"><p data-idx="17">面包屑</p></nav></body></html>`;

const URL = 'https://example.com/test-article';

function setupTmp(name, keyIds, { withSnapshot = true, snapshot = STYLED_SNAPSHOT } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-render-article-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (withSnapshot) {
    fs.writeFileSync(path.join(urlDir, '1_clean_style_snapshot.html'), snapshot);
  }
  if (keyIds !== null) {
    fs.writeFileSync(path.join(urlDir, '2_key_ids.json'), JSON.stringify(keyIds));
  }
  return { tmpRoot, urlDir };
}

async function runArticle(tmpRoot, env = {}) {
  const script = path.resolve('script/render_article.mjs');
  return runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot, ...env },
    timeoutMs: 30000,
  });
}

// ── 轮 A · 样式视图裁剪（断言对象 3_extract.html）──

test('render_article.mjs: 轮 A 四键裁剪——块子树+骨架链一字不动，dump 折叠空壳，流外噪音删除', async () => {
  const { tmpRoot, urlDir } = setupTmp('round-a', {
    titleId: 3,
    descriptionIds: [4],
    paragraphIds: [6, 7, [11, 12, 13]],
    dumpIds: [8],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.article, path.join(urlDir, '3_article.html'));
  assert.equal(out.removedCount, 5, '应删除 5 个元素（9/14/15/16/17）');
  assert.equal(out.dumpCollapsedCount, 1, '应折叠 1 个 dump（8）');
  // emit 加法式契约：三段计数超集；中间产物路径字段已删（无消费者）
  assert.equal(out.styledExtract, undefined, 'emit 不应再含 styledExtract 字段');
  assert.equal(out.juiceStyles, undefined, 'emit 不应再含 juiceStyles 字段');
  assert.equal(typeof out.styledCount, 'number');
  assert.ok(out.slim && typeof out.slim.spansUnwrapped === 'number');
  assert.deepEqual(out.chunks, { split: false, count: 1, files: [out.article] });

  // 三份产物全部落盘（3_extract / 3_juice 调试中间产物 + 3_article 终态）
  for (const f of ['3_extract.html', '3_juice.html', '3_article.html']) {
    assert.ok(fs.existsSync(path.join(urlDir, f)), `${f} 应产出`);
  }

  const html = fs.readFileSync(path.join(urlDir, '3_extract.html'), 'utf8');

  // title/description/paragraphIds 块（含嵌套子流展开）子树 + 祖先链保留，属性一字不动
  for (const id of [1, 2, 3, 4, 5, 6, 7, 71, 10, 11, 12, 13, 131]) {
    assert.ok(html.includes(`data-idx="${id}"`), `id ${id} 应保留`);
  }
  assert.ok(html.includes('class="main"'), '骨架链属性应保留');
  assert.ok(html.includes('style="margin:0"'), 'key 区域 style 属性应原样保留');
  assert.ok(html.includes('style="padding:10px"'));
  assert.ok(html.includes('style="border:1px solid"'));
  assert.ok(html.includes('图容器<span data-idx="71"'), '块的后代应原样保留');

  // dump [8] 折叠为空壳：子树清空、属性仅 id/class/data-idx（role/aria-label 剥除）
  assert.ok(html.includes('<nav class="toc" id="nav-toc" data-idx="8"></nav>'), 'dump 应折叠为仅三属性的空壳');
  assert.ok(!html.includes('推荐阅读'), 'dump 内容应清空');
  assert.ok(!html.includes('role="navigation"'));
  assert.ok(!html.includes('aria-label="目录"'));
  assert.ok(!html.includes('data-idx="9"'), 'dump 子元素应随折叠消失');

  // 流外噪音分支删除
  for (const id of [14, 15, 16, 17]) {
    assert.ok(!html.includes(`data-idx="${id}"`), `id ${id} 应删除`);
  }
  assert.ok(!html.includes('广告'));
  assert.ok(!html.includes('面包屑'));

  // <title> 与全部 <style> 保留；dump 子树内的 <style> 也挪入 head（折叠不吞样式表）
  assert.ok(html.includes('<title>'));
  const headEnd = html.indexOf('</head>');
  const headPart = html.slice(0, headEnd);
  const bodyPart = html.slice(headEnd);
  assert.equal((headPart.match(/<style/g) || []).length, 2, 'head 应含 2 个 <style>（原 1 + 挪入 1）');
  assert.equal((bodyPart.match(/<style/g) || []).length, 0, 'body 不应残留 <style>');
  assert.ok(html.includes('.deep{color:blue}'));

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: titleId 为 null 时正常；流外游离块为顶层标量、嵌套数组展开', async () => {
  const snap = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>游离</title></head><body><div class="wrap" data-idx="1"><h2 data-idx="2">流外标题</h2><p data-idx="3">流外引言文本<em data-idx="31">强调</em></p><section data-idx="4"><p data-idx="5">段落一</p></section><aside class="ad" data-idx="6">广告</aside></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('standalone', {
    titleId: null,
    descriptionIds: [3],
    paragraphIds: [2, [5]],
    dumpIds: [],
  }, { snapshot: snap });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.dumpCollapsedCount, 0);

  const html = fs.readFileSync(path.join(urlDir, '3_extract.html'), 'utf8');
  for (const id of [1, 2, 3, 31, 4, 5]) {
    assert.ok(html.includes(`data-idx="${id}"`), `id ${id} 应保留`);
  }
  assert.ok(!html.includes('data-idx="6"'), '同层噪音应删除');
  assert.ok(!html.includes('广告'));
  assert.ok(html.includes('流外引言文本<em'), 'description 子树应原样保留');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: dump 落在保留区外——随分支删除、不报错不计数', async () => {
  const { tmpRoot, urlDir } = setupTmp('outside', {
    titleId: 3,
    descriptionIds: [4],
    paragraphIds: [6],
    dumpIds: [17],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.dumpCollapsedCount, 0, '保留区外的 dump 不折叠');
  const html = fs.readFileSync(path.join(urlDir, '3_extract.html'), 'utf8');
  assert.ok(html.includes('data-idx="6"'));
  assert.ok(!html.includes('data-idx="17"'));
  assert.ok(!html.includes('data-idx="16"'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: dump 是 key 元素祖先时报 error（折叠会摧毁 key 子树）', async () => {
  const { tmpRoot, urlDir } = setupTmp('conflict', {
    titleId: null,
    descriptionIds: [],
    paragraphIds: [6],
    dumpIds: [5],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('冲突'), `reason 应说明冲突: ${out.reason}`);
  assert.ok(out.reason.includes('5'), `reason 应含 dump id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(urlDir, '3_extract.html')), '失败不应写产物');
  assert.ok(!fs.existsSync(path.join(urlDir, '3_article.html')), '失败不应写终态产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: key id 未命中时报 error 并列出缺失 id（轮 A 拦截）', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', {
    titleId: 3,
    descriptionIds: [99],
    paragraphIds: [6],
    dumpIds: [],
  });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(urlDir, '3_extract.html')), '失败不应写产物');
  assert.ok(!fs.existsSync(path.join(urlDir, '3_article.html')), '失败不应写终态产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: paragraphIds 为空或含非法成员时报 error', async () => {
  const empty = setupTmp('empty', { titleId: 3, descriptionIds: [], paragraphIds: [], dumpIds: [] });
  const r1 = await runArticle(empty.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('paragraphIds'), `reason 应指向 paragraphIds: ${JSON.parse(r1.stdout).reason}`);
  fs.rmSync(empty.tmpRoot, { recursive: true, force: true });

  const bad = setupTmp('badmember', { titleId: 3, descriptionIds: [], paragraphIds: [6, 'x'], dumpIds: [] });
  const r2 = await runArticle(bad.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('非法'), `reason 应指出非法成员: ${JSON.parse(r2.stdout).reason}`);
  fs.rmSync(bad.tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: 四键标记重叠时报 error', async () => {
  // titleId 与 descriptionIds 重叠：仍互不相交（title/desc ∩ paragraphIds 已允许，见 key-ids 单测）
  const a = setupTmp('overlap1', { titleId: 3, descriptionIds: [3], paragraphIds: [6, 7], dumpIds: [] });
  const r1 = await runArticle(a.tmpRoot);
  assert.equal(r1.code, 1);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.status, 'error');
  assert.ok(out1.reason.includes('重叠'), `reason 应说明重叠: ${out1.reason}`);
  fs.rmSync(a.tmpRoot, { recursive: true, force: true });

  const b = setupTmp('overlap2', { titleId: null, descriptionIds: [], paragraphIds: [6], dumpIds: [6] });
  const r2 = await runArticle(b.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('重叠'));
  fs.rmSync(b.tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: 缺快照 / 缺 key_ids 时报 error 并指路', async () => {
  const noSnapshot = setupTmp('nosnap', { titleId: 3, descriptionIds: [], paragraphIds: [6], dumpIds: [] }, { withSnapshot: false });
  const r1 = await runArticle(noSnapshot.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 1'));
  fs.rmSync(noSnapshot.tmpRoot, { recursive: true, force: true });

  const noKeyIds = setupTmp('nokey', null);
  const r2 = await runArticle(noKeyIds.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 2'));
  fs.rmSync(noKeyIds.tmpRoot, { recursive: true, force: true });
});

// ── 轮 B · 样式内联（断言对象 3_juice.html；key_ids 顶层全标 ⇒ 轮 A 近似恒等）──

// 模拟裁剪后形态的快照：<style> 规则 + 原有内联样式（结构化/盒模型几何/
// 字体类混杂）+ class + 文本/非文本元素
const EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>样式计算</title><style>.box{border:2px solid red;background-color:#f0f0f0;box-shadow:0 2px 4px rgba(0,0,0,.1);text-align:center;overflow-x:auto;overflow-wrap:break-word;transform:translateY(2px)}.plain{color:#333;font-weight:bold;font-family:Georgia;letter-spacing:1px;line-height:1.6}p{font-size:18px}</style></head><body><div class="box" style="margin:0;padding:10px;width:100%;box-sizing:border-box;position:relative;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;font-style:normal;color:inherit" data-idx="1"><p class="plain" data-idx="2">文本</p><div style="display:flex;flex-direction:column;gap:8px;padding:12px;position:absolute" data-idx="3">默认文本</div><em style="font-style:italic" data-idx="5">强调</em><span style="color:#f00;background-color:#ffff00" data-idx="4"></span></div></body></html>`;

test('render_article.mjs: 轮 B juice 内联并删净 <style> 与 class', async () => {
  const { tmpRoot, urlDir } = setupTmp('round-b', {
    titleId: null, descriptionIds: [], paragraphIds: [1], dumpIds: [],
  }, { snapshot: EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.styledCount, 4, '带内联样式的元素应为 4 个（div 1 / p 2 / div 3 / span 4）');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');

  // 终态：无 <style>、无 class，规则内联到元素（字面声明值）
  assert.ok(!juiced.includes('<style'), '不应含 <style> 标签');
  assert.ok(!juiced.includes('class='), '不应含 class 属性');

  // 结构化样式保留：边框背景 / box-shadow / flex·grid 方向（2026-09-09
  // 收紧：display 值门控 + 方向 longhand；gap/对齐出白名单）
  assert.ok(juiced.includes('2px solid red'), '应保留边框规则');
  // 被清理过的元素经 CSSOM 重序列化，颜色归一为 rgb() 形式（语义等价）
  assert.ok(juiced.includes('rgb(240, 240, 240)'), '应保留背景色规则');
  assert.ok(juiced.includes('box-shadow'), '应保留 box-shadow');
  assert.ok(juiced.includes('display: flex'), 'flex 布局的 display 应保留');
  assert.ok(juiced.includes('flex-direction'), 'flex 方向属性应保留');
  assert.ok(!juiced.includes('gap'), 'gap 出白名单应删除');
  assert.ok(!juiced.includes('overflow-x'), 'overflow 三件出白名单应删除');
  assert.ok(juiced.includes('translateY(2px)'), 'transform 声明应保留');
  // 白名单按属性判定而非按元素：行内元素（高亮 span）的背景同样保留
  assert.ok(juiced.includes('rgb(255, 255, 0)'), 'span 的背景色应保留');
  assert.ok(juiced.includes('data-idx="2"'), 'data-idx 应保留');

  // 字体类仅保留 font-size / font-weight（步骤 4 判标题层级的信号）
  assert.ok(juiced.includes('font-size: 18px'), 'font-size 声明应保留');
  assert.ok(juiced.includes('font-weight: bold'), 'font-weight 声明应保留');

  // 盒模型几何全删：margin / padding / 宽高 / box-sizing；定位仅留 absolute（步骤 4 特殊定位信号）
  assert.ok(!juiced.includes('margin'), 'margin 声明应删除');
  assert.ok(!juiced.includes('padding'), 'padding 声明应删除');
  assert.ok(!juiced.includes('width'), 'width 声明应删除');
  assert.ok(!juiced.includes('box-sizing'), 'box-sizing 声明应删除');
  assert.ok(!juiced.includes('position: relative'), 'position:relative 应删除（仅 absolute 保留）');
  assert.ok(juiced.includes('position: absolute'), 'position:absolute 应保留（步骤 4 特殊定位信号）');

  // 其余字体与文本类声明全删：font-family/font-style / 行高 / 字距 / 文本对齐 / color / 文本换行
  assert.ok(!juiced.includes('font-family'), 'font-family 声明应删除');
  assert.ok(!juiced.includes('font-style'), 'font-style 声明（含 italic）应删除');
  assert.ok(!juiced.includes('letter-spacing'), 'letter-spacing 声明应删除');
  assert.ok(!juiced.includes('line-height'), 'line-height 声明应删除');
  assert.ok(!juiced.includes('text-align'), 'text-align 声明应删除');
  assert.ok(!juiced.includes('overflow-wrap'), 'overflow-wrap 属文本换行应删除');
  assert.ok(!/(^|[^-])color:/.test(juiced), 'color 声明应删除（background-color 不受影响）');
  assert.ok(!juiced.includes('-webkit-'), '-webkit- 前缀声明应删除');
  assert.ok(!juiced.includes('inherit'), '值为 inherit 的声明应删除');
  // 只剩被删声明的元素：style 属性整体移除
  assert.ok(juiced.includes('<em data-idx="5">'), 'em 仅 font-style，清空后不应残留 style 属性');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// img 宽高例外：白名单唯一的元素级例外——<img> 的 width/height 保留
// （步骤 4 LLM 判图片权重的语义信号：小图标 / 大图 / 图片组），其余规则
// 不变：img 的 margin 照删、其他元素的宽高照删
const IMG_SIZE_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>img 宽高</title><style>body{transition:opacity .2s}</style></head><body><figure data-idx="1"><img src="https://example.com/a/pic.png" style="width:120px;height:80px;margin:10px" data-idx="2"><figcaption data-idx="3">图注</figcaption></figure><div style="width:100%;height:40px;border:1px solid black" data-idx="4">文本</div></body></html>`;

test('render_article.mjs: img 的 style 宽高保留（步骤 4 语义信号），其余元素宽高仍删', async () => {
  const { tmpRoot, urlDir } = setupTmp('img-size', {
    titleId: null, descriptionIds: [], paragraphIds: [1, 4], dumpIds: [],
  }, { snapshot: IMG_SIZE_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // img 宽高保留（元素级例外）；img 的 margin 照删
  assert.ok(juiced.includes('width: 120px'), 'img 的 width 声明应保留');
  assert.ok(juiced.includes('height: 80px'), 'img 的 height 声明应保留');
  assert.ok(!juiced.includes('margin'), 'img 的 margin 声明应删除');
  // 例外仅限 img：div 的宽高照删、白名单内样式照留
  assert.ok(!juiced.includes('width: 100%'), 'div 的 width 声明应删除');
  assert.ok(!juiced.includes('height: 40px'), 'div 的 height 声明应删除');
  assert.ok(juiced.includes('1px solid'), 'div 的 border 声明应保留');
  assert.equal(out.styledCount, 2, '带内联样式的元素应为 2 个（img / div）');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 复现真实站点（微信公众号）踩到的坑：行内 style 属性里的引号以 &quot; 实体
// 编码（font-family: Optima, &quot;Microsoft YaHei&quot;, serif），而文档含
// <style> 标签时 juice 的 cheerio 载入不解码属性实体，实体原样进入行内样式
// 的严格 postcss 解析（inline.js strict:true），& 开头的 token 报
// "Unknown word Microsoft"。缺 <style> 标签时 cheerio 会解码实体、测不出
// 来，故夹具必须带一个 <style>。修复：juice decodeStyleAttributes 在解析
// 层对 style 属性值做实体解码。
const ENTITY_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>实体引号</title><style>body{transition:opacity .2s}</style></head><body style="font-family: Optima, &quot;Microsoft YaHei&quot;, serif; border: 1px solid black; margin: 10px"><div data-idx="1">文本</div></body></html>`;

test('render_article.mjs: 行内 style 属性含 &quot; 实体引号时不再崩溃', async () => {
  const { tmpRoot, urlDir } = setupTmp('entity', {
    titleId: null, descriptionIds: [], paragraphIds: [1], dumpIds: [],
  }, { snapshot: ENTITY_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // 同一属性的声明被正常解析：结构化 border 保留（元素经 CSSOM 重序列化，
  // 颜色归一为 rgb() 形式，只断言结构部分），font-family 白名单外删除
  assert.ok(juiced.includes('1px solid'), 'border 声明应保留');
  assert.ok(!juiced.includes('font-family'), 'font-family 声明应删除');
  assert.ok(!juiced.includes('&quot;'), '不应残留引号实体');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 引号混排的两个崩溃形状（正则把 &quot; 改写为 ' 的路线修不了）：
// A. 值内已有字面单引号 + 实体双引号混排——改写后 'a'b' 同样崩 Unclosed
//    string（url("…men's-tshirt.png") 一类，6de614b^ 能转、正则版反而崩）；
// B. 实体双引号内含撇号（&quot;D'Nealian&quot;）——正则版修复前后都崩。
// 正解：juice decodeStyleAttributes 在解析层解码实体，两种形状都是合法 CSS。
const MIXED_QUOTE_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>混排引号</title><style>body{transition:opacity .2s}</style></head><body style="font-family: 'a&quot;b', serif; border: 1px solid black; margin: 10px"><div style="font-family: &quot;D'Nealian&quot;, serif; outline: 1px solid blue" data-idx="1">文本</div></body></html>`;

test('render_article.mjs: 引号混排（字面单引号 × 实体双引号 × 实体内撇号）不再崩溃', async () => {
  const { tmpRoot, urlDir } = setupTmp('mixed-quote', {
    titleId: null, descriptionIds: [], paragraphIds: [1], dumpIds: [],
  }, { snapshot: MIXED_QUOTE_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // 两个元素的声明都正常解析：结构化样式保留，字体类（白名单外）删除
  assert.ok(juiced.includes('1px solid'), 'body 的 border 声明应保留');
  assert.ok(juiced.includes('outline'), 'div 的 outline 声明应保留');
  assert.ok(!juiced.includes('font-family'), 'font-family 声明应删除');
  assert.ok(!juiced.includes('&quot;'), '不应残留引号实体');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// -style 结尾的非 style 属性（data-style 等，真实 Webflow 页面存在）不得被
// 实体解码波及——正则 \bstyle=" 会误配它们，把合法 JSON 破坏成 {'k':'v'}。
const DATA_STYLE_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>data-style</title><style>body{transition:opacity .2s}</style></head><body><div data-style="{&quot;theme&quot;:&quot;dark&quot;}" style="border: 1px solid black" data-idx="1">文本</div></body></html>`;

test('render_article.mjs: data-style 等后缀属性不被引号处理波及', async () => {
  const { tmpRoot, urlDir } = setupTmp('data-style', {
    titleId: null, descriptionIds: [], paragraphIds: [1], dumpIds: [],
  }, { snapshot: DATA_STYLE_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  assert.ok(juiced.includes('1px solid'), 'style 属性的 border 应保留');
  // data-style 原样存活：实体不被解码（outerHTML 序列化仍以 &quot; 表达）
  assert.ok(juiced.includes('data-style='), 'data-style 属性应保留');
  assert.ok(juiced.includes('&quot;theme&quot;'), 'data-style 值内的引号实体应原样保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Tailwind v4 形态：工具类规则包在 @layer 级联层里（真实站点
// developers.openai.com 实测 56% 的 CSS 在 @layer utilities 内），而 juice
// 不解析 @layer 块——不解包则工具类样式一条都内联不进去，只靠工具类表达
// 样式的元素（figure 卡片边框/圆角/背景）在轮 B 后一丝样式不剩。
// 夹具含两种 layer 形态：声明形（@layer a, b;）与块形（@layer name { … }），
// 块内再嵌 @media（md:p-5 形态）与递归嵌套 layer。
const LAYERED_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>layer 解包</title><style>
@property --tw-border-style { syntax: "*"; inherits: false; initial-value: solid }
@layer theme, base, components, utilities;
@layer theme { :root { --radius-lg: 8px; --color-border: #d4d4d8; --color-surface: #fafafa } }
@layer utilities {
  .rounded-lg { border-radius: var(--radius-lg) }
  .border { border-style: var(--tw-border-style); border-width: 1px }
  .border-default { border-color: var(--color-border) }
  .bg-surface { background-color: var(--color-surface) }
  .p-4 { padding: 1rem }
  @media (min-width: 768px) { .md\\:p-5 { padding: 1.25rem } }
  @layer nested { .nested-deep { border-width: 2px; border-style: solid } }
}
.direct { outline: 1px solid blue }
</style></head><body>
<figure class="rounded-lg border border-default bg-surface p-4" data-idx="1872">图</figure>
<div class="nested-deep" data-idx="2">嵌套层</div>
<div class="direct" data-idx="3">顶层规则</div>
</body></html>`;

test('render_article.mjs: @layer 内的工具类规则解包后正常内联（Tailwind v4）', async () => {
  const { tmpRoot, urlDir } = setupTmp('layered', {
    titleId: null, descriptionIds: [], paragraphIds: [1872, 2, 3], dumpIds: [],
  }, { snapshot: LAYERED_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // figure 的工具类样式全部内联进来。:root 变量定义随层解包提升到顶层后，
  // juice 会把已定义的 var() 解析为具体值（border-radius: 8px、
  // border-color: #d4d4d8 → CSSOM 归一 rgb(…）；--tw-border-style 以
  // @property 注册 initial-value solid（真实 Tailwind 形态——零值过滤会把
  // style:none 的整边三件全删，不注册则计算为 none、边框断言对象被清理）
  // 由函数值真实化链路以浏览器计算值替换为 solid——结构信号「带边框
  // 圆角的盒子」对步骤 4 LLM 成立
  assert.ok(/border-radius:\s*8px/.test(juiced), 'figure 应内联 border-radius（已解析变量值）');
  assert.ok(/border-width:\s*1px/.test(juiced), 'figure 应内联 border-width');
  assert.ok(/border-color:\s*rgb\(212, ?212, ?216\)/.test(juiced), 'figure 应内联 border-color（已解析变量值）');
  assert.ok(/background-color:\s*rgb\(250, ?250, ?250\)/.test(juiced), 'figure 应内联 background-color（已解析变量值）');
  // 盒模型几何照旧走白名单删除（解包不改变白名单行为）
  assert.ok(!juiced.includes('padding'), 'padding 声明应删除');
  // 递归嵌套 layer 同样解包内联
  assert.ok(juiced.includes('border-width: 2px'), '嵌套层规则应内联');
  // 顶层规则不受影响（回归护栏）
  assert.ok(juiced.includes('outline'), '顶层规则的 outline 应照常内联');
  // 终态无 @layer 残留、无 <style>、无 class
  assert.ok(!juiced.includes('@layer'), '不应残留 @layer');
  assert.ok(!juiced.includes('<style'), '不应含 <style> 标签');
  assert.ok(!juiced.includes('class='), '不应含 class 属性');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 函数值真实化：多级 var 链（--color-border → --alpha-10 → color-mix(in oklab, …)）
// juice 递归解析会把 color-mix 的颜色空间参数弄丢（产出非法值，浏览器整条
// 丢弃）；@property 注册的变量（--tw-border-style）与 calc() 同样留函数
// 间接引用。要求终态全部替换为浏览器 getComputedStyle 计算出的真实值。
const FUNCVAL_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>函数值真实化</title><style>
@property --tw-border-style { syntax: "*"; inherits: false; initial-value: solid }
:root { --alpha-base: rgb(13, 13, 13); --alpha-10: color-mix(in oklab, var(--alpha-base) 10%, transparent); --color-border: var(--alpha-10); --font-big: calc(1.125rem * 2) }
.bordered { border-style: var(--tw-border-style); border-width: 1px; border-color: var(--color-border) }
.bigtext { font-size: var(--font-big) }
</style></head><body>
<div class="bordered" data-idx="1">边框</div>
<p class="bigtext" data-idx="2">大字</p>
</body></html>`;

test('render_article.mjs: var/color-mix/calc 残留替换为浏览器计算的真实值', async () => {
  const { tmpRoot, urlDir } = setupTmp('funcval', {
    titleId: null, descriptionIds: [], paragraphIds: [1, 2], dumpIds: [],
  }, { snapshot: FUNCVAL_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // @property 注册变量 → 计算值 solid；calc() → 具体 px（1.125rem×2 = 36px）
  assert.ok(juiced.includes('border-style: solid'), 'border-style 应替换为计算值 solid');
  assert.ok(juiced.includes('font-size: 36px'), 'font-size 的 calc 应替换为具体 px 值');
  assert.ok(/border-color:\s*(?!.*color-mix)[^;"]+/.test(juiced), 'border-color 应为具体色值');
  // 终态零函数间接引用
  assert.ok(!juiced.includes('var('), '不应残留 var(');
  assert.ok(!juiced.includes('color-mix('), '不应残留 color-mix(');
  assert.ok(!juiced.includes('calc('), '不应残留 calc(');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 隐藏声明剥离：收起的元素（class 规则 / <style> 规则 / 内联 style / 裸 hidden
// 属性 / 变量驱动）在计算样式前剥离隐藏声明、展开为可见——只删隐藏声明本身，
// 规则其余声明保留（.row{display:flex} 不被 display:block 盲改，flex 结构
// 信号流到步骤 4）。
const HIDDEN_STRIP_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>隐藏剥离</title><style>
:root { --gone: none }
.panel { display: none }
.row { display: flex; gap: 8px }
.collapse { display: none }
.invis { visibility: hidden; border: 2px solid green }
.byvar { display: var(--gone); border: 1px solid red }
.attrhide { border: 3px solid blue }
</style></head><body>
<div class="panel" data-idx="1"><p>类规则收起的中文内容</p></div>
<div class="row collapse" data-idx="2"><span>自然恢复 flex</span></div>
<div class="invis" data-idx="3">可见化并保留边框</div>
<div class="byvar" data-idx="4">变量驱动收起的内容</div>
<div class="attrhide" hidden="true" data-idx="5">裸 hidden 属性收起的内容</div>
<div style="display: none; border: 4px solid purple" data-idx="6">内联收起的内容</div>
<p data-idx="7">正文段落</p>
</body></html>`;

test('render_article.mjs: 隐藏声明剥离——收起元素展开、自然 display 恢复', async () => {
  const { tmpRoot, urlDir } = setupTmp('hidden-strip', {
    titleId: null, descriptionIds: [], paragraphIds: [1, 2, 3, 4, 5, 6, 7], dumpIds: [],
  }, { snapshot: HIDDEN_STRIP_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  // 终态零隐藏声明（display:none / visibility:hidden 一处不留）
  assert.ok(!juiced.includes('display: none'), '不应残留 display: none');
  assert.ok(!juiced.includes('visibility: hidden'), '不应残留 visibility: hidden');
  // 收起内容全部展开、进入产物
  for (const text of ['类规则收起的中文内容', '自然恢复 flex', '可见化并保留边框', '变量驱动收起的内容', '裸 hidden 属性收起的内容', '内联收起的内容']) {
    assert.ok(juiced.includes(text), `收起内容应展开保留: ${text}`);
  }
  // 只删隐藏声明、规则其余声明保留：collapse 剥除后 .row 的 flex 自然恢复
  // （不是 display:block 盲改——flex 方向信号对步骤 4 LLM 完整）。
  // 逐元素断言用整标签匹配（style 属性可能排在 data-idx 之前，从 id
  // 往后切片会切掉它）
  const tagOf = (id) => juiced.match(new RegExp(`<[^>]*data-idx="${id}"[^>]*>`))?.[0] || '';
  assert.ok(tagOf(2).includes('display: flex'), `自然 display:flex 应恢复: ${tagOf(2)}`);
  assert.ok(!tagOf(2).includes('gap'), `gap 出白名单应删除: ${tagOf(2)}`);
  // visibility:hidden 剥除但同规则 border 保留
  assert.ok(tagOf(3).includes('border') || tagOf(3).includes('rgb('), `invis 的边框应保留: ${tagOf(3)}`);
  // 变量驱动兜底：strip 阶段覆写 display:block 展开可见；finalize 值门控下
  // block（div 的 UA 默认值）不再残留——可见性由「内容在 + 零 display:none」保证
  assert.ok(!tagOf(4).includes('display:'), `display:block 兜底值不应残留于终态: ${tagOf(4)}`);
  assert.ok(tagOf(4).includes('border') || tagOf(4).includes('rgb('), `byvar 的边框应保留: ${tagOf(4)}`);
  // 裸 hidden 属性摘除后元素可见、属性不残留
  assert.ok(tagOf(5).includes('border') || tagOf(5).includes('rgb('), `attrhide 的边框应保留: ${tagOf(5)}`);
  assert.ok(!/hidden/.test(tagOf(5)), `hidden 属性应摘除: ${tagOf(5)}`);
  // 内联 display:none 剥除、同属性其余声明保留
  assert.ok(tagOf(6).includes('border') || tagOf(6).includes('rgb('), `内联收起元素的边框应保留: ${tagOf(6)}`);
  // 可见正文不受影响
  assert.ok(juiced.includes('正文段落'), '可见正文保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

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

test('render_article.mjs: 零值声明过滤——等于全元素初始值的声明删除、实信号保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('zero-void', {
    titleId: null,
    descriptionIds: [],
    paragraphIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    dumpIds: [],
  }, { snapshot: ZERO_VOID_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  const tagOf = (id) => juiced.match(new RegExp(`<[^>]*data-idx="${id}"[^>]*>`))?.[0] || '';

  // 只剩零值声明的元素：style 属性整体消失（id 12 overflow:auto 因
  // 2026-09-09 overflow 出白名单同批清空）
  for (const id of [1, 2, 5, 8, 9, 10, 11, 12, 15]) {
    assert.ok(!tagOf(id).includes('style='), `id ${id} 零值声明应清空 style 属性: ${tagOf(id)}`);
  }
  // 实信号保留
  assert.ok(tagOf(3).includes('1px solid'), `实边框应保留: ${tagOf(3)}`);
  assert.ok(tagOf(4).includes('border: solid') || tagOf(4).includes('border-style: solid'),
    `style 实值 + width 缺省（medium+solid 可见）应保留: ${tagOf(4)}`);
  assert.ok(tagOf(6).includes('rgb(249, 249, 249)') && !tagOf(6).includes('border-radius'),
    `零圆角删、实背景留: ${tagOf(6)}`);
  assert.ok(tagOf(7).includes('border-radius: 8px'), `非零圆角应保留: ${tagOf(7)}`);
  // flex 简写在 2026-09-09 布局白名单收紧中出白名单（只留方向信号）
  assert.ok(!tagOf(13).includes('style='), `flex 简写出白名单应清空 style: ${tagOf(13)}`);
  assert.ok(tagOf(14).includes('outline') && tagOf(14).includes('1px'),
    `实 outline 应保留: ${tagOf(14)}`);
  assert.equal(out.styledCount, 5, `应剩 5 个带样式元素（3/4/6/7/14），实得 ${out.styledCount}`);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// pre>code 内部样式对最终 markdown 无语义——仅文本与 data-language 是步骤 4
// 所需。高亮 token span 携 font-weight/background/border 等白名单内幸存样式，
// 若流进步骤 4 会让 LLM 误产 **bold** 损坏代码。finalize 在 pre 子树内直接
// 剥净全部内联样式（跳过白名单），token span 变 bare 由轮 C 规则⑥解包为
// 纯文本。对照：pre 外的 font-weight（标题层级信号）仍按白名单保留。
const PRE_CODE_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>代码块样式</title><style>body{transition:opacity .2s}</style></head><body>
<pre data-idx="1"><code data-language="python" data-idx="2"><span style="font-weight:700" data-idx="3">const</span><span style="color:#f00" data-idx="4"> </span><span style="background-color:#ffff00" data-idx="5">client</span></code></pre>
<p style="font-weight:bold" data-idx="6">普通段落粗体</p>
</body></html>`;

test('render_article.mjs: pre 内 token span 样式全删（markdown 无需）——pre 外 font-weight 仍保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('pre-code-styles', {
    titleId: null, descriptionIds: [], paragraphIds: [1, 6], dumpIds: [],
  }, { snapshot: PRE_CODE_EXTRACT });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(path.join(urlDir, '3_juice.html'), 'utf8');
  const tagOf = (id) => juiced.match(new RegExp(`<[^>]*data-idx="${id}"[^>]*>`))?.[0] || '';
  // pre 内 token span 样式全删（font-weight/background/color 均无意义）
  assert.ok(!tagOf(3).includes('style='), `pre 内 font-weight span 应剥净 style: ${tagOf(3)}`);
  assert.ok(!tagOf(4).includes('style='), `pre 内 color span 应剥净 style: ${tagOf(4)}`);
  assert.ok(!tagOf(5).includes('style='), `pre 内 background span 应剥净 style: ${tagOf(5)}`);
  // pre 外的 font-weight 仍保留（标题层级信号，步骤 4 判 div→h2 用）
  assert.ok(tagOf(6).includes('font-weight'), `pre 外的 font-weight 应保留: ${tagOf(6)}`);
  // 代码文本与语言信号存活
  assert.ok(juiced.includes('const') && juiced.includes('client'), '代码文本存活');
  assert.ok(juiced.includes('data-language="python"'), 'data-language 语言信号存活');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── 轮 C · 文章视图提取 + 瘦身 + 分块（断言对象 3_article.html）──

// 模拟纯内联形态的快照：块模型——流容器 [4]/非流包装层 [20]/骨架 [10][11]
// 不在任何键、不入文章；[9] 为轮 A 折叠的 dump 空壳（轮 C 不消费 dumpIds）
const JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试文章</title></head><body><div data-idx="10"><main data-idx="11"><h1 style="font-size: 32px; font-weight: bold" data-idx="1">标题</h1><div style="color: rgb(102, 102, 102)" data-idx="2">作者</div></main><div style="margin: 0" data-idx="4"><p style="font-size: 18px" data-idx="5">段落一</p><nav class="toc" data-idx="9"></nav><figure data-idx="6"><img src="x.png" data-idx="7"></figure><div data-idx="20"><section data-idx="21"><p data-idx="22">小节</p></section><p data-idx="23">小节段落</p><p data-idx="24">尾段</p></div><p data-idx="8">段落二</p></div></div></body></html>`;

test('render_article.mjs: 轮 C 四键块迁移——子树一字不动，嵌套子流展开，壳/容器/骨架不入', async () => {
  const { tmpRoot, urlDir } = setupTmp('round-c', {
    titleId: 1,
    descriptionIds: [2],
    paragraphIds: [5, 6, [21, 23, 24], 8],
    dumpIds: [9],
  }, { snapshot: JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.article, path.join(urlDir, '3_article.html'));
  assert.equal(out.elementCount, 8, '应迁移 8 个元素（标题 + 说明 + 6 个段落块）');

  const html = fs.readFileSync(out.article, 'utf8');
  const tagOf = (id) => html.match(new RegExp(`<[^>]*data-idx="${id}"[^>]*>`))?.[0] || '';

  // key 元素子树一字不动（含段落块的后代与嵌套子流块）。样式经轮 B 白名单
  // 清理：font-size/font-weight 存活；color/margin 白名单外删除（应删断言）
  assert.ok(html.includes('<body style="max-width: 768px; margin: 4rem auto">'), 'body 应带居中布局内联样式');
  assert.ok(html.includes('<title>测试文章</title>'), '<title> 应保留');
  assert.ok(html.includes('<html lang="zh-CN">'), 'lang 应保留');
  assert.ok(tagOf(1).includes('font-size: 32px') && tagOf(1).includes('font-weight: bold'),
    `h1 的字号/字重信号应保留: ${tagOf(1)}`);
  assert.ok(!tagOf(2).includes('style='), `desc 的 color 白名单外应删: ${tagOf(2)}`);
  assert.ok(html.includes('<div data-idx="2">作者</div>'), 'desc 文本应保留');
  assert.ok(tagOf(5).includes('font-size: 18px'), `段落字号信号应保留: ${tagOf(5)}`);
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

test('render_article.mjs: titleId 为 null 正常；description 落在段落块子树内随外层整块带入', async () => {
  const nestedDesc = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>嵌套说明</title></head><body><div data-idx="10"><div data-idx="3">作者 日期</div><section data-idx="4"><div data-idx="5"><p data-idx="51">作者行</p><p data-idx="52">正文</p></div><p data-idx="6">段落</p><p data-idx="7">尾段</p></section></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('nested-desc', {
    titleId: null,
    descriptionIds: [3, 51],
    paragraphIds: [5, 6, 7],
    dumpIds: [],
  }, { snapshot: nestedDesc });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 4, '应迁移 4 个元素（desc 3 + 块 5/6/7），desc 51 随块 5 带入不单列');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
  assert.equal((html.match(/data-idx="51"/g) || []).length, 1,
    '嵌套 desc 应只出现一次（在最外层块的子树内，不被单独追加到文末）');
  assert.ok(html.includes('<div data-idx="5"><p data-idx="51">作者行</p><p data-idx="52">正文</p></div>'),
    '包含 desc 的块子树应原样');
  assert.ok(!html.includes('data-idx="4"'), '流容器应不入');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: paragraphIds 乱序列举时输出仍按文档序', async () => {
  const shuffled = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>乱序</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">前段</p><section data-idx="6"><p data-idx="7">小节</p></section><p data-idx="8">后段</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('order', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [8, 5, 6],
    dumpIds: [],
  }, { snapshot: shuffled });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
  const order = [1, 5, 6, 8].map((id) => html.indexOf(`data-idx="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `乱序列举不应打乱输出文档序: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: paragraphIds 为空或含非法成员时报 error（launch 前拦截）', async () => {
  // 形状校验用例已在轮 A 组覆盖（empty/badmember），此处验证轮 C 组夹具
  // 形态下同样拦截——使用 JUICED 形态快照
  const bad = setupTmp('badmember-c', { titleId: 1, descriptionIds: [], paragraphIds: [5, 'x'], dumpIds: [] }, { snapshot: JUICED });
  const r = await runArticle(bad.tmpRoot);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.stdout).reason.includes('非法'), `reason 应指出非法成员: ${JSON.parse(r.stdout).reason}`);
  fs.rmSync(bad.tmpRoot, { recursive: true, force: true });
});

// 瘦身规则① data-*：保留白名单 {data-idx, data-language}（后者是
// 步骤 4 判代码围栏语言的机械信号），其余 data-*（组件库脚手架/交互
// 状态）全删——白名单而非黑名单，陌上站点的 data-* 安全默认删除
// span 6 带 style 是刻意防拆——规则① 删 data-color 后裸 span 会成空壳被规则⑥ 拆掉（spec §5.7 设计行为），本用例只测 data-* 白名单
const DATASTAR_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>瘦身</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-variant="lead" data-idx="5">段落<span data-color="accent" style="background-color: rgb(255, 255, 0)" data-idx="6">行内</span></p><code data-language="python" data-wrap-long-lines="false" data-idx="7">print(1)</code></div></body></html>`;

test('render_article.mjs: 瘦身规则①——data-* 只留 data-idx 与 data-language', async () => {
  const { tmpRoot, urlDir } = setupTmp('datastar', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [5, 7],
    dumpIds: [],
  }, { snapshot: DATASTAR_JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
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
// $…$ 单美元内联形式（与参考页最终 markdown 既有约定一致）。annotation
// 里的实体（&lt;）经 textContent 解码、序列化时重新转义
const MATH_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>公式</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5">设 <span data-idx="60"><span data-idx="61"><math data-idx="62"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-idx="63"><span data-idx="64">M</span></span></span> 为最小长度，</p><p data-idx="8">裸公式 <math data-idx="70"><semantics><mrow><mi>L</mi></mrow><annotation encoding="application/x-tex">L &lt; M</annotation></semantics></math> 成立，</p><p data-idx="9">无源公式 <math data-idx="80"><mrow><mi>x</mi></mrow></math> 保留。</p><p data-idx="10">带文字的包装 <span data-idx="90"><span data-idx="91">see <math data-idx="92"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-idx="93"><span data-idx="94">M</span></span></span> 尾部</p><p data-idx="11">未声明编码 <math data-idx="95"><semantics><mrow><mi>r</mi></mrow><annotation style="display: block;">r</annotation></semantics></math> 换，他声明 <math data-idx="96"><semantics><mrow><mi>r</mi></mrow><annotation encoding="application/mathml-presentation+xml">not-latex</annotation></semantics></math> 不换。</p></div></body></html>`;

test('render_article.mjs: 瘦身规则②——MathML 按三档替换为 $LaTeX$', async () => {
  const { tmpRoot, urlDir } = setupTmp('math', {
    titleId: 1,
    descriptionIds: [70],
    paragraphIds: [5, 8, 9, 10, 11],
    dumpIds: [],
  }, { snapshot: MATH_JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
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

test('render_article.mjs: 瘦身规则③④——块内残留按钮清理、button 块受保护不解包', async () => {
  const { tmpRoot, urlDir } = setupTmp('button', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [23, 5],
    dumpIds: [],
  }, { snapshot: BUTTON_JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
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
// 曾漏进最终 markdown）；http(s)/mailto 与无协议（相对/#锚点）保留
const HREF_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>链接</title></head><body><h1 data-idx="1">标题</h1><div data-idx="4"><p data-idx="5"><a href="codex://threads/new?prompt=%E6%8F%90%E7%A4%BA" data-idx="30">深问</a>、<a href="https://example.com/a" data-idx="31">正常链</a>、<a href="mailto:x@example.com" data-idx="32">邮件</a>、<a href="javascript:void(0)" data-idx="33">假链</a>、<a href="#anchor" data-idx="34">锚点</a>。</p></div></body></html>`;

test('render_article.mjs: 瘦身规则⑤——非白名单协议 <a> 解包、合法链接保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('href', {
    titleId: 1,
    descriptionIds: [],
    paragraphIds: [5],
    dumpIds: [],
  }, { snapshot: HREF_JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
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

test('render_article.mjs: 瘦身规则⑥——空壳 span 塌缩为纯文本、带样式与保护集 span 保留', async () => {
  const { tmpRoot, urlDir } = setupTmp('span', {
    titleId: 1,
    descriptionIds: [36],
    paragraphIds: [30, 5],
    dumpIds: [],
  }, { snapshot: SPAN_JUICED });
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(path.join(urlDir, '3_article.html'), 'utf8');
  assert.ok(html.includes('<pre data-idx="30"><code data-language="python" data-idx="31">print(1)</code></pre>'),
    `嵌套空壳 span 应塌缩为纯文本: ${html.slice(html.indexOf('<body'))}`);
  assert.ok(html.includes('background-color: rgb(255, 255, 0)'), '带 style 的 span 应保留');
  assert.ok(html.includes('data-idx="36"'), '保护集中的空壳 span（嵌在块内的 desc）应保留');
  assert.equal(out.slim.spansUnwrapped, 3, '应解包 3 层（32/33/34）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── 大产物分块（spec 2026-09-09）──

// 40 个 ~1.85KB 段落块 + h1 ≈ 74KB；阈值调 60KB 触发分割
const BIG_PARAS = Array.from({ length: 40 }, (_, i) =>
  `<p style="font-size: 16px" data-idx="${100 + i}">${'段'.repeat(600)}</p>`);
const BIG_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>大文章</title></head><body><h1 style="font-size: 32px" data-idx="1">标题</h1>${BIG_PARAS.join('')}</body></html>`;
const BIG_KEY_IDS = {
  titleId: 1,
  descriptionIds: [],
  paragraphIds: Array.from({ length: 40 }, (_, i) => 100 + i),
  dumpIds: [],
};

test('render_article.mjs: 超阈值分割——分块文件落盘 + emit chunks 契约', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-split', BIG_KEY_IDS, { snapshot: BIG_JUICED });
  const r = await runArticle(tmpRoot, { U2M_ARTICLE_SPLIT_THRESHOLD: '60000' });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.chunks.split, true);
  assert.ok(out.chunks.count >= 2, `应至少分 2 块: ${out.chunks.count}`);
  assert.equal(out.chunks.files.length, out.chunks.count);
  assert.ok(/3_article_chunk_1_of_\d+\.html$/.test(out.chunks.files[0]), 'files 应按块序（首文件为第 1 块）');
  // 3_article.html 照写（调试对照）；每块是完整独立文档
  assert.ok(fs.existsSync(path.join(urlDir, '3_article.html')));
  for (const f of out.chunks.files) {
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(html.startsWith('<!DOCTYPE html>'), `${f} 应为完整文档`);
    assert.ok(html.includes('<title>大文章</title>'));
    assert.ok(html.includes('<html lang="zh-CN">'));
    assert.ok(html.endsWith('</body></html>'));
  }
  // 全部段落块 id 恰出现一次于 own 区（各分块 own 并集 = 全集、互不重叠：
  // 以「每个 id 在所有文件中出现总次数 ≥1」宽松校验 + ✅/❌ 标记存在性）
  const all = out.chunks.files.map((f) => fs.readFileSync(f, 'utf8')).join('');
  for (const id of [1, 100, 139]) {
    assert.ok(all.includes(`data-idx="${id}"`), `id ${id} 应在某分块中`);
  }
  // ✅/❌ 每块恒在（2026-09-09 用户裁定：边界不随上下文侧有无而缺失）；
  // ⚠️下文在非末块照常就位（上下文不计预算）
  assert.ok(all.includes('✅ 待转换内容自此开始'), '✅ 每块恒在');
  assert.ok(all.includes('❌ 待转换内容自此结束'), '❌ 每块恒在');
  assert.ok(all.includes('⚠️ 下文上下文'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: 未分割——emit chunks 恒定形状 + 清另一模式旧分块', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-nosplit', {
    titleId: 1, descriptionIds: [], paragraphIds: [5, 6], dumpIds: [],
  }, { snapshot: JUICED });
  // 预置另一模式残留
  fs.writeFileSync(path.join(urlDir, '3_article_chunk_9_of_9.html'), '<html></html>');
  fs.writeFileSync(path.join(urlDir, '4_skeleton.json'), '[]');
  fs.writeFileSync(path.join(urlDir, '4_skeleton_chunk_1_of_2.json'), '[]');
  const r = await runArticle(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.chunks, { split: false, count: 1, files: [out.article] });
  // stale 清理：旧骨架（两种形态）与旧分块 html 全清
  assert.ok(!fs.existsSync(path.join(urlDir, '4_skeleton.json')), '应清 stale 4_skeleton.json');
  assert.ok(!fs.existsSync(path.join(urlDir, '4_skeleton_chunk_1_of_2.json')), '应清 stale 分片骨架');
  assert.ok(!fs.existsSync(path.join(urlDir, '3_article_chunk_9_of_9.html')), '未分割应清旧分块 html');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_article.mjs: 分割时清 stale 骨架与越界旧分块（X>N）', async () => {
  const { tmpRoot, urlDir } = setupTmp('chunk-stale', BIG_KEY_IDS, { snapshot: BIG_JUICED });
  fs.writeFileSync(path.join(urlDir, '4_skeleton.json'), '[]');
  fs.writeFileSync(path.join(urlDir, '3_article_chunk_9_of_9.html'), '<html></html>');
  const r = await runArticle(tmpRoot, { U2M_ARTICLE_SPLIT_THRESHOLD: '60000' });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.chunks.split);
  assert.ok(!fs.existsSync(path.join(urlDir, '4_skeleton.json')), '分割也应清 stale 单文件骨架');
  assert.ok(!fs.existsSync(path.join(urlDir, '3_article_chunk_9_of_9.html')), 'X>N 旧分块应清');
  for (const f of out.chunks.files) assert.ok(fs.existsSync(f));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
