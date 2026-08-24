// test/unit/env.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlToDirName, workingRoot, storageStatePath, ensureUrlDirs } from '../../script/lib/env.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('urlToDirName: 剥 http(s):// 前缀（从域名开始），非法字符转下划线，保留 [A-Za-z0-9.-]', () => {
  assert.equal(urlToDirName('https://example.com/a?b=1'), 'example.com_a_b_1');
  assert.equal(urlToDirName('http://127.0.0.1:8000/x.html#frag'), '127.0.0.1_8000_x.html_frag');
  assert.equal(urlToDirName('https://example.com/中文'), 'example.com___');
  // 无协议前缀的输入原样净化
  assert.equal(urlToDirName('example.com/a'), 'example.com_a');
});

test('urlToDirName: 同域名 http/https 派生同一目录名（视为同一站点）', () => {
  assert.equal(urlToDirName('http://example.com/x'), urlToDirName('https://example.com/x'));
});

test('urlToDirName: 超 120 字符截断 + sha256 前 8 位后缀', () => {
  const url = 'https://example.com/' + 'a'.repeat(130);
  const name = urlToDirName(url);
  assert.equal(name.length, 128);
  assert.ok(name.startsWith('example.com_' + 'a'.repeat(108)));
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
  assert.equal(name.slice(120), hash);
});

test('workingRoot 受 U2M_WORKING_ROOT 覆盖；storageStatePath 固定子路径', () => {
  process.env.U2M_WORKING_ROOT = '/tmp/u2m-test-root';
  assert.equal(workingRoot(), '/tmp/u2m-test-root');
  assert.equal(storageStatePath(), path.join('/tmp/u2m-test-root', 'cookies', 'storage_state.json'));
  delete process.env.U2M_WORKING_ROOT;
});

test('ensureUrlDirs 创建 urlDir + assets/{images,trans} 并返回路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  process.env.U2M_WORKING_ROOT = root;
  const dirs = ensureUrlDirs('https://example.com/a');
  for (const k of ['urlDir', 'wf', 'assets', 'images', 'trans']) {
    assert.ok(fs.existsSync(dirs[k]), `缺目录 ${k}`);
  }
  assert.equal(dirs.wf, dirs.urlDir);
  assert.equal(dirs.urlDir, path.join(root, urlToDirName('https://example.com/a')));
  assert.equal(dirs.assets, path.join(dirs.urlDir, 'assets'));
  assert.equal(dirs.images, path.join(dirs.assets, 'images'));
  assert.equal(dirs.trans, path.join(dirs.assets, 'trans'));
  delete process.env.U2M_WORKING_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});
