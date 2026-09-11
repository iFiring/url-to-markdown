// test/unit/chrome-d1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** 与 clean-snapshot.test.mjs 同款基座：手写快照 → 真 CLI → 读回两版产物 */
async function runClean(snapshot, urlPath = 'chrome-d1', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-d1-'));
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
    stderr: r.stderr,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40); // 160 字符

test('D1: body 级 fixed 小文本子元素两版删除，static 无信号小兄弟保留', async () => {
  const r = await runClean(wrap(`
<div id="app" data-idx="1"><h1 data-idx="2">标题</h1><p data-idx="3">${BIG}</p></div>
<div id="bar" data-idx="4" style="position:fixed;bottom:0">关注</div>`));
  try {
    assert.ok(!r.cleaned.includes('data-idx="4"'), '清洗版删除浮层');
    assert.ok(!r.styled.includes('data-idx="4"'), '带样式版同步删除');
    assert.ok(r.cleaned.includes('data-idx="1"') && r.cleaned.includes('data-idx="3"'), '内容根保留');
    assert.ok(r.cleaned.includes('data-idx="2"'), 'static 无词汇的 h1 小兄弟保留');
  } finally { r.cleanup(); }
});

test('D1: 文本量排名第 1 恒不入候选（即使 fixed）；static+词汇命中删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1" style="position:fixed">${BIG}${BIG}</div>
<div data-idx="2" class="weui-toast">提示</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="1"'), 'rank1 fixed 豁免');
    assert.ok(!r.cleaned.includes('data-idx="2"'), 'static + toast 词汇删除');
  } finally { r.cleanup(); }
});

test('D1: ratio 5% 边界——6% 存活、4% 删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">${'正'.repeat(200)}</div>
<div data-idx="2" style="position:fixed">${'浮'.repeat(12)}</div>
<div data-idx="3" style="position:fixed">${'层'.repeat(8)}</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="2"'), '12/200=6% > 5% 存活');
    assert.ok(!r.cleaned.includes('data-idx="3"'), '8/200=4% ≤ 5% 删除');
  } finally { r.cleanup(); }
});

test('D1: 占优子元素 p≥5 停止下探；p=4 正常下探', async () => {
  const mk = (ps) => wrap(`
<div data-idx="1">
  <div data-idx="2">${BIG}${ps}</div>
  <div data-idx="3" style="position:fixed">浮层</div>
</div>`);
  const r5 = await runClean(mk('<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p>'), 'stop5');
  try {
    assert.ok(r5.cleaned.includes('data-idx="3"'), 'p=5：不进入该层，浮层存活');
  } finally { r5.cleanup(); }
  const r4 = await runClean(mk('<p>1</p><p>2</p><p>3</p><p>4</p>'), 'stop4');
  try {
    assert.ok(!r4.cleaned.includes('data-idx="3"'), 'p=4：下探扫描，浮层删除');
  } finally { r4.cleanup(); }
});

test('D1: 占优子元素匹配 main 后不进入其内部', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">
  <main data-idx="2">
    <div data-idx="3">${BIG}</div>
    <div data-idx="4" style="position:fixed">文内吸顶</div>
  </main>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="4"'), 'main 内部层级不扫描');
  } finally { r.cleanup(); }
});

test('D1: 内容守卫三条件各自拦截；守卫通过者删除', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">${BIG}</div>
<div data-idx="2" style="position:fixed"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="3" style="position:fixed"><pre>code</pre></div>
<div data-idx="4" style="position:fixed"><article data-idx="5">广告</article></div>
<div data-idx="6" style="position:fixed" class="site-modal"><button data-idx="7">确定</button></div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="2"'), 'p>2 阻断');
    assert.ok(r.cleaned.includes('data-idx="3"'), 'pre 阻断');
    assert.ok(r.cleaned.includes('data-idx="4"'), 'article 后代阻断');
    assert.ok(!r.cleaned.includes('data-idx="6"'), '守卫通过 → 删除');
  } finally { r.cleanup(); }
});

test('D1: 沿占优脊柱下探深层删除；非占优分支不扫描', async () => {
  const r = await runClean(wrap(`
<div data-idx="1">
  <div data-idx="2">
    <div data-idx="3">${BIG}</div>
    <div data-idx="4" style="position:fixed">深层浮层</div>
  </div>
</div>
<div data-idx="5">
  <div data-idx="6" style="position:fixed">支外浮层</div>
  <div data-idx="7">次要内容${'x'.repeat(20)}</div>
</div>`));
  try {
    assert.ok(!r.cleaned.includes('data-idx="4"'), '脊柱深层删除');
    assert.ok(r.cleaned.includes('data-idx="6"'), '非占优分支不扫描');
    assert.ok(r.cleaned.includes('data-idx="5"'), '非占优兄弟 ratio>5% 存活');
  } finally { r.cleanup(); }
});

test('D1: 脊柱下探深度硬上限（20 层）', async () => {
  // BIG 裹 <p>——裸文本独子链会被既有 K11 当纯 div 树整链折为 VIEW_TEXT，
  // p 不入纯树允许集，排除干扰后本测试只考察 D1 深度上限
  let body = `<div data-idx="900"><p data-idx="902">${BIG}</p></div><div data-idx="901" style="position:fixed">深层浮层</div>`;
  for (let i = 0; i < 22; i++) body = `<div data-idx="${899 - i}">${body}</div>`;
  const r = await runClean(wrap(body), 'depthcap');
  try {
    assert.ok(r.cleaned.includes('data-idx="901"'), '22 层独子链：深度上限后层级不扫描，浮层存活');
  } finally { r.cleanup(); }
});

test('D1: 全零文本层退化保护；script 不入候选；style 文本不计量', async () => {
  const r0 = await runClean(wrap(`
<div data-idx="1" style="position:fixed"><img data-idx="2" src="a.png" alt="a"></div>
<div data-idx="3" style="position:fixed"><img data-idx="4" src="b.png" alt="b"></div>
<script data-idx="5">console.log(${'x'.repeat(50)}')</script>`), 'zero');
  try {
    assert.ok(r0.cleaned.includes('data-idx="1"') && r0.cleaned.includes('data-idx="3"'),
      'max=0 无占优信号，全存活（img 属 KEEP_EMPTY 不被级联删）');
    assert.ok(r0.cleaned.includes('data-idx="5"'), 'script 不入 D1 候选');
  } finally { r0.cleanup(); }
  const r1 = await runClean(wrap(`
<div data-idx="1">${'正'.repeat(100)}</div>
<div data-idx="2" style="position:fixed"><style>${'x'.repeat(300)}</style>浮层</div>`), 'styletext');
  try {
    assert.ok(!r1.cleaned.includes('data-idx="2"'), 'style 文本不计量 → 可视文本 2 字 → 删除');
    assert.ok(r1.cleaned.includes('data-idx="1"'), '内容根不被 style 文本反超');
  } finally { r1.cleanup(); }
});
