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

test('R1: display 不走关键字规则（div 上 display:initial=inline 是真信号）', () => {
  const doc = run(`<div style="display: initial;">x</div>`);
  assert.equal(doc.querySelector('div').style.getPropertyValue('display'), 'initial');
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
// 破坏点：无标签白名单 → div 上 display:inline 被误删；无值门控 → inline-block 被误删

test('R3: 行内默认标签 display:inline 删、其余声明保留', () => {
  const doc = run(`<span style="display: inline; font-weight: bold;">x</span>`);
  const st = doc.querySelector('span').style;
  assert.equal(st.getPropertyValue('display'), '');
  assert.equal(st.getPropertyValue('font-weight'), 'bold');
});

test('R3: div display:inline 保留、span display:inline-block 保留', () => {
  const doc = run(`<div id=a style="display: inline;">x</div><span id=b style="display: inline-block;">y</span>`);
  assert.equal(doc.getElementById('a').style.getPropertyValue('display'), 'inline');
  assert.equal(doc.getElementById('b').style.getPropertyValue('display'), 'inline-block');
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
