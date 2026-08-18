// test/unit/env.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { urlToDirName, workingRoot, storageStatePath, ensureWorkflowDirs } from '../../script/lib/env.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('urlToDirName: 非法字符转下划线，保留 [A-Za-z0-9.-]', () => {
  assert.equal(urlToDirName('https://example.com/a?b=1'), 'https___example_com_a_b_1');
  assert.equal(urlToDirName('http://127.0.0.1:8000/x.html#frag'), 'http___127_0_0_1_8000_x_html_frag');
  assert.equal(urlToDirName('https://example.com/中文'), 'https___example_com___');
});

test('urlToDirName: 超 120 字符截断 + sha256 前 8 位后缀', () => {
  const url = 'https://example.com/' + 'a'.repeat(101);
  const name = urlToDirName(url);
  assert.equal(name.length, 128);
  assert.ok(name.startsWith('https___example_com_' + 'a'.repeat(100)));
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
  assert.equal(name.slice(120), hash);
});

test('workingRoot 受 U2M_WORKING_ROOT 覆盖；storageStatePath 固定子路径', () => {
  process.env.U2M_WORKING_ROOT = '/tmp/u2m-test-root';
  assert.equal(workingRoot(), '/tmp/u2m-test-root');
  assert.equal(storageStatePath(), path.join('/tmp/u2m-test-root', 'cookies', 'storage_state.json'));
  delete process.env.U2M_WORKING_ROOT;
});

test('ensureWorkflowDirs 创建五级目录并返回 manifest 路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  process.env.U2M_WORKING_ROOT = root;
  const dirs = ensureWorkflowDirs('https://example.com/a', 'node_workflow');
  for (const k of ['wf', 'assets', 'draft', 'complex', 'images']) {
    assert.ok(fs.existsSync(dirs[k]), `缺目录 ${k}`);
  }
  assert.equal(dirs.manifest, path.join(dirs.assets, 'manifest.json'));
  delete process.env.U2M_WORKING_ROOT;
});
