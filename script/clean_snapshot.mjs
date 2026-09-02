#!/usr/bin/env node
/**
 * clean_snapshot.mjs —— 步骤 2：结构清洗。单页两趟（同一 chromium 页面对
 * 同一 1_snapshot.html 先后渲染两次，cfg.mode 分叉）：
 *   趟 1（styled）结构清洗 + astro 解包 + 长文本占位 + SVG 瘦身 + 属性白名单
 *     → 2_clean_style_snapshot.html（供步骤 4 裁剪）+ 2_long_text.json
 *   趟 2（clean）结构清洗 + 长文本占位 + K1-K7/K9 机械规则瘦身
 *     → 2_clean_snapshot.html（结构视图）
 * 零样式计算：不做 juice 内联、不做 CSS 隐藏检测——CSS 隐藏子树按可见
 * 保留，清洗版的隐藏折叠只认 HTML 裸 hidden 属性（K5）。
 *
 * 长文本占位两趟共享（2026-08-31 修订，恢复 simplify 前"两版共享、编号逐
 * 一对应"）：两趟在共享段同位执行，清洗版携带与带样式版编号一致的
 * {{LONG_TEXT_k|n_chars}} 占位符；还原链不变——步骤 7 引用、步骤 8 回填仍
 * 只走带样式版路径。K8 行内 run token 化废除：run 整段折叠吞噬行内结构，
 * 按文本节点占位只折叠超阈值的单个文本节点、行内结构保真。
 *
 * 共同结构清洗（两趟一致；实现在 lib/page-clean-snapshot.js，共享步骤 1-9）：
 *   【整体删除】与正文结构无关的噪声，连子树一起删：
 *     - 文档级噪声：link / meta / base（title 保留，作步骤 3 识别线索）
 *     - 页面骨架：nav / footer / form 及 role="navigation"/"contentinfo"/"form"
 *       等价物（article 内嵌 footer 同删）
 *     - 媒体播放器：video / audio（子元素 source / track 随之删除）
 *     - 残余表单控件与模态框：input / select / textarea / label / dialog
 *       （form 外的搜索框等 UI 控件兜底，按钮型 input 亦在此列；
 *       script / noscript / template 已在步骤 1 的 page-prepare.js 删除，此处不重复）
 *   【正文保留】header / aside 属正文结构（hero 主标题、章节交替），不删；
 *     button / [role="button"] 同样保留（2026-08-25 起不删：FAQ 折叠头 /
 *     CTA / 卡片式 role=button 常是内容载体，整删会误伤正文，交步骤 3 判断）
 *   【级联删除】空元素：子树内既无非空白文本、也无白名单元素的空壳；
 *     后序单趟判定，子空则父亦空，自然级联到任意深度；置于各类删除之后，
 *     只含噪声的容器随之清除
 *   【空壳保留】KEEP_EMPTY 白名单——即使为空也不删（自身即内容，且使祖先
 *     "有内容"）：媒体/嵌入 img/iframe/canvas/object/embed/source/picture、
 *     排版 br/hr/wbr、矢量/公式 svg/math、pre、h1-h6、表格结构 table/
 *     caption/colgroup/col/thead/tbody/tfoot/tr/td/th（删空单元格/列定义
 *     会让行列错位，单元格内的噪声照删、留空壳）
 *   【astro 解包】astro- 前缀标签（框架保留命名空间：astro-island/
 *     astro-slot/astro-static-slot 及变体）子元素上提、包装弃置——两趟共享
 *
 * 两趟分叉（page-clean-snapshot.js 内 mode 分支）：
 *   - styled 趟：保留 style 属性与 <style> 标签，SVG 瘦身为壳
 *     （仅留 id/class/data-idx）；长文本占位（纯空白文本与 svg/style
 *     子树文本不占位）——中文（含汉字）字符数 > 16 → {{LONG_TEXT_k|n_chars}}，
 *     英文（不含汉字）单词数 > 12 → {{LONG_TEXT_k|n_words}}；属性白名单
 *     （22 静态属性 = clean K2 八属性 + style/href/src/width/height + 内容
 *     信号 colspan/rowspan/start/aria-label/data-src/srcset/datetime/open/
 *     lang，外加 <style> 选择器引用的动态属性集；<style> 标签豁免）——
 *     target/rel/tabindex/loading/未被选择器引用的 data-* 等删净
 *   - clean 趟：删 style 属性与 <style> 标签，SVG 剥成裸 <svg></svg> 壳；
 *     K1-K7/K9 机械规则——K1 class 语义过滤、K2 属性白名单（href/src/
 *     aria 全删）、K3 SVG 清空、K4 astro 解包（两趟共享）、K5 hidden 裸属性
 *     折叠 {{HIDDEN_TAG|n_chars;构成}}（规模按占位前原文预计算）、K6/K7
 *     table/pre 折叠 {{TABLE_k|rows×cols}}/{{PRE_CODE_TAG|n_lines}}
 *     （行列/行数规模信号，pre 行数占位前预计算）、K9 空白压缩
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","cleanedSnapshot":"...","styledSnapshot":"...",
 *    "longText":".../2_long_text.json","longTextCount":N}   → 退出码 0
 *   {"status":"error","reason":"..."}                        → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { urlDir } from './lib/env.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';
import { convertTables } from './lib/table2md.js';

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

async function main() {
  const args = parseArgs(process.argv);
  if (!args) return;
  const url = args.url;
  if (!url) return usage('用法: clean_snapshot.mjs --url <url>');

  // 表格转换引擎：--table-engine 或 U2M_TABLE_ENGINE，默认 self
  const engine = args['table-engine'] || process.env.U2M_TABLE_ENGINE || 'self';
  if (engine !== 'self' && engine !== 'turndown') {
    return usage(`--table-engine 仅支持 self|turndown，实际: ${engine}`);
  }

  const dir = urlDir(url);
  const snapshotPath = path.join(dir, '1_snapshot.html');

  if (!fs.existsSync(snapshotPath)) {
    return emitError(`找不到 ${snapshotPath}，请先运行步骤 1`);
  }
  debug(`读入快照 ${snapshotPath}（${fs.statSync(snapshotPath).size} 字节）`);

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');
  const collectTablesFn = await readSharedScript('page-collect-tables.js');
  const foldTablesFn = await readSharedScript('page-fold-tables.js');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
    const context = await newU2MContext(browser);
    const page = await context.newPage();
    // 只拦 http(s) 子资源：DOM 解析不需要图片/字体，file:// 主文档导航不经路由
    await page.route(/^https?:/, (route) => route.abort());

    // 趟 1（styled）：结构清洗 + 长文本占位 + SVG 瘦身 → 带样式版（live 表）
    // __u2mCollectTables 源码拼在前，使 __u2mCleanSnapshot 末尾能调用它收集表元数据
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const styledEvalSrc = `${collectTablesFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'styled' })})`;
    const styled = await page.evaluate(styledEvalSrc);

    // ── Node 层表格转换：预展开长文本 → 引擎 → 纯结构校验 → 2_tables.json + 日志 ──
    const longTextMap = styled.longTexts || {};
    const logsDir = path.join(dir, 'logs', 'tables');
    const { tables: tablesJson, counts: tableCounts } = await convertTables(
      styled.tables || [], { engine, longTextMap, logsDir });
    const tablesJsonPath = path.join(dir, '2_tables.json');
    await fsPromises.writeFile(tablesJsonPath, JSON.stringify(tablesJson, null, 2), 'utf8');

    // 构造 resultByDataIdx 供 fold（成功表折叠、失败表保 live + 标记）
    const resultByDataIdx = {};
    for (const [k, info] of Object.entries(tablesJson)) {
      resultByDataIdx[info.dataIdx] = { k: Number(k), status: info.status, rows: info.rows, cols: info.cols };
    }
    // styled fold：同页 DOM（evaluate 间状态保留，未 reload）——成功表折成
    // {{TABLE_k|rows×cols}}、失败表打 data-u2m-table="fail"
    await page.evaluate(`(${foldTablesFn})(${JSON.stringify(resultByDataIdx)})`);
    const styledHtml = await page.content();
    const styledPath = path.join(dir, '2_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, styledHtml, 'utf8');

    const longTextPath = path.join(dir, '2_long_text.json');
    await fsPromises.writeFile(longTextPath, JSON.stringify(styled.longTexts), 'utf8');

    // 趟 2（clean）：重新加载同一快照，结构清洗 + K1-K9 → 清洗版（终端视图）
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const clean = await page.evaluate(`(${pageCleanFn})(${JSON.stringify({ mode: 'clean' })})`);

    const cleanedPath = path.join(dir, '2_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, clean.html, 'utf8');

    debug(`[clean] hidden 折叠 ${clean.stats.hiddenCount} · 清洗版 ${Buffer.byteLength(clean.html, 'utf8')} 字节 · 表格 ${tableCounts.ok}ok/${tableCounts.failed}fail`);
    log(`清洗完成: ${cleanedPath} (${styled.longTextCount} 个长文本占位符, 表格 ${tableCounts.total} 个: ${tableCounts.ok} 成功 ${tableCounts.failed} 失败)`);

    await context.close();
    await browser.close();

    emit({
      status: 'ok',
      cleanedSnapshot: cleanedPath,
      styledSnapshot: styledPath,
      longText: longTextPath,
      longTextCount: styled.longTextCount,
      tables: tableCounts,
      tablesJson: tablesJsonPath,
    });
  } catch (e) {
    await browser?.close().catch(() => {});
    emitError(e.message, 1);
  }
}

main().catch((e) => emitError(e.message, 1));
