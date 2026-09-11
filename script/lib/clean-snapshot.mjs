// script/lib/clean-snapshot.mjs
// 步骤 1 清洗阶段（原步骤 2 CLI 主体，2026-09-11 步骤 1/2 合并时平移）。
// 单页两趟（同一 chromium 页面对同一 1_snapshot.html 先后渲染两次，
// cfg.mode 分叉）：
//   趟 1（styled）结构清洗 + astro 解包 + 长文本占位 + SVG 瘦身 + 属性白名单
//     → 1_clean_style_snapshot.html（供步骤 3 裁剪）+ 1_long_text.json
//   趟 2（clean）结构清洗 + K1-K11 机械规则瘦身 + 长文本占位（K11 之后、无编号）
//     → 1_clean_snapshot.html（结构视图）
// 样式计算仅限共享段标志预计算（spec 2026-09-09）：不做 juice 内联；
// CSS 隐藏检测限 body 边界脚手架区（body 直接子孙 ∪ 独子链）——链外深处
// 的 CSS 隐藏子树（FAQ/非激活 tab）按可见保留，清洗版折叠为 HIDDEN_TAG
// 壳（K5x）；裸 hidden 属性折叠（K5）全文档不变。
//
// 长文本占位分两趟各自执行（2026-09-03 修订，自共享段移出）：styled 趟在
// 分支开头带编号执行（{{LONG_TEXT_k|n_chars}}，恢复清单 1_long_text.json
// 由此产出）；clean 趟在 K11 之后无编号执行（{{LONG_TEXT|n_chars}}——唯一
// 消费者步骤 2 只看结构+体量信号）。还原链不变——步骤 4 引用、步骤 5 回填
// 仍只走带样式版路径。
//
// 阶段模块约定（对齐 snapshot-*.mjs）：不 emit、不 launch——browser 由
// 调用方（snapshot.mjs）传入并负责 close；本模块自管裸 context（无
// storageState / initScripts，与抓取 context 的环境差异是设计约束：
// file:// 重解析只应用内联后的 <style>，computed style 须来自纯净级联）
// + 拦截 http(s) 子资源（DOM 解析不需要图片/字体）；抛异常或返回值。
//
// 两趟分叉的完整规则清单见 lib/page-clean-snapshot.js 头注与
// docs/superpowers/specs/2026-08-27-clean-snapshot-simplify-design.md。
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { debug } from './contract.mjs';
import { readSharedScript } from './placeholder.mjs';
import { newU2MContext } from './browser.mjs';
import { convertTables } from './table2md.js';
import { convertCodes } from './code2md.mjs';

/**
 * 结构清洗：对 urlDir/1_snapshot.html 两趟渲染（styled → clean），
 * 产出 5 个清洗产物（1_clean_snapshot.html / 1_clean_style_snapshot.html /
 * 1_long_text.json / 1_tables.json / 1_code.json + logs/ 诊断）。
 * @param {import('playwright').Browser} browser 共享 chromium 实例（调用方负责 close）
 * @param {{urlDir: string, snapshotPath?: string, tableEngine?: 'self'|'turndown',
 *          log?: Function}} opts
 *   urlDir 工作目录绝对路径；snapshotPath 缺省 <urlDir>/1_snapshot.html；
 *   tableEngine 已由 CLI 校验的表格引擎值
 * @returns {Promise<{cleanedSnapshot: string, styledSnapshot: string,
 *   longText: string, longTextCount: {texts:number,runs:number,total:number},
 *   tables: {total:number,ok:number,failed:number}, tablesJson: string,
 *   codes: {total:number,ok:number,failed:number}, codeJson: string,
 *   viewText: {count:number}, chrome: {removed:number,cssHiddenFolded:number,
 *   dialogFolded:number,overlayFolded:number,commentsRemoved:number}}>}
 */
