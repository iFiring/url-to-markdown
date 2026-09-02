import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

async function runClean(tmpRoot, url) {
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    fs.readFileSync(path.resolve('test/fixtures/code-blocks.html')));
  const r = await runScript(process.execPath, [path.resolve('script/clean_snapshot.mjs'), '--url', url],
    { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  return { r, dir };
}

const URL = 'https://example.com/code-blocks';

test('代码管线：2_code.json 各形态判定与内容（spec §6.3 验收基准）', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r, dir } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    // 11 个非 hidden pre：b6 non_textual、b7 empty、b8 single_line_suspect 失败
    assert.equal(out.codes.total, 11);
    assert.equal(out.codes.ok, 8);
    assert.equal(out.codes.failed, 3);

    const cj = JSON.parse(fs.readFileSync(path.join(dir, '2_code.json'), 'utf8'));
    // b1 shiki：ok、lang、两行
    assert.equal(cj['1'].status, 'ok');
    assert.equal(cj['1'].lang, 'javascript');
    assert.equal(cj['1'].content, 'import OpenAI;\nconst client = 1;');
    // b2 ra：grid 行重建 + LONG_TEXT 预展开（中文注释原文回归）
    assert.equal(cj['2'].status, 'ok');
    assert.equal(cj['2'].lang, 'tsx');
    assert.ok(cj['2'].content.startsWith('这是一条超过十六个汉字阈值的中文注释行内容\nsystem: `...`\nconst t = 1;'),
      `ra 形态内容: ${cj['2'].content}`);
    // b3 槽：gutterStripped、序号零贡献
    assert.equal(cj['3'].status, 'ok');
    assert.equal(cj['3'].gutterStripped, true);
    assert.equal(cj['3'].content, '{\n  "model": "gpt-5.6"\n}');
    // b4 内联序号：numberStripped
    assert.equal(cj['4'].status, 'ok');
    assert.equal(cj['4'].numberStripped, true);
    assert.equal(cj['4'].content, 'alpha\nbeta\ngamma');
    // b5 yaml：不剥
    assert.equal(cj['5'].status, 'ok');
    assert.equal(cj['5'].content, '1: a\n2: b\nfoo: bar');
    assert.ok(!cj['5'].numberStripped);
    // b6/b7/b8 失败原因
    assert.equal(cj['6'].reason, 'non_textual');
    assert.equal(cj['7'].reason, 'empty');
    assert.equal(cj['8'].reason, 'single_line_suspect');
    // b9 围栏素材：ok、字面 {{CODE_2}} 保留在内容里
    assert.equal(cj['9'].status, 'ok');
    assert.ok(cj['9'].content.includes('{{CODE_2}} inline'));
    // b11 br 分行
    assert.equal(cj['10'].content, 'alpha\nbeta\ngamma');
    // b12 复制保护：层 1 不杀
    assert.equal(cj['11'].status, 'ok');
    assert.equal(cj['11'].content, 'protected const a = 1;\nprotected const b = 2;');
    // 失败诊断日志：3 份
    assert.equal(fs.readdirSync(path.join(dir, 'logs', 'codes')).length, 3);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('代码管线：styled ok 折 / failed live，clean 恒折，k 对齐，data-language 提升', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const styled = fs.readFileSync(out.styledSnapshot, 'utf8');
    const cleaned = fs.readFileSync(out.cleanedSnapshot, 'utf8');
    assert.equal((styled.match(/\{\{CODE_\d+\|\d+_lines\}\}/g) || []).length, 8, '8 ok 块折叠');
    assert.equal((styled.match(/data-u2m-code="fail"/g) || []).length, 3, '3 失败块保 live');
    assert.equal((cleaned.match(/\{\{CODE_\d+\|\d+_lines\}\}/g) || []).length, 11, 'clean 恒折叠（含失败）');
    // k 对齐：hidden 块 b10 不占号——b11（br 分行块）是 k=10
    assert.match(cleaned, /<pre[^>]*data-idx="100"[^>]*>\{\{CODE_10\|3_lines\}\}/, 'br 块 k=10（hidden 不占号）');
    // data-language 提升（b1 本就在 code 上）
    assert.match(cleaned, /<pre[^>]*data-idx="10"[^>]*data-language="tsx"[^>]*>/, 'b2 lang 从 class 提升到 pre');
    // 失败块子树在 styled 保留
    assert.ok(styled.includes('src="x.png"'), 'b6 img 保留在 styled');
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});

test('代码管线：步骤 8 精确匹配还原 + 步骤 9 自适应围栏（端到端）', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-integ-code-'));
  try {
    const { r, dir } = await runClean(tmpRoot, URL);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    fs.writeFileSync(path.join(dir, '3_key_ids.json'),
      JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [120], dumpIds: [] }));
    fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify([
      { h1: '# 代码块形态测试' },
      { code: '{{CODE_1}}' },
      { code: '{{CODE_9}}' },                                    // 内容含 ``` 与字面 {{CODE_2}}
      { code: { lang: 'wrong', content: 'protected const a = 1;\nprotected const b = 2;' } }, // LLM 自转（b12）
      { p: '正文段落。' },
    ], null, 2));
    const r8 = await runScript(process.execPath, [path.resolve('script/screenshot_trans.mjs'), '--url', URL],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r8.code, 0, `stderr: ${r8.stderr}`);
    const out8 = JSON.parse(r8.stdout);
    assert.equal(out8.codesResolved, 2);
    assert.deepEqual(out8.failedCodes, []);
    const resolved = JSON.parse(fs.readFileSync(out8.resolvedSkeleton, 'utf8'));
    assert.deepEqual(resolved[1].code, { lang: 'javascript', content: 'import OpenAI;\nconst client = 1;' });
    // b9 的字面 {{CODE_2}} 不被误替换（2_code.json 里 2 号存在）
    assert.ok(resolved[2].code.content.includes('{{CODE_2}} inline'));
    const r9 = await runScript(process.execPath, [path.resolve('script/render_skeleton.mjs'), '--url', URL],
      { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
    assert.equal(r9.code, 0, `stderr: ${r9.stderr}`);
    const md = fs.readFileSync(JSON.parse(r9.stdout).markdownPath, 'utf8');
    // b9 内容含 ``` → 4 重围栏
    assert.ok(md.includes('````markdown\nouter\n```\ninner fence\n```\nref {{CODE_2}} inline\n````'),
      `b9 应 4 重围栏: ${md}`);
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
});
