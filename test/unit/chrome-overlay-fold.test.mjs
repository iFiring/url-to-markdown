// test/unit/chrome-overlay-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-ovl', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-ovl-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/snapshot.mjs'), '--url', url, '--from-snapshot'],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40); // 160 字符

test("H3': 非占优分支独子链上的可见 fixed 浮层折叠为 OVERLAY_TAG（知乎登录横幅形态）", async () => {
  // div3 文本 24/320=7.5% > 5% → D1 不删；div3 非脊柱 → 其层级不扫描；
  // div4 在独子链上（div3 是 body 直下、div4 是 div3 独子）→ H3' 接住
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}${BIG}</p></div>
<div data-idx="3">
  <div data-idx="4" style="position:fixed">登录知乎，问答干货一键收藏打开知乎App扫码下载</div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"') && r.cleaned.includes('{{OVERLAY_TAG|'),
      '链上可见 fixed 折叠');
    assert.ok(!r.cleaned.includes('登录知乎'), 'clean 子树清空');
    // styled 保活 = 壳存活 + 不折 chrome token + 原文可还原：24 字 ≥16 汉字阈值，
    // styled 趟该文本被既有 LT run 机制折为带编号占位入恢复清单（正常形态）
    assert.ok(r.styled.includes('data-idx="4"') && !r.styled.includes('OVERLAY_TAG'),
      'styled 壳存活、无 chrome token');
    const lt = JSON.parse(fs.readFileSync(r.out.longText, 'utf8'));
    assert.ok(r.styled.includes('登录知乎') || JSON.stringify(lt.runs).includes('登录知乎'),
      'styled 保活（原文或恢复清单可还原）');
  } finally { r.cleanup(); }
});

test("H3': 优先级 hidden > overlay；sticky 计入；off-chain 深处 fixed 不折", async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${'正'.repeat(100)}</p></div>
<div data-idx="3" class="hid" style="position:fixed">这是一个足够长的隐藏固定浮层文本超过百分之五</div>
<div data-idx="4" style="position:sticky;top:0">吸顶工具条文本足够长超过比例阈值百分之五</div>
<div data-idx="5">
  <div data-idx="6"><p data-idx="7">${BIG}</p></div>
  <div data-idx="8" style="position:fixed"><p data-idx="9">深处吸顶浮层文本超过比例阈值</p></div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|22_chars') && !r.cleaned.includes('隐藏固定浮层'),
      'hidden fixed（22 字/100=22% 逃 D1）→ HIDDEN_TAG（状态优先于位置）');
    assert.ok(r.cleaned.includes('{{OVERLAY_TAG|20_chars') && !r.cleaned.includes('吸顶工具条文本'),
      'body 直下 sticky 可见（20 字/100=20% 逃 D1）→ OVERLAY_TAG（H3 无 ratio 条件）');
    assert.ok(r.cleaned.includes('深处吸顶浮层'), 'off-chain 深处 fixed 不折（R2 红线）');
  } finally { r.cleanup(); }
});

test("H3': 守卫拦截——fixed 含 pre 不折", async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">代码演示浮层文本较长超过阈值<pre data-idx="4">x=1</pre></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), 'pre 守卫阻断');
    assert.ok(!r.cleaned.includes('OVERLAY_TAG'));
  } finally { r.cleanup(); }
});
