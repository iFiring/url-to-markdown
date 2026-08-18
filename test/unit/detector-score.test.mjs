// test/unit/detector-score.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals } from '../../script/lib/detector.mjs';

test('计分：命中数 ≥2 判定需登录', () => {
  assert.equal(scoreSignals({}).needsLogin, false);
  assert.equal(scoreSignals({ password: true }).needsLogin, false);
  assert.equal(scoreSignals({ url: true, cookieMissing: true }).needsLogin, true);
  assert.equal(scoreSignals({ password: true, url: true }).hits, 2);
  assert.equal(scoreSignals({ cookieMissing: true, spa: true }).needsLogin, true);
});
