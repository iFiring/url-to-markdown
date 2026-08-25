import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-clean-snapshot.js');

/** 瘦身规则测试基座：手写 1_snapshot 夹具 → 子进程跑真 clean_snapshot.mjs → 读回两版产物。 */
async function runClean(snapshot, urlPath = 'slim-article', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-slim-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url], {
    env: { ...env, U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
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

function runInBrowser(html, fnSrc) {
  // 用 node 模拟浏览器环境：使用 jsdom 或直接字符串处理验证
  // 这里验证函数源码是否合法
  const wrapped = `(${fnSrc})()`;
  // 基础语法检查
  assert.doesNotThrow(() => new Function('return ' + wrapped), '页面函数应为合法 JS');
}

test('page-clean-snapshot.js: 文件存在且包含 __u2mCleanSnapshot 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mCleanSnapshot'), '应定义 __u2mCleanSnapshot');
});

test('page-clean-snapshot.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('clean_snapshot.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('clean_snapshot.mjs: 对 article-1 快照执行清洗', async () => {
  // 准备临时目录，手动放入一个测试快照
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-'));
  const url = 'https://example.com/test-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  // 用 article-1.html 作为模拟快照
  const fixture = fs.readFileSync(path.resolve('test/fixtures/article-1.html'), 'utf8');
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), fixture);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  // 验证清洗结果
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  assert.ok(!cleaned.includes('style='), '不应含 style 属性');
  assert.ok(!cleaned.includes('<style'), '不应含 <style> 标签');
  assert.ok(cleaned.includes('LONG_TEXT'), '应含长文本占位符');
  assert.ok(!cleaned.match(/<svg[^>]+[a-z-]+=/i), 'SVG 不应有属性');

  // head 里的 meta/link（charset/viewport/preconnect/og:* 等）对步骤 3 的结构识别
  // 是纯噪声，全部删除；title 保留作识别线索
  assert.ok(!cleaned.includes('<meta'), '不应含 <meta> 标签');
  assert.ok(!cleaned.includes('<link'), '不应含 <link> 标签');
  assert.ok(cleaned.includes('<title>'), '应保留 <title>');

  // 清理
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 空元素级联删除，有内容的元素保留', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-empty-'));
  const url = 'https://example.com/empty-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">
    <div data-u2m-id="2"></div>
    <div data-u2m-id="3">
      <div data-u2m-id="4"></div>
    </div>
    <div data-u2m-id="5">   </div>
    <div data-u2m-id="6">正文内容</div>
    <div data-u2m-id="7"><span data-u2m-id="8">行内文本</span></div>
    <span data-u2m-id="9"></span>
    <img data-u2m-id="10" src="x.png" alt="x">
    <svg data-u2m-id="11"></svg>
    <h1 data-u2m-id="12"></h1>
    <div data-u2m-id="13"><br></div>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');

  // 空壳删除（含级联与"仅空白"情形）
  assert.ok(!cleaned.includes('data-u2m-id="2"'), '空 div 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="3"'), '仅含空子元素的父元素应级联删除');
  assert.ok(!cleaned.includes('data-u2m-id="4"'), '嵌套的空子元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="5"'), '仅含空白文本的元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="9"'), '空 span 应删除');

  // 有内容的元素必须保留
  assert.ok(cleaned.includes('data-u2m-id="6"'), '含文本的元素必须保留');
  assert.ok(cleaned.includes('data-u2m-id="7"'), '含文本 span 的父元素必须保留');
  assert.ok(cleaned.includes('data-u2m-id="8"'), '含文本的 span 必须保留');
  assert.ok(cleaned.includes('data-u2m-id="10"'), 'img 必须保留');
  assert.ok(cleaned.includes('<svg></svg>'), 'svg 壳必须保留');
  assert.ok(cleaned.includes('data-u2m-id="12"'), '标题（h1）即使为空也保留');
  assert.ok(cleaned.includes('data-u2m-id="13"'), '含 br 的元素必须保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 删除 nav/footer/form 及 role 等价物，正文保留', async () => {
  // 页面骨架标签（导航/页脚/表单）不属于文章正文，整体删除——含
  // role 伪装变体与 <article> 内嵌 footer；只含骨架标签的包装容器随之级联清除
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-skel-'));
  const url = 'https://example.com/skel-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">
    <nav data-u2m-id="2"><a data-u2m-id="3" href="/x">菜单项</a></nav>
    <div data-u2m-id="4"><nav data-u2m-id="5">嵌套导航</nav></div>
    <footer data-u2m-id="6">页脚内容</footer>
    <form data-u2m-id="7"><input data-u2m-id="8" value="q"></form>
    <div data-u2m-id="9" role="navigation">role 伪装导航</div>
    <div data-u2m-id="10" role="contentinfo">role 伪装页脚</div>
    <article data-u2m-id="11"><p data-u2m-id="13">正文段落</p><footer data-u2m-id="12">作者信息</footer></article>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');

  // 骨架标签整体删除（断言限定开标签位置，避免误伤正文里的同名字符串）
  assert.ok(!/<nav[\s>]/.test(cleaned), 'nav 应删除');
  assert.ok(!/<footer[\s>]/.test(cleaned), 'footer 应删除');
  assert.ok(!/<form[\s>]/.test(cleaned), 'form 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="2"'), 'nav 元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="6"'), 'footer 元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="7"'), 'form 元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="8"'), 'form 内的 input 随 form 一起删除');
  assert.ok(!cleaned.includes('data-u2m-id="12"'), 'article 内嵌 footer 同样删除');

  // role 伪装变体（div/span/a + role）一并删除
  assert.ok(
    !/<[a-z][a-z0-9-]*[^>]*\srole\s*=\s*["'](navigation|contentinfo|form)["']/i.test(cleaned),
    'role="navigation"/"contentinfo"/"form" 等价物应删除'
  );
  assert.ok(!cleaned.includes('data-u2m-id="9"'), 'role 伪装导航应删除');
  assert.ok(!cleaned.includes('data-u2m-id="10"'), 'role 伪装页脚应删除');

  // 级联与保留
  assert.ok(!cleaned.includes('data-u2m-id="4"'), '只含 nav 的包装容器应级联删除');
  assert.ok(cleaned.includes('data-u2m-id="11"'), 'article 正文必须保留');
  assert.ok(cleaned.includes('正文段落'), '正文文本必须保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 删除 video/audio 与残余表单控件，header/aside 保留', async () => {
  // 媒体播放器与 form 外残余控件（搜索框/下拉/对话框）不是文章正文；
  // header/aside 是正文结构（hero 含主标题、章节 header+aside 交替），必须保留
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-media-'));
  const url = 'https://example.com/media-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">
    <video data-u2m-id="2" src="v.mp4"><source data-u2m-id="3" src="v.webm"><track data-u2m-id="4" kind="subtitles"></video>
    <audio data-u2m-id="5" src="a.mp3"></audio>
    <div data-u2m-id="6"><video data-u2m-id="7" src="v2.mp4"></video></div>
    <input data-u2m-id="8" value="搜索">
    <select data-u2m-id="9"><option>选项</option></select>
    <textarea data-u2m-id="10">留言</textarea>
    <label data-u2m-id="11">标签文本</label>
    <dialog data-u2m-id="12">对话框内容</dialog>
    <article data-u2m-id="13"><header data-u2m-id="14"><h1 data-u2m-id="15">标题</h1></header><p data-u2m-id="16">正文段落</p><aside data-u2m-id="17">补充说明</aside></article>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');

  // 媒体播放器整体删除（断言限定开标签位置，避免误伤正文同名字符串）
  assert.ok(!/<video[\s>]/.test(cleaned), 'video 应删除');
  assert.ok(!/<audio[\s>]/.test(cleaned), 'audio 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="2"'), 'video 元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="3"'), 'video 内的 source 随之删除');
  assert.ok(!cleaned.includes('data-u2m-id="4"'), 'video 内的 track 随之删除');
  assert.ok(!cleaned.includes('data-u2m-id="5"'), 'audio 元素应删除');
  assert.ok(!cleaned.includes('data-u2m-id="6"'), '只含 video 的包装容器应级联删除');

  // 残余表单控件与模态框删除
  assert.ok(!/<input[\s>]/.test(cleaned), 'input 应删除');
  assert.ok(!/<select[\s>]/.test(cleaned), 'select 应删除');
  assert.ok(!/<textarea[\s>]/.test(cleaned), 'textarea 应删除');
  assert.ok(!/<label[\s>]/.test(cleaned), 'label 应删除');
  assert.ok(!/<dialog[\s>]/.test(cleaned), 'dialog 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="8"'), 'form 外的 input 同样删除');
  assert.ok(!cleaned.includes('data-u2m-id="9"'), 'select 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="10"'), 'textarea 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="11"'), 'label 应删除');
  assert.ok(!cleaned.includes('data-u2m-id="12"'), 'dialog 应删除');

  // header/aside 是正文结构（hero 含标题、章节补充内容），必须保留
  assert.ok(cleaned.includes('data-u2m-id="13"'), 'article 正文必须保留');
  assert.ok(cleaned.includes('data-u2m-id="14"'), 'article 内的 header 必须保留');
  assert.ok(cleaned.includes('data-u2m-id="15"'), 'header 内的 h1 必须保留');
  assert.ok(cleaned.includes('data-u2m-id="16"'), '正文段落必须保留');
  assert.ok(cleaned.includes('data-u2m-id="17"'), 'aside 补充内容必须保留');
  assert.ok(cleaned.includes('正文段落'), '正文文本必须保留');
  assert.ok(cleaned.includes('补充说明'), 'aside 文本必须保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 表格结构整体保留（含空单元格），内部噪声仍删', async () => {
  // 回归：空 <td>/<th>/<tr>/<col> 不在 KEEP_EMPTY 白名单时会被空元素级联删除，
  // 删掉后表格行列错位；article-1 实测丢过整个 <colgroup>+4 <col>。
  // 表格结构元素即使为空也保留；单元格内的按钮等噪声照删，留下空壳单元格。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-table-'));
  const url = 'https://example.com/table-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">
    <table data-u2m-id="2">
      <colgroup data-u2m-id="3"><col data-u2m-id="4"><col data-u2m-id="5"></colgroup>
      <thead data-u2m-id="6"><tr data-u2m-id="7"><th data-u2m-id="8">列A</th><th data-u2m-id="9"></th></tr></thead>
      <tbody data-u2m-id="10">
        <tr data-u2m-id="11"><td data-u2m-id="12">有值</td><td data-u2m-id="13"></td><td data-u2m-id="14"><button data-u2m-id="15">按钮</button></td></tr>
        <tr data-u2m-id="16"></tr>
      </tbody>
    </table>
    <p data-u2m-id="17">正文段落</p>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');

  // 表格结构全体保留——含空 th/td/tr 与无子节点的 col/colgroup
  for (const [tid, what] of [
    ['2', 'table'], ['3', 'colgroup'], ['4', 'col'], ['5', 'col'],
    ['6', 'thead'], ['7', 'tr'], ['8', '有值的 th'], ['9', '空 th'],
    ['10', 'tbody'], ['11', 'tr'], ['12', '有值的 td'], ['13', '空 td'],
    ['14', '含按钮的 td'], ['16', '空 tr'],
  ]) {
    assert.ok(cleaned.includes(`data-u2m-id="${tid}"`), `${what} (id=${tid}) 必须保留`);
  }
  assert.equal((cleaned.match(/<td[\s>]/g) || []).length, 3, 'td 数量应为 3（不丢空单元格）');
  assert.equal((cleaned.match(/<tr[\s>]/g) || []).length, 3, 'tr 数量应为 3（不丢空行）');
  assert.equal((cleaned.match(/<col[\s>]/g) || []).length, 2, 'col 数量应为 2');

  // 单元格内的按钮噪声照删，但留下空壳 td（不破坏列对齐）
  assert.ok(!/<button[\s>]/.test(cleaned), '单元格内的 button 仍应删除');
  assert.ok(!cleaned.includes('data-u2m-id="15"'), 'button 元素应删除');

  // 表格外的正文与级联行为不受影响
  assert.ok(cleaned.includes('data-u2m-id="17"'), '表格外正文必须保留');
  assert.ok(cleaned.includes('正文段落'), '正文文本必须保留');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 纯空白文本节点（缩进）不占位', async () => {
  // 回归：父元素开标签与子元素之间的缩进空白（>16 字符）曾被占位成
  // {{LONG_TEXT_k|N_CHARS}}，凭空给步骤 3 的 LLM 捏造"父子之间存在长文本"。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-ws-'));
  const url = 'https://example.com/ws-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  // 21 字符的纯空白（换行+缩进）夹在父开标签与子元素之间；
  // 另放一段真实长文本作对照（应正常占位）
  const ws = '\n' + ' '.repeat(20);
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">${ws}<div data-u2m-id="2">这是一段真实存在的长文本内容，用来对照占位行为。</div>${ws}<div data-u2m-id="3"></div>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  // 只有真实长文本被占位，纯空白不计入
  assert.equal(out.longTextCount, 1, '仅真实长文本应被占位，缩进空白不应计数');

  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  const between = cleaned.match(/data-u2m-id="1">([\s\S]*?)<div data-u2m-id="2"/);
  assert.ok(between, '应能找到父元素与第一个子元素之间的片段');
  assert.ok(!between[1].includes('LONG_TEXT'), '父子之间的缩进空白不应变成占位符');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 中英文分标准占位，并生成 2_long_text.json 恢复清单', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-lang-'));
  const url = 'https://example.com/lang-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  const zhLong = '汉'.repeat(17); // 17 字 > 16 → 占位（_chars）
  const zhShort = '汉'.repeat(16); // 16 字 → 不占位
  const enLong = Array(13).fill('word').join(' '); // 13 词 > 12 → 占位（_words）
  const enShort = Array(12).fill('word').join(' '); // 12 词、59 字符 → 不占位（与旧"纯字符数"行为的核心差异）
  const mixed = '汉字'.repeat(9); // 含汉字 → 按中文标准，18 字 → 占位（_chars）

  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1"><p data-u2m-id="2">${zhLong}</p></div>
  <div data-u2m-id="3"><p data-u2m-id="4">${zhShort}</p></div>
  <div data-u2m-id="5"><p data-u2m-id="6">${enLong}</p></div>
  <div data-u2m-id="7"><p data-u2m-id="8">${enShort}</p></div>
  <div data-u2m-id="9"><p data-u2m-id="10">${mixed}</p></div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.longTextCount, 3, '仅中文 17 字、英文 13 词、混合 18 字三段应被占位');

  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  // 中英文分别按字符数/单词数占位，单位后缀小写
  assert.ok(cleaned.includes('|17_chars}}'), '中文按字符数占位，后缀 _chars');
  assert.ok(cleaned.includes('|13_words}}'), '英文按单词数占位，后缀 _words');
  assert.ok(cleaned.includes('|18_chars}}'), '含汉字的混合文本按中文标准');
  // 12 词英文即使字符数(59) > 16 也不占位
  assert.ok(cleaned.includes(enShort), '12 词英文不应占位（即使字符数 > 16）');
  assert.ok(cleaned.includes(zhShort), '16 字中文不应占位');

  // 2_long_text.json：占位编号 → 原文映射
  assert.ok(out.longText, 'emit 应含 longText 恢复清单路径');
  const longTexts = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
  assert.deepEqual(longTexts, { 1: zhLong, 2: enLong, 3: mixed }, '编号→原文映射应完整');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clean_snapshot.mjs: 带样式快照保留样式，SVG 瘦身为壳，占位符与清洗版严格一致', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-clean-styled-'));
  const url = 'https://example.com/styled-article';
  const urlDir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(urlDir, { recursive: true });

  // HTML 长文本（应占位）+ SVG 内长文本与 body 内 <style> 长 CSS（不应占位，否则两版编号错位）
  const htmlLong = '这是一段足够长的中文文本，用来触发占位符的产生。';
  const svgLong = '很长的SVG文本内容，如果参与占位会导致编号错位的问题出现。';
  const cssLong = '/* 这是一段足够长的CSS注释，用来验证样式文本不会被占位。 */';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style>.x{color:red}</style></head>
