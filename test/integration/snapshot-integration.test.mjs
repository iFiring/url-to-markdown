import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';

const snapshotScript = path.resolve('script/snapshot.mjs');
const cleanScript = path.resolve('script/clean_snapshot.mjs');
const chunkerScript = path.resolve('script/chunker.mjs');
let server;
let tmpRoot;

before(async () => {
  server = await startFixtureServer();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-snapshot-'));
});

after(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('snapshot.mjs: 静态文章页 → ok + 1_snapshot.html', async () => {
  const url = `${server.url}/static-article.html`;
  const r = await runScript(process.execPath, [snapshotScript, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.elements > 0, '应有标记元素');
  assert.ok(fs.existsSync(out.snapshot), '1_snapshot.html 应存在');

  // 验证快照内容
  const html = fs.readFileSync(out.snapshot, 'utf8');
  assert.ok(html.includes('data-u2m-id'), '应含 data-u2m-id');
  assert.ok(!html.includes('<script'), '不应含 script 标签');
});

test('snapshot.mjs: 虚拟列表页 → error + virtual_list', async () => {
  const url = `${server.url}/virtual-list.html`;
  const r = await runScript(process.execPath, [snapshotScript, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.equal(out.reason, 'virtual_list');
});

test('snapshot.mjs: 标记 body 全部元素（排除纯文本修饰标签与 svg/math 内部）', async () => {
  const url = `${server.url}/inline-marking.html`;
  const r = await runScript(process.execPath, [snapshotScript, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(out.elements > 0, '应有标记元素');
  const html = fs.readFileSync(out.snapshot, 'utf8');

  // 开标签计数（(?=[\s>/]) 防止 <b 误匹配 <br>/<body>、<i 误匹配 <img> 等）
  const total = (tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])`, 'g')) || []).length;
  const withId = (tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])(?=[^>]*data-u2m-id)[^>]*>`, 'g')) || []).length;

  // 块级与有结构意义的行内元素（span/a/code/img）：全部标记
  for (const tag of ['main', 'div', 'p', 'h1', 'span', 'a', 'code', 'img', 'svg', 'math']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), total(tag), `<${tag}> 应全部带 data-u2m-id`);
  }
  // 纯文本修饰与薄语义行内标签：不标记
  for (const tag of ['strong', 'em', 'b', 'i', 'u', 's', 'mark', 'sub', 'sup', 'br', 'wbr', 'abbr', 'q', 'time', 'kbd', 'samp', 'cite']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), 0, `<${tag}> 不应带 data-u2m-id`);
  }
  // svg/math 内部后代不标记（根元素在上面已验证标记）
  for (const tag of ['g', 'rect', 'circle', 'path', 'mrow', 'mi', 'mo', 'mn']) {
    assert.ok(total(tag) > 0, `夹具应含 <${tag}>`);
    assert.equal(withId(tag), 0, `<${tag}>（svg/math 内部）不应带 data-u2m-id`);
  }
});

// === 完整管线测试：步骤 1 → 2 → 4 ===

/**
 * 运行完整管线并验证产物。
 * @param {string} fixtureName - 夹具文件名（如 article-1.html）
 * @param {string} keyIdsFixture - key_ids 夹具文件名（如 article-1_key_ids.json）
 */
