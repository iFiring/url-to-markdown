// test/unit/chrome-dialog-fold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-dlg', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-dlg-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return {
    out,
    cleaned: fs.readFileSync(out.cleanedSnapshot, 'utf8'),
    styled: fs.readFileSync(out.styledSnapshot, 'utf8'),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

const wrap = (bodyInner, headInner = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title>
<style>.hid{display:none}</style>${headInner}</head>
<body>${bodyInner}</body></html>`;
const BIG = '正文内容'.repeat(40);

test('H2: 偏离脊柱的深处 role=dialog 折叠为 DIALOG_TAG，styled 保活', async () => {
  // div4 文本 >5% → D1 不删；dialog 在 off-chain 深处 → H2 任意深度接住
  const r = await runClean(wrap(`
<div data-idx="1">
  <div data-idx="2"><p data-idx="3">${BIG}</p></div>
  <div data-idx="4">评论区操作<div data-idx="5" role="dialog"><button data-idx="6">关闭</button>赞赏作者</div></div>
</div>`));
  try {
    assert.ok(r.cleaned.includes('data-idx="5"') && r.cleaned.includes('{{DIALOG_TAG|6_chars'),
      'dialog 壳折叠（关闭赞赏作者=6 字）');
    assert.ok(!r.cleaned.includes('data-idx="6"'), 'dialog 内部随折吞没');
    assert.ok(r.styled.includes('赞赏作者'), '带样式版保活');
  } finally { r.cleanup(); }
});

test('H2: 优先级 dialog > hidden；aria-modal 等价命中', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" class="hid" role="dialog">营销提示信息请确认是否继续访问</div>
<div data-idx="4" aria-modal="true">另一弹窗文本足够长超过比例阈值</div>`));
  try {
    assert.ok(r.cleaned.includes('{{DIALOG_TAG|') && !r.cleaned.includes('{{HIDDEN_TAG|'),
      'hidden+dialog → DIALOG_TAG（语义声明最强）');
    assert.ok((r.cleaned.match(/DIALOG_TAG/g) || []).length === 2, 'aria-modal 同折');
  } finally { r.cleanup(); }
});

test('H2: 守卫拦截——dialog 含 3 个 p 或含 table 不折（table 照常收集）', async () => {
  const r = await runClean(wrap(`
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" role="dialog"><p>a</p><p>b</p><p>c</p></div>
<div data-idx="4" role="dialog"><table data-idx="5"><thead><tr><th>A</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table></div>`));
  try {
    assert.ok(!r.cleaned.includes('DIALOG_TAG'), '守卫阻断两类 dialog 折叠');
    assert.ok(r.cleaned.includes('{{TABLE_1|2×1}}'), 'dialog 内表照常收集折叠、k 对齐');
    assert.equal(r.out.tables.total, 1);
  } finally { r.cleanup(); }
});
