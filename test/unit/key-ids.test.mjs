// test/unit/key-ids.test.mjs
// 直接测 parseKeyIds——四键约束的单一事实源（步骤 4/6/8 共享）。
// 重点：titleId/descriptionIds 可与 paragraphIds 重叠（流内标题/说明保留
// 原位、步骤 6 同节点去重），其余组合互不相交、同一键内不得重复。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyIds } from '../../script/lib/key-ids.mjs';

const ok = (keyIds) => !(parseKeyIds(keyIds).error);
const err = (keyIds) => parseKeyIds(keyIds).error || '';

test('parseKeyIds: titleId/descriptionIds 与 paragraphIds 重叠允许', () => {
  // titleId 同时是 paragraphIds 首块
  assert.ok(ok({ titleId: 5, descriptionIds: [], paragraphIds: [5, 6], dumpIds: [] }));
  // descriptionIds 同时在 paragraphIds
  assert.ok(ok({ titleId: 1, descriptionIds: [3], paragraphIds: [3, 4], dumpIds: [] }));
  // title + desc 都落在 paragraphIds 首段
  assert.ok(ok({ titleId: 1, descriptionIds: [2], paragraphIds: [1, 2, 3], dumpIds: [] }));
  // 嵌套形式也不影响：titleId 与深层子流块重叠
  assert.ok(ok({ titleId: 5, descriptionIds: [], paragraphIds: [[5, 6], 7], dumpIds: [] }));
});

test('parseKeyIds: 其余重叠仍拒绝', () => {
  // titleId ∩ descriptionIds
  assert.match(err({ titleId: 3, descriptionIds: [3], paragraphIds: [6], dumpIds: [] }), /重叠/);
  // paragraphIds ∩ dumpIds
  assert.match(err({ titleId: null, descriptionIds: [], paragraphIds: [5], dumpIds: [5] }), /重叠/);
  // titleId ∩ dumpIds
  assert.match(err({ titleId: 3, descriptionIds: [], paragraphIds: [6], dumpIds: [3] }), /重叠/);
  // descriptionIds ∩ dumpIds
  assert.match(err({ titleId: null, descriptionIds: [4], paragraphIds: [6], dumpIds: [4] }), /重叠/);
});

test('parseKeyIds: 同一键内重复仍拒绝', () => {
  assert.match(err({ titleId: null, descriptionIds: [3, 3], paragraphIds: [6], dumpIds: [] }), /重叠/);
  assert.match(err({ titleId: null, descriptionIds: [], paragraphIds: [6, 6], dumpIds: [] }), /重叠/);
  assert.match(err({ titleId: null, descriptionIds: [], paragraphIds: [6], dumpIds: [7, 7] }), /重叠/);
});

test('parseKeyIds: 形状拦截', () => {
  // titleId 非正整数
  assert.match(err({ titleId: 0, descriptionIds: [], paragraphIds: [6], dumpIds: [] }), /titleId/);
  assert.match(err({ titleId: -1, descriptionIds: [], paragraphIds: [6], dumpIds: [] }), /titleId/);
  // paragraphIds 为空
  assert.match(err({ titleId: null, descriptionIds: [], paragraphIds: [], dumpIds: [] }), /paragraphIds/);
  // paragraphIds 非法成员
  assert.match(err({ titleId: 1, descriptionIds: [], paragraphIds: [2, 'x'], dumpIds: [] }), /非法成员/);
});
