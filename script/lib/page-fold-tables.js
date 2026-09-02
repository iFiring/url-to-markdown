// script/lib/page-fold-tables.js
// styled 趟折叠 pass：在 Node 层转换完成后，对 styled DOM 的每个非 hidden
// <table> 按 data-idx 查 status：ok → 清空子树放 {{TABLE_k|rows×cols}} 文本
// 节点（与 clean 趟 K6 同形、k 一致）；failed/缺失 → 保 live、打
// data-u2m-table="fail" 供步骤 5 识别（步骤 5 用 closest('table') 统一剥
// 样式，标记主要供诊断/trans2img）。
function __u2mFoldTables(resultByDataIdx) {
  var tables = document.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue; // K5 独占
    var dataIdx = tb.getAttribute('data-idx') || '';
    var r = resultByDataIdx[dataIdx];
    if (r && r.status === 'ok') {
      while (tb.firstChild) tb.removeChild(tb.firstChild);
      tb.appendChild(document.createTextNode('{{TABLE_' + r.k + '|' + r.rows + '×' + r.cols + '}}'));
    } else {
      tb.setAttribute('data-u2m-table', 'fail');
    }
  }
}
