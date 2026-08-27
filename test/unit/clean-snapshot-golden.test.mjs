import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runScript } from '../helpers/run-script.mjs';
import { urlToDirName } from '../../script/lib/env.mjs';

// 带样式版 golden 基线：步骤 2 重构（2026-08-27 极致简化）的硬约束是
// 2_clean_style_snapshot.html 与 2_long_text.json 逐字节不变、步骤 4-9 零影响。
test('golden: 带样式版与恢复清单在重构全程逐字节一致', async () => {
  for (const name of ['article-1', 'clean-simplify']) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-golden-'));
    try {
      const url = `https://example.com/${name}`;
      const dir = path.join(tmpRoot, urlToDirName(url));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '1_snapshot.html'),
        fs.readFileSync(path.resolve('test/fixtures', `${name}.html`))
      );
      const r = await runScript(
        process.execPath,
        [path.resolve('script/clean_snapshot.mjs'), '--url', url],
        { env: { U2M_WORKING_ROOT: tmpRoot }, timeoutMs: 60000 }
      );
      assert.equal(r.code, 0, `stderr: ${r.stderr}`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.status, 'ok');
      const styledGolden = fs.readFileSync(path.resolve('test/fixtures/golden', `${name}.styled.html`), 'utf8');
      const longGolden = fs.readFileSync(path.resolve('test/fixtures/golden', `${name}.longtext.json`), 'utf8');
      assert.equal(fs.readFileSync(out.styledSnapshot, 'utf8'), styledGolden, `${name} 带样式版应与 golden 逐字节一致`);
      assert.equal(fs.readFileSync(out.longText, 'utf8'), longGolden, `${name} 恢复清单应与 golden 逐字节一致`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
});
