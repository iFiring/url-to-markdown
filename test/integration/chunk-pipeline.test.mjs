import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

// 40 个 ~1.85KB 段落块 + h1 ≈ 74KB；阈值 60KB → 分 2 块。
// 链路：步骤 6（真实 chromium）→ 合成步骤 7 分片 → 步骤 8（无 img/trans
// 纯 Node 路径，死端口 URL）→ 步骤 9 渲染。
const PARAS = Array.from({ length: 40 }, (_, i) =>
  `<p style="font-size: 16px" data-idx="${100 + i}">${'段'.repeat(600)}</p>`);
const JUICED = `<!DOCTYPE html>
<html lang="zh-CN"><head><title>分块链路</title></head><body><h1 style="font-size: 32px" data-idx="1">标题</h1>${PARAS.join('')}</body></html>`;
const KEY_IDS = {
  titleId: 1,
  descriptionIds: [],
  paragraphIds: Array.from({ length: 40 }, (_, i) => 100 + i),
  dumpIds: [],
};
const URL = 'http://127.0.0.1:9/chunk-chain'; // 死端口：步骤 8 无 img/trans 不触网

test('分块链路：步骤 6 分割 → 分片骨架 → 步骤 8 合并 → 步骤 9 渲染', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chunk-chain-'));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  fs.writeFileSync(path.join(urlDir, '5_juice_styles.html'), JUICED);
  fs.writeFileSync(path.join(urlDir, '3_key_ids.json'), JSON.stringify(KEY_IDS));
  fs.writeFileSync(path.join(urlDir, '1_snapshot.html'), JUICED);
  fs.writeFileSync(path.join(urlDir, '2_long_text.json'), JSON.stringify({ texts: {}, runs: {} }));
  const env = { U2M_WORKING_ROOT: tmpRoot, U2M_ARTICLE_SPLIT_THRESHOLD: '60000' };

  // 步骤 6：分割
  const r6 = await runScript(process.execPath, [path.resolve('script/extract_article.mjs'), '--url', URL], { env, timeoutMs: 60000 });
  assert.equal(r6.code, 0, `stderr: ${r6.stderr}`);
  const out6 = JSON.parse(r6.stdout);
  assert.equal(out6.chunks.split, true);
  const N = out6.chunks.count;
  assert.ok(N >= 2, `应至少 2 块: ${N}`);

  // 合成步骤 7：每分片一个骨架分片（无占位符、无 img/trans）
  for (let x = 1; x <= N; x++) {
    fs.writeFileSync(path.join(urlDir, `7_skeleton_chunk_${x}_of_${N}.json`),
      JSON.stringify([{ p: `分片${x}专属内容` }]));
  }

  // 步骤 8：合并 + 还原
  const r8 = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', URL], { env, timeoutMs: 60000 });
  assert.equal(r8.code, 0, `stderr: ${r8.stderr}`);
  const out8 = JSON.parse(r8.stdout);
  assert.equal(out8.status, 'ok');
  assert.equal(out8.chunksMerged, N);
  assert.equal(out8.skipped, 'no_trans2img');

  // 步骤 9：渲染
  const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', URL], { env, timeoutMs: 30000 });
  assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
  const md = fs.readFileSync(path.join(urlDir, '9_markdown.md'), 'utf8');
  const order = Array.from({ length: N }, (_, i) => md.indexOf(`分片${i + 1}专属内容`));
  for (const pos of order) assert.ok(pos >= 0, '9_markdown 应含全部分片内容');
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `分片内容应按块序排列: ${order}`);
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
