// test/unit/env-redirect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  redirectedDirName, redirectMarkerPath, hasRedirectMarker,
  writeRedirectMarker, clearRedirectMarker, urlDir, urlToDirName,
} from '../../script/lib/env.mjs';
import crypto from 'node:crypto';

let tmp;
test.before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-env-redirect-'));
  process.env.U2M_WORKING_ROOT = tmp;
});
test.after(() => {
  delete process.env.U2M_WORKING_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const URL = 'https://mmh1.top/article#/ai-article/skill';

test('redirectedDirName: redirected_ 前缀 + 与 urlToDirName 同款净化', () => {
  assert.equal(redirectedDirName('https://example.com/a?b=1'), 'redirected_example.com_a_b_1');
  assert.equal(
    redirectedDirName(URL),
    'redirected_' + urlToDirName(URL),
    '短 URL：前缀直接拼 urlToDirName 结果',
  );
});

test('redirectedDirName: 超 120 字符截断 + sha256("redirected_"+url) 前 8 位', () => {
  const longUrl = 'https://example.com/' + 'x'.repeat(200);
  const name = redirectedDirName(longUrl);
  assert.ok(name.length <= 128, '120 + 8 hex');
  assert.ok(name.startsWith('redirected_'));
  const expectHash = crypto.createHash('sha256').update('redirected_' + longUrl, 'utf8').digest('hex').slice(0, 8);
  assert.ok(name.endsWith(expectHash));
});

test('marker: 写入/存在/删除生命周期；删除不存在不报错；内容损坏不影响定位', () => {
  assert.equal(hasRedirectMarker(URL), false, '初始无 marker');
  writeRedirectMarker(URL, 'https://mmh1.top/article/skill.html');
  assert.equal(hasRedirectMarker(URL), true);
  assert.equal(
    fs.readFileSync(redirectMarkerPath(URL), 'utf8'),
    'to: https://mmh1.top/article/skill.html\n',
  );
  // 定位只依赖存在性，不解析内容——marker 内容损坏仍生效（spec §7）
  fs.writeFileSync(redirectMarkerPath(URL), '!!!garbage!!!\n', 'utf8');
  assert.equal(hasRedirectMarker(URL), true);
  assert.equal(urlDir(URL), path.join(tmp, redirectedDirName(URL)));
  clearRedirectMarker(URL);
  assert.equal(hasRedirectMarker(URL), false);
  clearRedirectMarker(URL); // 再删不报错
});

test('urlDir: marker 存在 → redirected 目录；不存在 → 原名目录；目录在但无 marker → 原名', () => {
  const plain = path.join(tmp, urlToDirName(URL));
  assert.equal(urlDir(URL), plain, '无 marker 时现状行为');
  // 目录存在但无 marker = 陈旧残留 → 仍走原名
  fs.mkdirSync(path.join(tmp, redirectedDirName(URL)), { recursive: true });
  assert.equal(urlDir(URL), plain, '陈旧 redirected 目录不影响定位');
  writeRedirectMarker(URL, 'https://mmh1.top/article/skill.html');
  assert.equal(urlDir(URL), path.join(tmp, redirectedDirName(URL)));
});
