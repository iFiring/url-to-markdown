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

  // article-1 key_ids: { titleIds:[], descriptionIds:[], listFlowIds:[28] }
  assert.equal(out.totalChunks > 0, true, '应有分块');
  const types = new Set(out.chunks.map((c) => c.type));
  assert.ok(types.size > 0, '应有至少一种分块类型');

  // 验证 multiLayer 块有 styledHtml
  const multiLayer = out.chunks.filter((c) => c.type === 'multiLayer');
  for (const chunk of multiLayer) {
    assert.ok(chunk.styledHtml, `multiLayer 块 ${chunk.id} 应有 styledHtml`);
    assert.ok(chunk.needsLLM === true, `multiLayer 块 ${chunk.id} 应标记 needsLLM`);
  }
});

test('管线 article-2: snapshot → clean → chunk', async () => {
  const out = await runPipelineTest('article-2.html', 'article-2_key_ids.json');

  // article-2 key_ids: { titleIds:[895], descriptionIds:[909], listFlowIds:[961, 1087] }
  assert.ok(out.totalChunks > 0, '应有分块');

  // 验证标题块存在
  const titleChunks = out.chunks.filter((c) => c.dataU2mId === 895);
  assert.ok(titleChunks.length > 0, '应有标题分块 (dataU2mId=895)');

  // 验证列表流块存在
  const listChunks = out.chunks.filter(
    (c) => c.dataU2mId === 961 || c.dataU2mId === 1087
  );
  // 列表流的子元素产生的块（子元素有自己的 dataU2mId）
  assert.ok(out.chunks.length > titleChunks.length, '列表流应产生额外分块');
});
