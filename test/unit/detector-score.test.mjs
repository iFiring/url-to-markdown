// test/unit/detector-score.test.mjs
// 计分语义 v2（2026-09-07 设计）：六信号 + loginConfirmed；
// 跳过记忆（memorized 数组）= 命中信号全部在记忆内才整体豁免，
// 存在记忆外新信号时记忆内信号照常态计票。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals } from '../../script/lib/detector.mjs';

test('计分：命中数 ≥2 判定需登录', () => {
  assert.equal(scoreSignals({}).needsLogin, false);
  assert.equal(scoreSignals({ url: true, content: true }).needsLogin, true);
  assert.equal(scoreSignals({ password: true, url: true }).hits, 2);
  assert.equal(scoreSignals({ spa: true, loginButton: true }).needsLogin, true);
  assert.equal(scoreSignals({ url: true }).needsLogin, false, '弱信号单独不成立');
});

test('计分：强信号（password/loginConfirmed）单独成立', () => {
  assert.equal(scoreSignals({ password: true }).needsLogin, true);
  assert.equal(scoreSignals({ loginConfirmed: true }).needsLogin, true);
  assert.equal(scoreSignals({ loginConfirmed: true, url: true }).hits, 2, '强信号也计入命中数');
  assert.deepEqual(scoreSignals({ loginConfirmed: true }).strong, ['loginConfirmed']);
  assert.deepEqual(scoreSignals({ password: true, loginConfirmed: true }).strong,
    ['password', 'loginConfirmed']);
});

test('计分：loginButton 可见未确认只是普通一票（点击探测降级语义）', () => {
  assert.equal(scoreSignals({ loginButton: true }).needsLogin, false);
  assert.deepEqual(scoreSignals({ loginButton: true }).strong, []);
});

test('计分：cookieMissing 已从信号集删除——即使传入也不计票', () => {
  assert.equal(scoreSignals({ cookieMissing: true }).hits, 0);
  assert.equal(scoreSignals({ cookieMissing: true, url: true }).needsLogin, false,
    'cookieMissing 不能再与 url 凑票');
});

test('记忆豁免：命中信号全部在记忆数组内 → 整体豁免不判定需登录', () => {
  const r = scoreSignals({ url: true, content: true }, ['url', 'content']);
  assert.equal(r.needsLogin, false);
  assert.equal(r.dismissed, true, '豁免应显式标注供 emit 通报');
  // 单弱信号命中且在记忆内同样豁免
  assert.equal(scoreSignals({ loginButton: true }, ['loginButton']).needsLogin, false);
});

test('记忆豁免：存在记忆外新信号 → 记忆内信号恢复计票', () => {
  // url 在记忆内，spa 是新证据 → 两票合议成立
  const r = scoreSignals({ url: true, spa: true }, ['url']);
  assert.equal(r.needsLogin, true);
  assert.equal(r.dismissed, false);
  assert.equal(r.hits, 2, '记忆内信号照常计入票数');
  // 新证据是强信号 → 单独成立
  assert.equal(scoreSignals({ url: true, content: true, password: true },
    ['url', 'content']).needsLogin, true);
});

test('记忆豁免边界：零命中不算豁免；强信号从不被记忆压制（代码不写入，手写也仅在全命中时生效）', () => {
  assert.equal(scoreSignals({}, ['url']).dismissed, false, '无命中时 dismissed 无意义');
  // 强信号 + 记忆内弱信号混合：不全在记忆 → 不豁免，强信号成立
  assert.equal(scoreSignals({ loginConfirmed: true, loginButton: true },
    ['loginButton']).needsLogin, true);
});