<body>
  <style>.y{color:green}${cssLong}</style>
  <div data-u2m-id="1">
    <p data-u2m-id="2" style="color:blue">${htmlLong}</p>
    <svg id="fig1" class="chart" data-u2m-id="3" width="100" height="100"><text>${svgLong}</text></svg>
  </div>
</body></html>`;
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), snapshot);

  const script = path.resolve('script/clean_snapshot.mjs');
  const r = await runScript(process.execPath, [script, '--url', url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
  assert.ok(out.styledSnapshot, 'emit 应含 styledSnapshot 路径');
  const styled = fs.readFileSync(out.styledSnapshot, 'utf8');

  // 清洗版：无样式、SVG 清空
  assert.ok(!cleaned.match(/ style="/), '清洗版不应含 style 属性');
  assert.ok(!cleaned.includes('<style'), '清洗版不应含 <style> 标签');
  assert.ok(cleaned.includes('<svg></svg>'), '清洗版 SVG 应清空为壳');
  assert.ok(!cleaned.includes(svgLong), '清洗版不应残留 SVG 文本');

  // 带样式版：保留 style 属性与 <style> 标签；SVG 瘦身为壳（仅 id/class/data-u2m-id）
  assert.ok(styled.includes('style="color:blue"'), '带样式版应保留元素 style 属性');
  assert.ok(styled.includes('<style'), '带样式版应保留 <style> 标签');
  assert.ok(styled.includes(cssLong), '带样式版应保留 body 内 <style> 文本（原样，不占位）');
  const svgOpen = styled.match(/<svg[^>]*>/);
  assert.ok(svgOpen, '带样式版应含 <svg> 开标签');
  assert.ok(svgOpen[0].includes('id="fig1"'), 'svg 壳应保留 id');
  assert.ok(svgOpen[0].includes('class="chart"'), 'svg 壳应保留 class');
  assert.ok(svgOpen[0].includes('data-u2m-id="3"'), 'svg 壳应保留 data-u2m-id');
  assert.ok(!/width=|height=/.test(svgOpen[0]), 'svg 壳不应保留 width/height 等其他属性');
  assert.ok(!styled.includes(svgLong) && !styled.includes('<text'), '带样式版不应残留 SVG 子元素与文本');

  // 两版占位符集合完全一致（编号与 N 值逐一对应）
  const ph = (h) => (h.match(/\{\{LONG_TEXT_\d+\|\d+_[a-z]+\}\}/g) || []).sort();
  assert.deepEqual(ph(styled), ph(cleaned), '两版长文本占位符应完全一致');
  assert.ok(cleaned.includes('{{LONG_TEXT_'), 'HTML 长文本应被占位');
  assert.ok(!styled.includes(htmlLong), '带样式版中 HTML 长文本同样应被占位');

  // 恢复清单条数 = 占位数（SVG 文本与 <style> CSS 均不参与，故仅 htmlLong 一条）
  assert.equal(out.longTextCount, 1, '仅 HTML 长文本占位，SVG/style 文本不计入');
  const longTexts = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
  assert.deepEqual(longTexts, { 1: htmlLong }, '恢复清单应仅含 HTML 长文本');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('R2: class 噪声过滤——工具/哈希 token 剥除，语义 token 保留，带样式版不受影响', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <section data-u2m-id="2" class="article flex px-4 astro-3ef6ksr2 h-[30rem] text-xs hover:bg-x md:flex">正文内容</section>
    <div data-u2m-id="3" class="page-header btn-primary expn-content shiki">语义类元素</div>
    <div data-u2m-id="4" class="flex px-4 rounded">全是噪声</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r2-class');
  try {
    const sec = cleaned.match(/<section[^>]*>/)[0];
    assert.ok(sec.includes('class="article"'), `语义 token article 应保留: ${sec}`);
    assert.ok(!/(flex|px-4|astro-|30rem|text-xs|hover:|md:)/.test(sec), `噪声 token 应剥除: ${sec}`);
    const keep = cleaned.match(/<div data-u2m-id="3"[^>]*>/)[0];
    for (const tok of ['page-header', 'btn-primary', 'expn-content', 'shiki']) {
      assert.ok(keep.includes(tok), `两词 kebab 语义 token ${tok} 应保留: ${keep}`);
    }
    assert.ok(!/<div data-u2m-id="4"[^>]*class=/.test(cleaned), '全噪声 class 应连同属性删除');
    // 带样式版不受影响（硬约束）
    assert.ok(styled.includes('astro-3ef6ksr2') && styled.includes('h-[30rem]'), '带样式版保留原始 class');
  } finally { cleanup(); }
});
