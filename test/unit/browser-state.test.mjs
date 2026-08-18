import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneExpired, mergeStorageState, readStorageState, writeStorageState } from '../../script/lib/browser.mjs';

const cookie = (over) => ({ name: 'a', value: '1', domain: '.x.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax', ...over });

test('pruneExpired: 剔除已过期（expires>0 且 < now），保留会话与未来', () => {
  const now = 1_700_000_000_000;
  const state = { cookies: [cookie({ name: 'old', expires: 1 }), cookie({ name: 'sess', expires: -1 }), cookie({ name: 'future', expires: 9_999_999_999 })], origins: [] };
  const names = pruneExpired(state, now).cookies.map((c) => c.name);
  assert.deepEqual(names.sort(), ['future', 'sess']);
});

test('mergeStorageState: cookie 按 (name,domain,path) 去重、新覆盖旧', () => {
  const base = { cookies: [cookie({ value: '1' }), cookie({ name: 'b', domain: '.y.com' })], origins: [] };
  const inc = { cookies: [cookie({ value: '9' }), cookie({ name: 'c', domain: '.z.com' })], origins: [] };
  const merged = mergeStorageState(base, inc);
  const a = merged.cookies.find((c) => c.name === 'a');
  assert.equal(a.value, '9');
  assert.equal(merged.cookies.length, 3);
});

test('mergeStorageState: localStorage 按 origin+name 去重覆盖', () => {
  const base = { cookies: [], origins: [{ origin: 'https://a.com', localStorage: [{ name: 'k', value: '1' }] }] };
  const inc = { cookies: [], origins: [{ origin: 'https://a.com', localStorage: [{ name: 'k', value: '2' }, { name: 'm', value: '3' }] }] };
  const merged = mergeStorageState(base, inc);
  assert.deepEqual(merged.origins[0].localStorage, [{ name: 'k', value: '2' }, { name: 'm', value: '3' }]);
});

test('read/write 往返；缺失文件返回空态', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2m-'));
  const file = path.join(dir, 'storage_state.json');
  await writeStorageState(file, { cookies: [cookie()], origins: [] });
  const back = await readStorageState(file);
  assert.equal(back.cookies[0].name, 'a');
  const empty = await readStorageState(path.join(dir, 'nope.json'));
  assert.deepEqual(empty, { cookies: [], origins: [] });
});
