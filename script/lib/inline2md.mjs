// script/lib/inline2md.mjs
// 长文本行内 run 的确定性 Markdown 转换器（spec 2026-09-06 §5）。
// 输入是步骤 2 共享段规范化序列化的 canonical HTML 片段（2_long_text.json
// 的 runs 段）：剥净属性、span 已归一为 strong/em/del、math 已压成仅含
// annotation 的极简形态。jsdom 解析后递归下降映射为 GFM 行内语法。
//
// 转义策略（§5.3，2026-09-07 自审修订）：
//  - 常规文本节点：活动字符 `` \ ` * _ [ ] < $ ~ `` 反斜杠转义；`!` 仅后随
//    `[` 时转义（防误触步骤 8 图片下载扫描）；
//  - 行首中断符：处于输出行首（值开头 / 文本换行后 / br 硬换行后 / 前导
//    空白后）的 `# > - + =` 直接转义、「数字 + ./) + 空白」转义定界符——
//    防源码换行后随文本被解析为列表/标题/引用/setext（软折叠不覆盖块级
//    中断构造）；
//  - code span 内部与 math 源照抄不转义：code span 内反斜杠是字面字符
//    （转义即可见损坏），math 源 `\alpha` 不可翻倍。
import { JSDOM } from 'jsdom';

const ESCAPE_CHARS = new Set(['\\', '`', '*', '_', '[', ']', '<', '$', '~']);
const LINE_START_ESCAPE = new Set(['#', '>', '-', '+', '=']);
// 行首有序列表定界：数字串（CommonMark 上限 9 位）+ ./) + 空白或行尾
const OL_LINE_RE = /^(\d{1,9})([.)])(\s|$)/;

// 文本节点转义。state.lineStart 跨元素线程：换行/br 置 true，空白保持
// true（CommonMark 允许 ≤3 前导空格的中断），任何非空白输出置 false。
// 元素包装（如 ** 前缀）后内层文本可能残留旧 lineStart → 过度转义，
// 渲染透明、无害；宁可过度不漏（漏 = 块结构被破坏）。
function escapeText(text, state) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { out += '\n'; state.lineStart = true; continue; }
    if (c === '\r') continue; // 归一：\r\n 按 \n（canonical 来自浏览器，防御）
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

// 强调边界退化（spec §5.4）：内容首/尾为空白或 */_ 时 GFM 强调不闭合，
// 退化为原生 HTML 标签透传，保真优先。md 形态仅在边界合法时使用。
const EMPH_DEGENERATE = /^[\s*_]|[\s*_]$/;
function wrapEmphasis(content, openHtml, closeHtml, md) {
  if (EMPH_DEGENERATE.test(content)) return openHtml + content + closeHtml;
  return md + content + md;
}

function convertNode(node, state) {
  if (node.nodeType === 3) return escapeText(node.textContent, state);
  if (node.nodeType !== 1) return '';
  const inner = () => convertNodes(node.childNodes, state);
  switch (node.tagName) {
    case 'STRONG': case 'B':
      return wrapEmphasis(inner(), '<strong>', '</strong>', '**');
    case 'EM': case 'I':
      return wrapEmphasis(inner(), '<em>', '</em>', '*');
    case 'DEL': case 'S':
      return wrapEmphasis(inner(), '<del>', '</del>', '~~');
    case 'A': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!href) return text;                       // canonical 已解包；防御
      // href 含 ) / 空白时角括号包裹（CommonMark 链接目标语法），防截断
      const dest = /[)\s]/.test(href) ? `<${href}>` : href;
      return `[${text}](${dest})`;
    }
    case 'BR':
      // GFM 硬换行（比两空格尾随式抗工具链剥空白）；换行后行首中断符要转义
      state.lineStart = true;
      return '\\' + '\n';
    default:
      return inner();                                // 未知标签解包（Task 3 增补 code/math/同族）
  }
}

// canonical 片段 → markdown。解析失败抛错，调用方（screenshot_trans）
// 兜底为 textContent 纯文本（spec §5.4）。
export function inlineRunToMarkdown(html) {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
  const state = { lineStart: true };
  return convertNodes(doc.body.childNodes, state);
}
