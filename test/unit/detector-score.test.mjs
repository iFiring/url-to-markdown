// test/unit/detector-score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals } from '../../script/lib/detector.mjs';

test('计分：命中数 ≥2 判定需登录', () => {
  assert.equal(scoreSignals({}).needsLogin, false);
  assert.equal(scoreSignals({ url: true, cookieMissing: true }).needsLogin, true);
  assert.equal(scoreSignals({ password: true, url: true }).hits, 2);
  assert.equal(scoreSignals({ cookieMissing: true, spa: true }).needsLogin, true);
  assert.equal(scoreSignals({ url: true }).needsLogin, false, '弱信号单独不成立');
});

test('计分：强信号（password/loginButton）单独成立', () => {
  assert.equal(scoreSignals({ password: true }).needsLogin, true);
  assert.equal(scoreSignals({ loginButton: true }).needsLogin, true);
  assert.equal(scoreSignals({ loginButton: true, cookieMissing: true }).hits, 2, '强信号也计入命中数');
  assert.equal(scoreSignals({ loginButton: true, cookieMissing: true }).needsLogin, true);
});

test('计分：demoted 强信号视为不存在——不单票、不计票', () => {
  assert.equal(scoreSignals({ loginButton: true }, ['loginButton']).needsLogin, false);
  assert.equal(scoreSignals({ password: true }, ['password']).needsLogin, false);
  // 用户裁决过 skip 的信号不再与 cookieMissing 凑票（cookieMissing 对未登录上下文近乎恒真，
  // 保留凑票会让 skip 记忆形同虚设——同站每次都重新弹 viewer）
  assert.equal(scoreSignals({ loginButton: true, cookieMissing: true }, ['loginButton']).needsLogin, false);
  // 降级 loginButton 不影响 password 的单票资格
  assert.equal(scoreSignals({ password: true, loginButton: true }, ['loginButton']).needsLogin, true);
  // 降级信号与其余真实佐证的组合不受影响（url+content 各自独立成票）
  assert.equal(scoreSignals({ loginButton: true, url: true, content: true }, ['loginButton']).needsLogin, true);
});
