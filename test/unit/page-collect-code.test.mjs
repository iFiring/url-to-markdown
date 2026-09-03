import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-collect-code.js');
const src = () => fs.readFileSync(scriptPath, 'utf8');

test('文件存在且含 __u2mCollectCode', () => {
  assert.ok(src().includes('function __u2mCollectCode'));
});

function run(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const fn = new Function('document', 'getComputedStyle', 'return (' + src() + ')()');
  return fn(dom.window.document, dom.window.getComputedStyle.bind(dom.window));
}

const GUT = `style="user-select:none"`;

test('shiki 形态：inline 行 span + \\n 文本节点——行数按换行、lang 取 data-language', () => {
  // pre 内容空白敏感——夹具精确书写，不留缩进
  const out = run(
    `<pre data-idx="10"><code data-language="javascript" data-idx="11"><span style="display:inline"><span style="display:inline">import</span> OpenAI;</span>\n` +
    `<span style="display:inline"><span style="display:inline">const</span> a = 1;</span></code></pre>`);
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.k, 1);
  assert.equal(c.dataIdx, '10');
  assert.equal(c.lang, 'javascript');
  assert.equal(c.lines, 2);
  assert.equal(c.text, 'import OpenAI;\nconst a = 1;');
  assert.equal(c.renderedLines, null, 'jsdom 无布局 → null');
  assert.equal(c.blockContainers, 0, 'inline span 不计容器');
  assert.equal(c.textContentNoGutter.replace(/\s+/g, ' ').trim(), 'import OpenAI; const a = 1;');
});

test('ra 形态：grid 行容器零 \\n——行数按容器边界、lang 取 language-* class', () => {
  const out = run(
    `<pre data-idx="20"><code class="ra-code language-tsx" data-idx="21"><span style="display:grid"><span style="display:inline">system:</span> \`...\`</span><span style="display:grid"><span style="display:inline">const</span> t = Date();</span><span style="display:grid"><span style="display:inline">const</span> u = 2;</span></code></pre>`);
  const c = out[0];
  assert.equal(c.lang, 'tsx');
  assert.equal(c.lines, 3, 'grid 容器边界断行');
  assert.equal(c.text.split('\n').length, 3);
  assert.equal(c.blockContainers, 3);
});

test('br 分行形态', () => {
  const out = run(`<pre data-idx="30"><code data-idx="31">alpha<br>beta<br>gamma</code></pre>`);
  assert.equal(out[0].lines, 3);
  assert.equal(out[0].text, 'alpha\nbeta\ngamma');
});

test('块间空白文本节点吞掉、内部空行保留', () => {
  const out = run(
    `<pre data-idx="40"><code data-idx="41"><span style="display:block">a</span>\n` +
    `<span style="display:block"></span>\n` +
    `<span style="display:block">b</span></code></pre>`);
  // 块间 \n 文本节点在空行上不产生额外断行；空行容器产生 1 个空行
  assert.equal(out[0].text, 'a\n\nb');
});

test('层 1 槽排除：user-select:none 纯数字子树零贡献、gutterStripped 置位、textContentNoGutter 减槽', () => {
  const out = run(
    `<pre data-idx="50"><code data-idx="51"><span style="display:block;user-select:none"><span ${GUT}>1\n` +
    `</span><span ${GUT}>2\n` +
    `</span><span ${GUT}>3\n` +
    `</span></span><span style="display:inline">{"model": "x"}</span></code></pre>`);
  const c = out[0];
  assert.equal(c.gutterStripped, true);
  assert.equal(c.text, '{"model": "x"}', '序号槽零贡献');
  assert.ok(!c.textContentNoGutter.includes('1'), 'textContentNoGutter 减槽');
});

