import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');

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
  const script = path.resolve('script/compute_styles.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

// 模拟步骤 4 产物：<style> 规则 + 原有内联样式（结构化/盒模型几何/字体类混杂）+ class + 文本/非文本元素
const EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>样式计算</title><style>.box{border:2px solid red;background-color:#f0f0f0;box-shadow:0 2px 4px rgba(0,0,0,.1);text-align:center;overflow-x:auto;overflow-wrap:break-word;transform:translateY(2px)}.plain{color:#333;font-weight:bold;font-family:Georgia;letter-spacing:1px;line-height:1.6}p{font-size:18px}</style></head><body><div class="box" style="margin:0;padding:10px;width:100%;box-sizing:border-box;position:relative;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;font-style:normal;color:inherit" data-u2m-id="1"><p class="plain" data-u2m-id="2">文本</p><div style="display:flex;flex-direction:column;gap:8px;padding:12px" data-u2m-id="3">默认文本</div><em style="font-style:italic" data-u2m-id="5">强调</em><span style="color:#f00;background-color:#ffff00" data-u2m-id="4"></span></div></body></html>`;

function setupTmp(name, { withExtract = true } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-styles-${name}-`));
  const urlDir = path.join(tmpRoot, 'test-article');
  fs.mkdirSync(urlDir, { recursive: true });
  if (withExtract) {
    fs.writeFileSync(path.join(urlDir, '4_styled_extract.html'), EXTRACT);
  }
  return { tmpRoot, urlDir };
}

test('compute_styles.mjs: juice 内联并删净 <style> 与 class，只产一份文件', async () => {
  const { tmpRoot, urlDir } = setupTmp('ok');
  const script = path.resolve('script/compute_styles.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
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

test('compute_styles.mjs: 缺步骤 4 产物时报 error 指路步骤 4', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', { withExtract: false });
  const script = path.resolve('script/compute_styles.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 4'), `reason 应指路步骤 4: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
