// script/lib/table2md.js
// 引擎选择器：预展开表内 {{LONG_TEXT_k|...}} → 调 self|turndown 引擎 →
// 存 2_tables.json schema + 失败落 logs/tables/ 诊断日志。
import fs from 'node:fs/promises';
import path from 'node:path';

const LONG_TEXT_RE = /\{\{LONG_TEXT_(\d+)(?:\|[^}]*)?\}\}/g;

export function expandLongText(html, longTextMap) {
  return html.replace(LONG_TEXT_RE, (match, id) =>
    Object.prototype.hasOwnProperty.call(longTextMap, id) ? longTextMap[id] : match);
}

export async function convertTables(tableList, { engine = 'self', longTextMap = {}, logsDir } = {}) {
  const mod = engine === 'turndown'
    ? await import('./table2md-turndown.mjs')
    : await import('./table2md-self.mjs');
  const convertTable = mod.convertTable;

  const tables = {};
  let ok = 0, failed = 0;
  for (const t of tableList) {
    const expanded = expandLongText(t.outerHTML, longTextMap);
    const r = convertTable(expanded);
    tables[String(t.k)] = {
      dataIdx: t.dataIdx,
      html: t.outerHTML, // 原始（含占位符，诊断用）
      markdown: r.status === 'ok' ? r.markdown : null,
      status: r.status,
      reason: r.reason, // ok 时为 undefined；failed 时为校验未过项
      engine,
      rows: t.rows,
      cols: t.cols,
    };
    if (r.status === 'ok') ok++;
    else {
      failed++;
      if (logsDir) {
        const snippet = t.outerHTML.length > 2000 ? t.outerHTML.slice(0, 2000) + '\n…[truncated]' : t.outerHTML;
        const logText = `engine: ${engine}\ndataIdx: ${t.dataIdx}\nshape: ${t.rows}×${t.cols}\nreason: ${r.reason}\n\n--- outerHTML ---\n${snippet}\n`;
        await fs.mkdir(logsDir, { recursive: true });
        await fs.writeFile(path.join(logsDir, `${t.k}_${t.dataIdx}.log`), logText, 'utf8');
      }
    }
  }
  return { tables, counts: { total: tableList.length, ok, failed } };
}
