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
  const wrapped = `(${src})({titleIds:[1]})`;
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

// 模拟步骤 5 产物：纯内联样式（无 class、无 <style>），
// key 元素挂在祖先骨架（10/11）下，flow 容器（4）含三个元素子节点
const JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试文章</title></head><body><div data-u2m-id="10"><main data-u2m-id="11"><h1 style="font-size: 32px; font-weight: bold" data-u2m-id="1">标题</h1><div style="color: rgb(102, 102, 102)" data-u2m-id="2">作者</div><div style="color: rgb(102, 102, 102)" data-u2m-id="3">日期</div></main><div style="margin: 0" data-u2m-id="4"><p style="font-size: 18px" data-u2m-id="5">段落一</p><figure data-u2m-id="6"><img src="x.png" data-u2m-id="7"></figure><p data-u2m-id="8">段落二</p></div></div></body></html>`;

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

test('extract_article.mjs: 分组顺序提取进新 body，骨架与 flow 容器不入，属性一字不动', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok', {
    titleIds: [1],
    descriptionIds: [2, 3],
    listFlowIds: [4],
  });
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.article, path.join(urlDir, '6_article.html'));
  assert.equal(out.elementCount, 6, '应提取 6 个元素（1 标题 + 2 说明 + 3 正文块）');

  const html = fs.readFileSync(out.article, 'utf8');

  // key 元素与 flow 子元素保留，属性与内容一字不动
  assert.ok(html.includes('<body style="max-width: 768px; margin: 4rem auto">'), 'body 应带居中布局内联样式');
  assert.ok(html.includes('<title>测试文章</title>'), '<title> 应保留');
  assert.ok(html.includes('<html lang="zh-CN">'), 'lang 应保留');
  assert.ok(html.includes('<h1 style="font-size: 32px; font-weight: bold" data-u2m-id="1">标题</h1>'));
  assert.ok(html.includes('<div style="color: rgb(102, 102, 102)" data-u2m-id="2">作者</div>'));
  assert.ok(html.includes('<p style="font-size: 18px" data-u2m-id="5">段落一</p>'));
  assert.ok(html.includes('<figure data-u2m-id="6"><img src="x.png" data-u2m-id="7"></figure>'), '子树应完整');
  assert.ok(html.includes('data-u2m-id="8">'));

  // 骨架与 flow 容器不入新 html
  for (const id of [4, 10, 11]) {
    assert.ok(!html.includes(`data-u2m-id="${id}"`), `id ${id} 应不入`);
  }

  // 分组顺序：1 → 2 → 3 → 5 → 6 → 8
  const order = [1, 2, 3, 5, 6, 8].map((id) => html.indexOf(`data-u2m-id="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `id 顺序应递增: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 同一元素既是 description 又是 flow 子元素时只出现一次', async () => {
  const dup = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>去重</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p style="color: red" data-u2m-id="2">作者行</p><p data-u2m-id="5">正文</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('dup', { titleIds: [1], descriptionIds: [2], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), dup);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.elementCount, 3, '去重后应只提取 3 个元素（1/2/5）');
  const html = fs.readFileSync(out.article, 'utf8');
  assert.equal((html.match(/data-u2m-id="2"/g) || []).length, 1, 'id 2 应只出现一次');
  assert.ok(html.includes('<p style="color: red" data-u2m-id="2">作者行</p>'), '属性应原样');
  assert.ok(!html.includes('data-u2m-id="4"'), 'flow 容器应不入');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: flow 内未包标签的非空白文本按文档序迁入', async () => {
  const bare = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>裸文本</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4">文本 1<p data-u2m-id="5">段落</p>文本 2<figure data-u2m-id="6">…</figure></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('bare', { titleIds: [1], descriptionIds: [], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), bare);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.elementCount, 3, '元素数应为 3（h1/p/figure），裸文本不计入');

  const html = fs.readFileSync(out.article, 'utf8');
  // 文本 1/文本 2 迁入，且与元素按文档序交错；flow 容器不入
  assert.ok(html.includes('<body style="max-width: 768px; margin: 4rem auto"><h1 data-u2m-id="1">标题</h1>文本 1<p data-u2m-id="5">段落</p>文本 2<figure data-u2m-id="6">…</figure></body>'),
    `body 应按文档序交错迁入裸文本: ${html.slice(html.indexOf('<body>'))}`);
  assert.ok(!html.includes('data-u2m-id="4"'), 'flow 容器应不入');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 纯空白文本与注释不迁入', async () => {
  const ws = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>空白</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"> <p data-u2m-id="5">段落</p><!--注--></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('ws', { titleIds: [1], descriptionIds: [], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), ws);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.elementCount, 2, '元素数应为 2（h1/p）');

  const html = fs.readFileSync(out.article, 'utf8');
  // 纯空白文本节点与注释被跳过，body 内元素直接相连，无 <!--注-->
  assert.ok(html.includes('<body style="max-width: 768px; margin: 4rem auto"><h1 data-u2m-id="1">标题</h1><p data-u2m-id="5">段落</p></body>'),
    `body 不应含空白或注释: ${html.slice(html.indexOf('<body>'))}`);
  assert.ok(!html.includes('<!--'), '注释不应迁入');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: listFlowDeleteIds 噪音为 flow 直接子元素时剔除', async () => {
  const noise = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>噪音</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">段落</p><div class="ad" data-u2m-id="9">广告</div><p data-u2m-id="10">尾段</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('del-child', { titleIds: [1], descriptionIds: [], listFlowIds: [4], listFlowDeleteIds: [9] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), noise);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 3, '应提取 3 个元素（h1/p5/p10），噪音已剔');
  assert.equal(out.removedNoiseCount, 1, '应报告剔除 1 个噪音');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(!html.includes('data-u2m-id="9"'), '噪音元素应不入文章视图');
  assert.ok(!html.includes('广告'), '噪音内容应不入文章视图');
  assert.ok(html.includes('<p data-u2m-id="5">段落</p>'), '噪音前的正文应保留');
  assert.ok(html.includes('<p data-u2m-id="10">尾段</p>'), '噪音后的正文应保留');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 噪音嵌在迁移子元素内部时整棵剔除、外层保留', async () => {
  const nested = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>嵌套噪音</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><section data-u2m-id="5"><p data-u2m-id="6">正文</p><div class="ad" data-u2m-id="9">广告<em data-u2m-id="99">词</em></div></section></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('del-nested', { titleIds: [1], descriptionIds: [], listFlowIds: [4], listFlowDeleteIds: [9] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), nested);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 2, '应提取 2 个元素（h1/section5），孙代噪音不计数');
  assert.equal(out.removedNoiseCount, 1);

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.includes('<section data-u2m-id="5">'), '噪音的外层容器应保留');
  assert.ok(html.includes('<p data-u2m-id="6">正文</p>'), '噪音兄弟正文应保留');
  assert.ok(!html.includes('data-u2m-id="9"'), '噪音子树根应剔除');
  assert.ok(!html.includes('data-u2m-id="99"'), '噪音后代应整棵剔除');
  assert.ok(!html.includes('广告'), '噪音内容应剔除');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 嵌套 listFlowIds 最外层优先——内层子节点跳过、结构保留、文档序不变', async () => {
  const nestedFlows = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>嵌套流</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><section data-u2m-id="5"><p data-u2m-id="6">正文</p><div data-u2m-id="7"><p data-u2m-id="8">小节正文</p></div></section><p data-u2m-id="10">尾段</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('nested-flows', { titleIds: [1], descriptionIds: [], listFlowIds: [4, 7], listFlowDeleteIds: [] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), nestedFlows);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 3, '应提取 3 个元素（h1/section5/p10），内层流子节点 8 随 5 整体带入不单列');

  const html = fs.readFileSync(out.article, 'utf8');
  // 内层流容器 7 连同其子元素 8 原样留在 section 5 内——不被拔出、不留空壳
  assert.ok(html.includes('<div data-u2m-id="7"><p data-u2m-id="8">小节正文</p></div>'),
    `内层流应整体保留在 section 内: ${html.slice(html.indexOf('<body>'))}`);
  assert.equal((html.match(/data-u2m-id="8"/g) || []).length, 1, 'id 8 应只出现一次');
  // 文档序：1 → 5 → 8（在 5 内）→ 10
  const order = [1, 5, 8, 10].map((id) => html.indexOf(`data-u2m-id="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `id 顺序应递增: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: listFlowIds 列表乱序时输出仍按文档序', async () => {
  const twoFlows = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>乱序流</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">前段</p></div><div data-u2m-id="7"><p data-u2m-id="8">后段</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('order', { titleIds: [1], descriptionIds: [], listFlowIds: [7, 4], listFlowDeleteIds: [] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), twoFlows);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 3, '应提取 3 个元素（h1/p5/p8）');

  const html = fs.readFileSync(out.article, 'utf8');
  assert.ok(html.indexOf('data-u2m-id="5"') < html.indexOf('data-u2m-id="8"'),
    `列表乱序不应打乱输出文档序: ${html.slice(html.indexOf('<body>'))}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: standaloneIds 游离内容各成一块、按文档序落位在流之间', async () => {
  const standalone = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>游离内容</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">前流段落</p></div><h2 data-u2m-id="6">流间小标题</h2><p data-u2m-id="7">流间引言</p><div data-u2m-id="8"><p data-u2m-id="9">后流段落</p></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('standalone', { titleIds: [1], descriptionIds: [], standaloneIds: [6, 7], listFlowIds: [4, 8], listFlowDeleteIds: [] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), standalone);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.elementCount, 5, '应提取 5 个元素（h1/p5/h2-6/p7/p9）');

  const html = fs.readFileSync(out.article, 'utf8');
  // 游离块落在两个流之间：1 → 5 → 6 → 7 → 9
  const order = [1, 5, 6, 7, 9].map((id) => html.indexOf(`data-u2m-id="${id}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `id 顺序应递增: ${order}`);
    assert.ok(order[i - 1] >= 0, '元素应存在');
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: standaloneIds 与 listFlowDeleteIds 重叠时报 error', async () => {
  const snap = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>重叠</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">段落</p><div class="ad" data-u2m-id="6">广告</div></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('standalone-overlap', { titleIds: [1], descriptionIds: [], standaloneIds: [6], listFlowIds: [4], listFlowDeleteIds: [6] });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), snap);
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('重叠'), `reason 应说明重叠: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: key id 未命中时报 error 并列出缺失 id', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', { titleIds: [1], descriptionIds: [99], listFlowIds: [4] });
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'test-article', '6_article.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: listFlowDeleteIds 未命中时报 error 且不写产物', async () => {
  const { tmpRoot, urlDir } = setupTmp('del-miss', { titleIds: [1], descriptionIds: [], listFlowIds: [4], listFlowDeleteIds: [99] });
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(urlDir, '6_article.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: listFlowDeleteIds 与 key id 重叠时报 error', async () => {
  const { tmpRoot } = setupTmp('del-overlap', { titleIds: [1], descriptionIds: [], listFlowIds: [4], listFlowDeleteIds: [1] });
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('listFlowDeleteIds'), `reason 应指向 listFlowDeleteIds: ${out.reason}`);
  assert.ok(out.reason.includes('重叠'), `reason 应说明重叠: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: listFlowIds 为空时报 error', async () => {
  const { tmpRoot, urlDir } = setupTmp('empty', { titleIds: [1], descriptionIds: [], listFlowIds: [] });
  const script = path.resolve('script/extract_article.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('listFlowIds'), `reason 应指向 listFlowIds: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_article.mjs: 缺步骤 5 产物 / 缺 key_ids 时报 error 并指路', async () => {
  const script = path.resolve('script/extract_article.mjs');

  const noJuiced = setupTmp('nojuice', { titleIds: [1], listFlowIds: [4] }, { withJuiced: false });
  const r1 = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: noJuiced.tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 5'));
  fs.rmSync(noJuiced.tmpRoot, { recursive: true, force: true });

  const noKeyIds = setupTmp('nokey', null);
  const r2 = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: noKeyIds.tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKeyIds.tmpRoot, { recursive: true, force: true });
});

// 瘦身规则① data-*：保留白名单 {data-u2m-id, data-language}（后者是
// 步骤 7 判代码围栏语言的机械信号），其余 data-*（组件库脚手架/交互
// 状态）全删——白名单而非黑名单，陌上站点的 data-* 安全默认删除
const DATASTAR_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>瘦身</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-variant="lead" data-u2m-id="5">段落<span data-color="accent" data-u2m-id="6">行内</span></p><code data-language="python" data-wrap-long-lines="false" data-u2m-id="7">print(1)</code></div></body></html>`;

test('extract_article.mjs: 瘦身规则①——data-* 只留 data-u2m-id 与 data-language', async () => {
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
    assert.ok(html.includes(`data-u2m-id="${id}"`), `id ${id} 应保留`);
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
// <math> 本身；无 annotation 保留原树。$…$ 单美元内联形式（与参考页
// 9_markdown 既有约定一致）。annotation 里的实体（&lt;）经 textContent
// 解码、序列化时重新转义
const MATH_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>公式</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">设 <span data-u2m-id="60"><span data-u2m-id="61"><math data-u2m-id="62"><semantics><mrow><mi>M</mi></mrow><annotation encoding="application/x-tex">M</annotation></semantics></math></span><span data-u2m-id="63"><span data-u2m-id="64">M</span></span></span> 为最小长度，</p><p data-u2m-id="8">裸公式 <math data-u2m-id="70"><semantics><mrow><mi>L</mi></mrow><annotation encoding="application/x-tex">L &lt; M</annotation></semantics></math> 成立，</p><p data-u2m-id="9">无源公式 <math data-u2m-id="80"><mrow><mi>x</mi></mrow></math> 保留。</p></div></body></html>`;

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
    assert.ok(!html.includes(`data-u2m-id="${id}"`), `katex 包装 id ${id} 应随整体替换消失`);
  }
  assert.ok(html.includes('裸公式 $L &lt; M$ 成立'), '裸 math 应替换为 LaTeX 文本');
  assert.ok(!html.includes('data-u2m-id="70"'), '裸 math 的 id 应消失');
  assert.ok(html.includes('<math data-u2m-id="80"'), '无 annotation 的 math 应保留原树');
  assert.equal(out.slim.mathReplaced, 2, '应替换 2 处（双胞胎整体 + 裸 math）');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// 瘦身规则③④：无文本/纯符号（/[\p{L}\p{N}]/u 不命中——⋮ 即此类）button
// 与无文本 svg 整删（随 button 删除的内部 svg 不重复计数）；有文本
// button（中文/字母数字）解包降级保留文本；保护集中的 button 不动
const BUTTON_JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>按钮</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5">正文</p><button data-u2m-id="20"><svg data-u2m-id="21"><path d="M0 0"/></svg></button><button data-u2m-id="22">⋮</button><svg data-u2m-id="28"><rect width="1"/></svg><button data-u2m-id="23">JavaScript</button><button data-u2m-id="24">查看答案</button></div></body></html>`;

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
    assert.ok(!html.includes(`data-u2m-id="${id}"`), `id ${id} 应删除`);
  }
  assert.ok(html.includes('data-u2m-id="23">JavaScript</button>'),
    '保护集中的 button 应原样保留（不解包）');
  assert.ok(!/<button[^>]*data-u2m-id="24"/.test(html), '有文本 button 应解包');
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
<html lang="zh-CN"><head><title>链接</title></head><body><h1 data-u2m-id="1">标题</h1><div data-u2m-id="4"><p data-u2m-id="5"><a href="codex://threads/new?prompt=%E6%8F%90%E7%A4%BA" data-u2m-id="30">深问</a>、<a href="https://example.com/a" data-u2m-id="31">正常链</a>、<a href="mailto:x@example.com" data-u2m-id="32">邮件</a>、<a href="javascript:void(0)" data-u2m-id="33">假链</a>、<a href="#anchor" data-u2m-id="34">锚点</a>。</p></div></body></html>`;

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
