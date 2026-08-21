import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pageScriptPath = path.resolve(thisDir, '../../script/lib/page-compute-styles.js');

test('page-compute-styles.js: 文件存在且包含 __u2mComputeStyles 函数', () => {
  const src = fs.readFileSync(pageScriptPath, 'utf8');
  assert.ok(src.includes('function __u2mComputeStyles'), '应定义 __u2mComputeStyles');
});

test('page-compute-styles.js: 函数可被 evaluate 格式调用', () => {
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

// 模拟步骤 3.1 产物：<style> 规则 + 原有内联样式 + class + 文本/非文本元素
const EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>样式计算</title><style>.box{border:2px solid red;background-color:#f0f0f0}.plain{color:#333;font-weight:bold}p{font-size:18px}</style></head><body><div class="box" style="margin:0" data-u2m-id="1"><p class="plain" data-u2m-id="2">文本</p><div data-u2m-id="3">默认文本</div><span data-u2m-id="4"></span></div></body></html>`;

function setupTmp(name, { withExtract = true } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-styles-${name}-`));
  const urlDir = path.join(tmpRoot, 'test-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });
  if (withExtract) {
    fs.writeFileSync(path.join(stepsDir, '3.1_styled_extract.html'), EXTRACT);
  }
  return { tmpRoot, urlDir, stepsDir };
}

test('compute_styles.mjs: 计算版/juice 版各自内联并删净 <style> 与 class', async () => {
  const { tmpRoot, urlDir, stepsDir } = setupTmp('ok');
  const script = path.resolve('script/compute_styles.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.computedStyles, path.join(stepsDir, '3.2_computed_styles.html'));
  assert.equal(out.juiceStyles, path.join(stepsDir, '3.2_juice_styles.html'));
  assert.equal(out.styledCount, 3, '有目标属性的元素应为 3 个（1/2/3）');

  const computed = fs.readFileSync(out.computedStyles, 'utf8');
  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');

  // --- 计算版：终态为纯内联 ---
  assert.ok(!computed.includes('<style'), '计算版不应含 <style> 标签');
  assert.ok(!computed.includes('class='), '计算版不应含 class 属性');

  // id1（box）：border 三属性 × 4 边 + 背景色；原有 margin 内联被替换掉
  assert.ok(computed.includes('border-top-width: 2px'), '应有计算边框宽度');
  assert.ok(computed.includes('border-top-style: solid'), '应有计算边框样式');
  assert.ok(computed.includes('border-top-color: rgb(255, 0, 0)'), '应有计算边框颜色');
  assert.ok(computed.includes('background-color: rgb(240, 240, 240)'), '应有计算背景色');
  assert.ok(!computed.includes('margin'), '原有内联 margin 不应保留');

  // id2（文本元素）：字号/字重/颜色（#333 → rgb）
  assert.ok(computed.includes('font-size: 18px'), '应有计算字号');
  assert.ok(computed.includes('font-weight: 700'), 'bold 应计算为 700');
  assert.ok(computed.includes('color: rgb(51, 51, 51)'), '应有计算颜色');

  // id3（默认样式文本）：字号/字重有，黑色 color 不写
  assert.ok(computed.includes('font-weight: 400'), '默认字重应写为 400');
  assert.ok(!computed.includes('color: rgb(0, 0, 0)'), '黑色文本 color 不应写入');
  assert.ok(!computed.includes('background-color: rgba(0, 0, 0, 0)'), '透明背景不应写入');
  assert.ok(!computed.includes('border-top-style: none'), 'none 边框不应写入');

  // id4（空 span，无任何目标属性）：不应有 style 属性
  assert.ok(computed.includes('<span data-u2m-id="4">'), '空元素不应带 style 属性');

  // 非 text 容器（id1 无直接文本）：不应有字体属性
  const m = computed.match(/<div[^>]*data-u2m-id="1"[^>]*>/);
  assert.ok(m, 'id1 开标签应存在');
  assert.ok(!m[0].includes('font-size'), '无直接文本的容器不应有字体属性');

  // --- juice 版：规则内联到元素，<style>/class 删净 ---
  assert.ok(!juiced.includes('<style'), 'juice 版不应含 <style> 标签');
  assert.ok(!juiced.includes('class='), 'juice 版不应含 class 属性');
  assert.ok(juiced.includes('2px solid red'), 'juice 应内联边框规则（字面值）');
  assert.ok(juiced.includes('#f0f0f0'), 'juice 应内联背景规则（字面值）');
  assert.ok(juiced.includes('font-weight: bold'), 'juice 应内联字重规则');
  assert.ok(juiced.includes('color: #333'), 'juice 应内联颜色规则');
  assert.ok(juiced.includes('font-size: 18px'), 'juice 应内联字号规则');
  assert.ok(juiced.includes('margin: 0'), 'juice 版原有内联样式参与级联应保留');
  assert.ok(juiced.includes('data-u2m-id="2"'), 'data-u2m-id 应保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('compute_styles.mjs: 缺 3.1 产物时报 error 指路步骤 3.1', async () => {
  const { tmpRoot, urlDir } = setupTmp('miss', { withExtract: false });
  const script = path.resolve('script/compute_styles.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 3.1'), `reason 应指路步骤 3.1: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
