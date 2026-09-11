// script/lib/chunk-article.mjs
/**
 * 文章视图分块器（spec docs/superpowers/specs/2026-09-09-article-chunk-split-design.md）。
 * 纯函数：不碰文件系统与浏览器；由 render_article.mjs 在 slim pass 后调用。
 *
 * 输入：page-slim 产物全文 slimHtml 与 body 逐子元素 outerHTML（同一 DOM、
 * 同一序列化器——每块 markup 与 3_article.html 逐字节一致）。输出完整独立
 * html 分块 3_article_chunk_X_of_N.html 的内容。
 *
 * 算法（spec §3.3-§3.5）：
 *   1. 触发：slimHtml 字节 > splitThreshold 才分割
 *   2. 贪心装箱：按文档序累加，加入下一块会超 chunkMax 即封块（own 向
 *      40KB 靠齐）；单个段落块自身 > chunkMax 时独立成块（允许溢出——
 *      段落块是步骤 4 的原子契约单位）
 *   3. 尾块合并（循环每轮重查）：最后一块段落块数 <5 且（前块+尾块 own）≤
 *      splitThreshold → 并入前块。守护必须用 splitThreshold：贪心封边处恒有
 *      前块+尾块首块 > chunkMax，而尾块 own ≥ 尾块首块，chunkMax 守护下条件
 *      永假（死代码）。合并后仅剩 1 块 → 视为未分割（防御分支）
 *   4. 上下文窗口：第 2 块起 📌开头（第 1 块前 min(3,·) 个的前缀）+ ⚠️上文
 *      （上一块尾部向前 ≤2，跳过已在开头集内的块）；每块 ⚠️下文（下一块
 *      开头向后 ≤2，末块无）。每侧独立字节帽 chunkMax/5：(已取+候选) ≤ 帽
 *      才取、否则停
 *   5. 上下文不计入块预算（2026-09-09 用户裁定）：📌/⚠️ 侧是只读参照，为压
 *      40KB 削上下文本末倒置——无超限削减 pass；每侧自身选取上限（≤3/≤2/≤2
 *      块且 ≤chunkMax/5）即是约束，文件最坏 ≈ chunkMax + 3×cap。
 *      （历史：v1 按「文件−下文 > chunkMax」削减上文→开头→下文，紧装块
 *      上下文被削光；v2 装箱预留 3072B 仍被胖开头侧吃掉——均废弃）
 *
 * 标记注释（一句话中英标签，spec §3.5 文案）划出转换边界：✅/❌ **每块恒在**
 * （2026-09-09 用户裁定：首块 ✅ 紧跟 body 开标签、末块 ❌ 紧贴 </body>，
 * 不随上下文侧有无而缺失），子代理只转换 ✅ 与 ❌ 之间的段落块。
 * 三侧上下文段落块**包裹在注释内、
 * 每块独立一行**（2026-09-09 用户裁定：注释对 DOM 解析不可见、对子代理的
 * 文本阅读可见——结构上杜绝误转换；序列化保证文本节点中 > 转义为 &gt;，
 * 内容不会提前终结注释）。
 */
const OPENING_MARK = '<!-- 📌 开头上下文（勿转换）/ OPENING CONTEXT (do NOT convert)';
const PREV_MARK = '<!-- ⚠️ 上文上下文（勿转换）/ PRECEDING CONTEXT (do NOT convert)';
const START_MARK = '<!-- ✅ 待转换内容自此开始 / Convert ONLY the content below this marker -->';
const END_MARK = '<!-- ❌ 待转换内容自此结束 / Convertible content ENDS here -->';
const NEXT_MARK = '<!-- ⚠️ 下文上下文（勿转换）/ FOLLOWING CONTEXT (do NOT convert)';

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// page-slim 产物形态：'<!DOCTYPE html>\n' + documentElement.outerHTML，
// head 与 body 之间无空白文本节点（序列化保证）——不匹配则放弃分割（防御）
const DOC_RE = /^<!DOCTYPE html>\n?(<html[\s\S]*?<\/head><body[^>]*>)[\s\S]*<\/body><\/html>\s*$/;