export async function cleanSnapshot(browser, opts = {}) {
  const { urlDir: dir, tableEngine = 'self', log = () => {} } = opts;
  const snapshotPath = opts.snapshotPath || path.join(dir, '1_snapshot.html');

  // 兜底防御（CLI 的 --from-snapshot 分支有带指引的专属文案先行拦截）
  if (!fsSync.existsSync(snapshotPath)) {
    throw new Error(`找不到 ${snapshotPath}（快照不存在）`);
  }
  debug(`读入快照 ${snapshotPath}（${fsSync.statSync(snapshotPath).size} 字节）`);

  const pageCleanFn = await readSharedScript('page-clean-snapshot.js');
  const latexFn = await readSharedScript('page-latex.js');
  const collectTablesFn = await readSharedScript('page-collect-tables.js');
  const foldTablesFn = await readSharedScript('page-fold-tables.js');
  const collectCodeFn = await readSharedScript('page-collect-code.js');
  const foldCodeFn = await readSharedScript('page-fold-code.js');

  let context;
  try {
    context = await newU2MContext(browser);
    const page = await context.newPage();
    // 只拦 http(s) 子资源：DOM 解析不需要图片/字体，file:// 主文档导航不经路由
    await page.route(/^https?:/, (route) => route.abort());

    // 趟 1（styled）：结构清洗 + 长文本占位 + SVG 瘦身 → 带样式版（live 表/失败代码块）
    // __u2mLatexText（run 检测的 math 判源）与 __u2mCollectTables/__u2mCollectCode
    // 源码拼在前，使 __u2mCleanSnapshot 末尾能调用它们收集表/代码块元数据
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const styledEvalSrc = `${latexFn}\n${collectTablesFn}\n${collectCodeFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'styled' })})`;
    const styled = await page.evaluate(styledEvalSrc);

    // ── Node 层表格转换：预展开长文本 → 引擎 → 纯结构校验 → 1_tables.json + 日志 ──
    const longTextMap = styled.longTexts || {};
    const logsDir = path.join(dir, 'logs', 'tables');
    const { tables: tablesJson, counts: tableCounts } = await convertTables(
      styled.tables || [], { engine: tableEngine, longTextMap, logsDir });
    const tablesJsonPath = path.join(dir, '1_tables.json');
    await fsPromises.writeFile(tablesJsonPath, JSON.stringify(tablesJson, null, 2), 'utf8');

    // 构造 resultByDataIdx 供 fold（成功表折叠、失败表保 live + 标记）
    const resultByDataIdx = {};
    for (const [k, info] of Object.entries(tablesJson)) {
      resultByDataIdx[info.dataIdx] = { k: Number(k), status: info.status, rows: info.rows, cols: info.cols };
    }

    // ── Node 层代码块转换：七类校验 + 序号剥离 + 序列化 → 1_code.json + 日志 ──
    const { codes: codesJson, counts: codeCounts } = await convertCodes(
      styled.codes || [], { longTextMap, logsDir: path.join(dir, 'logs', 'codes') });
    const codeJsonPath = path.join(dir, '1_code.json');
    await fsPromises.writeFile(codeJsonPath, JSON.stringify(codesJson, null, 2), 'utf8');

    // styled fold 映射 + clean 趟 codeFold 映射（clean 恒折叠含 failed——
    // 行数：ok 取 JSON 修剪后行数，failed 取收集原始行数）
    const codeResultByDataIdx = {};
    const codeFold = {};
    for (const c of styled.codes || []) {
      const r = codesJson[String(c.k)];
      codeResultByDataIdx[c.dataIdx] = {
        k: c.k, status: r.status, lines: r.lines, lang: r.lang,
      };
      codeFold[c.dataIdx] = {
        k: c.k,
        lines: r.status === 'ok' ? r.lines : c.lines,
        lang: r.status === 'ok' ? r.lang : c.lang,
      };
    }

    // styled fold：同页 DOM（evaluate 间状态保留，未 reload）——成功表折成
    // {{TABLE_k|rows×cols}}、失败表打 data-u2m-table="fail"；随后代码块
    // （成功折成 {{CODE_k|n_lines}}、失败打 data-u2m-code="fail"）。fold 后
    // 重新序列化（用与 styled 趟 return 同形的 '<!DOCTYPE html>\n' + outerHTML，
    // 保持产物格式）
    await page.evaluate(`(${foldTablesFn})(${JSON.stringify(resultByDataIdx)})`);
    await page.evaluate(`(${foldCodeFn})(${JSON.stringify(codeResultByDataIdx)})`);
    const styledHtml = '<!DOCTYPE html>\n' + await page.evaluate(() => document.documentElement.outerHTML);
    const styledPath = path.join(dir, '1_clean_style_snapshot.html');
    await fsPromises.writeFile(styledPath, styledHtml, 'utf8');

    // 1_long_text.json 两段 schema（spec 2026-09-06 §4）：texts 散文本纯文本 +
    // runs 行内 run 规范化 HTML，单一计数器全局编号。table2md/code2md 的
    // expandLongText 只消费 texts（表格/pre 子树被 run 检测位置排除、其内部
    // 永远只有散文本占位符）
    const longTextPath = path.join(dir, '1_long_text.json');
    await fsPromises.writeFile(longTextPath,
      JSON.stringify({ texts: styled.longTexts || {}, runs: styled.longTextRuns || {} }), 'utf8');

    // 趟 2（clean）：重新加载同一快照，结构清洗 + K1-K9 → 清洗版（终端视图）。
    // __u2mLatexText 两趟都注入——共享段 run 检测两趟都调它判 math 源，
    // 只注入一趟会让两趟的 math 阻断判定不一致、破坏孪生守卫
    await page.goto(`file://${snapshotPath}`, { waitUntil: 'domcontentloaded' });
    const clean = await page.evaluate(`${latexFn}\n(${pageCleanFn})(${JSON.stringify({ mode: 'clean', codeFold })})`);

    const cleanedPath = path.join(dir, '1_clean_snapshot.html');
    await fsPromises.writeFile(cleanedPath, clean.html, 'utf8');

    debug(`[clean] hidden 折叠 ${clean.stats.hiddenCount} · 视图文本折叠 ${clean.stats.viewTextCount} · 清洗版 ${Buffer.byteLength(clean.html, 'utf8')} 字节 · 表格 ${tableCounts.ok}ok/${tableCounts.failed}fail · 代码块 ${codeCounts.ok}ok/${codeCounts.failed}fail`);
    for (const kill of clean.stats.chromeKills || []) {
      debug(`[chrome-d1] ${kill.at} <${kill.tag}${kill.idx ? ' idx=' + kill.idx : ''}> ratio=${kill.ratio} ${kill.sig} "${kill.txt}"`);
    }
    debug(`[clean] chrome: 删除 ${clean.stats.chromeRemoved || 0} · css-hidden 折 ${clean.stats.cssHiddenFolded || 0} · dialog 折 ${clean.stats.dialogFolded || 0} · overlay 折 ${clean.stats.overlayFolded || 0} · 注释剥 ${clean.stats.commentsRemoved || 0}`);
    const ltTextCount = Object.keys(styled.longTexts || {}).length;
    const ltRunCount = Object.keys(styled.longTextRuns || {}).length;
    log(`清洗完成: ${cleanedPath} (长文本 ${styled.longTextCount} 个: 散文本 ${ltTextCount} + 行内 run ${ltRunCount}, 表格 ${tableCounts.total} 个: ${tableCounts.ok} 成功 ${tableCounts.failed} 失败, 代码块 ${codeCounts.total} 个: ${codeCounts.ok} 成功 ${codeCounts.failed} 失败)`);

    return {
      cleanedSnapshot: cleanedPath,
      styledSnapshot: styledPath,
      longText: longTextPath,
      longTextCount: { texts: ltTextCount, runs: ltRunCount, total: styled.longTextCount },
      tables: tableCounts,
      tablesJson: tablesJsonPath,
      codes: codeCounts,
      codeJson: codeJsonPath,
      viewText: { count: clean.stats.viewTextCount },
      chrome: {
        removed: clean.stats.chromeRemoved || 0,
        cssHiddenFolded: clean.stats.cssHiddenFolded || 0,
        dialogFolded: clean.stats.dialogFolded || 0,
        overlayFolded: clean.stats.overlayFolded || 0,
        commentsRemoved: clean.stats.commentsRemoved || 0,
      },
    };
  } finally {
    await context?.close().catch(() => {});
  }
}
