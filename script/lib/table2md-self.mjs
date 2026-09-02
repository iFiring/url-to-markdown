// script/lib/table2md-self.mjs
// self 引擎（默认）：jsdom 建 DOM → 共享 expandTableSpans → 手写 GFM 管道表
// 序列化（行内 code/a/strong/em/img）→ 纯结构校验。单 jsdom 依赖（spec §14）。
// 表头判定与参考项目一致：仅首行全 <th> 才作表头；否则判 failed（不合成）。
import { JSDOM } from 'jsdom';
import { expandTableSpans } from './expand-table-spans.mjs';

// 单元格内出现的块级元素——无法压成行内，判 failed
const BLOCK_LEVEL = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|PRE|DIV|P|H[1-6]|FIGURE|BLOCKQUOTE|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|NAV)$/;
const BLOCK_SELECTOR = 'table,tbody,thead,tfoot,tr,ul,ol,pre,div,p,h1,h2,h3,h4,h5,h6,figure,blockquote,section,article,aside,header,footer,nav';

// 行内格式序列化：递归遍历 cell 子节点，产出 GFM 行内 markdown
function inline(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' '); // 文本：折叠空白
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  const inner = [...node.childNodes].map(inline).join('');
  switch (tag) {
    case 'CODE': return '`' + inner + '`';
    case 'A': {
      const href = node.getAttribute('href') || '';
      return href ? `[${inner}](${href})` : inner;
    }
    case 'STRONG': case 'B': return `**${inner}**`;
    case 'EM': case 'I': return `*${inner}*`;
    case 'BR': return ' ';
    case 'IMG': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return src ? `![${alt}](${src})` : alt;
    }
    default:
      // 块级元素出现在单元格内 → 抛信号，外层判 failed
      if (BLOCK_LEVEL.test(tag)) throw new Error('nested block content in cell');
      return inner;
  }
}

function cellText(cell) {
  return [...cell.childNodes].map(inline).join('')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

export function convertTable(htmlString) {
  let doc;
  try {
    doc = new JSDOM(`<html><body>${htmlString}</body></html>`).window.document;
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `parse error: ${e.message}` };
  }
  const table = doc.querySelector('table');
  if (!table) return { markdown: null, status: 'failed', reason: 'no <table>' };

  // 嵌套块级内容检测（在 expand 之前：expand 会克隆 origin innerHTML 到填充格，
  // 块级内容会扩散——先判源头）
  for (const cell of table.querySelectorAll('td,th')) {
    if (cell.querySelector(BLOCK_SELECTOR)) {
      return { markdown: null, status: 'failed', reason: 'nested block content in cell' };
    }
  }

  try { expandTableSpans(doc); } catch (e) {
    return { markdown: null, status: 'failed', reason: `expand error: ${e.message}` };
  }

  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (trs.length === 0) return { markdown: null, status: 'failed', reason: 'empty table (no rows)' };

  const rows = trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName)));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) return { markdown: null, status: 'failed', reason: 'empty table (no columns)' };

  // 表头判定：首行必须全 <th> 且列数 = width
  const first = rows[0];
  const headerOk = first.length === width && first.every((c) => c.tagName === 'TH');
  if (!headerOk) return { markdown: null, status: 'failed', reason: 'no <th> header (first row not all th)' };

  // 矩形校验
  for (const r of rows) {
    if (r.length !== width) return { markdown: null, status: 'failed', reason: `ragged row (got ${r.length}, want ${width})` };
  }
  // 非空校验：至少一个单元格有文本
  const allEmpty = rows.every((r) => r.every((c) => !c.textContent.trim()));
  if (allEmpty) return { markdown: null, status: 'failed', reason: 'degenerate empty grid' };

  let grid;
  try {
    grid = rows.map((r) => r.map(cellText));
  } catch (e) {
    return { markdown: null, status: 'failed', reason: e.message };
  }

  const lines = [];
  lines.push('| ' + grid[0].join(' | ') + ' |');
  lines.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < grid.length; i++) lines.push('| ' + grid[i].join(' | ') + ' |');
  const markdown = lines.join('\n');

  if (/<[a-zA-Z]/.test(markdown)) return { markdown: null, status: 'failed', reason: 'residual HTML tag in output' };
  if (/\{\{LONG_TEXT_\d+/.test(markdown)) return { markdown: null, status: 'failed', reason: 'unresolved LONG_TEXT placeholder' };

  return { markdown, status: 'ok' };
}
