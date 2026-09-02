import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { convertCodes } from '../../script/lib/code2md.mjs';

// 收集载荷工厂——字段含义见 spec §5.1；jsdom 无关（纯 Node 数据变换）
function payload(over = {}) {
  return {
    k: 1, dataIdx: '10', lang: '', text: '', lines: 1,
    renderedLines: null, hasNonText: false, textContentNoGutter: '',
    blockContainers: 0, gutterStripped: false, outerHTML: '<pre></pre>',
    ...over,
  };
}

test('ok：纯文本代码——\\r\\n 归一、首尾空行修剪、n_lines 重算、lang 兜底链', async () => {
  const text = '\r\nconst a = 1;\n\nconst b = 2;\r\n\n';
  const { codes, counts } = await convertCodes(
    [payload({ text, textContentNoGutter: text, lines: 7 })], {});
  assert.equal(counts.total, 1); assert.equal(counts.ok, 1); assert.equal(counts.failed, 0);
  const c = codes['1'];
  assert.equal(c.status, 'ok');
  assert.equal(c.content, 'const a = 1;\n\nconst b = 2;');  // 首尾空行修剪、内部空行保留
  assert.equal(c.lines, 3);
  // guessCodeLang("const a = 1;...") 命中 (const|let|var)\s+\w+\s*= → javascript
  assert.equal(c.lang, 'javascript');
  assert.equal('reason' in c, false);
});

test('ok：data-language 收集值优先于 guessCodeLang', async () => {
  const text = 'const a = 1;';
  const { codes } = await convertCodes([payload({ lang: 'tsx', text, textContentNoGutter: text })], {});
  assert.equal(codes['1'].lang, 'tsx');
});

test('failed：non_textual——pre 内含 img', async () => {
  const { codes } = await convertCodes([payload({ hasNonText: true, text: 'x', textContentNoGutter: 'x' })], {});
  assert.equal(codes['1'].status, 'failed');
  assert.equal(codes['1'].reason, 'non_textual');
  assert.equal(codes['1'].content, null);
});

test('failed：content_loss——提取文本与 DOM 文本（减槽）空白不敏感不等', async () => {
  const { codes } = await convertCodes([payload({ text: 'const a = 1;', textContentNoGutter: 'const a = 1; const b = 2;' })], {});
  assert.equal(codes['1'].reason, 'content_loss');
});

test('ok：content_loss 对 <br>/空白差异免疫（空白不敏感比较）', async () => {
  const { codes } = await convertCodes([payload({ text: 'a\nb', textContentNoGutter: 'ab' })], {});
  assert.equal(codes['1'].status, 'ok');
});

test('ok：LONG_TEXT 预展开——占位符替换为恢复清单原文', async () => {
  const text = '{{LONG_TEXT_5|12_words}}\nconst b = 2;';
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text })], { longTextMap: { 5: '// 这是一条很长的注释行' } });
  assert.equal(codes['1'].content, '// 这是一条很长的注释行\nconst b = 2;');
});

test('failed：unresolved_long_text——预展开后仍残留占位符', async () => {
  const text = '{{LONG_TEXT_9|12_words}} code';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text })], { longTextMap: {} });
  assert.equal(codes['1'].reason, 'unresolved_long_text');
});

test('failed：empty——修剪后为空', async () => {
  const { codes } = await convertCodes([payload({ text: '\n\n  \n', textContentNoGutter: '\n\n  \n' })], {});
  assert.equal(codes['1'].reason, 'empty');
});

test('failed：single_line_suspect——单行但渲染多行（renderedLines=3）', async () => {
  const text = 'very long single line';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 3 })], {});
  assert.equal(codes['1'].reason, 'single_line_suspect');
});

test('ok：单行 + renderedLines=1 不误判；单行 + renderedLines=null 跳过', async () => {
  const text = 'single';
  const a = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 1 })], {});
  assert.equal(a.codes['1'].status, 'ok');
  const b = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: null })], {});
  assert.equal(b.codes['1'].status, 'ok');
});

test('failed：rendered_mismatch——提取行数扣空行豁免后超渲染行数', async () => {
  const text = 'a\n\n\nb';   // trimmed 4 行、interiorBlanks 2 → 4-2=2 > renderedLines 1
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 1 })], {});
  assert.equal(codes['1'].reason, 'rendered_mismatch');
});

test('ok：rendered_mismatch 空行豁免——空行无矩形合法（4-2=2 ≤ rendered 2）', async () => {
  const text = 'a\n\n\nb';
  const { codes } = await convertCodes([payload({ text, textContentNoGutter: text, renderedLines: 2 })], {});
  assert.equal(codes['1'].status, 'ok');
});

test('failed：mixed_signal_mismatch——\\n 与块容器双信号矛盾', async () => {
  const text = 'a\nb\nc\nd\ne';                          // newlineCount 4 → 5 行
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text, blockContainers: 9 })], {});  // |5-9|=4 > 1
  assert.equal(codes['1'].reason, 'mixed_signal_mismatch');
});

test('ok：mixed_signal ±1 容差——shiki 块容器 + 尾随 \\n', async () => {
  const text = 'a\nb\nc\n';                              // newlineCount 3 → 4
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text, blockContainers: 3 })], {});  // |4-3|=1
  assert.equal(codes['1'].status, 'ok');
});

test('ok：单信号跳过 mixed_signal（\\n=0 或容器=0）', async () => {
  const a = await convertCodes([payload({ text: 'x\ny', textContentNoGutter: 'x\ny', blockContainers: 0 })], {});
  assert.equal(a.codes['1'].status, 'ok');
  const b = await convertCodes([payload({ text: 'x', textContentNoGutter: 'x', blockContainers: 5 })], {});
  assert.equal(b.codes['1'].status, 'ok');
});

test('ok：LONG_TEXT 纪元豁免——占位符展开多行时不虚假 rendered_mismatch（spec §6.1 补注）', async () => {
  // 收集时 renderedLines 量的是占位符形态（单行 1），展开后 3 行——纪元不可比，
  // 含 {{LONG_TEXT_ 的 text 跳过渲染交叉校验（single_line_suspect 同跳）
  const text = '{{LONG_TEXT_1|57_chars}}';
  const longTextMap = { 1: '第一行超过阈值的中文长文本行；\n第二行超过阈值的中文长文本行；\n第三行超过阈值的中文长文本行；' };
  const { codes } = await convertCodes(
    [payload({ text, textContentNoGutter: text, renderedLines: 1 })], { longTextMap });
  assert.equal(codes['1'].status, 'ok', `应跳过渲染交叉校验: ${JSON.stringify(codes['1'])}`);
  assert.equal(codes['1'].lines, 3);
  assert.equal(codes['1'].content, longTextMap[1]);
});

test('counts 与失败诊断日志落盘', async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-code2md-'));
  try {
    const { counts } = await convertCodes(
      [payload({ k: 1, dataIdx: '10', hasNonText: true, text: 'x', textContentNoGutter: 'x' }),
       payload({ k: 2, dataIdx: '20', text: 'ok code', textContentNoGutter: 'ok code' })],
      { logsDir });
    assert.deepEqual(counts, { total: 2, ok: 1, failed: 1 });
    const logPath = path.join(logsDir, '1_10.log');
    assert.ok(fs.existsSync(logPath));
    const log = fs.readFileSync(logPath, 'utf8');
    assert.ok(log.includes('reason: non_textual'));
    assert.ok(log.includes('--- outerHTML ---'));
  } finally { fs.rmSync(logsDir, { recursive: true, force: true }); }
});
