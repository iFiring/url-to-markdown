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
  assert.ok(cleaned.includes('{{LONG_TEXT_'), '清洗版恢复长文本占位（两趟共享，与带样式版编号一致）');
  assert.ok(/<svg data-u2m-id="[0-9]+"><\/svg>/.test(cleaned) || !cleaned.includes('<svg'), 'SVG 壳保留 data-u2m-id');

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
  assert.ok(cleaned.includes('<svg data-u2m-id="11"></svg>'), 'svg 壳必须保留且带 id');
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

test('K6: table 整树折叠为 {{TABLE_TAG|N_rows|M_cols}}——带样式版结构完整（含空单元格）', async () => {
  // 回归：空 <td>/<th>/<tr>/<col> 不在 KEEP_EMPTY 白名单时会被空元素级联删除，
  // 删掉后表格行列错位；article-1 实测丢过整个 <colgroup>+4 <col>。
  // 清洗版整树折叠为行列 token（结构守护转移至带样式版断言）。
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <table data-u2m-id="2">
      <colgroup data-u2m-id="3"><col data-u2m-id="4"><col data-u2m-id="5"></colgroup>
      <thead data-u2m-id="6"><tr data-u2m-id="7"><th data-u2m-id="8">列A</th><th data-u2m-id="9"></th></tr></thead>
      <tbody data-u2m-id="10">
        <tr data-u2m-id="11"><td data-u2m-id="12">有值</td><td data-u2m-id="13"></td></tr>
      </tbody>
    </table>
    <p data-u2m-id="14">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k6-table');
  try {
    const seg = cleaned.match(/<table data-u2m-id="2"[^>]*>([\s\S]*?)<\/table>/)[1];
    assert.ok(seg === '{{TABLE_TAG|2_rows|2_cols}}', `table 应折叠为行列 token（thead 1 行 + tbody 1 行 × 2 列）: ${seg}`);
    assert.ok(!cleaned.includes('列A') && !cleaned.includes('data-u2m-id="3"'), '表格内部结构与内容从清洗版消失');
    assert.ok(cleaned.includes('正文段落'), '表外正文保留');
    // 带样式版：表格结构全体保留（含空 th/td/col——删空单元格会让行列错位）
    for (const [tid, what] of [
      ['3', 'colgroup'], ['4', 'col'], ['6', 'thead'], ['8', '有值的 th'], ['9', '空 th'],
      ['12', '有值的 td'], ['13', '空 td'],
    ]) {
      assert.ok(styled.includes(`data-u2m-id="${tid}"`), `${what} (id=${tid}) 带样式版必须保留`);
    }
    assert.ok(!styled.includes('{{TABLE_TAG'), '守卫: 带样式版不得出现行列 token');
  } finally { cleanup(); }
});

test('K6: 列数按各行 colspan 之和的最大值——网格列数而非单元格个数', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <table data-u2m-id="2">
      <tr data-u2m-id="3"><td data-u2m-id="4" colspan="3">跨三列</td><td data-u2m-id="5">尾列</td></tr>
      <tr data-u2m-id="6"><td data-u2m-id="7">甲</td><td data-u2m-id="8">乙</td></tr>
    </table>
    <p data-u2m-id="9">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k6-colspan');
  try {
    const seg = cleaned.match(/<table data-u2m-id="2"[^>]*>([\s\S]*?)<\/table>/)[1];
    // 行1: colspan 3 + 1 = 4 列；行2: 2 列 → 取最大 4；行数 2
    assert.ok(seg === '{{TABLE_TAG|2_rows|4_cols}}', `colspan 按网格列展开取各行最大: ${seg}`);
  } finally { cleanup(); }
});

test('K6: 嵌套表格的行列不计入外层——行归属按最近 table 判定', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <table data-u2m-id="2">
      <tr data-u2m-id="3">
        <td data-u2m-id="4">外层单元格
          <table data-u2m-id="5">
            <tr data-u2m-id="6"><td data-u2m-id="7">内层1</td><td data-u2m-id="8">内层2</td></tr>
            <tr data-u2m-id="9"><td data-u2m-id="10">内层3</td><td data-u2m-id="11">内层4</td></tr>
          </table>
        </td>
        <td data-u2m-id="12">外层右列</td>
      </tr>
    </table>
    <p data-u2m-id="13">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k6-nested');
  try {
    const seg = cleaned.match(/<table data-u2m-id="2"[^>]*>([\s\S]*?)<\/table>/)[1];
    // 外层只有 1 行 2 列；内层表格的 2 行不计入（整树折叠后内层随之消失）
    assert.ok(seg === '{{TABLE_TAG|1_rows|2_cols}}', `嵌套表格行列不计入外层: ${seg}`);
  } finally { cleanup(); }
});

