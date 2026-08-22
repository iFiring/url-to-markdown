import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(thisDir, '../../script/render_skeleton.mjs');

test('render_skeleton.mjs: 文件存在且可执行', () => {
  assert.ok(fs.existsSync(scriptPath), '脚本应存在');
  const stat = fs.statSync(scriptPath);
  assert.ok((stat.mode & 0o111) !== 0, '脚本应有执行权限');
});

test('render_skeleton.mjs: 无参数时输出 usage_error', async () => {
  const r = await runScript(process.execPath, [scriptPath]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stdout).status, 'usage_error');
});

const RESOLVED = [
  { h1: '标题一' },
  { p: '一段正文，含**粗体**。' },
  { h2: '二级标题' },
  { blockquote: '单行引用' },
  { blockquote: '多行引用\n第二段' },
  { ul: '- 条目一\n- 条目二' },
  { ol: '1. 第一步\n2. 第二步' },
  { code: { lang: 'python', content: 'def hello():\n    print("hi")' } },
  { code: { content: 'plain code' } },
  { img: 'https://example.com/a.png' },
  { table: '|a|b|\n|--|--|\n|1|2|' },
  { trans2img: '92' },
  { p: '结尾段落' },
];

function setup(name, { resolved = RESOLVED } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-rskel-${name}-`));
  const urlDir = path.join(tmpRoot, 'test-rskel');
  const stepsDir = path.join(urlDir, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });
  if (resolved !== null) {
    fs.writeFileSync(path.join(stepsDir, '3.5_resolved_skeleton.json'), JSON.stringify(resolved));
  }
  return { tmpRoot, urlDir, stepsDir };
}

test('render_skeleton.mjs: 缺前置文件时报 error', async () => {
  const { tmpRoot, urlDir } = setup('missing', { resolved: null });
  const r = await runScript(process.execPath, [scriptPath, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('3.5'), `reason 应提示 3.5: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: 全类型条目转换为 markdown', async () => {
  const { tmpRoot, urlDir, stepsDir } = setup('full');
  const r = await runScript(process.execPath, [scriptPath, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const mdPath = path.join(stepsDir, '3.6_markdown.md');
  assert.equal(out.markdownPath, mdPath);
  assert.ok(fs.existsSync(mdPath), `产物应存在: ${mdPath}`);

  const md = fs.readFileSync(mdPath, 'utf8');

  // 按块切分（双换行），逐条比对
  const blocks = md.split(/\n\n+/);

  assert.equal(blocks[0], '# 标题一');
  assert.equal(blocks[1], '一段正文，含**粗体**。');
  assert.equal(blocks[2], '## 二级标题');
  assert.equal(blocks[3], '> 单行引用');
  assert.equal(blocks[4], '> 多行引用\n> 第二段');
  assert.equal(blocks[5], '- 条目一\n- 条目二');
  assert.equal(blocks[6], '1. 第一步\n2. 第二步');
  assert.equal(blocks[7], '```python\ndef hello():\n    print("hi")\n```');
  assert.equal(blocks[8], '```\nplain code\n```');
  assert.equal(blocks[9], '![](https://example.com/a.png)');
  assert.equal(blocks[10], '|a|b|\n|--|--|\n|1|2|');
  assert.equal(blocks[11], '![](assets/trans/92.webp)');
  assert.equal(blocks[12], '结尾段落');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: 空骨架输出空 markdown', async () => {
  const { tmpRoot, urlDir, stepsDir } = setup('empty', { resolved: [] });
  const r = await runScript(process.execPath, [scriptPath, urlDir], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.blocks, 0);

  const mdPath = path.join(stepsDir, '3.6_markdown.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.equal(md.trim(), '', '空骨架应产出空 markdown');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: 相对路径 url-dir 正常解析', async () => {
  const { tmpRoot, urlDir, stepsDir } = setup('relpath');
  const r = await runScript(process.execPath, [scriptPath, 'test-rskel'], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.ok(fs.existsSync(path.join(stepsDir, '3.6_markdown.md')));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
