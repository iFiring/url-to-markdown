import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-finalize-inline.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mFinalizeInline', () => {
  assert.ok(src().includes('function __u2mFinalizeInline'));
});

// finalize 需 computedMap 参数；传 {} 即可（table 分支在 computedMap 之前）
function run(html) {
  const dom = new JSDOM(`<html><body>${html}</body></html>`);
  const fn = new Function('document', 'return (' + src() + ')({})');
  fn(dom.window.document);
  return dom.window.document;
}

test('失败 live 表子树全部 style 删除', () => {
  const html = `<table data-u2m-table="fail" style="border:1px solid red">
    <thead><tr><th style="background:#eef;font-weight:bold">H</th></tr></thead>
    <tbody><tr><td style="border:1px solid blue;color:red">a</td></tr></tbody></table>`;
  const doc = run(html);
  assert.equal(doc.querySelector('table').getAttribute('style'), null, 'table 自身 style 删除');
  assert.equal(doc.querySelector('th').getAttribute('style'), null, 'th style 删除');
  assert.equal(doc.querySelector('td').getAttribute('style'), null, 'td style 删除');
});

test('成功折叠表（仅文本节点、无 [style] 子树）→ no-op', () => {
  const html = `<table data-idx="5">{{TABLE_1|2×2}}</table>`;
  const doc = run(html);
  assert.equal(doc.querySelector('table').getAttribute('style'), null);
  assert.match(doc.body.textContent, /\{\{TABLE_1/);
});

test('表外元素样式不受影响（仍走白名单）', () => {
  const html = `<div style="display:flex;border:1px solid green"><p style="font-size:14px">x</p></div>
    <table><tbody><tr><td style="border:1px solid red">y</td></tr></tbody></table>`;
  const doc = run(html);
  const div = doc.querySelector('div');
  assert.match(div.getAttribute('style') || '', /display/i);
  assert.match(div.getAttribute('style') || '', /border/i);
  assert.equal(doc.querySelector('td').getAttribute('style'), null);
});

// ===== R1：CSS 关键字零值（initial/unset）=====
// 破坏点：关键字规则缺失 → 白名单内非继承属性上的 initial/unset 字面量存活

test('R1: 非继承属性上 initial/unset 全删（outline/align/flex/justify/overflow）', () => {
  const doc = run(`<section style="outline-color: initial; outline-style: initial; align-items: unset; flex-direction: unset; justify-content: unset; overflow: unset;">x</section>`);
  assert.equal(doc.querySelector('section').getAttribute('style'), null);
});

test('R1: 继承属性 unset 删（≡inherit 默认行为）、initial 保留（阻断继承有意义）', () => {
  const doc = run(`<span id=a style="font-weight: unset;">x</span><span id=b style="font-size: initial;">y</span>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null);
  assert.equal(doc.getElementById('b').style.getPropertyValue('font-size'), 'initial');
});

// R7 收紧后 display 走值门控（仅 flex/grid 四值存活），initial/unset 一律删
test('R1: display:initial/unset 删（值门控吸收，不再保留块级标签上的行内化信号）', () => {
  const doc = run(`<div id=a style="display: initial;">x</div><div id=b style="display: unset;">y</div>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null);
  assert.equal(doc.getElementById('b').getAttribute('style'), null);
});

// ===== R1b：border/outline 形态扩展 =====
// 破坏点：sideVoid/outlineVoid 不认 initial/unset、bare 简写不入四边正则

test('R1b: bare border 简写 initial 形态全删（含 border-color: currentcolor）', () => {
  const doc = run(`<p style="border-width: initial; border-style: initial; border-color: currentcolor;">x</p>`);
  assert.equal(doc.querySelector('p').getAttribute('style'), null);
});

test('R1b: outline-style:initial 触发三件全删（实值 color/width 同删）', () => {
  const doc = run(`<div style="outline-style: initial; outline-color: rgb(255, 0, 0); outline-width: 2px;">x</div>`);
  assert.equal(doc.querySelector('div').getAttribute('style'), null);
});

test('R1b: 实边存活、initial 边三件删', () => {
  const doc = run(`<h3 style="border-left: 5px solid rgb(248, 57, 41); border-top-style: initial; border-top-width: initial; border-top-color: currentcolor;">x</h3>`);
  const st = doc.querySelector('h3').style;
  assert.equal(st.getPropertyValue('border-left-style'), 'solid', '左边存活');
  assert.equal(st.getPropertyValue('border-left-width'), '5px');
  assert.equal(st.getPropertyValue('border-top-style'), '', '顶边 initial 三件删');
  assert.equal(st.getPropertyValue('border-top-color'), '');
});

// ===== R2：transform:none + background 长手簇 =====
// 破坏点：无图规则缺失 → 非初始值 no-repeat 存活；clip 混入无图规则 → padding-box 误删

test('R2: transform:none 删、真实 transform 保留', () => {
  const doc = run(`<div id=a style="transform: none;">x</div><div id=b style="transform: translateX(5px);">y</div>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null);
  assert.equal(doc.getElementById('b').style.getPropertyValue('transform'), 'translateX(5px)');
});

test('R2: 无图 background 长手簇全删（含非初始 no-repeat/left top）、background-color 保留', () => {
  const doc = run(`<code style="background-position: left top; background-size: auto; background-repeat: no-repeat; background-attachment: scroll; background-origin: padding-box; background-clip: border-box; background-color: rgba(27, 31, 35, 0.05);">x</code>`);
  const st = doc.querySelector('code').style;
  for (const p of ['background-position', 'background-position-x', 'background-position-y',
    'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip']) {
    assert.equal(st.getPropertyValue(p), '', p + ' 应删');
  }
  assert.equal(st.getPropertyValue('background-color'), 'rgba(27, 31, 35, 0.05)', '有效背景色保留');
});

test('R2: 有真图时非初始长手保留、初始形长手删', () => {
  const doc = run(`<div style="background-image: linear-gradient(red, blue); background-repeat: no-repeat; background-position: 0% 0%; background-size: auto;">x</div>`);
  const st = doc.querySelector('div').style;
  assert.equal(st.getPropertyValue('background-image'), 'linear-gradient(red, blue)');
  assert.equal(st.getPropertyValue('background-repeat'), 'no-repeat', '有图时 no-repeat 是真信号');
  assert.equal(st.getPropertyValue('background-position'), '', '初始位置删');
  assert.equal(st.getPropertyValue('background-size'), '', '初始 size 删');
});

test('R2: background-clip 仅删初始 border-box（clip 影响纯色绘制）', () => {
  const doc = run(`<span style="background-clip: padding-box; background-color: rgb(255, 0, 0);">x</span>`);
  const st = doc.querySelector('span').style;
  assert.equal(st.getPropertyValue('background-clip'), 'padding-box');
  assert.equal(st.getPropertyValue('background-color'), 'rgb(255, 0, 0)');
});

// ===== R3：UA 默认 display:inline =====
// 破坏点：无标签白名单 → span 上 display:inline 残留为噪音。
// （2026-09-09 R7 收紧后 div 上 inline / span 上 inline-block 也删——display
// 仅 flex/grid 四值存活，行内标签全值删，旧「保留真信号」语义已被取代）

test('R3: 行内默认标签 display:inline 删、其余声明保留', () => {
  const doc = run(`<span style="display: inline; font-weight: bold;">x</span>`);
  const st = doc.querySelector('span').style;
  assert.equal(st.getPropertyValue('display'), '');
  assert.equal(st.getPropertyValue('font-weight'), 'bold');
});

test('R3: div display:inline 与 span display:inline-block 均删（R7 值门控+行内全删）', () => {
  const doc = run(`<div id=a style="display: inline;">x</div><span id=b style="display: inline-block;">y</span>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null);
  assert.equal(doc.getElementById('b').getAttribute('style'), null);
});

// ===== R4：背景画布等值 =====
// 破坏点：只比画布 → 灰卡上白 span 误删；不比祖先 → 黑卡上黑 span 存活

test('R4: background-color 与画布白等值删除（含 bare background 简写等值）', () => {
  const doc = run(`<p id=a style="background-color: rgb(255, 255, 255);">x</p><p id=b style="background: rgb(255,255,255);">y</p>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null);
  assert.equal(doc.getElementById('b').getAttribute('style'), null);
});

test('R4: 与最近非透明祖先背景等值删、祖先自身保留', () => {
  const doc = run(`<div style="background-color: rgb(0, 0, 0);"><span style="background-color: rgb(0, 0, 0);">x</span></div>`);
  assert.equal(doc.querySelector('span').getAttribute('style'), null, 'span 黑底与父黑底等值 → 删');
  assert.equal(doc.querySelector('div').style.getPropertyValue('background-color'), 'rgb(0, 0, 0)', 'div 黑底≠画布白 → 保留');
});

test('R4: 灰卡上的白 span 保留（背景是卡片而非画布）', () => {
  const doc = run(`<div style="background-color: rgba(0, 0, 0, 0.05);"><span style="background-color: rgb(255, 255, 255);">x</span></div>`);
  assert.equal(doc.querySelector('span').style.getPropertyValue('background-color'), 'rgb(255, 255, 255)');
  assert.equal(doc.querySelector('div').style.getPropertyValue('background-color'), 'rgba(0, 0, 0, 0.05)');
});

test('R4: body 深色底保留（画布传播源）、子元素同色删', () => {
  const dom = new JSDOM(`<html><body style="background-color: rgb(17, 17, 17);"><div style="background-color: rgb(17, 17, 17);">x</div></body></html>`);
  const fn = new Function('document', 'return (' + src() + ')({})');
  fn(dom.window.document);
  const doc = dom.window.document;
  assert.equal(doc.body.style.getPropertyValue('background-color'), 'rgb(17, 17, 17)', 'body 自身声明 vs html/白 → 保留');
  assert.equal(doc.querySelector('div').getAttribute('style'), null, 'div 与最近非透明祖先 body 等值 → 删');
});

// ===== R5：继承等值 font 修剪 =====
// 破坏点：无继承比较 → 重复 font 声明存活；绝对初始值比较 → bold 下的 400 重置被误删

test('R5: 与继承有效值等值的 font 声明删（normal≡400、根默认 medium≡16px）', () => {
  const doc = run(`<div style="font-size: 17px; font-weight: 400;"><p style="font-size: 17px; font-weight: normal;">x</p></div>`);
  assert.equal(doc.querySelector('p').getAttribute('style'), null, 'p 两件均与继承等值 → 全删');
  const st = doc.querySelector('div').style;
  assert.equal(st.getPropertyValue('font-size'), '17px', '17px≠默认16px → 保留');
  assert.equal(st.getPropertyValue('font-weight'), '', '400≡默认normal → 删');
});

test('R5: 对比保留——bold 下 400 重置、17px 下 18px', () => {
  const doc = run(`<div id=a style="font-weight: bold;"><span style="font-weight: 400;">x</span></div><div id=b style="font-size: 17px;"><span style="font-size: 18px;">y</span></div>`);
  assert.equal(doc.querySelector('#a span').style.getPropertyValue('font-weight'), '400');
  assert.equal(doc.querySelector('#b span').style.getPropertyValue('font-size'), '18px');
  assert.equal(doc.querySelector('#a').style.getPropertyValue('font-weight'), 'bold');
});

test('R5: 三级重复链只留最上层', () => {
  const doc = run(`<section style="font-size: 20px;"><div style="font-size: 20px;"><p style="font-size: 20px;">x</p></div></section>`);
  assert.equal(doc.querySelector('section').style.getPropertyValue('font-size'), '20px');
  assert.equal(doc.querySelector('div').getAttribute('style'), null);
  assert.equal(doc.querySelector('p').getAttribute('style'), null);
});

test('R5: 不可比形态保守保留（em/bolder/关键字）', () => {
  const doc = run(`<p style="font-size: 1.1em; font-weight: bolder;">x</p>`);
  const st = doc.querySelector('p').style;
  assert.equal(st.getPropertyValue('font-size'), '1.1em');
  assert.equal(st.getPropertyValue('font-weight'), 'bolder');
});

// ===== R6：img auto 尺寸 =====
// 破坏点：img 元素级例外无值门控 → height:auto 无信号声明存活

test('R6: img height:auto 删、真实像素宽高保留', () => {
  const doc = run(`<img id=a style="height: auto; width: 677px;"><img id=b style="height: 120px; width: 50px;">`);
  const a = doc.getElementById('a').style;
  assert.equal(a.getPropertyValue('height'), '', 'auto 无信号 → 删');
  assert.equal(a.getPropertyValue('width'), '677px', 'px 宽度是步骤 7 信号 → 保留');
  const b = doc.getElementById('b').style;
  assert.equal(b.getPropertyValue('height'), '120px');
  assert.equal(b.getPropertyValue('width'), '50px');
});

// ===== 组合回归：真实观察形态 =====

test('组合: 微信 h3 标题噪音簇清理后只剩 bold/18px/左边框', () => {
  const doc = run(`<h3 style="outline-color: initial; outline-style: initial; font-weight: bold; font-size: 18px; background-position: 0% 0%; background-size: auto; background-repeat: no-repeat; background-attachment: scroll; background-origin: padding-box; background-clip: border-box; background-color: rgb(255, 255, 255); border-left: 5px solid rgb(248, 57, 41); align-items: unset; flex-direction: unset; justify-content: unset; overflow: unset; transform: none;">标题</h3>`);
  const st = doc.querySelector('h3').style;
  assert.equal(st.getPropertyValue('font-weight'), 'bold');
  assert.equal(st.getPropertyValue('font-size'), '18px');
  assert.equal(st.getPropertyValue('border-left-style'), 'solid');
  assert.equal(st.getPropertyValue('border-left-width'), '5px');
  for (const p of ['outline-color', 'outline-style', 'background-color', 'background-position',
    'background-repeat', 'background-clip', 'align-items', 'flex-direction', 'justify-content',
    'overflow', 'transform']) {
    assert.equal(st.getPropertyValue(p), '', p + ' 应删');
  }
});

// ===== R7：布局白名单收紧（2026-09-09）=====
// 语义：布局组只保留「方向」信号——display 值门控（flex/inline-flex/grid/
// inline-grid 四值）+ 五个方向 longhand；对齐全族（justify-*/align-*/place-*，
// 不只 center）、gap、order、flex 长手与简写、grid placement（span/areas/
// auto-rows/简写）全部出白名单；行内标签（INLINE_DEFAULT_TAGS）display
// 无论何值全删。
// 破坏点：值门控缺失 → display:block/inline-block 等噪音存活；行内全删缺失
// → span 上 display:flex 残留；白名单未收紧 → 对齐/gap/placement 存活

test('R7: display 值门控——flex/inline-flex/grid/inline-grid 保留，其余值删', () => {
  const doc = run(`<div id=a style="display: flex;">x</div><div id=b style="display: inline-flex;">x</div><div id=c style="display: grid;">x</div><div id=d style="display: inline-grid;">x</div><div id=e style="display: block;">x</div><div id=f style="display: inline;">x</div><div id=g style="display: inline-block;">x</div><div id=h style="display: table;">x</div><div id=i style="display: contents;">x</div>`);
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.ok(doc.getElementById(id).style.getPropertyValue('display'), id + ' 方向值应保留');
  }
  for (const id of ['e', 'f', 'g', 'h', 'i']) {
    assert.equal(doc.getElementById(id).getAttribute('style'), null, id + ' 非方向值应删净');
  }
});

test('R7: 行内标签 display 全值删（inline-block/flex/grid 也不留）', () => {
  const doc = run(`<span id=a style="display: inline-block;">x</span><span id=b style="display: flex;">x</span><a id=c style="display: grid;">x</a><strong id=d style="display: block; font-weight: bold;">x</strong>`);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(doc.getElementById(id).getAttribute('style'), null, id + ' 行内标签 display 应全删');
  }
  const d = doc.getElementById('d').style;
  assert.equal(d.getPropertyValue('display'), '', 'strong 上 display:block 也删');
  assert.equal(d.getPropertyValue('font-weight'), 'bold', '非 display 声明不受牵连');
});

test('R7: 五方向属性保留（flex-direction/wrap、grid-auto-flow/template-columns/rows）', () => {
  const doc = run(`<div style="flex-direction: column; flex-wrap: wrap; grid-auto-flow: row dense; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto auto;">x</div>`);
  const st = doc.querySelector('div').style;
  assert.equal(st.getPropertyValue('flex-direction'), 'column');
  assert.equal(st.getPropertyValue('flex-wrap'), 'wrap');
  assert.equal(st.getPropertyValue('grid-auto-flow'), 'row dense');
  assert.equal(st.getPropertyValue('grid-template-columns'), 'repeat(3, 1fr)');
  assert.equal(st.getPropertyValue('grid-template-rows'), 'auto auto');
});

test('R7: 对齐全族删——center 与 space-between/flex-start 同删', () => {
  const doc = run(`<div id=a style="justify-content: center; justify-items: center; justify-self: center; align-items: center; align-content: center; align-self: center; place-items: center; place-content: center; place-self: center;">x</div><div id=b style="justify-content: space-between; align-items: flex-start;">y</div>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null, '居中全家删');
  assert.equal(doc.getElementById('b').getAttribute('style'), null, '非居中对齐值同删（只留方向、不留分布）');
});

test('R7: gap/order/flex 长手与简写删', () => {
  const doc = run(`<div style="gap: 8px; row-gap: 4px; column-gap: 6px; order: 2; flex: 1; flex-grow: 2; flex-shrink: 0; flex-basis: 40%; flex-flow: column wrap;">x</div>`);
  assert.equal(doc.querySelector('div').getAttribute('style'), null);
});

test('R7: grid placement 删——容器方向信号（display:grid + template-columns/rows）保留', () => {
  const doc = run(`<div id=a style="grid-column: span 2; grid-row: 1 / 3; grid-area: main; grid-template-areas: 'a b'; grid-auto-rows: 40px; grid-auto-columns: 1fr; grid: 100px / 200px;">x</div><div id=b style="display: grid; grid-template-columns: repeat(2, 1fr); grid-auto-flow: column;">y</div>`);
  assert.equal(doc.getElementById('a').getAttribute('style'), null, 'placement/几何/简写全删');
  const b = doc.getElementById('b').style;
  assert.equal(b.getPropertyValue('display'), 'grid', '容器信号保留');
  assert.equal(b.getPropertyValue('grid-template-columns'), 'repeat(2, 1fr)');
  assert.equal(b.getPropertyValue('grid-auto-flow'), 'column');
});

test('R7: overflow 三件全删（auto/hidden/scroll/x/y——滚动裁剪不再保留）', () => {
  const doc = run(`<div id=a style="overflow: auto;">x</div><div id=b style="overflow: hidden;">x</div><div id=c style="overflow-x: scroll; overflow-y: hidden;">x</div>`);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(doc.getElementById(id).getAttribute('style'), null, id + ' overflow 应删');
  }
});