export function chunkArticle(slimHtml, children, { splitThreshold, chunkMax }) {
  const m = DOC_RE.exec(slimHtml);
  if (!m || !Array.isArray(children) || children.length === 0) return { split: false, chunks: [] };
  if (bytes(slimHtml) <= splitThreshold) return { split: false, chunks: [] };
  const header = m[1];
  const sizes = children.map(bytes);

  // ── 1. 贪心装箱（children 下标即块身份）──
  const packs = []; // number[][]：每包的 children 下标（文档序）
  let cur = [];
  let curBytes = 0;
  for (let i = 0; i < children.length; i++) {
    if (cur.length > 0 && curBytes + sizes[i] > chunkMax) {
      packs.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(i);
    curBytes += sizes[i];
  }
  if (cur.length > 0) packs.push(cur);

  // ── 2. 尾块合并（循环；N=1 回退）──
  const packBytes = (p) => p.reduce((s, i) => s + sizes[i], 0);
  while (
    packs.length >= 2
    && packs[packs.length - 1].length < 5
    && packBytes(packs[packs.length - 2]) + packBytes(packs[packs.length - 1]) <= splitThreshold
  ) {
    const last = packs.pop();
    packs[packs.length - 1].push(...last);
  }
  if (packs.length <= 1) return { split: false, chunks: [] };

  // ── 3. 上下文窗口（每侧字节帽 = chunkMax/5，候选放不进即停）──
  const cap = Math.floor(chunkMax / 5);
  const opening = (() => {
    const cand = packs[0].slice(0, Math.min(3, packs[0].length));
    const out = [];
    let acc = 0;
    for (const i of cand) {
      if (acc + sizes[i] > cap) break;
      out.push(i);
      acc += sizes[i];
    }
    return out;
  })();
  const openingSet = new Set(opening);
  const pickPrev = (i) => {
    // 从上一块末尾向前取 ≤2 个，跳过已在开头集内的块（去重）
    const out = [];
    let acc = 0;
    for (let j = packs[i - 1].length - 1; j >= 0 && out.length < 2; j--) {
      const idx = packs[i - 1][j];
      if (openingSet.has(idx)) continue;
      if (acc + sizes[idx] > cap) break;
      out.push(idx);
      acc += sizes[idx];
    }
    return out.reverse(); // 还原文档序
  };
  const pickNext = (i) => {
    const out = [];
    let acc = 0;
    for (let j = 0; j < packs[i + 1].length && out.length < 2; j++) {
      const idx = packs[i + 1][j];
      if (acc + sizes[idx] > cap) break;
      out.push(idx);
      acc += sizes[idx];
    }
    return out;
  };

  // ── 4. 组装（上下文不计入块预算——无削减 pass，spec §3.4）──
  const n = packs.length;
  const chunks = [];
  // 上下文副本变换（2026-09-09 用户裁定）：剥 data-idx（只读参照无需选择器
  // 锚点，也强化「勿转换」信号——待转换块才带编号）+ 剥 style（内联样式对
  // 只读参照是纯字节噪音）+ 压缩标签间空白 + 压缩文本节点两缘空白（含
  // &nbsp; 实体——只读参照对齐噪音）。序列化保证文本中 < > 已转义为实体、
  // [^<>] 不跨界，正则只触达当前标签/文本段；own 区保真不压缩
  const ctxHtml = (t) =>
    children[t]
      .replace(/\s+data-idx="[^"]*"/g, '')
      .replace(/\s+style="[^"]*"/g, '')
      .replace(/>\s+</g, '><')
      .replace(/>([^<>]+)</g, (m, text) =>
        '>' + text.replace(/^(?:\s|&nbsp;|&#160;)+|(?:\s|&nbsp;|&#160;)+$/g, '') + '<');
  // 一侧上下文 = 注释开标签 + 逐块独立一行 + 注释闭标签
  const commented = (mark, idxs) =>
    `\n${mark}\n${idxs.map((t) => ctxHtml(t)).join('\n')}\n-->`;
  for (let i = 0; i < n; i++) {
    const own = packs[i];
    const openingIdxs = i > 0 ? opening : [];
    const prevIdxs = i > 0 ? pickPrev(i) : [];
    const nextIdxs = i < n - 1 ? pickNext(i) : [];
    // DOC_RE 捕获组从 <html 起——DOCTYPE 前缀在此补上，与 3_article.html
    // 的 '<!DOCTYPE html>\n' + outerHTML 序列化形态逐字节同头；
    // own 区逐字节拼接（与 3_article.html body 内容一致）
    const parts = ['<!DOCTYPE html>\n', header];
    if (openingIdxs.length > 0) parts.push(commented(OPENING_MARK, openingIdxs));
    if (prevIdxs.length > 0) parts.push(commented(PREV_MARK, prevIdxs));
    // ✅/❌ 每块恒在（2026-09-09 用户裁定）：首块 ✅ 紧跟 body 开标签、
    // 末块 ❌ 紧贴 </body>——转换边界直观统一，不随上下文侧的有无而缺失
    parts.push(`\n${START_MARK}\n`);
    parts.push(own.map((t) => children[t]).join(''));
    parts.push(`\n${END_MARK}`);
    if (nextIdxs.length > 0) parts.push(commented(NEXT_MARK, nextIdxs));
    parts.push('</body></html>');
    chunks.push({ x: i + 1, n, html: parts.join('') });
  }
  return { split: true, chunks };
}
