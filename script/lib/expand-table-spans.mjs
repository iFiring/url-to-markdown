// script/lib/expand-table-spans.mjs
// 共享 rowspan/colspan 网格展开——取自 .temp/cross_table 报告 §4 算法（重写不导入）。
// 接收任意标准 DOM Document（jsdom 或浏览器 page.document），对其内每个
// <table> 做两件事：
//   1. 网格展开（仅含 [rowspan],[colspan] 的表）：被跨越位插入复制原单元格
//      内容的新单元格（保持原 th/td 标签）、参差行补空 td、原单元格移除
//      rowspan/colspan，产出规则矩形网格。
//   2. 多行 thead 降级（所有表）：thead 第 2 行起降为 tbody 数据行（th→td），
//      避免 GFM 重复分隔行。无跨越的多行 thead 表也需此步产出干净 GFM。
// 仅用标准 DOM API（避免 .rows/.cells/replaceChildren 的实现差异）。

export function parseSpan(value) {
  const n = parseInt(value, 10);
  return n > 1 ? Math.min(n, 1000) : 1;
}

export function parseRowspan(value, remainingRows) {
  return parseInt(value, 10) === 0 ? remainingRows : parseSpan(value);
}

function isCell(el) { return el && /^(TH|TD)$/.test(el.tagName); }

function demoteMultiRowThead(document, table) {
  const thead = [...table.children].find((el) => el.tagName === 'THEAD');
  if (!thead) return;
  const theadRows = [...thead.children].filter((el) => el.tagName === 'TR');
  if (theadRows.length <= 1) return;
  let tbody = [...table.children].find((el) => el.tagName === 'TBODY');
  if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
  for (const tr of theadRows.slice(1)) {
    for (const th of [...tr.children]) {
      if (th.tagName === 'TH') {
        const td = document.createElement('td');
        td.innerHTML = th.innerHTML;
        th.replaceWith(td);
      }
    }
    thead.removeChild(tr);
    tbody.insertBefore(tr, tbody.firstChild);
  }
}

function expandGrid(document, table) {
  // 仅取本表直接行（嵌套表的 tr 归属其最近 table）
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  const occupied = new Map(); // 'r,c' -> 覆盖该位的原单元格
  const rowEntries = [];       // rowEntries[r] = [{col, cell}]
  let width = 0;

  // 第一遍：按 HTML 表格算法放置每个单元格、记录跨度覆盖位
  rows.forEach((tr, r) => {
    const entries = [];
    let c = 0;
    for (const cell of [...tr.children]) {
      if (!isCell(cell)) continue;
      while (occupied.has(`${r},${c}`)) c++; // 跳过被上方 rowspan 占用的列
      const cs = parseSpan(cell.getAttribute('colspan'));
      const rs = parseRowspan(cell.getAttribute('rowspan'), rows.length - r);
      entries.push({ col: c, cell });
      for (let dr = 0; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++)
          occupied.set(`${r + dr},${c + dc}`, cell);
      c += cs;
    }
    rowEntries.push(entries);
    if (c > width) width = c;
  });

  // 第二遍：按列号重排每行，跨越覆盖位插入内容副本
  rows.forEach((tr, r) => {
    const newCells = [];
    for (let c = 0; c < width; c++) {
      const entry = rowEntries[r].find((e) => e.col === c);
      if (entry) {
        entry.cell.removeAttribute('rowspan');
        entry.cell.removeAttribute('colspan');
        newCells.push(entry.cell);
      } else {
        const origin = occupied.get(`${r},${c}`);
        // 保持原标签（th→th/td→td），避免破坏表头行判定
        const filler = document.createElement(origin ? origin.tagName.toLowerCase() : 'td');
        if (origin) filler.innerHTML = origin.innerHTML;
        newCells.push(filler);
      }
    }
    while (tr.firstChild) tr.removeChild(tr.firstChild);
    for (const nc of newCells) tr.appendChild(nc);
  });
}

export function expandTableSpans(document) {
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    // 1. 网格展开：仅含跨越的表（无跨越早退，零影响）
    if (table.querySelector('[rowspan],[colspan]')) {
      expandGrid(document, table);
    }
    // 2. 多行 thead 降级：所有表（含无跨越的多行 thead 表）
    demoteMultiRowThead(document, table);
  }
}
