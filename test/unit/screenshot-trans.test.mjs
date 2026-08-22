import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-resolve-placeholders.js');

test('page-resolve-placeholders.js: 文件存在且包含 __u2mResolvePlaceholders 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mResolvePlaceholders'), '应定义 __u2mResolvePlaceholders');
});

test('page-resolve-placeholders.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  const wrapped = `(${src})({"1": "ok"})`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('screenshot_trans.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 步骤 6 产物：body 768px 居中；trans2img 元素含占位符
const ARTICLE = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>测试</title></head><body style="max-width: 768px; margin: 4rem auto">
<h1 data-u2m-id="1">标题</h1>
<p data-u2m-id="2">{{LONG_TEXT_5|10_chars}}</p>
<div data-u2m-id="10" style="background-color: rgb(240, 240, 240); border: 1px solid rgb(200, 200, 200); padding: 16px">
<div data-u2m-id="11" style="background-color: rgb(255, 255, 255); padding: 8px">
<span data-u2m-id="12">{{LONG_TEXT_6|8_chars}}</span>
</div>
</div>
<p data-u2m-id="20">{{LONG_TEXT_8|10_chars}}</p>
</body></html>`;

const SKELETON = [
  { h1: '标题' },
  { p: '{{LONG_TEXT_5}}' },
  { trans2img: '10' },
  { p: '{{LONG_TEXT_8}}' },
];

const LONG_TEXT = {
  '5': '段落一文本内容',
  '6': '重要内容',
  '8': '段落二文本内容',
};

function setupTmp(name, { article = ARTICLE, skeleton = SKELETON, longText = LONG_TEXT } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-sstrans-${name}-`));
  const urlDir = path.join(tmpRoot, 'test-sstrans');
  const assetsDir = path.join(urlDir, 'assets');
  fs.mkdirSync(urlDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  if (article !== null) fs.writeFileSync(path.join(urlDir, '6_article.html'), article);
  if (skeleton !== null) fs.writeFileSync(path.join(urlDir, '7_skeleton.json'), JSON.stringify(skeleton));
  if (longText !== null) fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify(longText));
  return { tmpRoot, urlDir, assetsDir };
}

test('screenshot_trans.mjs: 正常截图 + 占位符还原 + resolved skeleton', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('ok');
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.count, 1, '应截图 1 个元素');
  assert.equal(out.replaced, 3, '应替换全文档 3 个占位符（含 trans 子树内外）');
  assert.equal(out.resolvedSkeleton, path.join(urlDir, '8_resolved_skeleton.json'));

  // 截图文件存在且非空
  const imgPath = path.join(assetsDir, 'trans', '10.webp');
  assert.ok(fs.existsSync(imgPath), `截图应存在: ${imgPath}`);
  const stat = fs.statSync(imgPath);
  assert.ok(stat.size > 100, `截图应非空: ${stat.size} bytes`);

  // 确认是 WebP（RIFF....WEBP 文件头）
  const buf = fs.readFileSync(imgPath);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', 'WebP RIFF header');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', 'WebP WEBP signature');

  // resolved skeleton：占位符全部还原，trans2img 保留
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [
    { h1: '标题' },
    { p: '段落一文本内容' },
    { trans2img: '10' },
    { p: '段落二文本内容' },
  ], 'resolved skeleton 应还原所有占位符并保留 trans2img 条目');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 无 trans2img 条目时 skipped 但仍输出 resolved skeleton', async () => {
  const { tmpRoot, urlDir, assetsDir } = setupTmp('skip', {
    skeleton: [{ h1: '标题' }, { p: '{{LONG_TEXT_5}}' }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.skipped, 'no_trans2img');
  assert.ok(!fs.existsSync(path.join(assetsDir, 'trans')), 'skipped 不应创建 trans 目录');

  // skipped 路径也应写出 resolved skeleton
  const resolved = JSON.parse(fs.readFileSync(path.join(urlDir, '8_resolved_skeleton.json'), 'utf8'));
  assert.deepEqual(resolved, [
    { h1: '标题' },
    { p: '段落一文本内容' },
  ], 'skipped 路径也应还原占位符');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: DOM 缺 id 时报 error', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', {
    skeleton: [{ trans2img: '999' }],
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('999'), `reason 应含缺失 id: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 占位符引用未定义编号时报 error', async () => {
  const { tmpRoot, urlDir } = setupTmp('badref', {
    article: `<!DOCTYPE html><html><head><title>t</title></head><body style="max-width: 768px"><div data-u2m-id="10"><span>{{LONG_TEXT_999|3_chars}}</span></div></body></html>`,
    skeleton: [{ trans2img: '10' }],
    longText: { '5': '其他文本' },
  });
  const script = path.resolve('script/screenshot_trans.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('999'), `reason 应含未定义编号: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('screenshot_trans.mjs: 缺前置产物时报 error', async () => {
  const script = path.resolve('script/screenshot_trans.mjs');

  // 缺步骤 6
  const noArt = setupTmp('noart', { article: null });
  const r1 = await runScript(process.execPath, [script, noArt.urlDir], {
    env: { U2M_WORKING_ROOT: noArt.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r1.code, 1);
  assert.ok(JSON.parse(r1.stdout).reason.includes('步骤 6'));
  fs.rmSync(noArt.tmpRoot, { recursive: true, force: true });

  // 缺步骤 7
  const noSkel = setupTmp('noskel', { skeleton: null });
  const r2 = await runScript(process.execPath, [script, noSkel.urlDir], {
    env: { U2M_WORKING_ROOT: noSkel.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(r2.stdout).reason.includes('步骤 7'));
  fs.rmSync(noSkel.tmpRoot, { recursive: true, force: true });

  // 缺 2_long_text.json
  const noLt = setupTmp('nolt', { longText: null });
  const r3 = await runScript(process.execPath, [script, noLt.urlDir], {
    env: { U2M_WORKING_ROOT: noLt.tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r3.code, 1);
  assert.ok(JSON.parse(r3.stdout).reason.includes('步骤 2'));
  fs.rmSync(noLt.tmpRoot, { recursive: true, force: true });
});
