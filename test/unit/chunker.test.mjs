import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
