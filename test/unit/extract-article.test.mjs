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

test('page-extract-article.js: 文件存在且包含 __u2mExtractArticle 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mExtractArticle'), '应定义 __u2mExtractArticle');
});

test('page-extract-article.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  const wrapped = `(${src})({titleIds:[1]})`;
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
