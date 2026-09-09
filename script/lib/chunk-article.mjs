// script/lib/chunk-article.mjs
/**
 * 文章视图分块器（spec docs/superpowers/specs/2026-09-09-article-chunk-split-design.md）。
 * 纯函数：不碰文件系统与浏览器；由 extract_article.mjs 在 slim pass 后调用。
 *
 * 输入：page-slim 产物全文 slimHtml 与 body 逐子元素 outerHTML（同一 DOM、
 * 同一序列化器——每块 markup 与 6_article.html 逐字节一致）。输出完整独立
 * html 分块 6_article_chunk_X_of_N.html 的内容。
 *
 * 算法（spec §3.3-§3.5）：
 *   1. 触发：slimHtml 字节 > splitThreshold 才分割
 *   2. 贪心装箱：按文档序累加，加入下一块会超 chunkMax 即封块（own 向
 *      50KB 靠齐）；单个段落块自身 > chunkMax 时独立成块（允许溢出——
 *      段落块是步骤 7 的原子契约单位）
 *   3. 尾块合并（循环每轮重查）：最后一块段落块数 <5 且（前块+尾块 own）≤
 *      splitThreshold → 并入前块。守护必须用 splitThreshold：贪心封边处恒有
 *      前块+尾块首块 > chunkMax，而尾块 own ≥ 尾块首块，chunkMax 守护下条件
 *      永假（死代码）。合并后仅剩 1 块 → 视为未分割（防御分支）
 *   4. 上下文窗口：第 2 块起 📌开头（第 1 块前 min(3,·) 个的前缀）+ ⚠️上文
 *      （上一块尾部向前 ≤2，跳过已在开头集内的块）；每块 ⚠️下文（下一块
 *      开头向后 ≤2，末块无）。每侧独立字节帽 chunkMax/5：(已取+候选) ≤ 帽
 *      才取、否则停
 *   5. 上下文不计入块预算（2026-09-09 用户裁定）：📌/⚠️ 侧是只读参照，为压
 *      50KB 削上下文本末倒置——无超限削减 pass；每侧自身选取上限（≤3/≤2/≤2
 *      块且 ≤chunkMax/5）即是约束，文件最坏 ≈ chunkMax + 3×cap。
 *      （历史：v1 按「文件−下文 > chunkMax」削减上文→开头→下文，紧装块
 *      上下文被削光；v2 装箱预留 3072B 仍被胖开头侧吃掉——均废弃）
 *
 * 标记注释（一句话中英双语，spec §3.5 文案）划出转换边界：子代理只转换
 * ✅ 与 ❌ 之间（或无标记时的全部）段落块。
 */
const OPENING_MARK = (k) => `<!-- 📌 开头上下文（勿转换）/ OPENING CONTEXT (do NOT convert): 以下 ${k} 个段落块是文章开头的标题/导语，仅供建立标题层级与字号基准。勿为它们产出条目；其中出现的 LONG_TEXT/TABLE/CODE 编号一律勿引用（由第 1 块负责）。 -->`;
const PREV_MARK = (k) => `<!-- ⚠️ 上文上下文（勿转换）/ PRECEDING CONTEXT (do NOT convert): 以下 ${k} 个段落块紧邻本块待转换内容之前，仅供衔接语境（标题层级/列表延续/字号基准）。勿为它们产出条目；其中的编号一律勿引用（由上一块负责）。 -->`;
const START_MARK = '<!-- ✅ 待转换内容自此开始 / Convert ONLY the content below this marker -->';
const END_MARK = '<!-- ❌ 待转换内容自此结束 / Convertible content ENDS here（下方为下文上下文，勿转换） -->';
const NEXT_MARK = (k) => `<!-- ⚠️ 下文上下文（勿转换）/ FOLLOWING CONTEXT (do NOT convert): 以上 ${k} 个段落块紧邻本块待转换内容之后，仅供衔接语境。勿为它们产出条目；其中的编号一律勿引用（由下一块负责）。 -->`;

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
  for (let i = 0; i < n; i++) {
    const own = packs[i];
    const openingIdxs = i > 0 ? opening : [];
    const prevIdxs = i > 0 ? pickPrev(i) : [];
    const nextIdxs = i < n - 1 ? pickNext(i) : [];
    // DOC_RE 捕获组从 <html 起——DOCTYPE 前缀在此补上，与 6_article.html
    // 的 '<!DOCTYPE html>\n' + outerHTML 序列化形态逐字节同头
    const parts = ['<!DOCTYPE html>\n', header];
    if (openingIdxs.length > 0) {
      parts.push(`\n${OPENING_MARK(openingIdxs.length)}`);
      parts.push(...openingIdxs.map((t) => children[t]));
    }
    if (prevIdxs.length > 0) {
      parts.push(`\n${PREV_MARK(prevIdxs.length)}`);
      parts.push(...prevIdxs.map((t) => children[t]));
    }
    if (openingIdxs.length > 0 || prevIdxs.length > 0) parts.push(`\n${START_MARK}\n`);
    parts.push(...own.map((t) => children[t]));
    if (nextIdxs.length > 0) {
      parts.push(`\n${END_MARK}`);
      parts.push(`\n${NEXT_MARK(nextIdxs.length)}`);
      parts.push(...nextIdxs.map((t) => children[t]));
    }
    parts.push('</body></html>');
    chunks.push({ x: i + 1, n, html: parts.join('') });
  }
  return { split: true, chunks };
}