async function runPipelineTest(fixtureName, keyIdsFixture) {
  const url = `${server.url}/${fixtureName}`;

  // 步骤 1：快照
  const r1 = await runScript(process.execPath, [snapshotScript, url], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r1.code, 0, `步骤 1 失败: ${r1.stderr}`);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.status, 'ok');
  assert.ok(out1.elements > 0, `${fixtureName}: 应有标记元素`);

  // 从快照路径推导 urlDir
  const snapshotPath = out1.snapshot; // e.g. /tmp/u2m-xxx/<url-dir>/steps/1_snapshot.html
  const stepsDir = path.dirname(snapshotPath);
  const urlDir = path.dirname(stepsDir);

  // 步骤 2：清洗
  const r2 = await runScript(process.execPath, [cleanScript, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r2.code, 0, `步骤 2 失败: ${r2.stderr}`);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.status, 'ok');
  assert.ok(out2.longTextCount > 0, `${fixtureName}: 应有长文本占位符`);

  // 验证清洗产物
  const cleanedPath = path.join(stepsDir, '2_clean_snapshot.html');
  assert.ok(fs.existsSync(cleanedPath), '2_clean_snapshot.html 应存在');
  const cleaned = fs.readFileSync(cleanedPath, 'utf8');
  assert.ok(!cleaned.match(/ style="/), `${fixtureName}: 清洗后不应含 CSS style 属性`);
  assert.ok(cleaned.includes('LONG_TEXT'), `${fixtureName}: 应含长文本占位符`);
  // 按钮类控件（button / role=button / input 按钮）是交互 UI 噪声，整体删除；
  // 断言限定在开标签位置，避免误伤正文里恰好出现的同名字符串
  assert.ok(!/<button[\s>]/.test(cleaned), `${fixtureName}: 清洗后不应含 <button> 标签`);
  assert.ok(
    !/<[a-z][a-z0-9-]*[^>]*\srole\s*=\s*["']button["']/i.test(cleaned),
    `${fixtureName}: 清洗后不应含 role="button" 控件`
  );
  // 空壳元素（子树无非空白文本、无内容元素）应被级联删除。
  // 断言锚定 <div> 开标签——否则 <img ... id></div> 中 img 的闭尖括号会误命中
  assert.ok(
    !/<div[^>]*data-u2m-id="\d+"[^>]*><\/div>/.test(cleaned),
    `${fixtureName}: 清洗后不应残留空 div`
  );
  // 2_long_text.json：占位编号 → 原文映射，条数与占位符一致，原文可在清洗快照中定位回占位符
  assert.ok(out2.longText, `${fixtureName}: emit 应含 longText 路径`);
  const longTextPath = path.join(stepsDir, '2_long_text.json');
  assert.ok(fs.existsSync(longTextPath), `${fixtureName}: 2_long_text.json 应存在`);
  const longTexts = JSON.parse(fs.readFileSync(longTextPath, 'utf8'));
  assert.equal(
    Object.keys(longTexts).length, out2.longTextCount,
    `${fixtureName}: 恢复清单条数应等于占位符数量`
  );
  for (const [k, txt] of Object.entries(longTexts)) {
    assert.ok(typeof txt === 'string' && txt.trim() !== '', `${fixtureName}: 原文 ${k} 应为非空白字符串`);
    assert.ok(cleaned.includes(`{{LONG_TEXT_${k}|`), `${fixtureName}: 占位符 ${k} 应出现在清洗快照中`);
  }

  // 2_clean_style_snapshot.html：带样式版——保留样式，结构清洗与占位符和清洗版逐一对应
  assert.ok(out2.styledSnapshot, `${fixtureName}: emit 应含 styledSnapshot 路径`);
  const styledPath = path.join(stepsDir, '2_clean_style_snapshot.html');
  assert.ok(fs.existsSync(styledPath), `${fixtureName}: 2_clean_style_snapshot.html 应存在`);
  const styled = fs.readFileSync(styledPath, 'utf8');
  assert.ok(
    styled.includes('style="') || styled.includes('<style'),
    `${fixtureName}: 带样式版应保留样式`
  );
  assert.ok(!/<button[\s>]/.test(styled), `${fixtureName}: 带样式版同样应删除按钮`);
  assert.ok(!/<meta/.test(styled) && !/<link/.test(styled), `${fixtureName}: 带样式版同样应删 meta/link`);
  // 占位符一一对应：两版占位符集合完全相同（编号与 N 值）
  const phOf = (h) => (h.match(/\{\{LONG_TEXT_\d+\|\d+_[a-z]+\}\}/g) || []).sort();
  assert.deepEqual(phOf(styled), phOf(cleaned), `${fixtureName}: 两版占位符应逐一对应`);

  // 步骤 3（模拟）：复制预定义的 key_ids
  const keyIdsPath = path.resolve(`test/fixtures/${keyIdsFixture}`);
  fs.copyFileSync(keyIdsPath, path.join(stepsDir, '3_key_ids.json'));

  // 步骤 4：分块
  const r4 = await runScript(process.execPath, [chunkerScript, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 60000,
  });
  assert.equal(r4.code, 0, `步骤 4 失败: ${r4.stderr}`);
  const out4 = JSON.parse(r4.stdout);
  assert.equal(out4.status, 'ok');
  assert.ok(out4.totalChunks > 0, `${fixtureName}: 应有分块`);
  assert.ok(fs.existsSync(out4.chunkList), '4_chunk_list.json 应存在');

  return out4;
}

test('管线 article-1: snapshot → clean → chunk', async () => {
  const out = await runPipelineTest('article-1.html', 'article-1_key_ids.json');

  // article-1 key_ids: { titleIds:[], descriptionIds:[], listFlowIds:[67] }
  assert.equal(out.totalChunks > 0, true, '应有分块');
  const types = new Set(out.chunks.map((c) => c.type));
  assert.ok(types.size > 0, '应有至少一种分块类型');

  // 验证 multiLayer 块有 styledHtml
  const multiLayer = out.chunks.filter((c) => c.type === 'multiLayer');
  assert.ok(multiLayer.length > 0, 'article-1 应有 multiLayer 块');
  for (const chunk of multiLayer) {
    assert.ok(chunk.styledHtml, `multiLayer 块 ${chunk.id} 应有 styledHtml`);
    assert.ok(chunk.needsLLM === true, `multiLayer 块 ${chunk.id} 应标记 needsLLM`);
  }
});

test('管线 article-1: styledHtml 只含渲染有效的计算样式（瘦身）', async () => {
  const out = await runPipelineTest('article-1.html', 'article-1_key_ids.json');
  const multiLayer = out.chunks.filter((c) => c.type === 'multiLayer');
  assert.ok(multiLayer.length > 0, 'article-1 应有 multiLayer 块');

  let totalStyled = 0;
  for (const chunk of multiLayer) {
    const s = chunk.styledHtml;
    totalStyled += s.length;
    // 白名单外的噪声属性（UA/默认值全量转储的标志）不得出现
    assert.ok(
      !/accent-color:|animation-|anchor-name:|caret-color:|transition-|cursor:|user-select:/.test(s),
      `块 ${chunk.id} styledHtml 不应含白名单外属性（如 accent-color/animation-*）`
    );
    // 样式已全量内联，class 是纯噪声
    assert.ok(!s.includes('class='), `块 ${chunk.id} styledHtml 不应含 class 属性`);
    // var() 必须是已解析的计算值
    assert.ok(!s.includes('var('), `块 ${chunk.id} styledHtml 不应含未解析的 var()`);
    // data-u2m-id 必须保留（下游按 id 引用）
    assert.ok(s.includes('data-u2m-id'), `块 ${chunk.id} styledHtml 应保留 data-u2m-id`);
    // 单块安全上限（基线最小块 147KB）
    assert.ok(s.length < 128 * 1024, `块 ${chunk.id} styledHtml 应 < 128KB，实际 ${s.length}`);
  }
  // 总量上限（基线约 9.3MB）
  assert.ok(totalStyled < 512 * 1024, `styledHtml 总量应 < 512KB，实际 ${totalStyled}`);

  // 夹具有效样式必须保留（计算后的真实值）
  const all = multiLayer.map((c) => c.styledHtml).join('\n');
  assert.ok(all.includes('text-transform:uppercase'), '应保留 text-transform 有效值');
  assert.ok(all.includes('position:absolute'), '应保留 position 有效值');
  assert.ok(all.includes('font-size:'), '应保留 font-size 计算值');

  // 字体名对下游转化无用（Markdown 不带字体，SVG 规范用系统字体栈）：不保留 font-family 与含字体名的 font 简写
  for (const chunk of multiLayer) {
    assert.ok(!chunk.styledHtml.includes('font-family'), `块 ${chunk.id} 不应保留 font-family`);
    assert.ok(!/(^|;)\s*font:/.test(chunk.styledHtml), `块 ${chunk.id} 不应保留 font 简写（含字体名）`);
  }

  // 缩进空白（含换行的纯空白文本节点）是源码格式化噪声，应折叠；pre 内的空白除外
  for (const chunk of multiLayer) {
    const withoutPre = chunk.styledHtml.replace(/<pre[\s\S]*?<\/pre>/g, '<pre></pre>');
    assert.ok(!/>\s*\n\s*</.test(withoutPre), `块 ${chunk.id} 不应含换行缩进空白`);
  }

  // 文本保真：空白折叠不得改变文本内容（归一化后与原始 html 字段一致）
  // 实体解码（&amp; 必须最后，防双重解码）
  const decode = (s) => s
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
  const normText = (h) => decode(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  for (const chunk of multiLayer) {
    assert.equal(
      normText(chunk.styledHtml), normText(chunk.html),
      `块 ${chunk.id} styledHtml 文本内容应与原始 html 一致`
    );
  }
});

test('管线 article-2: snapshot → clean → chunk', async () => {
  const out = await runPipelineTest('article-2.html', 'article-2_key_ids.json');

  // article-2 key_ids: { titleIds:[1081], descriptionIds:[1125], listFlowIds:[1180, 1356] }
  assert.ok(out.totalChunks > 0, '应有分块');

  // 验证标题块存在
  const titleChunks = out.chunks.filter((c) => c.dataU2mId === 1081);
  assert.ok(titleChunks.length > 0, '应有标题分块 (dataU2mId=1081)');

  // 验证列表流块存在
  const listChunks = out.chunks.filter(
    (c) => c.dataU2mId === 1180 || c.dataU2mId === 1356
  );
  // 列表流的子元素产生的块（子元素有自己的 dataU2mId）
  assert.ok(out.chunks.length > titleChunks.length, '列表流应产生额外分块');
});
