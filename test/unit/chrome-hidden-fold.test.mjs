// test/unit/chrome-hidden-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-hid', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-hid-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/snapshot.mjs'), '--url', url, '--from-snapshot'],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const res = {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    tablesJson: JSON.parse(fs.readFileSync(out.tablesJson, 'utf8')),
    codesJson: JSON.parse(fs.readFileSync(out.codeJson, 'utf8')),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
  return res;
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}.vh{visibility:hidden}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40);

test('H1-C: body 直下 css-hidden（有兄弟）折叠为 HIDDEN_TAG，styled 保活', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p></div>
<div data-idx="4" class="hid"><div data-idx="5">弹窗内部</div></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), '壳保留（data-idx 可引用）');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|4_chars'), 'token 带占位前原文规模');
    assert.ok(!r.cleaned.includes('data-idx="5"') && !r.cleaned.includes('弹窗内部'), '子树清空');
    assert.ok(r.styled.includes('data-idx="5"') && r.styled.includes('弹窗内部'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H1-C: 独子链下探折叠（body>div>section[hidden]>div+header 检测到 section 为止）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3"><section data-idx="4" class="hid"><div data-idx="5">菜单</div><header data-idx="6">页头</header></section></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"') && r.cleaned.includes('{{HIDDEN_TAG|'), 'section 壳折叠');
    assert.ok(!r.cleaned.includes('data-idx="5"') && !r.cleaned.includes('data-idx="6"'), 'section 内部随折吞没');
    assert.ok(r.styled.includes('data-idx="6"'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H1-C 红线: 分叉后深处 hidden 不折（非激活 tab/FAQ 收起内容保活）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><div data-idx="2"><p data-idx="3">${BIG}</p></div><div data-idx="4" class="hid"><p data-idx="5">非激活 tab 面板</p></div></div>`));
  try {
    assert.ok(r.cleaned.includes('非激活 tab 面板'), 'off-chain hidden 全额存活（裁定 R2/R3）');
    assert.ok(r.cleaned.includes('data-idx="5"'), '内部 id 可见（步骤 3 可挑选）');
    assert.ok(!r.cleaned.includes('{{HIDDEN_TAG'), '无任何 css-hidden 折叠');
  } finally { r.cleanup(); }
});

test('H1-C: 守卫拦截（p>2）；visibility:hidden 计入；嵌套只折最外层；裸 [hidden] 仍归 K5', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" class="hid"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="4" class="vh">不可见</div>
<div data-idx="5" class="hid"><div data-idx="6" class="hid">内层</div></div>
<div data-idx="7" hidden="true">属性隐藏</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="3"') && r.cleaned.includes('<p'), 'p=3 守卫阻断折叠');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|3_chars'), 'visibility:hidden 折叠（不可见=3 字）');
    assert.ok(!r.cleaned.includes('data-idx="6"'), '嵌套 hidden 随最外层吞并');
    assert.ok((r.cleaned.match(/HIDDEN_TAG/g) || []).length === 3, '共 3 个折叠壳：vh/嵌套外层/裸属性');
    assert.ok(r.cleaned.includes('{{HIDDEN_TAG|4_chars'), '裸 [hidden] K5 照常（属性隐藏=4 字）');
    assert.ok(r.styled.includes('data-idx="7"') && r.styled.includes('属性隐藏'), 'styled 全部保活');
  } finally { r.cleanup(); }
});

test('k 对齐: css-hidden 表/代码块由 K5x 独占，两版 skip 同源、编号不错位', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<table data-idx="3" class="hid"><tr><td>隐藏表</td></tr></table>
<table data-idx="4"><thead><tr><th>A</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>
<pre data-idx="5" class="hid">hidden code line one
line two
line three</pre>
<pre data-idx="6" data-language="js">const a = 1;
const b = 2;
console.log(a, b);</pre>`));
  try {
    assert.equal(r.out.tables.total, 1, '隐藏表不入收集（styled skip 同源）');
    assert.equal(r.out.codes.total, 1, '隐藏 pre 不入收集');
    assert.deepEqual(Object.keys(r.tablesJson), ['1'], 'tables.json 仅 k=1');
    assert.equal(r.tablesJson['1'].dataIdx, '4', 'k=1 归属可见表');
    assert.deepEqual(Object.keys(r.codesJson), ['1'], 'code.json 仅 k=1');
    assert.ok(r.cleaned.includes('{{TABLE_1|2×1}}'), '可见表 k=1 不错位');
    assert.ok(!r.cleaned.includes('TABLE_2'), '无幽灵 k=2');
    assert.ok(r.cleaned.includes('{{CODE_1|3_lines}}'), '可见 pre k=1');
    assert.ok(!r.cleaned.includes('CODE_2'), '无幽灵 CODE_2');
    assert.ok(r.styled.includes('隐藏表') && r.styled.includes('hidden code line one'),
      'styled 隐藏表/代码块保 live（不入恢复清单政策）');
  } finally { r.cleanup(); }
});
