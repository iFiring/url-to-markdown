import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/lib/page-chunker.js');

test('page-chunker.js: 文件存在且包含 __u2mChunk 函数', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('function __u2mChunk'), '应定义 __u2mChunk');
});

test('page-chunker.js: 函数可被 evaluate 格式调用', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const wrapped = `(${src})()`;
  assert.doesNotThrow(() => new Function('return ' + wrapped));
});

test('page-chunker.js: 包含 PHRASING_TAGS 和 FLOW_TAGS 分类', () => {
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(src.includes('PHRASING_TAGS') || src.includes('phrasingTags'), '应定义短语内容标签集');
  assert.ok(src.includes('FLOW_TAGS') || src.includes('flowTags'), '应定义流式内容标签集');
});

test('chunker.mjs: 无参数时输出 usage_error', async () => {
  const script = path.resolve('script/chunker.mjs');
  const r = await runScript(process.execPath, [script]);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'usage_error');
});

test('chunker.mjs: 对 article-1 执行分块', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chunk-'));
  const urlDir = path.join(tmpRoot, 'test-article');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  // 放入快照和 key_ids
  const fixture = fs.readFileSync(path.resolve('test/fixtures/article-1.html'), 'utf8');
  fs.writeFileSync(path.join(stepsDir, '1_snapshot.html'), fixture);

  // 模拟步骤 3 产物（手动指定 ID，基于实际夹具内容）
  const keyIds = { titleIds: [], descriptionIds: [], listFlowIds: [1] };
  fs.writeFileSync(path.join(stepsDir, '3_key_ids.json'), JSON.stringify(keyIds));

  const script = path.resolve('script/chunker.mjs');
  const r = await runScript(process.execPath, [script, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
    timeoutMs: 30000,
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(Array.isArray(out.chunks), '应返回 chunks 数组');
  assert.ok(fs.existsSync(out.chunkList), '4_chunk_list.json 应存在');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
