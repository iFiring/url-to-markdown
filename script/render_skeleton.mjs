#!/usr/bin/env node
/**
 * render_skeleton.mjs —— 步骤 9：骨架回填为 Markdown。读
 * 8_resolved_skeleton.json，按文档序把每条骨架条目转为 markdown 块，
 * 块与块之间以空行分隔，产出 9_markdown.md（最终产物，写入该 URL 的
 * 工作目录）。纯 Node，无浏览器依赖。
 *
 * 用法:
 *   node render_skeleton.mjs --url <url>
 *
 * 转换规则（契约见 references/markdown_skeleton_guide.md：value 已带行外
 * 语法——#、>、- 、1.、![img](url) 由步骤 7 写好，行内 markdown 同理）：
 *   h1-h6       以 key 为准重建：剥 value 自带 # 前缀（仅剥后随空白者，
 *               「#1 排行榜」这类正文不误伤）后按级别补 "#"*N——LLM 漏写
 *               /写错级别也能纠正
 *   blockquote  以 key 为准重建：剥行首 > 后逐行补 "> "
 *   p / ul / ol / table / img   透传（嵌套缩进、管线表、![img](url) 只存在于
 *               value；img 经步骤 8 后或为 ![img](assets/images/x) 本地形态）
 *   code        "```{lang}" 围栏（lang 缺省时仅 "```"）
 *   trans2img   value 为步骤 8 择优回写的选中路径 assets/trans/{id}.webp →
 *               ![]({path})；仍是 ID 数组 → error（提示先跑步骤 8）
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
import { urlDir } from './lib/env.mjs';

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

// 单条骨架 → markdown 字符串。未知 key 返回 null（被主流程过滤）。
// trans2img 的 value 不是字符串（如仍是 ID 数组）时抛错——步骤 8 未跑。
function entryToMarkdown(key, value) {
  // h1-h6：以 key 级别为准重建——key 才是语义判定载体
  if (/^h[1-6]$/.test(key)) {
    const level = +key[1];
    const text = String(value).trim().replace(/^#{1,6}[ \t]+/, '');
    return `${'#'.repeat(level)} ${text}`;
  }

  switch (key) {
    case 'p':
    case 'ul':
    case 'ol':
    case 'table':
      return String(value).trim();

    case 'blockquote': {
      const lines = String(value).trim().split('\n');
      return lines.map((l) => `> ${l.replace(/^[ \t]*>[ \t]?/, '')}`).join('\n');
    }

    case 'code': {
      if (!value || typeof value !== 'object') return null;
      const lang = value.lang || '';
      const content = value.content || '';
      return `\`\`\`${lang}\n${content}\n\`\`\``;
    }

    case 'img':
      // value 已是 ![img](url) / ![img](assets/images/x) 完整 markdown，透传
      return String(value).trim();

    case 'trans2img': {
      if (typeof value !== 'string') {
        throw new Error(
          `trans2img 条目 value 应为步骤 8 择优回写的截图路径，实际为: ${JSON.stringify(value)}——请先运行步骤 8`
        );
      }
      return `![](${value})`;
    }

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
  const url = args.url;
  if (!url) return usage('用法: render_skeleton.mjs --url <url>');

  const dir = urlDir(url);
  const resolvedPath = path.join(dir, '8_resolved_skeleton.json');

  if (!fs.existsSync(resolvedPath)) {
    return emitError(`找不到 ${resolvedPath}，请先运行步骤 8`, 1);
  }

  const skeleton = JSON.parse(await fsPromises.readFile(resolvedPath, 'utf8'));
  debug(`resolved skeleton ${skeleton.length} 条`);
  const md = convertSkeleton(skeleton);

  const outPath = path.join(dir, '9_markdown.md');
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
