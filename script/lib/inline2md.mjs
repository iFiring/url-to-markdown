// script/lib/inline2md.mjs
// 长文本行内 run 的确定性 Markdown 转换器（spec 2026-09-06 §5）。
// 输入是步骤 2 共享段规范化序列化的 canonical HTML 片段（2_long_text.json
// 的 runs 段）：剥净属性、span 已归一为 strong/em/del、math 已压成仅含
// annotation 的极简形态。jsdom 解析后递归下降映射为 GFM 行内语法。
//
// 转义策略（§5.3，2026-09-07 自审修订）：
//  - 常规文本节点：活动字符 `` \ ` * _ [ ] < $ ~ `` 反斜杠转义；`!` 仅后随
//    `[` 时转义（防误触步骤 6 图片下载扫描）；
//  - 行首中断符：处于输出行首（值开头 / 文本换行后 / br 硬换行后 / 前导
//    空白后）的 `# > - + =` 直接转义、「数字 + ./) + 空白」转义定界符——
//    防源码换行后随文本被解析为列表/标题/引用/setext（软折叠不覆盖块级
//    中断构造）；
//  - code span 内部与 math 源照抄不转义：code span 内反斜杠是字面字符
//    （转义即可见损坏），math 源 `\alpha` 不可翻倍。
//  - 行内流空白折叠（2026-09-11，spec §12）：文本节点空白 run（含换行）
//    折叠为单空格——浏览器 white-space:normal 语义（与 code span/math 源
//    换行折叠同 rationale）。runs 是纯行内内容（pre 子树被 run 检测排除），
//    文本节点换行从不产生可见换行；pretty-printed 源码在行内元素间夹的
//    排版空白（换行+缩进）原样穿透会把 markdown 值拆成多行。可见换行只
//    来自 <br>（BR 分支不经 escapeText）；不 trim run 首尾——占位符与骨架
//    短文本拼接时空白承载词间距，残余双空格渲染时自折叠。
//
// 强调归一（2026-09-11，spec §5.4 修订）：微信类编辑器产出「双层加粗」
// （`<strong>` 套 font-weight:bold span，canonical 归一后成 strong 直接嵌
// strong），外层强调内容首/尾触内层 md 记号会批量触发旧版 raw HTML 退化
// ——实测微信长文 117 处字面标签，且 `**a****b**` 的四星连串触发
// CommonMark rule of 3 拒绝拆分、渲染出字面 `**`（保真损伤，不只是源码
// 丑）。转换前做四类渲染等价改写（normalizeEmphasis，迭代到不动点）：
//  R1 内容仅空白/br 的强调壳解包（子节点原位保留）；
//  R2 同族（md 记号相同：strong/b、em/i、del/s）嵌套强调并为一层——
//     仅当亲链全程同族才并，`<strong><em><strong>` 跨族不误并；
//  R3 强调元素首/尾的空白文本与 `<br>` 提升到元素外（GFM 强调空白边界
//     本就不闭合，提升后渲染等价）；
//  R4 run 末尾悬空 `<br>` 剥离（穿透 a/行内透传族下降；条目以 `\` 收尾
//     会被部分解析器渲染为字面反斜杠——run 中部硬换行保留）。
// 归一后 wrapEmphasis 的空白边界退化不可达；跨族嵌套（内容边界触 `*`）
// 换用同语义备选定界符 `__`/`_`（marked 实渲验证等价），raw HTML 透传
// 仅剩防御路径。
import { JSDOM } from 'jsdom';

const ESCAPE_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '<', '$', '~']);
const LINE_START_ESCAPE = new Set(['#', '>', '-', '+', '=']);
// 行首有序列表定界：数字串（CommonMark 上限 9 位）+ ./) + 空白或行尾
const OL_LINE_RE = /^(\d{1,9})([.)])(\s|$)/;
// 行内同族（u/mark/small/sub/sup/abbr/cite/q/kbd/samp/time/var）：
// markdown 无对应语法，GFM 允许行内 raw HTML，透传最保真
const RAW_PASS = new Set(['U', 'MARK', 'SMALL', 'SUB', 'SUP', 'ABBR', 'CITE', 'Q', 'KBD', 'SAMP', 'TIME', 'VAR']);
// 强调族（R2 同族合并判据）：同族 = md 记号相同，嵌套渲染等价可并层
const EMPH_FAMILY = { STRONG: 'b', B: 'b', EM: 'i', I: 'i', DEL: 'd', S: 'd' };
const EMPH_SELECTOR = 'strong,b,em,i,del,s';
// R4 剥尾部悬空 br 允许下降的行内标签（强调族尾 br 已被 R3 提升出元素）
const BR_DESCEND = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', ...RAW_PASS]);

