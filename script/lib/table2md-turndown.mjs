// script/lib/table2md-turndown.mjs
// turndown 引擎（备选）：jsdom window + 共享 expandTableSpans + turndown+
// turndown-plugin-gfm 转换。与 .temp/cross_table 同栈。同 self 接口。
// 表头判定同 self：首行全 <th> 才表头，否则 failed（统一由本层校验，
// 保证两引擎判定一致，不依赖 turndown 的 isHeadingRow）。
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { expandTableSpans } from './expand-table-spans.mjs';

const BLOCK_SELECTOR = 'table,tbody,thead,tfoot,tr,ul,ol,pre,div,p,h1,h2,h3,h4,h5,h6,figure,blockquote,section,article,aside,header,footer,nav';

export function convertTable(htmlString) {
  let dom, window;
  try {
    dom = new JSDOM(`<html><body>${htmlString}</body></html>`);
    window = dom.window;
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `parse error: ${e.message}` };
  }
  const doc = window.document;
  const table = doc.querySelector('table');
  if (!table) return { markdown: null, status: 'failed', reason: 'no <table>' };

  // 嵌套块级内容检测（expand 前判源头，避免扩散到填充格）
  for (const cell of table.querySelectorAll('td,th')) {
    if (cell.querySelector(BLOCK_SELECTOR)) {
      return { markdown: null, status: 'failed', reason: 'nested block content in cell' };
    }
  }

  // expand 先行：跨格表展开后才矩形、首行才全 th（与 self 引擎一致）
  try { expandTableSpans(doc); } catch (e) {
    return { markdown: null, status: 'failed', reason: `expand error: ${e.message}` };
  }

  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (trs.length === 0) return { markdown: null, status: 'failed', reason: 'empty table (no rows)' };
  const rows = trs.map((tr) => [...tr.children].filter((c) => /^(TH|TD)$/.test(c.tagName)));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (width === 0) return { markdown: null, status: 'failed', reason: 'empty table (no columns)' };

  // 首行全 th 判定（两引擎一致）
  const first = rows[0];
  if (!(first.length === width && first.every((c) => c.tagName === 'TH')))
    return { markdown: null, status: 'failed', reason: 'no <th> header (first row not all th)' };

  // 矩形校验（无跨越的参差表 expand 不补 → 这里拦）
  for (const r of rows) if (r.length !== width)
    return { markdown: null, status: 'failed', reason: `ragged row (got ${r.length}, want ${width})` };
  // 非空校验
  const allEmpty = rows.every((r) => r.every((c) => !c.textContent.trim()));
  if (allEmpty) return { markdown: null, status: 'failed', reason: 'degenerate empty grid' };

  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  turndown.use(gfm);
  let markdown;
  try {
    markdown = turndown.turndown(table.outerHTML).trim();
  } catch (e) {
    return { markdown: null, status: 'failed', reason: `turndown error: ${e.message}` };
  }

  if (/<[a-zA-Z]/.test(markdown)) return { markdown: null, status: 'failed', reason: 'residual HTML tag in output' };
  if (/\{\{LONG_TEXT_\d+/.test(markdown)) return { markdown: null, status: 'failed', reason: 'unresolved LONG_TEXT placeholder' };

  return { markdown, status: 'ok' };
}
