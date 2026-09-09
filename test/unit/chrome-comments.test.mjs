// test/unit/chrome-comments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-cmt', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-cmt-'));
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

const BIG = '正文内容'.repeat(40);

test('注释剥离: head/body 注释两版删除', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title><!-- head-marker --></head>
<body>
<!-- body-marker -->
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p><!-- inner-marker -->
</div>
</body></html>`);
  try {
    assert.ok(!r.cleaned.includes('head-marker') && !r.styled.includes('head-marker'), 'head 注释删除');
    assert.ok(!r.cleaned.includes('body-marker') && !r.styled.includes('body-marker'), 'body 注释删除');
    assert.ok(!r.cleaned.includes('inner-marker') && !r.styled.includes('inner-marker'), '元素间注释删除');
    assert.ok(!r.cleaned.includes('<!--'), '清洗版零注释');
    assert.ok(!r.styled.includes('<!--'), '带样式版零注释');
  } finally { r.cleanup(); }
});

test('注释剥离: pre 子树内注释保留（styled 失败 live 代码块可观察）', async () => {
  // pre 含 img → code2md non_textual 必败 → styled 保 live（data-u2m-code="fail"），
  // 注释可观察；clean 侧 pre 恒折叠为 CODE 占位，注释随折消失
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body>
<div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p>
<pre data-idx="4">x<img data-idx="5" src="a.png" alt=""><!-- keep-me --></pre>
</div>
</body></html>`);
  try {
    assert.ok(r.styled.includes('keep-me'), 'styled live pre 内注释保留');
    assert.ok(!r.cleaned.includes('keep-me'), 'clean 折叠后注释不可见');
    assert.ok(r.cleaned.includes('{{CODE_1|'), 'clean pre 照常折叠');
  } finally { r.cleanup(); }
});
