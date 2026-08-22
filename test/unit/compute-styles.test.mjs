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

// 模拟步骤 4 产物：<style> 规则 + 原有内联样式（含噪声声明）+ class + 文本/非文本元素
const EXTRACT = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>样式计算</title><style>.box{border:2px solid red;background-color:#f0f0f0}.plain{color:#333;font-weight:bold;font-family:Georgia}p{font-size:18px}</style></head><body><div class="box" style="margin:0;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased;font-style:normal;color:inherit" data-u2m-id="1"><p class="plain" data-u2m-id="2">文本</p><div data-u2m-id="3">默认文本</div><em style="font-style:italic" data-u2m-id="5">强调</em><span data-u2m-id="4"></span></div></body></html>`;

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
  assert.equal(out.styledCount, 2, '带内联样式的元素应为 2 个（1/2）');

  // 计算版已移除：不再产出
  assert.ok(!fs.existsSync(path.join(urlDir, '5_computed_styles.html')), '不应再产出计算版文件');
  assert.equal(out.computedStyles, undefined, 'emit 不应再含 computedStyles 字段');

  const juiced = fs.readFileSync(out.juiceStyles, 'utf8');

  // 终态：无 <style>、无 class，规则内联到元素（字面声明值）
  assert.ok(!juiced.includes('<style'), '不应含 <style> 标签');
  assert.ok(!juiced.includes('class='), '不应含 class 属性');
  assert.ok(juiced.includes('2px solid red'), '应内联边框规则');
  // 被清理过的元素经 CSSOM 重序列化，颜色归一为 rgb() 形式（语义等价）
  assert.ok(juiced.includes('rgb(240, 240, 240)'), '应内联背景规则');
  assert.ok(juiced.includes('font-weight: bold'), '应内联字重规则');
  assert.ok(juiced.includes('color: rgb(51, 51, 51)'), '应内联颜色规则');
  assert.ok(juiced.includes('font-size: 18px'), '应内联字号规则');
  assert.ok(juiced.includes('margin: 0'), '原有内联样式参与级联应保留');
  assert.ok(juiced.includes('data-u2m-id="2"'), 'data-u2m-id 应保留');

  // 噪声声明清理：font-family / -webkit- 前缀 / font-style（任意值）/ 值为 inherit
  assert.ok(!juiced.includes('font-family'), 'font-family 声明应删除');
  assert.ok(!juiced.includes('-webkit-'), '-webkit- 前缀声明应删除');
  assert.ok(!juiced.includes('font-style'), 'font-style 声明（含 italic）应删除');
  assert.ok(!juiced.includes('inherit'), '值为 inherit 的声明应删除');
  // 只剩噪声声明的元素（em 只写了 font-style:normal）：style 属性整体移除
  assert.ok(juiced.includes('<em data-u2m-id="5">'), '清空后不应残留 style 属性');

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
