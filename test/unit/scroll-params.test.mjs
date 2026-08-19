import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('capture_snapshot 滚动参数与 page-detect.js 一致', () => {
  const cap = fs.readFileSync('script/capture_snapshot.mjs', 'utf8');
  const det = fs.readFileSync('script/lib/page-detect.js', 'utf8');
  const iters = Number(det.match(/scrollIters \|\| (\d+)/)[1]);
  const wait = Number(det.match(/scrollWait \|\| (\d+)/)[1]);
  assert.ok(cap.includes(`i < ${iters}`), `capture 滚动轮次应为 ${iters}`);
  assert.ok(cap.includes(`setTimeout(r, ${wait})`), `capture 每轮等待应为 ${wait}ms`);
});

test('capture_snapshot 稳定参数沿用原 clear_trans_html 值', () => {
  const cap = fs.readFileSync('script/capture_snapshot.mjs', 'utf8');
  assert.match(cap, /stableMs = 1000/);
  assert.match(cap, /maxMs = 15000/);
  assert.match(cap, /waitForTimeout\(200\)/);
});