test('clean_snapshot.mjs: 按钮保留——button 与 role="button" 两版都不再删除', async () => {
  // 2026-08-25 起按钮不再整删：FAQ 折叠头 / CTA / 卡片式 role=button 常是
  // 内容载体，整删或按字数取舍都会误伤正文——一律保留，交步骤 3 语义判断。
  const r = await runClean(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div id="root" data-u2m-id="1">
    <button data-u2m-id="2">复制</button>
    <button data-u2m-id="3">View complete API reference</button>
    <div role="button" data-u2m-id="4">展开全部章节内容</div>
    <a role="button" data-u2m-id="5">复制链接</a>
    <button data-u2m-id="6"></button>
    <input type="button" value="按钮型 input" data-u2m-id="7">
    <nav data-u2m-id="8"><button data-u2m-id="9">导航内按钮</button></nav>
    <p data-u2m-id="10">正文段落</p>
  </div>
</body></html>`, 'button-keep');

  for (const [id, what] of [
    ['2', '短文本 button'], ['3', '长文本 button'],
    ['4', 'role=button div'], ['5', 'role=button a'],
  ]) {
    assert.ok(r.cleaned.includes(`data-u2m-id="${id}"`), `${what} 清洗版应保留`);
    assert.ok(r.styled.includes(`data-u2m-id="${id}"`), `${what} 带样式版应保留`);
  }
  assert.ok(r.cleaned.includes('展开全部章节内容'), 'role=button 文本清洗版可见');
  // 空按钮无任何内容，仍被空元素级联删除
  assert.ok(!r.cleaned.includes('data-u2m-id="6"'), '空按钮应被空元素级联删除');
  // 按钮型 input 仍随表单控件删除（无子内容，value 文本极罕为正文）
  assert.ok(!r.cleaned.includes('data-u2m-id="7"'), '按钮型 input 仍删除');
  // nav 整删不变——nav 内按钮随之消失
  assert.ok(!r.cleaned.includes('data-u2m-id="8"'), 'nav 仍整删');
  assert.ok(!r.cleaned.includes('data-u2m-id="9"'), 'nav 内按钮随 nav 删除');
  assert.ok(r.cleaned.includes('正文段落'), '正文不受影响');
  r.cleanup();
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
  const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
  assert.ok(styled.includes('|17_chars}}'), '中文按字符数占位，后缀 _chars');
  assert.ok(styled.includes('|13_words}}'), '英文按单词数占位，后缀 _words');
  assert.ok(styled.includes('|18_chars}}'), '含汉字的混合文本按中文标准');
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
  assert.ok(/<svg data-u2m-id="3"><\/svg>/.test(cleaned), '清洗版 SVG 清空为壳且保留 id');
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

  // 占位两趟共享（2026-08-31 修订）：清洗版恢复 LONG_TEXT 占位，编号与
  // 带样式版逐一对应——占位步骤在共享段同位执行，还原链仍只走带样式版
  const ph = (h) => (h.match(/\{\{LONG_TEXT_\d+\|\d+_[a-z]+\}\}/g) || []).sort();
  assert.ok(ph(styled).length > 0, '带样式版 HTML 长文本应被占位');
  assert.deepEqual(ph(cleaned), ph(styled), '清洗版占位符应与带样式版逐一对应');
  assert.ok(!styled.includes(htmlLong), '带样式版中 HTML 长文本同样应被占位');

  // 恢复清单条数 = 占位数（SVG 文本与 <style> CSS 均不参与，故仅 htmlLong 一条）
  assert.equal(out.longTextCount, 1, '仅 HTML 长文本占位，SVG/style 文本不计入');
  const longTexts = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
  assert.deepEqual(longTexts, { 1: htmlLong }, '恢复清单应仅含 HTML 长文本');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('K1: class 语义过滤——工具/哈希/CSS-modules/变体剥除，语义 token 保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <section data-u2m-id="2" class="article flex px-4 astro-3ef6ksr2 h-[30rem] text-xs hover:bg-x md:flex -top-0.5 !h-9 _Button_6dmow_1 overflow-x-hidden shiki _tab_active">正文内容</section>
    <div data-u2m-id="3" class="page-header btn-primary expn-content">语义类元素</div>
    <div data-u2m-id="4" class="flex px-4 rounded overflow-auto border">全是噪声</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k1-class');
  try {
    const sec = cleaned.match(/<section[^>]*>/)[0];
    // _tab_active：纯语义下划线类（尾段不含数字）保留；_Button_6dmow_1（尾段含数字）仍删
    assert.ok(sec.includes('class="article _tab_active"'), `语义 token article 与纯语义下划线类 _tab_active 应保留: ${sec}`);
    assert.ok(!/(flex|px-4|astro-|30rem|text-xs|hover:|md:|top-0|!h-9|_Button_|overflow|shiki)/.test(sec), `噪声 token 应剥除: ${sec}`);
    const keep = cleaned.match(/<div data-u2m-id="3"[^>]*>/)[0];
    for (const tok of ['page-header', 'btn-primary', 'expn-content']) {
      assert.ok(keep.includes(tok), `两词 kebab 语义 token ${tok} 应保留: ${keep}`);
    }
    assert.ok(!/<div data-u2m-id="4"[^>]*class=/.test(cleaned), '全噪声 class 应连同属性删除');
    assert.ok(styled.includes('astro-3ef6ksr2') && styled.includes('h-[30rem]'), '带样式版保留原始 class');
  } finally { cleanup(); }
});

test('K2: 属性白名单——九属性存活（aria-label 截断保留），href/src/target/style 等删净，URL 一律清空', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <a data-u2m-id="2" href="https://example.com/x" aria-label="链接" target="_blank" data-1p-ignore="1">链接文本</a>
    <img data-u2m-id="3" src="https://example.com/i.png" alt="示意图" width="10" height="10">
    <div data-u2m-id="4" role="button" type="button" hidden="true" id="anchor" data-language="python" class="keep-me" tabindex="0" draggable="true">内容</div>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k2-attrs');
  try {
    const a = cleaned.match(/<a data-u2m-id="2"[^>]*>/)[0];
    // aria-label 2026-08-31 起入 clean 白名单（截断保留）；"链接" 1 句原样存活
    assert.ok(a.includes('aria-label="链接"'), `aria-label 应保留（"链接" 1 句原样）: ${a}`);
    assert.ok(!/href|target|data-1p/.test(a), `a 的 href/target/data 噪声应删净: ${a}`);
    const img = cleaned.match(/<img data-u2m-id="3"[^>]*>/)[0];
    assert.ok(!/src|width|height/.test(img), `img 的 src/宽高应删净: ${img}`);
    assert.ok(img.includes('alt="示意图"'), 'img 的 alt 语义保留');
    const div = cleaned.match(/<div data-u2m-id="4"[^>]*>/)[0];
    for (const attr of ['role="button"', 'type="button"', 'hidden="true"', 'id="anchor"', 'data-language="python"', 'class="keep-me"']) {
      assert.ok(div.includes(attr), `白名单属性 ${attr} 应保留: ${div}`);
    }
    assert.ok(!/tabindex|draggable/.test(div), `白名单外属性应删净: ${div}`);
    assert.ok(!cleaned.includes('lang='), 'html lang 应删（白名单外）');
    // 2026-08-28 起 styled 趟有自己的属性白名单：href 留（URL 源）、data-1p-ignore 删
    assert.ok(styled.includes('href="https://example.com/x"'), '带样式版保留 href（URL 源）');
    assert.ok(!styled.includes('data-1p-ignore'), '带样式版 data-* 脚手架属性应删净');
  } finally { cleanup(); }
});

test('K2b: aria-label 首末句截断——≥3 句保留首句+末句、中间 …；≤2 句原样；中英句末标点切句、逗号不切；两趟孪生一致', async () => {
  // 2026-08-31：aria-label 值在共享段截断（clean 与 styled 同位执行）。
  // 切句终止符 = 。！？；与 .!?;（不含逗号/顿号）；≥3 句才截断，≤2 句原样。
  const longZh = '复制到剪贴板。然后粘贴到编辑器。最后保存文件。';
  const longEn = 'First sentence. Second sentence here. Third sentence. Fourth one.';
  const semis = '第一分句；第二分句；第三分句；';
  const twoZh = '复制。粘贴。';
  const commaZh = '第一句，补充说明。第二句，补充说明。第三句，补充说明。';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <button data-u2m-id="2" aria-label="${longZh}">b1</button>
    <a data-u2m-id="3" aria-label="${longEn}">b2</a>
    <button data-u2m-id="4" aria-label="${semis}">b3</button>
    <button data-u2m-id="5" aria-label="${twoZh}">b4</button>
    <button data-u2m-id="6" aria-label="${commaZh}">b5</button>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k2b-aria-trunc');
  try {
    const grab = (html) => html.match(/aria-label="[^"]*"/g);
    // ≥3 句：首句 + … + 末句
    const wantZh = '复制到剪贴板。…最后保存文件。';
    assert.ok(cleaned.includes(`aria-label="${wantZh}"`), `clean 中文 ≥3 句应截断为首末句: ${grab(cleaned)}`);
    assert.ok(styled.includes(`aria-label="${wantZh}"`), `styled 中文 ≥3 句应截断（孪生一致）: ${grab(styled)}`);
    const wantEn = 'First sentence.…Fourth one.';
    assert.ok(cleaned.includes(`aria-label="${wantEn}"`), `clean 英文 ≥3 句应截断: ${grab(cleaned)}`);
    assert.ok(styled.includes(`aria-label="${wantEn}"`), `styled 英文 ≥3 句应截断（孪生一致）: ${grab(styled)}`);
    // 分号也是句末终止符
    const wantSemi = '第一分句；…第三分句；';
    assert.ok(cleaned.includes(`aria-label="${wantSemi}"`), `clean 分号切句应截断: ${grab(cleaned)}`);
    assert.ok(styled.includes(`aria-label="${wantSemi}"`), `styled 分号切句应截断: ${grab(styled)}`);
    // ≤2 句：原样
    assert.ok(cleaned.includes(`aria-label="${twoZh}"`), `clean 2 句原样保留: ${grab(cleaned)}`);
    assert.ok(styled.includes(`aria-label="${twoZh}"`), `styled 2 句原样保留: ${grab(styled)}`);
    // 逗号不切句：3 个句号 → 3 句，首末句内的逗号原样保留
    const wantComma = '第一句，补充说明。…第三句，补充说明。';
    assert.ok(cleaned.includes(`aria-label="${wantComma}"`), `clean 逗号不切句、首末句逗号保留: ${grab(cleaned)}`);
    assert.ok(styled.includes(`aria-label="${wantComma}"`), `styled 逗号不切句、首末句逗号保留: ${grab(styled)}`);
  } finally { cleanup(); }
});

test('K5: hidden 裸属性折叠为 {{HIDDEN_TAG|规模;构成}}——规模按占位前原文计，嵌套取外层', async () => {
  const attrLong = '这是一段仅靠 hidden 属性隐藏的中文文本';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <div data-u2m-id="2" hidden="true"><p data-u2m-id="3">${attrLong}</p><a data-u2m-id="4" href="/x">链接</a></div>
    <div data-u2m-id="5" hidden><div data-u2m-id="6" hidden="until-found"><p data-u2m-id="7">嵌套隐藏</p></div></div>
    <p data-u2m-id="8">正文段落</p>
  </div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'k5-hidden');
  try {
    const seg1 = cleaned.match(/<div data-u2m-id="2"[^>]*>([\s\S]*?)<\/div>/)[1];
    // 规模按占位前原文计：attrLong 23 字 + 链接 2 字 = 25——子树内长文本已被
    // 占位成 {{LONG_TEXT_1|23_chars}}，量占位符语法串会得 26 字（虚高）
    assert.ok(seg1 === '{{HIDDEN_TAG|25_chars;1_p/1_a}}', `子树应折为 HIDDEN_TAG 规模+构成 token: ${seg1}`);
    assert.ok(cleaned.match(/<div data-u2m-id="2"[^>]*>/)[0].includes('hidden'), 'hidden 属性保留（触发信号）');
    assert.ok(!cleaned.includes(attrLong) && !cleaned.includes('data-u2m-id="3"') && !cleaned.includes('data-u2m-id="4"'), '折叠子树内容应消失');
    const seg2 = cleaned.match(/<div data-u2m-id="5"[^>]*>([\s\S]*?)<\/div>/)[1];
    assert.ok(seg2 === '{{HIDDEN_TAG|4_chars;1_div/1_p}}', `嵌套 hidden 只折最外层: ${seg2}`);
    assert.ok(!cleaned.includes('data-u2m-id="6"') && !cleaned.includes('data-u2m-id="7"'), '内层 id 随外层折叠消失');
    assert.ok(!cleaned.includes('data-u2m-hidden'), 'data-u2m-hidden 属性应取消');
    assert.ok(cleaned.includes('正文段落'), '可见正文保留');
    // attrLong 23 字 > 16：带样式版以 LONG_TEXT 占位符保留、原文进恢复清单
    assert.ok(styled.includes('{{LONG_TEXT_1|') && styled.includes('data-u2m-id="3"'), '带样式版子树完整（长文本以占位符保留）');
    assert.ok(JSON.parse(fs.readFileSync(out.longText, 'utf8'))[1] === attrLong, '隐藏长文本原文在恢复清单完整保留');
    assert.ok(!styled.includes('{{HIDDEN_TAG'), '守卫: 带样式版不得出现 HIDDEN_TAG token');
  } finally { cleanup(); }
});

test('K7: pre 折叠为 {{PRE_CODE_TAG|N_lines}}——data-language 提升到 pre，行内 code 不动', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <pre data-u2m-id="2" class="shiki" tabindex="0"><code data-u2m-id="3" data-language="javascript"><span data-u2m-id="4" class="syntax-highlighter-line"><span data-u2m-id="5" class="shiki-token">import</span><span data-u2m-id="6" class="shiki-token"> OpenAI </span></span></code></pre>
    <p data-u2m-id="7">inline <code data-u2m-id="8">client.create()</code> code</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k7-pre');
  try {
    assert.ok(
      /<pre[^>]*data-u2m-id="2"[^>]*data-language="javascript"[^>]*>\{\{PRE_CODE_TAG\|1_lines\}\}<\/pre>/.test(cleaned),
      `pre 应折叠为行数 token 且 data-language 提升: ${cleaned.match(/<pre[\s\S]*?<\/pre>/)?.[0]}`
    );
    assert.ok(!cleaned.includes('data-u2m-id="3"') && !cleaned.includes('data-u2m-id="4"'), 'pre 内部 id 随子树删除');
    assert.ok(!cleaned.includes('shiki-token'), 'token span 应删除');
    // p7 外围 filler 特意用英文短词——本断言守护 K7 不动行内 code；
    // 占位按文本节点判阈值，各节点均低于阈值、原文保留
    assert.ok(cleaned.includes('<code data-u2m-id="8">client.create()</code>'), '行内 code 不动');
    assert.ok(styled.includes('shiki-token') && styled.includes('import'), '带样式版完整保留代码');
    assert.ok(!styled.includes('{{PRE_CODE_TAG'), '守卫: 带样式版不得出现行数 token');
  } finally { cleanup(); }
});

test('K7: 行数按换行切分——高亮 span 是语法 token 不是行', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <pre data-u2m-id="2"><code data-u2m-id="3"><span data-u2m-id="4" class="token keyword">const</span> a = 1;
<span data-u2m-id="5" class="token keyword">const</span> b = <span data-u2m-id="6" class="token number">2</span>;</code></pre>
    <p data-u2m-id="7">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k7-token-span');
  try {
    const seg = cleaned.match(/<pre data-u2m-id="2"[^>]*>([\s\S]*?)<\/pre>/)[1];
    // 3 个高亮 span 但只有 2 行——数 span 会得 3，数换行得 2
    assert.ok(seg === '{{PRE_CODE_TAG|2_lines}}', `行数按换行切分而非 span 个数: ${seg}`);
  } finally { cleanup(); }
});

test('K7: 每行一个 div 的编辑器式代码块——div 行块数兜底，容器 div 不虚增', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <pre data-u2m-id="2"><code data-u2m-id="3"><div>line1</div><div>line2</div><div>line3</div></code></pre>
    <pre data-u2m-id="4"><code data-u2m-id="5"><div>let a = 1;
let b = 2;
let c = 3;</div></code></pre>
    <p data-u2m-id="6">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k7-div-lines');
  try {
    // 无换行文本节点（div 块拼接无分隔）→ 换行法只得 1，div 行块 3 条兜底
    const divPerLine = cleaned.match(/<pre data-u2m-id="2"[^>]*>([\s\S]*?)<\/pre>/)[1];
    assert.ok(divPerLine === '{{PRE_CODE_TAG|3_lines}}', `div 行块数兜底编辑器式代码块: ${divPerLine}`);
    // 单个容器 div 内含真实换行 → 换行法 3 胜过 div 计数 1，不虚增
    const containerDiv = cleaned.match(/<pre data-u2m-id="4"[^>]*>([\s\S]*?)<\/pre>/)[1];
    assert.ok(containerDiv === '{{PRE_CODE_TAG|3_lines}}', `容器 div 不虚增行数: ${containerDiv}`);
  } finally { cleanup(); }
});

test('K7: 空 pre 折叠为 0_lines', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <pre data-u2m-id="2"></pre>
    <p data-u2m-id="3">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k7-empty-pre');
  try {
    const seg = cleaned.match(/<pre data-u2m-id="2"[^>]*>([\s\S]*?)<\/pre>/)[1];
    assert.ok(seg === '{{PRE_CODE_TAG|0_lines}}', `空 pre 行数为 0: ${seg}`);
  } finally { cleanup(); }
});

test('K7: 行数在长文本占位前预计算——占位吞掉换行后行数不塌缩', async () => {
  // 回归：pre 内单个长文本节点（含汉字、超阈值）被两趟共享的长文本占位折叠成
  // {{LONG_TEXT_k|N_chars}} 后，textContent 不再含换行——行数若在占位后才量会
  // 塌缩成 1。行数必须在共享段占位之前预计算挂 expando。
  const preLong = '第一行超过阈值的中文长文本行；\n第二行超过阈值的中文长文本行；\n第三行超过阈值的中文长文本行；';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <pre data-u2m-id="2"><code data-u2m-id="3">${preLong}</code></pre>
    <p data-u2m-id="4">正文段落</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k7-precompute');
  try {
    const seg = cleaned.match(/<pre data-u2m-id="2"[^>]*>([\s\S]*?)<\/pre>/)[1];
    assert.ok(seg === '{{PRE_CODE_TAG|3_lines}}', `行数按占位前原文的换行计（3 行而非 1）: ${seg}`);
    // 对照：带样式版里这段 pre 文本同样被占位（既有行为不变）
    assert.ok(styled.includes('{{LONG_TEXT_1|'), '带样式版 pre 长文本照常占位');
  } finally { cleanup(); }
});

test('K6/K7: 带 hidden 的 table/pre 由 K5 独占折叠——不被二次覆盖', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <table data-u2m-id="2" hidden="true"><tr><td>隐藏表格单元甲</td></tr></table>
    <pre data-u2m-id="3" hidden><code>hidden code block</code></pre>
    <p data-u2m-id="4">正文段落。</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k67-hidden-skip');
  try {
    const tbl = cleaned.match(/<table data-u2m-id="2"[^>]*>([\s\S]*?)<\/table>/)[1];
    // chromium 解析 <table><tr> 时按规范自动插入 tbody，K5 构成含 1_tbody
    assert.ok(tbl === '{{HIDDEN_TAG|7_chars;1_tbody/1_tr/1_td}}', `hidden table 保留 K5 折叠 token: ${tbl}`);
    assert.ok(!/\{\{TABLE_TAG/.test(tbl), '不得被 K6 覆盖');
    const pre = cleaned.match(/<pre data-u2m-id="3"[^>]*>([\s\S]*?)<\/pre>/)[1];
    assert.ok(pre === '{{HIDDEN_TAG|3_words;1_code}}', `hidden pre 保留 K5 折叠 token: ${pre}`);
    assert.ok(!/\{\{PRE_CODE_TAG/.test(pre), '不得被 K7 覆盖');
    assert.ok(cleaned.includes('正文段落'), '可见正文不受影响');
  } finally { cleanup(); }
});

test('R4+R5: astro 包装解包；安全位置空白删除、行内间空白保留', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <astro-island data-u2m-id="2" component-url="/x.js"><p data-u2m-id="3">岛内容</p></astro-island>
    <astro-slot data-u2m-id="4"><span data-u2m-id="5">槽内容</span></astro-slot>
    <div data-u2m-id="6">
      <p data-u2m-id="7">a</p>
      <p data-u2m-id="8">b</p>
    </div>
    <p data-u2m-id="9">x <a data-u2m-id="10" href="/y">链接</a> z</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'r4r5');
  try {
    assert.ok(!/<astro-island[\s>]/.test(cleaned) && !/<astro-slot[\s>]/.test(cleaned), 'astro 包装应解包');
    assert.ok(!cleaned.includes('data-u2m-id="2"') && !cleaned.includes('data-u2m-id="4"'), '包装自身 id 随包装弃置');
    assert.ok(cleaned.includes('data-u2m-id="3"') && cleaned.includes('岛内容'), '子元素上提保留');
    assert.ok(cleaned.includes('data-u2m-id="5"') && cleaned.includes('槽内容'), 'slot 子元素上提保留');
    // 块级元素之间的换行缩进删除
    const block = cleaned.match(/<div data-u2m-id="6">([\s\S]*?)<\/div>/)[1];
    assert.ok(!/\n\s/.test(block), `块级间空白应删除: ${JSON.stringify(block)}`);
    // 行内相邻文本/元素之间的空白保留
    const inline = cleaned.match(/<p data-u2m-id="9">([\s\S]*?)<\/p>/)[1];
    assert.ok(inline.includes('x <a') && inline.includes('> z'), `行内间空白应保留: ${JSON.stringify(inline)}`);
    // 2026-08-28 起 astro 解包两趟共享：带样式版同样解包（脚手架不流进步骤 4-7）
    assert.ok(!/<astro-[a-z]/.test(styled), '带样式版 astro 包装同样解包');
    assert.ok(styled.includes('data-u2m-id="3"') && styled.includes('data-u2m-id="5"'), '带样式版子元素上提保留');
  } finally { cleanup(); }
});

test('守卫: 长文本占位两趟共享——清洗版与带样式版占位集合逐一对应，步骤 2 不再 import juice', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1"><p data-u2m-id="2">这是一段超过十六个汉字的长文本，两趟都应为其生成占位符。</p></div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 'guard-terminal');
  try {
    const ph = (h) => (h.match(/\{\{LONG_TEXT_\d+\|\d+_[a-z]+\}\}/g) || []).sort();
    assert.equal(ph(styled).length, 1, '带样式版保留 LONG_TEXT 占位');
    assert.deepEqual(ph(cleaned), ph(styled), '清洗版占位符与带样式版逐一对应（编号一致）');
    assert.equal(out.longTextCount, 1, '恢复清单从共享占位产出');
    const src = fs.readFileSync(path.resolve(thisDir, '../../script/clean_snapshot.mjs'), 'utf8');
    assert.ok(!src.includes("from 'juice'"), '步骤 2 不再 import juice');
  } finally { cleanup(); }
});

test('长文本占位（两趟共享）——清洗版按文本节点折叠、行内结构保留、短文本原文', async () => {
  const zh17 = '汉'.repeat(17);                       // 17 字 > 16 → 占位
  const zh16 = '汉'.repeat(16);                       // 16 字 → 保留
  const en13 = Array(13).fill('word').join(' ');      // 13 词 > 12 → 占位
  const en12 = Array(12).fill('word').join(' ');      // 12 词 → 保留
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <p data-u2m-id="2">${zh17}</p>
    <p data-u2m-id="3">${zh16}</p>
    <p data-u2m-id="4">${en13}</p>
    <p data-u2m-id="5">${en12}</p>
    <p data-u2m-id="6">Use the <a data-u2m-id="7" href="/x">Prompt Caching Dashboard</a> to monitor cache hit rates and usage over time.</p>
    <p data-u2m-id="8">x <a data-u2m-id="9">链接</a> y</p>
  </div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k8-run');
  try {
    assert.ok(/<p data-u2m-id="2">\{\{LONG_TEXT_1\|17_chars\}\}<\/p>/.test(cleaned), '17 字文本节点清洗版同样占位');
    assert.ok(cleaned.includes(zh16), '16 字文本保留原文');
    assert.ok(/<p data-u2m-id="4">\{\{LONG_TEXT_2\|13_words\}\}<\/p>/.test(cleaned), '13 词文本节点清洗版同样占位');
    assert.ok(cleaned.includes(en12), '12 词文本保留原文');
    // 行内混排段（合计 14 词 > 12 阈值）不再整段折叠：各文本节点均低于阈值、
    // 全部原文保留，<a> 结构保真——run 整段吞噬曾让步骤 3 看不到行内结构
    const mixed = cleaned.match(/<p data-u2m-id="6">([\s\S]*?)<\/p>/)[1];
    assert.ok(mixed.includes('<a data-u2m-id="7">Prompt Caching Dashboard</a>'), `行内元素结构保留: ${mixed}`);
    assert.ok(mixed.startsWith('Use the ') && mixed.includes(' to monitor cache hit rates and usage over time.'), `行内短文本原文保留: ${mixed}`);
    const short = cleaned.match(/<p data-u2m-id="8">([\s\S]*?)<\/p>/)[1];
    assert.ok(short.includes('x <a') && short.includes('> y'), `短文本保留原文与行内间空白: ${JSON.stringify(short)}`);
    assert.ok(styled.includes('Prompt Caching Dashboard') && styled.includes('href="/x"'), '带样式版不受影响');
  } finally { cleanup(); }
});

test('长文本占位（两趟共享）——含 img 的段落：文本占位、img 与 alt 保持可引用', async () => {
  const long = '这是一段超过十六个汉字的长文本配上图片，构成图注场景。';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <p data-u2m-id="2">${long}<img data-u2m-id="3" src="x.png" alt="配图"></p>
    <p data-u2m-id="4">正文对照段落。</p>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k8-img');
  try {
    const seg = cleaned.match(/<p data-u2m-id="2">([\s\S]*?)<\/p>/)[1];
    assert.ok(seg.includes('{{LONG_TEXT_1|27_chars}}'), `长文本节点应占位: ${seg}`);
    assert.ok(!seg.includes(long), '原文不应残留清洗版');
    assert.ok(seg.includes('<img data-u2m-id="3" alt="配图">') || /<img data-u2m-id="3"[^>]*alt="配图"[^>]*>/.test(seg), 'img 元素与 alt 保留');
  } finally { cleanup(); }
});

test('行内结构保留——icon span 内 svg、短文本不经任何折叠', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <button data-u2m-id="2"><span data-u2m-id="3"><svg data-u2m-id="4"></svg></span> <span data-u2m-id="5">Copy Page</span></button>
  </div>
</body></html>`;
  const { cleaned, cleanup } = await runClean(snapshot, 'k8-break');
  try {
    const seg = cleaned.match(/<button data-u2m-id="2">([\s\S]*?)<\/button>/)[1];
    assert.ok(seg.includes('<svg data-u2m-id="4"></svg>'), 'icon span 内的 svg 保留');
    assert.ok(seg.includes('Copy Page'), '短文本保留原文');
    assert.ok(!/\{\{/.test(seg), `短文本结构不经折叠: ${seg}`);
  } finally { cleanup(); }
});

test('<title> 不占位——长中文标题保留作步骤 3 识别线索', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>提示缓存使用指南与最佳实践完全详解手册</title></head>
<body>
  <div data-u2m-id="1"><p data-u2m-id="2">正文段落。</p></div>
</body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'k8-title');
  try {
    assert.ok(cleaned.includes('<title>提示缓存使用指南与最佳实践完全详解手册</title>'), 'title 原文应保留（占位 treewalker 只走 body）');
    assert.ok(!/<title>\{\{/.test(cleaned), 'title 内不应出现占位符');
    assert.ok(styled.includes('提示缓存使用指南与最佳实践完全详解手册'), '带样式版不受影响');
  } finally { cleanup(); }
});

test('H1/H2/H3 整子树豁免占位——长标题原文保留作步骤 3 识别线索；H4 仍占位', async () => {
  // 与 <title> 不占位同款 rationale：H1/H2/H3 是标题层级锚点，占位成
  // {{LONG_TEXT_k|n_chars}} 会让步骤 3 的 LLM 看不到真实标题文本、无从判
  // 标题层级与 key id 取舍。豁免整子树（嵌套 span/a 等后代文本节点一并豁免，
  // 子树结构原样保留）；H4/H5/H6 仍按阈值占位（字面取 H1/H2/H3）。
  const zhH2 = '汉'.repeat(17);     // 17 字 > 16 → 若不豁免会占位
  const zhSubA = '链'.repeat(17);   // 嵌在 h2 内 a 里的 17 字 → 子树豁免
  const zhH3 = '字'.repeat(18);     // 18 字
  const zhH4 = '题'.repeat(19);     // 19 字 → H4 仍占位
  const zhP = '段'.repeat(20);      // 20 字 → 普通段落照常占位
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <h2 data-u2m-id="2"><span data-u2m-id="3">${zhH2}</span> <a data-u2m-id="4" href="/x">${zhSubA}</a></h2>
    <h3 data-u2m-id="5">${zhH3}</h3>
    <h4 data-u2m-id="6">${zhH4}</h4>
    <p data-u2m-id="7">${zhP}</p>
  </div>
</body></html>`;
  const { cleaned, styled, out, cleanup } = await runClean(snapshot, 'h1-h3-exempt');
  try {
    // H2 整子树（含嵌套 span 与 a 的长文本）原文保留、不出现占位符
    const h2 = cleaned.match(/<h2 data-u2m-id="2">([\s\S]*?)<\/h2>/)[1];
    assert.ok(h2.includes(zhH2), `H2 内 span 长文本应原文保留（豁免）: ${h2}`);
    assert.ok(h2.includes(zhSubA), `H2 内 a 长文本应原文保留（子树豁免）: ${h2}`);
    assert.ok(!/\{\{LONG_TEXT/.test(h2), `H2 子树不应出现占位符: ${h2}`);
    // H3 直接长文本原文保留
    assert.ok(cleaned.includes(`<h3 data-u2m-id="5">${zhH3}</h3>`), 'H3 长文本原文保留（豁免）');
    // H4 仍按阈值占位
    assert.ok(/<h4 data-u2m-id="6">\{\{LONG_TEXT_\d+\|19_chars\}\}<\/h4>/.test(cleaned), `H4 长文本仍占位: ${cleaned.match(/<h4[^]*?<\/h4>/)}`);
    // 普通长段落仍占位
    assert.ok(/<p data-u2m-id="7">\{\{LONG_TEXT_\d+\|20_chars\}\}<\/p>/.test(cleaned), '普通长段落仍占位');
    // 标题文本不进恢复清单；H4 与段落文本进清单
    const longTexts = JSON.parse(fs.readFileSync(out.longText, 'utf8'));
    const vals = Object.values(longTexts);
    assert.ok(!vals.includes(zhH2) && !vals.includes(zhH3) && !vals.includes(zhSubA), 'H1/H2/H3 标题文本不应进恢复清单');
    assert.ok(vals.includes(zhH4) && vals.includes(zhP), 'H4 与段落长文本应进恢复清单');
    // 带样式版同样豁免
    assert.ok(styled.includes(zhH2) && styled.includes(zhH3) && styled.includes(zhSubA), '带样式版标题原文保留');
  } finally { cleanup(); }
});

test('S1: astro- 前缀解包提升至两趟——带样式版同样解包，LONG_TEXT 编号不受影响', async () => {
  // 2026-08-28 起 K4 从清洗版独占提升为两趟共享：带样式版是步骤 4-7 的输入源，
  // astro 脚手架（含巨量 props 属性）曾一路流进 6_article.html（LLM 输入）。
  // 枚举扩展为 astro- 前缀匹配——该前缀是框架保留命名空间，static-slot 变体一并解包。
  const longZh = '这是一段放在岛屿里的超长中文文本，用于验证占位编号不受解包扰动。';
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body>
  <div data-u2m-id="1">
    <astro-island data-u2m-id="2" component-url="/x.js" props="{&quot;a&quot;:1}"><p data-u2m-id="3">${longZh}</p></astro-island>
    <astro-slot data-u2m-id="4"><span data-u2m-id="5">槽内容</span></astro-slot>
    <astro-static-slot data-u2m-id="6"><em data-u2m-id="7">静态槽</em></astro-static-slot>
    <p data-u2m-id="8">正文段落。</p>
  </div>
</body></html>`;
  const { out, cleaned, styled, cleanup } = await runClean(snapshot, 's1-astro-styled');
  try {
    // 两版都无 astro- 前缀标签（文本节点里的 < 会被序列化转义，开标签匹配不会误报）
    assert.ok(!/<astro-[a-z]/.test(styled), '带样式版 astro- 前缀标签应解包');
    assert.ok(!/<astro-[a-z]/.test(cleaned), '清洗版 astro- 前缀标签应解包（既有行为不回退）');
    // 包装 id 弃置、子元素上提
    assert.ok(!styled.includes('data-u2m-id="2"') && !styled.includes('data-u2m-id="4"') && !styled.includes('data-u2m-id="6"'), '包装自身 id 随包装弃置');
    for (const [id, what] of [['3', '岛内 p'], ['5', 'slot span'], ['7', 'static-slot em'], ['8', '正文 p']]) {
      assert.ok(styled.includes(`data-u2m-id="${id}"`), `${what} 带样式版上提保留`);
    }
    // 巨型脚手架属性随包装消失
    assert.ok(!styled.includes('component-url') && !styled.includes('props='), 'astro 脚手架属性随包装消失');
    // 岛内长文本仍正常占位、编号从 1 起（解包不增删文本节点、文档序不变）
    assert.ok(styled.includes('{{LONG_TEXT_1|'), '岛内长文本占位编号从 1 起');
    assert.equal(JSON.parse(fs.readFileSync(out.longText, 'utf8'))[1], longZh, '恢复清单内容完整');
  } finally { cleanup(); }
});

test('S2: 带样式版属性白名单——22 个内容/级联属性存活，脚手架属性删净，<style> 豁免', async () => {
  // 带样式版保留集 = clean K2 八属性 + style/href/src/width/height（juice 输入、
  // 步骤 7 链接/图片 URL 源、img 权重信号）+ 内容信号属性（colspan/rowspan/
  // start/aria-label/data-src/srcset/datetime/open/lang——跨格表格、ol 起始
  // 编号、icon-only 可达名、懒加载 URL、details 展开态、语言信号）。
  // <style> 标签整体豁免（media 等级联线索），注入的 meta charset 在白名单
  // 之后、天然存活。
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style data-astro-raw="1" media="screen">.x{color:red}</style></head>
<body>
  <div data-u2m-id="1">
    <a data-u2m-id="2" href="https://example.com/x" target="_blank" rel="noopener" aria-label="链接说明" data-v-1234abcd>链接文本</a>
    <img data-u2m-id="3" src="https://example.com/i.png" alt="示意图" width="640" height="360" srcset="i@2x.png 2x" loading="lazy" data-src="lazy.png">
    <div data-u2m-id="4" style="display:grid" role="button" type="button" hidden="true" id="anchor" data-language="python" class="keep-me" tabindex="0" draggable="true" lang="zh-CN">内容</div>
    <table data-u2m-id="5"><tr><td data-u2m-id="6" colspan="2" rowspan="3">单元格</td></tr></table>
    <ol data-u2m-id="7" start="5"><li data-u2m-id="8">条款</li></ol>
    <details data-u2m-id="9" open><summary data-u2m-id="10">细节</summary></details>
    <time data-u2m-id="11" datetime="2026-08-28">8月28日</time>
  </div>
</body></html>`;
  const { styled, cleanup } = await runClean(snapshot, 's2-styled-attrs');
  try {
    const a = styled.match(/<a data-u2m-id="2"[^>]*>/)[0];
    assert.ok(a.includes('href="https://example.com/x"'), `href 应保留（步骤 7 链接源）: ${a}`);
    assert.ok(a.includes('aria-label="链接说明"'), `aria-label 应保留（icon-only 可达名）: ${a}`);
    assert.ok(!/target|rel=|data-v-/.test(a), `a 的脚手架属性应删净: ${a}`);
    const img = styled.match(/<img data-u2m-id="3"[^>]*>/)[0];
    for (const attr of ['src="https://example.com/i.png"', 'alt="示意图"', 'width="640"', 'height="360"', 'srcset="i@2x.png 2x"', 'data-src="lazy.png"']) {
      assert.ok(img.includes(attr), `img 白名单属性 ${attr} 应保留: ${img}`);
    }
    assert.ok(!img.includes('loading'), `img 的 loading 应删净: ${img}`);
    const div = styled.match(/<div data-u2m-id="4"[^>]*>/)[0];
    for (const attr of ['style="display:grid"', 'role="button"', 'type="button"', 'hidden="true"', 'id="anchor"', 'data-language="python"', 'class="keep-me"', 'lang="zh-CN"']) {
      assert.ok(div.includes(attr), `白名单属性 ${attr} 应保留: ${div}`);
    }
    assert.ok(!/tabindex|draggable/.test(div), `白名单外属性应删净: ${div}`);
    const td = styled.match(/<td data-u2m-id="6"[^>]*>/)[0];
    assert.ok(td.includes('colspan="2"') && td.includes('rowspan="3"'), `跨格信号应保留（步骤 7 判复杂表格→trans2img）: ${td}`);
    assert.ok(styled.includes('<ol data-u2m-id="7" start="5"'), 'ol start 应保留（起始编号）');
    assert.ok(/<details data-u2m-id="9" open/.test(styled), 'details open 应保留（展开态）');
    assert.ok(styled.includes('datetime="2026-08-28"'), 'time datetime 应保留（日期原文）');
    // <style> 标签豁免：media 等级联线索与自身属性整体保留
    assert.ok(/<style[^>]*media="screen"/.test(styled), '<style> 的 media 属性应豁免保留');
    assert.ok(/<style[^>]*data-astro-raw/.test(styled), '<style> 标签属性整体豁免');
    assert.ok(styled.includes('.x{color:red}'), '<style> 文本保留');
    // html lang 保留（extract_article 照抄语言信号）；meta charset 注入在白名单之后
    assert.ok(/<html lang="zh-CN">/.test(styled), 'html lang 应保留（语言信号，步骤 6 照抄）');
    assert.ok(/<head><meta charset="utf-8">/.test(styled), 'meta charset 注入在白名单后仍存活');
  } finally { cleanup(); }
});

test('S3: <style> 选择器引用的属性动态保留——未引用的 data-* 照删', async () => {
  // 回归（code-review F2）：白名单静态删 data-theme 等曾断 juice 级联——
  // article-1 实测丢 45 条 border/background/display 声明。规则：白名单执行
  // 前扫 <style> 文本收集 attribute-selector 引用的属性名，引用即保留
  // （data-theme/data-width/[open]/Vue scoped data-v-* 一并覆盖），未引用照删。
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>
<style>.card[data-theme="dark"]{border:1px solid #000}h1[data-v-abc123]{font-weight:700}</style>
</head>
<body>
  <div data-u2m-id="1">
    <p data-u2m-id="2" class="card" data-theme="dark" data-unref="x">深色卡片</p>
    <h1 data-u2m-id="3" data-v-abc123>标题</h1>
  </div>
</body></html>`;
  const { styled, cleanup } = await runClean(snapshot, 's3-selector-attrs');
  try {
    const p = styled.match(/<p data-u2m-id="2"[^>]*>/)[0];
    assert.ok(p.includes('data-theme="dark"'), `选择器引用的 data-theme 应保留（juice 级联依赖）: ${p}`);
    assert.ok(!p.includes('data-unref'), `未被选择器引用的 data-* 应照删: ${p}`);
    assert.ok(styled.includes('data-v-abc123'), 'Vue scoped data-v-*（被 [data-v-abc123] 选择器引用）应保留');
  } finally { cleanup(); }
});

test('带样式版注入 <meta charset="utf-8">——清洗版不注入', async () => {
  const snapshot = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>
<body><div data-u2m-id="1"><p data-u2m-id="2">正文段落。</p></div></body></html>`;
  const { cleaned, styled, cleanup } = await runClean(snapshot, 'charset-meta');
  try {
    assert.ok(/<head><meta charset="utf-8">/.test(styled), '带样式版 head 首位应注入 meta charset');
    assert.ok(!/meta charset/i.test(cleaned), '清洗版不注入 meta');
  } finally { cleanup(); }
});

