// script/lib/page-collect-tables.js
// styled 趟收集 pass：在长文本折叠后、任何 table 折叠前，按文档序收集每表
// {k, dataIdx, outerHTML, rows, cols}。跳过 [hidden] 表（由 K5 独占折叠）。
// rows = 本表直接 tr 数（嵌套表行归属最近 table）；cols = 各行 colspan 之和
// 的最大值。供 Node 层跑转换引擎。
function __u2mCollectTables() {
  var tables = document.querySelectorAll('table');
  var out = [];
  var k = 0;
  for (var i = 0; i < tables.length; i++) {
    var tb = tables[i];
    if (!tb.parentNode) continue;
    if (tb.hasAttribute('hidden')) continue; // K5 独占
    k++;
    var trs = tb.querySelectorAll('tr');
    var rows = 0, cols = 0;
    for (var r = 0; r < trs.length; r++) {
      if (trs[r].closest('table') !== tb) continue; // 行归属最近 table
      rows++;
      var c = 0;
      var cells = trs[r].children;
      for (var c2 = 0; c2 < cells.length; c2++) {
        var tag = cells[c2].tagName;
        if (tag !== 'TD' && tag !== 'TH') continue;
        var cs = parseInt(cells[c2].getAttribute('colspan'), 10);
        c += cs > 1 ? cs : 1;
      }
      if (c > cols) cols = c;
    }
    out.push({ k: k, dataIdx: tb.getAttribute('data-idx') || '', outerHTML: tb.outerHTML, rows: rows, cols: cols });
  }
  return out;
}
