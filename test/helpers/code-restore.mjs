// CODE 还原测试基座：准备最小工作目录（1_snapshot + 2_long_text + 2_code +
// 3_key_ids + 7_skeleton）。无 trans2img/img 条目——步骤 8 浏览器阶段不触发
// （早退 emit），无需可达 URL。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { urlToDirName } from '../../script/lib/env.mjs';

export function setupCodeRestore(name, skeleton) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `u2m-coderestore-${name}-`));
  const url = `https://example.com/code-restore-${name}`;
  const dir = path.join(tmpRoot, urlToDirName(url));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1_snapshot.html'),
    '<!DOCTYPE html><html><head><title>t</title></head><body><h1 data-idx="1">t</h1><p data-idx="2">正文</p></body></html>');
  fs.writeFileSync(path.join(dir, '2_long_text.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(dir, '2_code.json'), JSON.stringify({
    1: { dataIdx: '10', lang: 'javascript', content: 'const a = 1;\nconst b = 2;', status: 'ok', lines: 2, gutterStripped: false },
    2: { dataIdx: '20', lang: 'tsx', content: 'system: `...`', status: 'ok', lines: 1, gutterStripped: false },
    9: { dataIdx: '90', lang: '', content: null, status: 'failed', reason: 'non_textual', lines: 1, gutterStripped: false },
  }, null, 2));
  fs.writeFileSync(path.join(dir, '3_key_ids.json'),
    JSON.stringify({ titleId: 1, descriptionIds: [], paragraphIds: [2], dumpIds: [] }));
  fs.writeFileSync(path.join(dir, '7_skeleton.json'), JSON.stringify(skeleton, null, 2));
  return { tmpRoot, url, dir };
}