test('层 1 槽壳传播：壳 us:auto、全部子元素皆槽 → 整棵视为槽、bc 不计壳', () => {
  // 回归（2026-09-03，developers.openai.com prompt-caching k=5/6）：真实形态
  // .syntax-highlighter-line-numbers 壳 display:block 但 user-select:auto，
  // us:none 只设在数字 span 上——旧谓词不认壳：walkLines 幻影首空行 +
  // blockContainers 计壳（唯一块容器）与 \n 双信号矛盾 mixed_signal_mismatch
  // 误杀。<!-- --> 是注释节点，textContent 不含、三处信号均不可见——夹具
  // 保留以钉死这一点。
  const out = run(
    `<pre data-idx="52"><code data-language="json" data-idx="53"><span style="display:block"><span ${GUT}>1<!-- --></span><span ${GUT}>2<!-- --></span></span><span style="display:inline">{"a": 1}\n` +
    `</span><span style="display:inline">{"b": 2}</span></code></pre>`);
  const c = out[0];
  assert.equal(c.gutterStripped, true);
  assert.equal(c.text, '{"a": 1}\n{"b": 2}', '槽零贡献且无幻影首空行');
  assert.equal(c.blockContainers, 0, '槽壳不计行容器 → mixed_signal 单信号跳过');
  assert.equal(c.lines, 2);
});

test('层 1 槽壳传播防空穴：空行容器（零子命中）不算槽——空行保真', () => {
  // textContent 空串过 GUTTER_TEXT_RE，但无 us:none 子命中——传播必须
  // 要求 ≥1 子命中，否则空行 div 会被当槽吞掉（块间空行容器保真依赖）
  const out = run(
    `<pre data-idx="54"><code data-idx="55"><div>line1</div><div></div><div>line3</div></code></pre>`);
  const c = out[0];
  assert.equal(c.text, 'line1\n\nline3', '空行容器贡献空行');
  assert.equal(c.blockContainers, 3, '空行容器照常计数');
});

test('层 1 不误杀：user-select:none 但内容非纯数字（复制保护整块）', () => {
  const out = run(`
    <pre data-idx="60" style="user-select:none"><code data-idx="61">const a = 1;
const b = 2;</code></pre>`);
  assert.equal(out[0].gutterStripped, false);
  assert.equal(out[0].lines, 2);
  assert.equal(out[0].text, 'const a = 1;\nconst b = 2;');
});

test('hasNonText：pre 内嵌 img 置位', () => {
  const out = run(`<pre data-idx="70"><code data-idx="71">code <img src="x.png"> more</code></pre>`);
  assert.equal(out[0].hasNonText, true);
});

test('lang 链：data-language 缺省 → code class language-* → pre class → 空', () => {
  const a = run(`<pre data-idx="80"><code class="language-python" data-idx="81">x = 1</code></pre>`);
  assert.equal(a[0].lang, 'python');
  const b = run(`<pre class="language-bash" data-idx="82"><code data-idx="83">ls</code></pre>`);
  assert.equal(b[0].lang, 'bash');
  const c = run(`<pre data-idx="84"><code data-idx="85">ls</code></pre>`);
  assert.equal(c[0].lang, '');
});

test('hidden / detached pre 跳过，k 按文档序连续编号', () => {
  const out = run(`
    <pre data-idx="90"><code data-idx="91">a</code></pre>
    <pre data-idx="92" hidden><code data-idx="93">hidden code</code></pre>
    <pre data-idx="94"><code data-idx="95">b</code></pre>`);
  assert.equal(out.length, 2);
  assert.equal(out[0].k, 1); assert.equal(out[0].dataIdx, '90');
  assert.equal(out[1].k, 2); assert.equal(out[1].dataIdx, '94');
});

test('outerHTML 携带 pre 原始序列化', () => {
  const out = run(`<pre data-idx="96"><code data-idx="97">x</code></pre>`);
  assert.ok(out[0].outerHTML.startsWith('<pre data-idx="96"'));
  assert.ok(out[0].outerHTML.endsWith('</pre>'));
});
