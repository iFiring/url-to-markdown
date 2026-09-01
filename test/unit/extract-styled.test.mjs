import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-extract-styled.js');

test('page-extract-styled.js: 文件存在且包含 __u2mExtractStyled 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mExtractStyled'), '应定义 __u2mExtractStyled');
});

test('page-extract-styled.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  const wrapped = `(${src})({titleId:null,descriptionIds:[],blockIds:[1],dumpIds:[]})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('extract_styled.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/extract_styled.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 2 带样式版快照：style 属性 + head/body 两处 <style> + 噪声分支。
// [8] 为段落流内的 dump（toc 导航，内含 <style>），[14]/[16] 为流外噪音分支
const STYLED_SNAPSHOT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试页</title><style>.hero{color:red}</style></head><body><div class="main" data-idx="1"><header class="hero" style="margin:0" data-idx="2"><h1 data-idx="3">标题</h1><p data-idx="4">作者 日期</p></header><section class="content" style="padding:10px" data-idx="5"><p data-idx="6">段落一</p><div style="border:1px solid" data-idx="7">图容器<span data-idx="71">内嵌</span></div><nav class="toc" id="nav-toc" data-idx="8" role="navigation" aria-label="目录"><style>.deep{color:blue}</style><p data-idx="9">推荐阅读</p></nav><div class="chapter" data-idx="10"><h3 data-idx="11">章节标题</h3><p data-idx="12">段落二</p><ul data-idx="13"><li data-idx="131">条目</li></ul></div></section></div><div class="ads" data-idx="14"><p data-idx="15">广告</p></div><nav class="breadcrumb" data-idx="16"><p data-idx="17">面包屑</p></nav></body></html>`;

const URL = 'https://example.com/test-article';

function setupTmp(name, keyIds, { withSnapshot = true, snapshot = STYLED_SNAPSHOT } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-extract-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (withSnapshot) {
    fs.writeFileSync(path.join(urlDir, '2_clean_style_snapshot.html'), snapshot);
  }
  if (keyIds !== null) {
    fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(keyIds));
  }
  return { tmpRoot, urlDir };
}

async function runExtract(tmpRoot) {
  const script = path.resolve('script/extract_styled.mjs');
  return runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
}

test('extract_styled.mjs: 四键裁剪——块子树+骨架链一字不动，dump 折叠空壳，流外噪音删除', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok', {
    titleId: 3,
    descriptionIds: [4],
    paragraphIds: [6, 7, [11, 12, 13]],
    dumpIds: [8],
  });
  const r = await runExtract(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.styledExtract, path.join(urlDir, '4_styled_extract.html'));
  assert.equal(out.removedCount, 5, '应删除 5 个元素（9/14/15/16/17）');
  assert.equal(out.dumpCollapsedCount, 1, '应折叠 1 个 dump（8）');

  const html = fs.readFileSync(out.styledExtract, 'utf8');

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

test('extract_styled.mjs: titleId 为 null 时正常；流外游离块为顶层标量、嵌套数组展开', async () => {
  const snap = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>游离</title></head><body><div class="wrap" data-idx="1"><h2 data-idx="2">流外标题</h2><p data-idx="3">流外引言文本<em data-idx="31">强调</em></p><section data-idx="4"><p data-idx="5">段落一</p></section><aside class="ad" data-idx="6">广告</aside></div></body></html>`;
  const { tmpRoot } = setupTmp('standalone', {
    titleId: null,
    descriptionIds: [3],
    paragraphIds: [2, [5]],
    dumpIds: [],
  }, { snapshot: snap });
  const r = await runExtract(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.dumpCollapsedCount, 0);

  const html = fs.readFileSync(out.styledExtract, 'utf8');
  for (const id of [1, 2, 3, 31, 4, 5]) {
    assert.ok(html.includes(`data-idx="${id}"`), `id ${id} 应保留`);
  }
  assert.ok(!html.includes('data-idx="6"'), '同层噪音应删除');
  assert.ok(!html.includes('广告'));
  assert.ok(html.includes('流外引言文本<em'), 'description 子树应原样保留');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: dump 落在保留区外——随分支删除、不报错不计数', async () => {
  const { tmpRoot } = setupTmp('outside', {
    titleId: 3,
    descriptionIds: [4],
    paragraphIds: [6],
    dumpIds: [17],
  });
  const r = await runExtract(tmpRoot);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.dumpCollapsedCount, 0, '保留区外的 dump 不折叠');
  const html = fs.readFileSync(out.styledExtract, 'utf8');
  assert.ok(html.includes('data-idx="6"'));
  assert.ok(!html.includes('data-idx="17"'));
  assert.ok(!html.includes('data-idx="16"'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: dump 是 key 元素祖先时报 error（折叠会摧毁 key 子树）', async () => {
  const { tmpRoot, urlDir } = setupTmp('conflict', {
    titleId: null,
    descriptionIds: [],
    paragraphIds: [6],
    dumpIds: [5],
  });
  const r = await runExtract(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('冲突'), `reason 应说明冲突: ${out.reason}`);
  assert.ok(out.reason.includes('5'), `reason 应含 dump id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(urlDir, '4_styled_extract.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: key id 未命中时报 error 并列出缺失 id', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', {
    titleId: 3,
    descriptionIds: [99],
    paragraphIds: [6],
    dumpIds: [],
  });
  const r = await runExtract(tmpRoot);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(urlDir, '4_styled_extract.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: paragraphIds 为空或含非法成员时报 error', async () => {
  const empty = setupTmp('empty', { titleId: 3, descriptionIds: [], paragraphIds: [], dumpIds: [] });
  const r1 = await runExtract(empty.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('paragraphIds'), `reason 应指向 paragraphIds: ${JSON.parse(r1.stdout).reason}`);
  fs.rmSync(empty.tmpRoot, { recursive: true, force: true });

  const bad = setupTmp('badmember', { titleId: 3, descriptionIds: [], paragraphIds: [6, 'x'], dumpIds: [] });
  const r2 = await runExtract(bad.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('非法'), `reason 应指出非法成员: ${JSON.parse(r2.stdout).reason}`);
  fs.rmSync(bad.tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: 四键标记重叠时报 error', async () => {
  // titleId 与 descriptionIds 重叠：仍互不相交（title/desc ∩ paragraphIds 已允许，见 key-ids 单测）
  const a = setupTmp('overlap1', { titleId: 3, descriptionIds: [3], paragraphIds: [6, 7], dumpIds: [] });
  const r1 = await runExtract(a.tmpRoot);
  assert.equal(r1.code, 1);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.status, 'error');
  assert.ok(out1.reason.includes('重叠'), `reason 应说明重叠: ${out1.reason}`);
  fs.rmSync(a.tmpRoot, { recursive: true, force: true });

  const b = setupTmp('overlap2', { titleId: null, descriptionIds: [], paragraphIds: [6], dumpIds: [6] });
  const r2 = await runExtract(b.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('重叠'));
  fs.rmSync(b.tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: 缺快照 / 缺 key_ids 时报 error 并指路', async () => {
  const noSnapshot = setupTmp('nosnap', { titleId: 3, descriptionIds: [], paragraphIds: [6], dumpIds: [] }, { withSnapshot: false });
  const r1 = await runExtract(noSnapshot.tmpRoot);
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 2'));
  fs.rmSync(noSnapshot.tmpRoot, { recursive: true, force: true });

  const noKeyIds = setupTmp('nokey', null);
  const r2 = await runExtract(noKeyIds.tmpRoot);
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKeyIds.tmpRoot, { recursive: true, force: true });
});
