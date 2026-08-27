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
  const wrapped = `(${src})({titleIds:[1]})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('extract_styled.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/extract_styled.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 2 带样式版快照：style 属性 + head/body 两处 <style> + 噪声分支
const STYLED_SNAPSHOT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试页</title><style>.hero{color:red}</style></head><body><div class="main" data-u2m-id="1"><header class="hero" style="margin:0" data-u2m-id="2"><h1 data-u2m-id="3">标题</h1><p data-u2m-id="4">作者 日期</p></header><section class="content" style="padding:10px" data-u2m-id="5"><p data-u2m-id="6">段落一</p><div style="border:1px solid" data-u2m-id="7">图容器</div></section><aside class="noise" data-u2m-id="8"><style>.deep{color:blue}</style><p data-u2m-id="9">推荐阅读</p></aside></div><div class="ads" data-u2m-id="10"><p data-u2m-id="11">广告</p></div></body></html>`;

const URL = 'https://example.com/test-article';

function setupTmp(name, keyIds, { withSnapshot = true } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-extract-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (withSnapshot) {
    fs.writeFileSync(path.join(urlDir, '2_clean_style_snapshot.html'), STYLED_SNAPSHOT);
  }
  if (keyIds !== null) {
    fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(keyIds));
  }
  return { tmpRoot, urlDir };
}

test('extract_styled.mjs: 保留 key 子树+骨架链与属性，删噪声，body style 挪 head', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok', {
    titleIds: [3],
    descriptionIds: [4],
    listFlowIds: [5],
  });
  const script = path.resolve('script/extract_styled.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.removedCount, 4, '应删除 4 个噪声元素（8/9/10/11）');
  assert.equal(out.styledExtract, path.join(urlDir, '4_styled_extract.html'));

  const html = fs.readFileSync(out.styledExtract, 'utf8');

  // key 子树 + 祖先链保留，属性一字不动
  for (const id of [1, 2, 3, 4, 5, 6, 7]) {
    assert.ok(html.includes(`data-u2m-id="${id}"`), `id ${id} 应保留`);
  }
  assert.ok(html.includes('class="main"'), '骨架链属性应保留');
  assert.ok(html.includes('class="hero"'));
  assert.ok(html.includes('style="margin:0"'), 'key 区域 style 属性应原样保留');
  assert.ok(html.includes('style="padding:10px"'));
  assert.ok(html.includes('style="border:1px solid"'));

  // 噪声分支删除
  for (const id of [8, 9, 10, 11]) {
    assert.ok(!html.includes(`data-u2m-id="${id}"`), `id ${id} 应删除`);
  }
  assert.ok(!html.includes('推荐阅读'), '噪声文本应删除');
  assert.ok(!html.includes('广告'), '噪声文本应删除');
  assert.ok(!html.includes('class="noise"'));
  assert.ok(!html.includes('class="ads"'));

  // <title> 与全部 <style> 保留，且 body 分支的 <style> 已挪入 head
  assert.ok(html.includes('<title>'), '<title> 应保留');
  const headEnd = html.indexOf('</head>');
  const headPart = html.slice(0, headEnd);
  const bodyPart = html.slice(headEnd);
  assert.equal((headPart.match(/<style/g) || []).length, 2, 'head 应含 2 个 <style>（原 1 + 挪入 1）');
  assert.equal((bodyPart.match(/<style/g) || []).length, 0, 'body 不应残留 <style>');
  assert.ok(html.includes('.deep{color:blue}'), 'body 分支的样式规则应保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: standaloneIds 游离内容子树保留、同层噪音裁掉', async () => {
  const snap = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>游离</title></head><body><div class="wrap" data-u2m-id="1"><h2 data-u2m-id="2">流外标题</h2><p data-u2m-id="3">流外引言文本<em data-u2m-id="31">强调</em></p><section data-u2m-id="4"><p data-u2m-id="5">段落一</p></section><aside class="ad" data-u2m-id="6">广告</aside></div></body></html>`;
  const { tmpRoot, urlDir } = setupTmp('standalone', { titleIds: [], descriptionIds: [], standaloneIds: [2, 3], listFlowIds: [4] });
  fs.writeFileSync(path.join(urlDir, '2_clean_style_snapshot.html'), snap);
  const script = path.resolve('script/extract_styled.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const html = fs.readFileSync(out.styledExtract, 'utf8');
  // 游离元素子树（含后代 31）+ 祖先链 1 + 流 4/5 保留；同层噪音 6 裁掉
  for (const id of [1, 2, 3, 31, 4, 5]) {
    assert.ok(html.includes(`data-u2m-id="${id}"`), `id ${id} 应保留`);
  }
  assert.ok(!html.includes('data-u2m-id="6"'), '噪音应删除');
  assert.ok(!html.includes('广告'), '噪音文本应删除');
  assert.ok(html.includes('流外引言文本<em'), '游离元素后代应原样保留');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: key id 未命中时报 error 并列出缺失 id', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', { titleIds: [3], descriptionIds: [99], listFlowIds: [5] });
  const script = path.resolve('script/extract_styled.mjs');
  const r = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('99'), `reason 应含缺失 id: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, 'test-article', '4_styled_extract.html')), '失败不应写产物');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('extract_styled.mjs: listFlowIds 为空时报 error', async () => {
  const { tmpRoot, urlDir } = setupTmp('empty', { titleIds: [3], descriptionIds: [], listFlowIds: [] });
  const script = path.resolve('script/extract_styled.mjs');
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

test('extract_styled.mjs: 缺快照 / 缺 key_ids 时报 error 并指路', async () => {
  const script = path.resolve('script/extract_styled.mjs');

  const noSnapshot = setupTmp('nosnap', { titleIds: [3], listFlowIds: [5] }, { withSnapshot: false });
  const r1 = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: noSnapshot.tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 2'));
  fs.rmSync(noSnapshot.tmpRoot, { recursive: true, force: true });

  const noKeyIds = setupTmp('nokey', null);
  const r2 = await runScript(process.execPath, [script, '--url', URL], {
    env: { U2M_WORKING_ROOT: noKeyIds.tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 3'));
  fs.rmSync(noKeyIds.tmpRoot, { recursive: true, force: true });
});
