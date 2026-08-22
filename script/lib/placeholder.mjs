// script/lib/placeholder.mjs
// 共享工具：读取 lib/ 下页面脚本 + 代码语言启发式。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = path.dirname(fileURLToPath(import.meta.url));

export async function readSharedScript(name) {
  return fs.readFile(path.join(libDir, name), 'utf8');
}

/** 本地代码语言启发式（data-lang/class 缺失时的兜底）。返回 '' 表示无法判定。 */
export function guessCodeLang(text) {
  const t = String(text || '');
  const s = t.trim();
  const shebang = s.match(/^#!\s*(?:\S+\/)?(?:env\s+)?(bash|sh|zsh|python\d?|node)\b/);
  if (shebang) {
    const b = shebang[1];
    if (b.startsWith('python')) return 'python';
    if (b === 'node') return 'javascript';
    if (b === 'sh' || b === 'zsh') return 'bash';
    return b;
  }
  if ((s[0] === '{' && s.endsWith('}')) || (s[0] === '[' && s.endsWith(']'))) {
    try { JSON.parse(s); return 'json'; } catch { /* 非 JSON，继续判定 */ }
  }
  if (/\bdef\s+\w+\s*\([^)]*\)\s*:/.test(t)) return 'python';
  if (/\bconsole\.\w+\(|\bfunction\s+\w+\s*\(|\b(const|let|var)\s+\w+\s*=/.test(t)) return 'javascript';
  if (/^\s*<(html|body|div|span|head|p)\b/i.test(s)) return 'html';
  return '';
}
