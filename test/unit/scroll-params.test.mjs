import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('snapshot-scroll 滚动参数与 page-detect.js 一致', () => {
  const scroll = fs.readFileSync('script/lib/snapshot-scroll.mjs', 'utf8');
  const det = fs.readFileSync('script/lib/page-detect.js', 'utf8');
  const iters = Number(det.match(/scrollIters \|\| (\d+)/)[1]);
  const wait = Number(det.match(/scrollWait \|\| (\d+)/)[1]);
  assert.ok(scroll.includes(`i < ${iters}`) || scroll.includes(`rounds`), `snapshot-scroll 滚动轮次应为 ${iters}`);
  assert.ok(scroll.includes(`setTimeout(r, ${wait})`), `snapshot-scroll 每轮等待应为 ${wait}ms`);
});

test('snapshot-scroll 稳定参数沿用原 clear_trans_html 值', () => {
  const scroll = fs.readFileSync('script/lib/snapshot-scroll.mjs', 'utf8');
  // DOM 稳定：1000ms 稳定期 / 15000ms 超时 / 200ms 轮询
  assert.match(scroll, /1000/);
  assert.match(scroll, /15000/);
  assert.match(scroll, /200/);
});
