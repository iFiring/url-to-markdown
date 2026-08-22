#!/usr/bin/env node
/**
 * render_skeleton.mjs —— 步骤 9：骨架回填为 Markdown。读
 * 8_resolved_skeleton.json，按文档序把每条骨架条目转为 markdown 块，
 * 块与块之间以空行分隔，产出 <url-dir>/9_markdown.md（最终产物）。
 * 纯 Node，无浏览器依赖。
 *
 * 用法:
 *   node render_skeleton.mjs <url-dir>
 *
 * 转换规则（块级语法由此脚本加，行内 markdown 已在步骤 7 写好）：
 *   h1-h6       "#" 前缀（数量 = 级别）
 *   p           value 原样
 *   blockquote  每行前缀 "> "
 *   ul / ol     value 原样（行级 "- " / "1. " 语法已写好）
 *   code        "```{lang}" 围栏（lang 缺省时仅 "```"）
 *   img         ![]({url})
 *   table       value 原样（完整管线表已写好）
 *   trans2img   ![](assets/trans/{id}.webp)（相对 urlDir）
 *   未知 key 静默跳过；空骨架输出空文件
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","markdownPath":"...","bytes":N,"blocks":M}  → 退出码 0
 *   {"status":"error","reason":"..."}                          → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { workingRoot } from './lib/env.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (val === undefined || val.startsWith('--')) { usage(`参数 --${key} 缺少值`); return null; }
      out[key] = val;
    } else out._.push(a);
  }
  return out;
}

function resolveUrlDir(arg) {
  if (!arg) return null;
  if (path.isAbsolute(arg)) return arg;
  return path.join(workingRoot(), arg);
}

// 单条骨架 → markdown 字符串。未知 key 返回 null（被主流程过滤）。
function entryToMarkdown(key, value) {
  // h1-h6：# 前缀
  if (/^h[1-6]$/.test(key)) {
    const level = +key[1];
    return `${'#'.repeat(level)} ${String(value)}`;
  }

  switch (key) {
    case 'p':
      return String(value);

    case 'blockquote': {
      const text = String(value);
      return text.split('\n').map((l) => `> ${l}`).join('\n');
    }

    case 'ul':
    case 'ol':
      return String(value);

    case 'code': {
      if (!value || typeof value !== 'object') return null;
      const lang = value.lang || '';
      const content = value.content || '';
      return `\`\`\`${lang}\n${content}\n\`\`\``;
    }

    case 'img':
      return `![](${String(value)})`;

    case 'table':
      return String(value);

    case 'trans2img':
      return `![](assets/trans/${String(value)}.webp)`;

    default:
      return null;
  }
}

function convertSkeleton(skeleton) {
  const blocks = [];
  for (const entry of skeleton) {
    const keys = Object.keys(entry);
    if (keys.length === 0) continue;
    const key = keys[0];
    const md = entryToMarkdown(key, entry[key]);
    if (md !== null) blocks.push(md);
  }
  return blocks.join('\n\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const urlDirArg = args._[0];
  if (!urlDirArg) return usage('用法: render_skeleton.mjs <url-dir>');

  const urlDir = resolveUrlDir(urlDirArg);
  const resolvedPath = path.join(urlDir, '8_resolved_skeleton.json');

  if (!fs.existsSync(resolvedPath)) {
    return emitError(`找不到 ${resolvedPath}，请先运行步骤 8`, 1);
  }

  const skeleton = JSON.parse(await fsPromises.readFile(resolvedPath, 'utf8'));
  debug(`resolved skeleton ${skeleton.length} 条`);
  const md = convertSkeleton(skeleton);

  const outPath = path.join(urlDir, '9_markdown.md');
  await fsPromises.writeFile(outPath, md);

  log(`markdown 已生成: ${outPath}（${md.length} 字节）`);

  emit({
    status: 'ok',
    markdownPath: outPath,
    bytes: md.length,
    blocks: md ? md.split(/\n\n+/).length : 0,
  });
}

main().catch((e) => emitError(e.message, 1));
