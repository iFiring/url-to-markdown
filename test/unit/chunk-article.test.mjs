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

test('T2 贪心装箱 + 尾块合并 + 下文豁免：合并块允许溢出 chunkMax', () => {
  // 14 个 1000B 块，chunkMax=6500 → 贪心 [6,6,2]；尾块 2 块 <5，
  // 6000+2000=8000 ≤ splitThreshold(12000) → 并入 → 2 块
  const children = Array.from({ length: 14 }, (_, i) => blk(i + 1, 1000));
  const r = chunkArticle(doc(children), children, { splitThreshold: 12000, chunkMax: 6500 });
  assert.equal(r.split, true);
  assert.equal(r.chunks.length, 2);
  const [c1, c2] = r.chunks;
  // 块 1：own=6000，下文 [b7] 1000B ≤cap(1300)——下文豁免不计入预算
  // （计入则 own+b7 恒 >chunkMax 永被削减）；无开头/上文 → 无 ✅
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束'), '下文豁免后 ❌ 应存活');
  assert.ok(c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');
  // 块 2（末块、尾块合并产物 own 8000 > chunkMax）：全部上下文削减
  assert.deepEqual(ids(c2.html), [7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(!c2.html.includes('📌') && !c2.html.includes('✅') && !c2.html.includes('❌'));
  // 合并块 own 8000 > chunkMax 6500——尾块合并溢出是合法例外（≤ splitThreshold）
  assert.ok(bytes(c2.html) > 6500 && bytes(c2.html) <= 12000);
});

test('T3 上下文窗口：开头/上文就位、下文被字节帽压制、末块全削减、分片守护不过保留小块', () => {
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

  // 块 1：own=[1-7]；next 候选 id8(3000) > cap → 下文压制 → 裸 own
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(!c1.html.includes('✅') && !c1.html.includes('❌'), '首块无上下文标记');

  // 块 2：📌开头=[1,2]（第 3 块 2400>cap 截停）、⚠️上文=[6,7]（向前取 2 块、
  // id5 3000 截停）、✅；next 候选 id12(8000)>cap → 无 ❌。
  // file=1600+1600+5400+注释 ≈ 9.1KB ≤ chunkMax → 削减不触发
  assert.deepEqual(ids(c2.html), [1, 2, 6, 7, 8, 9, 10, 11]);
  assert.ok(c2.html.includes('📌 开头上下文'), '应有开头上下文标记');
  assert.ok(c2.html.includes('⚠️ 上文上下文'), '应有上文上下文标记');
  assert.ok(c2.html.includes('✅ 待转换内容自此开始'), '应有开始标记');
  assert.ok(!c2.html.includes('❌'), '下文被字节帽压制 → 无结束标记');
  assert.ok(bytes(c2.html) <= 10000);
  // 开头块不重复出现（去重语义：上文跳过已在开头集内的块）
  assert.equal((c2.html.match(/data-idx="1"/g) || []).length, 1);

  // 块 3（末块）：own 9600 + 任何侧都超 chunkMax → 全削减 → 裸 own
  assert.deepEqual(ids(c3.html), [12, 13, 14]);
  assert.ok(!c3.html.includes('📌') && !c3.html.includes('✅'));

  // 每块都是完整独立文档（与 6_article.html 同头）
  for (const c of r.chunks) {
    assert.ok(c.html.startsWith('<!DOCTYPE html>\n'));
    assert.ok(c.html.includes('<title>t</title>'));
    assert.ok(c.html.includes('max-width: 768px'));
    assert.ok(c.html.endsWith('</body></html>'));
    assert.equal(c.n, 3);
  }
});

test('T4 尾块守护不过：巨块尾部保留为独立小块', () => {
  // 3 个 45KB 块：贪心各自成块；尾块 1 块 <5 但 45000+45000=90000 > 80000 守护不过
  const children = [blk(1, 45000), blk(2, 45000), blk(3, 45000)];
  const r = chunkArticle(doc(children), children, { splitThreshold: 80000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 3);
  assert.deepEqual(r.chunks.map((c) => ids(c.html)), [[1], [2], [3]]);
});

test('T5 巨段落块独立成块（允许溢出）+ 首块下文削减', () => {
  // id1=60KB > chunkMax(50KB) → 独立成块；剩余 8×500B 一块
  const children = [blk(1, 60000), ...Array.from({ length: 8 }, (_, i) => blk(i + 2, 500))];
  const r = chunkArticle(doc(children), children, { splitThreshold: 60000, chunkMax: 50000 });
  assert.equal(r.chunks.length, 2);
  // 首块 own 60KB + 下文 1000B > chunkMax → 削减删下文 → 裸 own、字节溢出合法
  assert.deepEqual(ids(r.chunks[0].html), [1]);
  assert.ok(bytes(r.chunks[0].html) > 50000, '巨块溢出是合法例外');
  assert.ok(!r.chunks[0].html.includes('❌'));
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

test('T7 下文豁免存活 + 末块三标记：❌/⚠️下文 与 📌/⚠️上文/✅ 各就各位', () => {
  // chunkMax=10000、cap=2000、splitThreshold=20000。贪心验算（计划期已逐块核算）：
  // pack0=[ids1-4]=8900（id5 1700B 封边）；pack1=[ids5-13]=8600（id14 1500B 封边）；
  // pack2=[ids14-19]=5500（6 块 ≥5 不合并）。总 23000 > 20000 触发分割。
  const children = [
    blk(1, 800), blk(2, 800), blk(3, 6500), blk(4, 800),
    blk(5, 1700), ...Array.from({ length: 7 }, (_, i) => blk(i + 6, 800)), blk(13, 1300),
    blk(14, 1500), ...Array.from({ length: 5 }, (_, i) => blk(i + 15, 800)),
  ];
  const r = chunkArticle(doc(children), children, { splitThreshold: 20000, chunkMax: 10000 });
  assert.equal(r.chunks.length, 3);
  const [c1, c2, c3] = r.chunks;

  // 块 1：own 8900 + 下文 [id5]（1700 ≤cap；id6 会 2500>cap 截停）——
  // 豁免后 (own+头) ≤chunkMax 不触发削减 → ❌/⚠️下文 存活
  assert.deepEqual(ids(c1.html), [1, 2, 3, 4, 5]);
  assert.ok(c1.html.includes('❌ 待转换内容自此结束') && c1.html.includes('⚠️ 下文上下文'));
  assert.ok(!c1.html.includes('✅'), '首块无开头/上文 → 无 ✅');

  // 块 2：own 8600 + 开头/上文 超预算（触发 ≈11676>10000）→ 📌/⚠️上文/✅ 全削减；
  // 下文 [id14]（1500 ≤cap）豁免存活 → own + ❌/⚠️下文
  assert.deepEqual(ids(c2.html), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(c2.html.includes('❌ 待转换内容自此结束'), '下文豁免应在削减后存活');
  assert.ok(!c2.html.includes('📌') && !c2.html.includes('✅'), 'own 超预算 → 开头/上文削光');

  // 块 3（末块）：📌=[1,2]（1600 ≤cap，id3 6500 截停）+ ⚠️上文=[13]（1300 ≤cap，
  // id12 会 2100>cap 截停）+ ✅ + own，无 ❌（末块无下文侧）
  assert.deepEqual(ids(c3.html), [1, 2, 13, 14, 15, 16, 17, 18, 19]);
  assert.ok(c3.html.includes('📌 开头上下文') && c3.html.includes('⚠️ 上文上下文'));
  assert.ok(c3.html.includes('✅ 待转换内容自此开始'));
  assert.ok(!c3.html.includes('❌'), '末块无下文侧');
});
