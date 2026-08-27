import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');
const scriptPath = path.resolve(thisDir, '../../script/compute_styles.mjs');

test('page-finalize-inline.js: 文件存在且包含 __u2mFinalizeInline 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mFinalizeInline'), '应定义 __u2mFinalizeInline');
});

test('page-finalize-inline.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('compute_styles.mjs: 无参数时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [scriptPath]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 4 产物：<style> 规则 + 原有内联样式（结构化/盒模型几何/字体类混杂）+ class + 文本/非文本元素
const EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>样式计算</title><style>.box{border:2px solid red;background-color:#f0f0f0;box-shadow:0 2px 4px rgba(0,0,0,.1);text-align:center;overflow-x:auto;overflow-wrap:break-word;transform:translateY(2px)}.plain{color:#333;font-weight:bold;font-family:Georgia;letter-spacing:1px;line-height:1.6}p{font-size:18px}</style></head><body><div class="box" style="margin:0;padding:10px;width:100%;box-sizing:border-box;position:relative;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;font-style:normal;color:inherit" data-u2m-id="1"><p class="plain" data-u2m-id="2">文本</p><div style="display:flex;flex-direction:column;gap:8px;padding:12px" data-u2m-id="3">默认文本</div><em style="font-style:italic" data-u2m-id="5">强调</em><span style="color:#f00;background-color:#ffff00" data-u2m-id="4"></span></div></body></html>`;

const URL = 'https://example.com/test-article';

function setupTmp(name, { withExtract = true, extractHtml = EXTRACT } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-styles-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (withExtract) {
    fs.writeFileSync(path.join(urlDir, '4_styled_extract.html'), extractHtml);
  }
  return { tmpRoot, urlDir };
}

test('compute_styles.mjs: juice 内联并删净 <style> 与 class，只产一份文件', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok');
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.juiceStyles, path.join(urlDir, '5_juice_styles.html'));
  assert.equal(out.styledCount, 4, '带内联样式的元素应为 4 个（div 1 / p 2 / div 3 / span 4）');

  // 计算版已移除：不再产出
  assert.ok(!fs.existsSync(path.join(urlDir, '5_computed_styles.html')), '不应再产出计算版文件');
  assert.equal(out.computedStyles, undefined, 'emit 不应再含 computedStyles 字段');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');

  // 终态：无 <style>、无 class，规则内联到元素（字面声明值）
  assert.ok(!juiced.includes('<style'), '不应含 <style> 标签');
  assert.ok(!juiced.includes('class='), '不应含 class 属性');

  // 结构化样式保留：边框背景 / box-shadow / flex·grid 布局
  assert.ok(juiced.includes('2px solid red'), '应保留边框规则');
  // 被清理过的元素经 CSSOM 重序列化，颜色归一为 rgb() 形式（语义等价）
  assert.ok(juiced.includes('rgb(240, 240, 240)'), '应保留背景色规则');
  assert.ok(juiced.includes('box-shadow'), '应保留 box-shadow');
  assert.ok(juiced.includes('display: flex'), 'flex 布局的 display 应保留');
  assert.ok(juiced.includes('flex-direction'), 'flex 布局属性应保留');
  assert.ok(juiced.includes('gap: 8px'), 'flex/grid 的 gap 应保留');
  assert.ok(juiced.includes('overflow-x'), 'overflow（块级滚动裁剪）应保留');
  assert.ok(juiced.includes('translateY(2px)'), 'transform 声明应保留');
  // 白名单按属性判定而非按元素：行内元素（高亮 span）的背景同样保留
  assert.ok(juiced.includes('rgb(255, 255, 0)'), 'span 的背景色应保留');
  assert.ok(juiced.includes('data-u2m-id="2"'), 'data-u2m-id 应保留');

  // 字体类仅保留 font-size / font-weight（步骤 7 判标题层级的信号）
  assert.ok(juiced.includes('font-size: 18px'), 'font-size 声明应保留');
  assert.ok(juiced.includes('font-weight: bold'), 'font-weight 声明应保留');

  // 盒模型几何与定位全删：margin / padding / 宽高 / box-sizing / position
  assert.ok(!juiced.includes('margin'), 'margin 声明应删除');
  assert.ok(!juiced.includes('padding'), 'padding 声明应删除');
  assert.ok(!juiced.includes('width'), 'width 声明应删除');
  assert.ok(!juiced.includes('box-sizing'), 'box-sizing 声明应删除');
  assert.ok(!juiced.includes('position'), 'position 声明应删除');

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
  assert.ok(juiced.includes('<em data-u2m-id="5">'), 'em 仅 font-style，清空后不应残留 style 属性');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// img 宽高例外：白名单唯一的元素级例外——<img> 的 width/height 保留
// （步骤 7 LLM 判图片权重的语义信号：小图标 / 大图 / 图片组），其余规则
// 不变：img 的 margin 照删、其他元素的宽高照删
const IMG_SIZE_EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>img 宽高</title><style>body{transition:opacity .2s}</style></head><body><figure data-u2m-id="1"><img src="https://example.com/a/pic.png" style="width:120px;height:80px;margin:10px" data-u2m-id="2"><figcaption data-u2m-id="3">图注</figcaption></figure><div style="width:100%;height:40px;border:1px solid black" data-u2m-id="4">文本</div></body></html>`;

test('compute_styles.mjs: img 的 style 宽高保留（步骤 7 语义信号），其余元素宽高仍删', async () => {
  const { tmpRoot } = setupTmp('img-size', { extractHtml: IMG_SIZE_EXTRACT });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');
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
<html lang="zh-CN"><head><title>实体引号</title><style>body{transition:opacity .2s}</style></head><body style="font-family: Optima, &quot;Microsoft YaHei&quot;, serif; border: 1px solid black; margin: 10px"><div data-u2m-id="1">文本</div></body></html>`;

test('compute_styles.mjs: 行内 style 属性含 &quot; 实体引号时不再崩溃', async () => {
  const { tmpRoot } = setupTmp('entity', { extractHtml: ENTITY_EXTRACT });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');
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
<html lang="zh-CN"><head><title>混排引号</title><style>body{transition:opacity .2s}</style></head><body style="font-family: 'a&quot;b', serif; border: 1px solid black; margin: 10px"><div style="font-family: &quot;D'Nealian&quot;, serif; outline: 1px solid blue" data-u2m-id="1">文本</div></body></html>`;

test('compute_styles.mjs: 引号混排（字面单引号 × 实体双引号 × 实体内撇号）不再崩溃', async () => {
  const { tmpRoot } = setupTmp('mixed-quote', { extractHtml: MIXED_QUOTE_EXTRACT });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');
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
<html lang="zh-CN"><head><title>data-style</title><style>body{transition:opacity .2s}</style></head><body><div data-style="{&quot;theme&quot;:&quot;dark&quot;}" style="border: 1px solid black" data-u2m-id="1">文本</div></body></html>`;

test('compute_styles.mjs: data-style 等后缀属性不被引号处理波及', async () => {
  const { tmpRoot } = setupTmp('data-style', { extractHtml: DATA_STYLE_EXTRACT });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');
  assert.ok(juiced.includes('1px solid'), 'style 属性的 border 应保留');
  // data-style 原样存活：实体不被解码（outerHTML 序列化仍以 &quot; 表达）
  assert.ok(juiced.includes('data-style='), 'data-style 属性应保留');
  assert.ok(juiced.includes('&quot;theme&quot;'), 'data-style 值内的引号实体应原样保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('compute_styles.mjs: 缺步骤 4 产物时报 error 指路步骤 4', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', { withExtract: false });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 4'), `reason 应指路步骤 4: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