// 内容最长反引号连续串长度（code span 围栏自适应——与骨架渲染（lib/skeleton2md）围栏同哲学：
// 围栏严格长于内容最长串，GFM 不可闭合）
function longestTickRun(s) {
  const runs = s.match(/`+/g);
  return runs ? Math.max(...runs.map((t) => t.length)) : 0;
}

// 文本节点转义。state.lineStart 跨元素线程：br 置 true（文本换行已折叠、
// 不再触发行首），空白保持 true（CommonMark 允许 ≤3 前导空格的中断），
// 任何非空白输出置 false。元素包装（如 ** 前缀）后内层文本可能残留旧
// lineStart → 过度转义，渲染透明、无害；宁可过度不漏（漏 = 块结构被破坏）。
function escapeText(text, state) {
  // 行内流空白折叠（spec §12）：空白 run（含换行）→ 单空格，`\r` 一并归一
  text = text.replace(/[ \t\r\n]+/g, ' ');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state.lineStart && LINE_START_ESCAPE.has(c)) {
      out += '\\' + c; state.lineStart = false; continue;
    }
    if (state.lineStart && c >= '0' && c <= '9') {
      const m = text.slice(i).match(OL_LINE_RE);
      if (m) {
        out += m[1] + '\\' + m[2];
        i += m[1].length + m[2].length - 1;
        state.lineStart = false; continue;
      }
    }
    if (ESCAPE_CHARS.has(c)) { out += '\\' + c; state.lineStart = false; continue; }
    if (c === '!' && text[i + 1] === '[') { out += '\\!'; state.lineStart = false; continue; }
    out += c;
    if (c !== ' ' && c !== '\t') state.lineStart = false;
  }
  return out;
}

function convertNodes(nodes, state) {
  let out = '';
  for (const n of nodes) out += convertNode(n, state);
  return out;
}

// 强调包裹（spec §5.4，2026-09-11 修订）：定界符择优取代一律退化。
// 内容首/尾触主记号字符（跨族嵌套产物，如 strong 包 em 的 `*x*`）时换
// 同语义备选定界符（** ↔ __、* ↔ _；不同记号字符无 rule of 3 冲突，
// marked 实渲等价）；空白边界经归一已不可达，与备选也冲突时才退化
// 原生 HTML 透传（防御路径）。空内容输出空串——`****` 是噪音。
function wrapEmphasis(content, openHtml, closeHtml, md, altMd) {
  if (!content) return '';
  if (!/^\s|\s$/.test(content)) {
    const first = content[0];
    const last = content[content.length - 1];
    if (first !== md[0] && last !== md[0]) return md + content + md;
    if (altMd && first !== altMd[0] && last !== altMd[0]) return altMd + content + altMd;
  }
  return openHtml + content + closeHtml;
}

// —— 强调归一（R1-R4，见文件头注）——

function unwrapElement(el) {
  while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
  el.remove();
}

// R1 判据：无任何「有意义内容」（非空白文本 / br 以外元素）
function isEmptyShell(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { if (n.textContent.trim() !== '') return false; }
    else if (n.nodeType === 1 && n.tagName !== 'BR') return false;
  }
  return true;
}

// R3：首/尾的 br 与空白文本（含文本节点部分前/后缀）提升到元素外
function hoistBoundary(el) {
  const doc = el.ownerDocument;
  let changed = false;
  for (;;) {
    const n = el.firstChild;
    if (!n) break;
    if (n.nodeType === 1 && n.tagName === 'BR') {
      el.parentNode.insertBefore(n, el); changed = true; continue;
    }
    if (n.nodeType === 3 && /^\s/.test(n.textContent)) {
      const m = n.textContent.match(/^\s+/)[0];
      if (m.length === n.textContent.length) el.parentNode.insertBefore(n, el);
      else {
        el.parentNode.insertBefore(doc.createTextNode(m), el);
        n.textContent = n.textContent.slice(m.length);
      }
      changed = true; continue;
    }
    break;
  }
  for (;;) {
    const n = el.lastChild;
    if (!n) break;
    if (n.nodeType === 1 && n.tagName === 'BR') {
      el.parentNode.insertBefore(n, el.nextSibling); changed = true; continue;
    }
    if (n.nodeType === 3 && /\s$/.test(n.textContent)) {
      const m = n.textContent.match(/\s+$/)[0];
      if (m.length === n.textContent.length) el.parentNode.insertBefore(n, el.nextSibling);
      else {
        el.parentNode.insertBefore(doc.createTextNode(m), el.nextSibling);
        n.textContent = n.textContent.slice(0, -m.length);
      }
      changed = true; continue;
    }
    break;
  }
  return changed;
}

// R4：run 末尾悬空 br 剥离（返回是否剥过——供上层重查同位）
function stripTrailingBr(node) {
  let stripped = false;
  for (;;) {
    const last = node.lastChild;
    if (last && last.nodeType === 1 && last.tagName === 'BR') { last.remove(); stripped = true; continue; }
    if (last && last.nodeType === 1 && BR_DESCEND.has(last.tagName) && stripTrailingBr(last)) { stripped = true; continue; }
    break;
  }
  return stripped;
}

// R1-R4 迭代到不动点（guard 防病态循环；单次改写恒缩小结构，正常远小于上限）
function normalizeEmphasis(body) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const el of [...body.querySelectorAll(EMPH_SELECTOR)]) {
      if (!el.isConnected) continue;
      const fam = EMPH_FAMILY[el.tagName];
      if (isEmptyShell(el)) { unwrapElement(el); changed = true; continue; }   // R1
      for (const inner of [...el.querySelectorAll(EMPH_SELECTOR)]) {          // R2
        if (!inner.isConnected || EMPH_FAMILY[inner.tagName] !== fam) continue;
        let p = inner.parentElement;
        let sameChain = true;
        while (p && p !== el) {
          if (EMPH_FAMILY[p.tagName] !== fam) { sameChain = false; break; }
          p = p.parentElement;
        }
        if (sameChain) { unwrapElement(inner); changed = true; }
      }
      if (hoistBoundary(el)) changed = true;                                  // R3
    }
  }
  stripTrailingBr(body);                                                      // R4
}

function convertNode(node, state) {
  if (node.nodeType === 3) return escapeText(node.textContent, state);
  if (node.nodeType !== 1) return '';
  const inner = () => convertNodes(node.childNodes, state);
  // HTML 命名空间 tagName 恒大写；MathML 等外来元素保留书写形态（canonical
  // 一律小写），统一大写化匹配
  switch (node.tagName.toUpperCase()) {
    case 'STRONG': case 'B':
      return wrapEmphasis(inner(), '<strong>', '</strong>', '**', '__');
    case 'EM': case 'I':
      return wrapEmphasis(inner(), '<em>', '</em>', '*', '_');
    case 'DEL': case 'S':
      return wrapEmphasis(inner(), '<del>', '</del>', '~~', null);
    case 'A': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!href) return text;                       // canonical 已解包；防御
      // href 含括号（配对与否一律处理）/ 空白 / 角括号时角括号包裹
      // （CommonMark 链接目标语法），防截断；< > 在 <…> 形态内不合法，
      // 百分号转义（罕见 URL 形态，语义等价）
      const dest = /[()\s<>]/.test(href)
        ? `<${href.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
        : href;
      return `[${text}](${dest})`;
    }
    case 'BR':
      // GFM 硬换行（比两空格尾随式抗工具链剥空白）；换行后行首中断符要转义
      state.lineStart = true;
      return '\\' + '\n';
    case 'CODE': {
      // code span 内容照抄不转义；内部换行折叠为空格——浏览器对行内流
      // 空白的处理语义（white-space:normal 折叠），且防换行后 - / 1. 触发
      // 块中断拆碎 code span
      const raw = node.textContent.replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
      if (!raw.includes('`')) return '`' + raw + '`';
      const fence = '`'.repeat(longestTickRun(raw) + 1);
      return fence + ' ' + raw + ' ' + fence;
    }
    case 'MATH': {
      // 极简形态（步骤 2 序列化保证 annotation 存在）；源照抄不转义。
      // 换行折叠为空格：TeX 源中换行 = 空格 token，渲染等价且防 $…$ 内
      // 换行触发块中断
      const ann = node.querySelector('annotation');
      const src = (ann ? ann.textContent : '').trim().replace(/\r\n?/g, '\n').replace(/\n/g, ' ');
      return node.getAttribute('display') === 'block' ? `$$${src}$$` : `$${src}$`;
    }
    default: {
      // wbr：零宽换行机会无输出，解包；同族透传；未知标签解包（只递归子节点）
      const tag = node.tagName.toUpperCase();
      if (tag === 'WBR') return '';
      if (RAW_PASS.has(tag)) {
        const lower = node.tagName.toLowerCase();
        return `<${lower}>${inner()}</${lower}>`;
      }
      return inner();
    }
  }
}

// canonical 片段 → markdown。解析失败抛错，调用方（render_markdown）
// 兜底为 textContent 纯文本（spec §5.4）。
export function inlineRunToMarkdown(html) {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  normalizeEmphasis(doc.body);
  const state = { lineStart: true };
  return convertNodes(doc.body.childNodes, state);
}

// 转换异常兜底（spec §5.4）：退回 jsdom textContent 纯文本。
export function runTextContent(html) {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  return doc.body.textContent || '';
}
