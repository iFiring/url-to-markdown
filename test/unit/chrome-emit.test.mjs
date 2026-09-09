// test/unit/chrome-emit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

async function runClean(snapshot, urlPath = 'chrome-emit', env = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-chrome-emit-'));
  const url = `https://example.com/${urlPath}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'), snapshot);
  const r = await runScript(process.execPath,
    [path.resolve(thisDir, '../../script/clean_snapshot.mjs'), '--url', url],
    { env: { ...env, U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 });
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  return { out: JSON.parse(r.stdout), stderr: r.stderr,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }) };
}

const BIG = '正文内容'.repeat(40);

test('emit: chrome 对象恒定形状（干净页全零）', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body><div data-idx="1"><h1 data-idx="2">题</h1><p data-idx="3">${BIG}</p></div></body></html>`, 'zero');
  try {
    assert.deepEqual(r.out.chrome, {
      removed: 0, cssHiddenFolded: 0, dialogFolded: 0, overlayFolded: 0, commentsRemoved: 0,
    });
  } finally { r.cleanup(); }
});

test('emit: chrome 计数反映各规则命中', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title><style>.hid{display:none}</style></head>
<body>
<!-- c1 -->
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">广告</div>
<div data-idx="4" class="hid">隐藏浮层文本</div>
<div data-idx="5" role="dialog">弹窗足够长文本超过比例阈值</div>
</body></html>`, 'counts');
  try {
    assert.equal(r.out.chrome.removed, 1, 'idx3：fixed + ratio 2/160 → D1 删除');
    assert.equal(r.out.chrome.cssHiddenFolded, 1, 'idx4：body 直下 css-hidden（ratio 3.75% 但 static 无词汇，D1 不删）');
    assert.equal(r.out.chrome.dialogFolded, 1, 'idx5：dialog ratio 8% 逃 D1 → H2 折叠');
    assert.equal(r.out.chrome.overlayFolded, 0);
    assert.equal(r.out.chrome.commentsRemoved, 1);
  } finally { r.cleanup(); }
});

test('U2M_DEBUG=1: D1 kill 明细走 stderr，stdout 单行 JSON 契约不破', async () => {
  const r = await runClean(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>t</title></head>
<body>
<div data-idx="1"><p data-idx="2">${BIG}</p></div>
<div data-idx="3" style="position:fixed">广告</div>
</body></html>`, 'dbg', { U2M_DEBUG: '1' });
  try {
    assert.ok(r.stderr.includes('[chrome-d1]'), 'kill 明细前缀');
    assert.ok(r.stderr.includes('pos:fixed'), '信号形态可见');
    assert.equal(r.out.chrome.removed, 1);
  } finally { r.cleanup(); }
});
