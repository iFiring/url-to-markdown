import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkArticle } from '../../script/lib/chunk-article.mjs';

// 头部与 page-slim 产物同构：'<!DOCTYPE html>\n' + documentElement.outerHTML
const HEAD = '<html lang="zh-CN"><head><title>t</title></head><body style="max-width: 768px; margin: 4rem auto">';
const doc = (children) => `<!DOCTYPE html>\n${HEAD}${children.join('')}</body></html>`;
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// 精确 size 字节的段落块（open 长度随 id 位数变化，filler 补齐）
const blk = (id, size) => {
  const open = `<p data-idx="${id}">`;
  return `${open}${'x'.repeat(size - open.length - 4)}</p>`;
};
assert.equal(bytes(blk(3, 800)), 800, 'blk 辅助函数应精确控制字节');

// 从 html 提取 data-idx 序列（断言块身份与顺序）
const ids = (html) => [...html.matchAll(/data-idx="(\d+)"/g)].map((m) => Number(m[1]));

test('T1 未达阈值不分割：split=false、chunks 空', () => {
  const children = [blk(1, 300), blk(2, 300), blk(3, 300)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 1024 * 1024, chunkMax: 51200 });
  assert.equal(r.split, false);
  assert.deepEqual(r.chunks, []);
});

test('T2 贪心装箱 + 尾块合并 + 上下文不计预算（合并块带全标记溢出）', () => {
  // 14 个 1000B 块，chunkMax=6500 → 贪心 [6,6,2]；尾块 2 块 <5，
  // 6000+2000=8000 ≤ splitThreshold(12000) → 并入 → 2 块
  const children = Array.from({ length: 14 }, (_, i) => blk(i + 1, 1000));
  const r = chunkArticle(doc(children), children, { splitThreshold: 12000, chunkMax: 6500 });
  assert.equal(r.split, true);
  assert.equal(r.chunks.length, 2);
  const [c1, c2] = r.chunks;
  // 块 1：own=6000，下文 [b7] 1000B ≤cap(1300)——上下文不计预算、永不被削；
  // 首块无开头/上文 → 无 ✅
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束'), '上下文免费后 ❌ 应存活');
  assert.ok(c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');
  // 块 2（末块、尾块合并产物 own 8000 > chunkMax）：上下文照常就位——
  // 📌[b1]、⚠️上文=[b6]（各 1 块即触帽：2×1000>cap 1300）、✅；无 ❌（末块）
  assert.deepEqual(ids(c2.html), [1, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(c2.html.includes('📌 开头上下文') && c2.html.includes('⚠️ 上文上下文'));
  assert.ok(c2.html.includes('✅ 待转换内容自此开始'));
  assert.ok(!c2.html.includes('❌'), '末块无下文侧');
  // 合并块 own 8000 > chunkMax 6500——尾块合并溢出是合法例外（≤ splitThreshold）
  assert.ok(bytes(c2.html) > 6500 && bytes(c2.html) <= 12000);
});

test('T3 上下文窗口：开头/上文就位、下文被字节帽压制、合并溢出末块全标记', () => {
  // chunkMax=10000、cap=2000、splitThreshold=12000。
  // 贪心：[ids1-7]=7800（id5=3000 封边）、[ids8-11]=5400（id12=8000 封边）、
  // [ids12-14]=9600（3 块 <5 但 5400+9600=15000 >12000 守护不过 → 保留）
  const children = [
    blk(1, 800), blk(2, 800), blk(3, 800), blk(4, 800), blk(5, 3000), blk(6, 800), blk(7, 800),
    blk(8, 3000), blk(9, 800), blk(10, 800), blk(11, 800),
    blk(12, 8000), blk(13, 800), blk(14, 800),
  ];
  const r = chunkArticle(doc(children), children, { splitThreshold: 12000, chunkMax: 10000 });
  assert.equal(r.split, true);
  assert.equal(r.chunks.length, 3);
  const [c1, c2, c3] = r.chunks;

  // 块 1：own=[1-7]；next 候选 id8(3000) > cap → 下文侧为空 → 裸 own
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!c1.html.includes('✅') && !c1.html.includes('❌'), '首块无上下文标记');

  // 块 2：📌开头=[1,2]（第 3 块 2400>cap 截停）、⚠️上文=[6,7]（向前取 2 块、
  // id5 3000 截停）、✅；next 候选 id12(8000)>cap → 无 ❌。
  // 上下文不计预算：own 5400 + 两侧 ~3.9KB 照常全保留
  assert.deepEqual(ids(c2.html), [1, 2, 6, 7, 8, 9, 10, 11]);
  assert.ok(c2.html.includes('📌 开头上下文'), '应有开头上下文标记');
  assert.ok(c2.html.includes('⚠️ 上文上下文'), '应有上文上下文标记');
  assert.ok(c2.html.includes('✅ 待转换内容自此开始'), '应有开始标记');
  assert.ok(!c2.html.includes('❌'), '下文被字节帽压制 → 无结束标记');
  // 开头块不重复出现（去重语义：上文跳过已在开头集内的块）
  assert.equal((c2.html.match(/data-idx="1"/g) || []).length, 1);

  // 块 3（末块、守护不过保留的合并前形态 own 9600）：📌[1,2] + ⚠️上文=[10,11]
  // （1600 ≤cap）+ ✅ 照常就位（上下文免费），无 ❌；
  // own 9600+上下文 → 文件 > chunkMax——上下文不计预算、合法
  assert.deepEqual(ids(c3.html), [1, 2, 10, 11, 12, 13, 14]);
  assert.ok(c3.html.includes('📌 开头上下文') && c3.html.includes('⚠️ 上文上下文'));
  assert.ok(c3.html.includes('✅ 待转换内容自此开始'));
  assert.ok(!c3.html.includes('❌'), '末块无下文侧');
  assert.ok(bytes(c3.html) > 10000, '上下文不计预算：文件可超 chunkMax');

  // 每块都是完整独立文档（与 6_article.html 同头）
  for (const c of r.chunks) {
    assert.ok(c.html.startsWith('<!DOCTYPE html>\n'));
    assert.ok(c.html.includes('<title>t</title>'));
    assert.ok(c.html.includes('max-width: 768px'));
    assert.ok(c.html.endsWith('</body></html>'));
    assert.equal(c.n, 3);
  }
});

test('T4b 尾块合并溢出合法：巨侧块全被字节帽压制 → 两裸块、末块文件超 chunkMax', () => {
  // 11 个 2100B 块，chunkMax=9500：4 块 8400 ≤ 9500、第 5 块 10500 > 9500 封边
  // → [4,4,3]；尾块 3<5：8400+6300=14700 ≤ 20000 → 并入 → [4,7]。
  // cap=1900 < 2100 → 三侧候选全被帽压制 → 每块都是裸 own；
  // c2 own 14700 > chunkMax（合并溢出合法），文件 14828 ≤ splitThreshold
  const children = Array.from({ length: 11 }, (_, i) => blk(i + 1, 2100));
  const r = chunkArticle(doc(children), children, { splitThreshold: 20000, chunkMax: 9500 });
  assert.equal(r.chunks.length, 2);
  assert.deepEqual(r.chunks.map((c) => ids(c.html)), [[1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11]]);
  const c2 = r.chunks[1];
  assert.ok(bytes(c2.html) > 9500 && bytes(c2.html) <= 20000, '合并块 own 溢出 chunkMax 合法');
  assert.ok(!c2.html.includes('📌') && !c2.html.includes('✅') && !c2.html.includes('❌'));
});

test('T4 尾块守护不过：巨块尾部保留为独立小块', () => {
  // 3 个 45KB 块：贪心各自成块；尾块 1 块 <5 但 45000+45000=90000 > 80000 守护不过
  const children = [blk(1, 45000), blk(2, 45000), blk(3, 45000)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 80000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 3);
  assert.deepEqual(r.chunks.map((c) => ids(c.html)), [[1], [2], [3]]);
});

test('T5 巨段落块独立成块（允许溢出）+ 首块下文照常就位', () => {
  // id1=60KB > chunkMax(50KB) → 独立成块；剩余 8×500B 一块
  const children = [blk(1, 60000), ...Array.from({ length: 8 }, (_, i) => blk(i + 2, 500))];
  const r = chunkArticle(doc(children), children, { splitThreshold: 60000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 2);
  // 首块 own 60KB（巨块溢出合法）；下文 [2,3] 1000B ≤cap 照常就位（不计预算）
  assert.deepEqual(ids(r.chunks[0].html), [1, 2, 3]);
  assert.ok(bytes(r.chunks[0].html) > 50000, '巨块溢出是合法例外');
  assert.ok(r.chunks[0].html.includes('❌ 待转换内容自此结束') && r.chunks[0].html.includes('⚠️ 下文上下文'));
  // 末块：opening 候选 60KB > cap、prev 候选 60KB > cap → 裸 own
  assert.deepEqual(ids(r.chunks[1].html), [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('T6 N=1 回退：装箱后仅 1 块 → 视为未分割', () => {
  // splitThreshold(100) < 总字节(~1KB) 触发分割，但 chunkMax 巨大 → 单包装箱 → 回退
  const children = [blk(1, 300), blk(2, 300)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 100, chunkMax: 102400 });
  assert.equal(r.split, false);
  assert.deepEqual(r.chunks, []);
});

test('T7 三侧各就各位：下文帽截停、中间块五标记齐备、末块无下文侧', () => {
  // chunkMax=10000、cap=2000、splitThreshold=20000。
  // 贪心：pack0=[1-4]=8900（id5 1700 会 10600>10000 封边）、pack1=[5-13]=8600
  // （id14 1500 会 10100>10000 封边）、pack2=[14-19]=5500（6 块 ≥5 不合并）。
  const children = [
    blk(1, 800), blk(2, 800), blk(3, 6500), blk(4, 800),
    blk(5, 1700), ...Array.from({ length: 7 }, (_, i) => blk(i + 6, 800)), blk(13, 1300),
    blk(14, 1500), ...Array.from({ length: 5 }, (_, i) => blk(i + 15, 800)),
  ];
  const r = chunkArticle(doc(children), children, { splitThreshold: 20000, chunkMax: 10000 });
  assert.equal(r.chunks.length, 3);
  const [c1, c2, c3] = r.chunks;

  // 块 1：own 8900 + 下文 [id5]（1700 ≤cap；id6 会 2500>cap 截停），
  // 无 ✅（首块无开头/上文）
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束') && c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');

  // 块 2（上下文不计预算的中间块）：📌=[1,2]（1600 ≤cap，id3 6500 截停）+
  // ⚠️上文=[4]（800 ≤cap，id3 6500 截停）+ ✅ + own 8600 + 下文 [14]
  // （1500 ≤cap，id15 会 2300>cap 截停）——五标记齐备
  assert.deepEqual(ids(c2.html), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(c2.html.includes('📌 开头上下文') && c2.html.includes('⚠️ 上文上下文'));
  assert.ok(c2.html.includes('✅ 待转换内容自此开始'));
  assert.ok(c2.html.includes('❌ 待转换内容自此结束') && c2.html.includes('⚠️ 下文上下文'));
  assert.ok(bytes(c2.html) > 10000, '上下文不计预算：文件可超 chunkMax');

  // 块 3（末块）：📌=[1,2] + ⚠️上文=[13]（1300 ≤cap，id12 会 2100>cap 截停）
  // + ✅ + own，无 ❌（末块无下文侧）
  assert.deepEqual(ids(c3.html), [1, 2, 13, 14, 15, 16, 17, 18, 19]);
  assert.ok(c3.html.includes('📌 开头上下文') && c3.html.includes('⚠️ 上文上下文'));
  assert.ok(c3.html.includes('✅ 待转换内容自此开始'));
  assert.ok(!c3.html.includes('❌'), '末块无下文侧');
});
