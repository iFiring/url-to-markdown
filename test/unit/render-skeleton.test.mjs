import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

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

// 新契约（references/markdown_skeleton_guide.md）：value 自带行外语法。
// h1-h6/blockquote 以 key 为准规范化重建（LLM 漏写/写错级别也能纠正），
// p/ul/ol/table/img 透传，trans2img 为步骤 8 回写的选中截图路径。
const RESOLVED = [
  { h1: '# 标题一' },
  { p: '一段正文，含**粗体**。' },
  { h2: '# 级别写错的标题' },
  { h5: '漏写井号的标题' },
  { h1: '# #1 排行榜' },
  { blockquote: '> 单行引用' },
  { blockquote: '> 多行引用\n第二段缺前缀' },
  { ul: '- 条目一\n - 嵌套条目' },
  { ol: '1. 第一步\n2. 第二步' },
  { code: { lang: 'python', content: 'def hello():\n    print("hi")' } },
  { code: { lang: '', content: 'plain code' } },
  { img: '![img](https://example.com/a.png)' },
  { img: '![img](assets/images/cover.png)' },
  { table: '|a|b|\n|--|--|\n|1|2|' },
  { trans2img: 'assets/trans/92.webp' },
  { p: '结尾段落' },
];

const URL = 'https://example.com/test-rskel';

function setup(name, { resolved = RESOLVED } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-rskel-${name}-`));
  const urlDir = path.join(tmpRoot, urlToDirName(URL));
  fs.mkdirSync(urlDir, { recursive: true });
  if (resolved !== null) {
    fs.writeFileSync(path.join(urlDir, '8_resolved_skeleton.json'), JSON.stringify(resolved));
  }
  return { tmpRoot, urlDir };
}

test('render_skeleton.mjs: 缺前置文件时报 error', async () => {
  const { tmpRoot, urlDir } = setup('missing', { resolved: null });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 8'), `reason 应提示步骤 8: ${out.reason}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: 全类型条目按新契约转换（h/blockquote 以 key 重建，其余透传）', async () => {
  const { tmpRoot, urlDir } = setup('full');
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');

  const mdPath = path.join(urlDir, '9_markdown.md');
  assert.equal(out.markdownPath, mdPath);
  assert.ok(fs.existsSync(mdPath), `产物应存在: ${mdPath}`);

  const md = fs.readFileSync(mdPath, 'utf8');

  // 按块切分（双换行），逐条比对
  const blocks = md.split(/\n\n+/);

  assert.equal(blocks[0], '# 标题一');
  assert.equal(blocks[1], '一段正文，含**粗体**。');
  // key 为准：h2 配单 # value 重建为 ##
  assert.equal(blocks[2], '## 级别写错的标题');
  // 漏写 # 的 value 按级别补前缀
  assert.equal(blocks[3], '##### 漏写井号的标题');
  // 正文以 # 开头：只剥后随空白的 # 前缀，内容不误伤
  assert.equal(blocks[4], '# #1 排行榜');
  assert.equal(blocks[5], '> 单行引用');
  // 缺前缀的行重建为 > 开头
  assert.equal(blocks[6], '> 多行引用\n> 第二段缺前缀');
  // ul/ol 透传（嵌套缩进只在 value 里）
  assert.equal(blocks[7], '- 条目一\n - 嵌套条目');
  assert.equal(blocks[8], '1. 第一步\n2. 第二步');
  assert.equal(blocks[9], '```python\ndef hello():\n    print("hi")\n```');
  assert.equal(blocks[10], '```\nplain code\n```');
  // img 透传（远端 URL 与本地化路径两种形态）
  assert.equal(blocks[11], '![img](https://example.com/a.png)');
  assert.equal(blocks[12], '![img](assets/images/cover.png)');
  assert.equal(blocks[13], '|a|b|\n|--|--|\n|1|2|');
  // trans2img：value 为步骤 8 回写的选中路径
  assert.equal(blocks[14], '![](assets/trans/92.webp)');
  // 末块带文件尾换行（writeFile 以 \n 收尾的 POSIX 惯例）
  assert.equal(blocks[15], '结尾段落\n');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: trans2img 仍为 ID 数组时报 error（提示先跑步骤 8）', async () => {
  const { tmpRoot } = setup('rawtrans', { resolved: [{ trans2img: [9, 10] }] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 8'), `reason 应提示步骤 8: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md')), '不应产出 markdown');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton.mjs: 空骨架输出空 markdown', async () => {
  const { tmpRoot, urlDir } = setup('empty', { resolved: [] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'ok');
  assert.equal(out.blocks, 0);

  const mdPath = path.join(urlDir, '9_markdown.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.equal(md.trim(), '', '空骨架应产出空 markdown');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: 围栏 backtick 自适应——内容含 ``` 时用 4 重围栏', async () => {
  const { tmpRoot } = setup('fence3', { resolved: [
    { code: { lang: 'md', content: '外层\n```\ninner fence\n```\n结尾' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  assert.equal(md, '````md\n外层\n```\ninner fence\n```\n结尾\n````\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: 内容含 ```` 时用 5 重围栏；反引号结尾安全', async () => {
  const { tmpRoot } = setup('fence4', { resolved: [
    { code: { lang: '', content: 'a\n````\nb`' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  assert.equal(md, '`````\na\n````\nb`\n`````\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: lang 清洗——反引号/换行剥离（js`+换行+x → jsx）', async () => {
  const { tmpRoot } = setup('langsan', { resolved: [
    { code: { lang: 'js`\nx', content: 'y' } },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const md = fs.readFileSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md'), 'utf8');
  // 'js`\nx' = j s 反引号 换行 x → 剥离非法字符后 'jsx'
  assert.equal(md, '```jsx\ny\n```\n');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('render_skeleton: code value 仍为字符串（{{CODE_ 残留）报 error 提示步骤 8', async () => {
  const { tmpRoot } = setup('residual', { resolved: [
    { code: '{{CODE_9}}' },
  ] });
  const r = await runScript(process.execPath, [scriptPath, '--url', URL], {
    env: { U2M_WORKING_ROOT: tmpRoot },
  });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'error');
  assert.ok(out.reason.includes('步骤 8'), `reason 应提示步骤 8: ${out.reason}`);
  assert.ok(!fs.existsSync(path.join(tmpRoot, urlToDirName(URL), '9_markdown.md')), '不应产出 markdown');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
