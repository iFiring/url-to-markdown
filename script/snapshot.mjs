#!/usr/bin/env node
/**
 * snapshot.mjs —— 步骤 1：快照下载 + 结构清洗。给定 URL，单个 chromium
 * 实例贯穿七个阶段（2026-09-11 起原步骤 1/2 合并）：五阶段抓取产出全保真
 * 快照 <url-dir>/1_snapshot.html，随后清洗阶段两趟渲染产出结构视图与带
 * 样式版。
 *
 * 用法:
 *   node snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60]
 *       [--table-engine self|turndown] [--from-snapshot]
 *
 * 七阶段（依次执行；1-5 共享抓取 context，6 用裸 context——环境隔离是
 * 设计约束：file:// 重解析只应用内联后的 <style>，computed style 须来自
 * 纯净级联，且不得继承登录态与 page-init）:
 *   1. 登录阶段（lib/snapshot-login.mjs）—— 六信号两级制检测是否需要登录：
 *      密码框 / 登录入口点击探测确认（全屏弹窗或跳转）为强信号单票成立，
 *      弱信号（URL 特征 / 标题与正文关键词 / 重定向 / SPA 等待 / 登录按钮
 *      可见但点击无确认）≥2 命中判定需登录；命中全在跳过记忆
 *      （login_decisions_skips.json）内则整体豁免；需登录时弹出 CDP Screencast
 *      viewer（地址记到 stderr）供人工登录，登录态写入全局唯一的
 *      working/cookies/storage_state.json（后续脚本只读）
 *   2. 滚动阶段（lib/snapshot-scroll.mjs）—— 渐进滚动到底再回顶，触发
 *      懒加载，等待 DOM 稳定
 *   3. 重定向门（lib/snapshot-redirect.mjs）—— 占优内容 iframe 检测（单次
 *      判定，只判入口原页面）：命中则跳转目标页原生续跑（登录检测复跑 +
 *      退化守卫 + 重新滚动），快照落在 redirected_ 特殊目录；未命中零行为差异
 *   4. 检测阶段（lib/snapshot-detect.mjs）—— 虚拟列表检测门（跑在最终目标
 *      页上）：顶部取正文签名，滚到底后检查签名是否仍在 innerText，消失即
 *      虚拟列表（页面仅渲染可见窗口，无法全文转化），直接终止、不写快照
 *   5. 快照阶段（lib/snapshot-capture.mjs）—— 注入 page-init.js +
 *      page-prepare.js：同源 iframe 合并、外部 CSS 内联、剥尽 JS、<base>、
 *      资源 src 绝对化、标记 data-idx，序列化全保真快照
 *   6. 清洗阶段（lib/clean-snapshot.mjs）—— 同一浏览器开裸 context（无
 *      storageState/initScripts + 拦截 http(s) 子资源）对快照 file:// 重解析
 *      两趟：styled 趟 → 1_clean_style_snapshot.html + 1_long_text.json +
 *      1_tables.json + 1_code.json；clean 趟 → 1_clean_snapshot.html。
 *      两趟规则（结构删除/D1/astro 解包/长文本占位/K1-K11/表格与代码块
 *      预计算）详见 lib/page-clean-snapshot.js 头注
 *
 * 可选参数:
 *   --table-engine self|turndown（或 U2M_TABLE_ENGINE，默认 self）——
 *      表格占位符转换引擎
 *   --from-snapshot —— 跳过 1-5 五阶段，直接读工作目录已有
 *      1_snapshot.html 进清洗：换表格引擎重跑、清洗逻辑升级后的重放用
 *      （不重新访问网络）
 *
 * data-idx 标记规则: 覆盖 body 内所有元素（文档序连续编号），仅排除
 * 纯文本修饰/薄语义行内标签（strong/em/b/i/br/wbr/abbr/q/time/kbd 等）与
 * svg/math 的内部后代（根元素本身仍标记）。
 *
 * 环境变量: U2M_WORKING_ROOT 覆盖工作根目录；U2M_PROXY 控制代理
 * （未设置继承系统代理 / direct 绕过 / URL 显式钉住）。
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","snapshot":"...","elements":N,"skill-root":"...",
 *    "url-name":"...","url-working-path":"...","redirect":{...}|null,
 *    "loginSkippedByMemory":[...]|null,
 *    "cleanedSnapshot":"...","styledSnapshot":"...","longText":"...",
 *    "longTextCount":{"texts":N,"runs":N,"total":N},
 *    "tables":{"total":N,"ok":N,"failed":N},"tablesJson":"...",
 *    "codes":{"total":N,"ok":N,"failed":N},"codeJson":"...",
 *    "viewText":{"count":N},
 *    "chrome":{"removed":N,"cssHiddenFolded":N,"dialogFolded":N,
 *              "overlayFolded":N,"commentsRemoved":N}} → 退出码 0
 *   {"status":"error","reason":"virtual_list"}  虚拟列表，未写快照 → 1
 *   {"status":"error","reason":"login_timeout"|"login_aborted"|...} → 1
 *
 * 重定向门：登录+滚动后检测「占优内容 iframe」（同源/跨域，见
 * lib/snapshot-redirect.mjs），命中则跳转目标页原生续跑；快照成功后写
 * redirect_to.yaml marker，urlDir() 据此把步骤 2-5 定位到 redirected_ 目录。
 * --from-snapshot 重放经 urlDir() 被动跟随 marker（redirect 字段如实通报），
 * marker 不写不清——只有抓取路径有权决定 marker。
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { storageStatePath, ensureUrlDirs, projectRoot, urlToDirName, redirectedDirName, writeRedirectMarker, clearRedirectMarker, urlDir, redirectMarkerPath } from './lib/env.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { snapshotLogin } from './lib/snapshot-login.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { snapshotDetect } from './lib/snapshot-detect.mjs';
import { snapshotCapture } from './lib/snapshot-capture.mjs';
import { runRedirectGate } from './lib/snapshot-redirect.mjs';
import { cleanSnapshot } from './lib/clean-snapshot.mjs';

/** 无值布尔 flag：命中即置 true，不消费下一个参数。 */
const BOOLEAN_FLAGS = new Set(['from-snapshot']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
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
  if (!url) return usage('用法: snapshot.mjs --url <url> [--timeout ms] [--scroll-rounds n] [--table-engine self|turndown] [--from-snapshot]');

  const timeout = Number(args.timeout ?? 300000);
  const scrollRounds = Number(args['scroll-rounds'] ?? 60);
  if (!Number.isFinite(timeout)) { usage(`--timeout 须为数字，收到 ${args.timeout}`); return; }
  if (!Number.isFinite(scrollRounds)) { usage(`--scroll-rounds 须为数字，收到 ${args['scroll-rounds']}`); return; }

  // 表格转换引擎：--table-engine 或 U2M_TABLE_ENGINE，默认 self（launch 前校验，非法值不起浏览器）
  const tableEngine = args['table-engine'] || process.env.U2M_TABLE_ENGINE || 'self';
  if (tableEngine !== 'self' && tableEngine !== 'turndown') {
    return usage(`--table-engine 仅支持 self|turndown，实际: ${tableEngine}`);
  }

  const fromSnapshot = args['from-snapshot'] === true;

  /** 阶段计时（U2M_DEBUG 时打印；finally 保证失败也见耗时）。 */
  const timed = async (name, fn) => {
    const t = performance.now();
    try { return await fn(); } finally { debug(`${name}耗时 ${((performance.now() - t) / 1000).toFixed(2)}s`); }
  };

  // ── --from-snapshot 前置解析（launch 之前 fail fast）─────────────────────
  // 跳过五阶段重放清洗：urlDir() 被动跟随 marker（重定向页自然落 redirected_
  // 目录）；emit 基础字段从盘上派生，形状与抓取路径恒一致。
  let replay = null; // {dirName, urlDir, snapshotPath, elements, redirect}
  if (fromSnapshot) {
    const dir = urlDir(url);
    const snapshotPath = path.join(dir, '1_snapshot.html');
    if (!fsSync.existsSync(snapshotPath)) {
      return emitError(`找不到 ${snapshotPath}——请去掉 --from-snapshot 重新运行（重新抓取快照）`, 1);
    }
    const elements = (fsSync.readFileSync(snapshotPath, 'utf8').match(/data-idx="\d+"/g) || []).length;
    const marker = redirectMarkerPath(url);
    const redirect = fsSync.existsSync(marker)
      ? { to: fsSync.readFileSync(marker, 'utf8').replace(/^to:\s*/, '').trim() }
      : null;
    replay = { dirName: path.basename(dir), urlDir: dir, snapshotPath, elements, redirect };
    debug(`--from-snapshot 重放: ${snapshotPath}（${elements} 个标记元素）${redirect ? `（重定向页 → ${redirect.to}）` : ''}`);
  } else {
    const ssPath = storageStatePath();
    debug(`storageState ${fsSync.existsSync(ssPath) ? '已注入' : '不存在'}；timeout=${timeout}ms scroll-rounds=${scrollRounds}`);
  }

  // 加载 initScript（重放不需要——抓取 context 不开）
  const pageInit = fromSnapshot ? null : await readSharedScript('page-init.js');

  // 启动浏览器（单实例贯穿抓取与清洗两个 context）
  const browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
  let context;
  try {
    let snapshotPath, elements, dirName, workingDir, redirect = null, loginSkippedByMemory = null;

    if (!fromSnapshot) {
      const ssPath = storageStatePath();
      context = await newU2MContext(browser, {
        storageState: ssPath && fsSync.existsSync(ssPath) ? ssPath : undefined,
        initScripts: [pageInit],
      });
      const page = await context.newPage();

      const login = await timed('登录阶段', () => snapshotLogin(page, url, { timeout, storageStatePath: ssPath, log }));
      await timed('滚动阶段', () => snapshotScroll(page, { scrollRounds, log: debug }));
      const gate = await timed('重定向门', () =>
        runRedirectGate(page, url, { timeout, storageStatePath: ssPath, scrollRounds, log: debug }));
      await timed('检测阶段', () => snapshotDetect(page, { log: debug }));

      // 目录创建在重定向决策后：redirected 页用特殊名（marker 尚未写入，显式指定）
      dirName = gate.redirected ? redirectedDirName(url) : urlToDirName(url);
      const dirs = ensureUrlDirs(url, dirName);
      debug(`url-dir: ${dirs.urlDir}${gate.redirected ? `（重定向自 ${url} → ${gate.to}）` : ''}`);
      const result = await timed('快照阶段', () => snapshotCapture(page, { outDir: dirs.urlDir, log }));

      // marker 生命周期：快照成功后写入；未命中清除 stale（spec §5.2）
      if (gate.redirected) writeRedirectMarker(url, gate.to);
      else clearRedirectMarker(url);

      // 抓取 context 用毕即关（清洗走裸 context，环境隔离）；置 null 防 catch 二次 close
      await context.close().catch(() => {});
      context = null;

      ({ snapshotPath, elements } = result);
      workingDir = dirs.urlDir;
      redirect = gate.redirected ? { to: gate.to } : null;
      // 记忆豁免如实通报（入口页或重定向目标页任一命中即报）——「已登录」结论
      // 其实来自跳过记忆压制时，agent/用户必须看得到
      loginSkippedByMemory = login?.loginSkippedByMemory || gate.loginSkippedByMemory || null;
    } else {
      ({ dirName, urlDir: workingDir, snapshotPath, elements, redirect } = replay);
    }

    // ── 清洗阶段：共享 browser，裸 context 由 lib/clean-snapshot.mjs 自管 ──
    const cleanResult = await timed('清洗阶段',
      () => cleanSnapshot(browser, { urlDir: workingDir, tableEngine, log }));

    // 先关浏览器再 emit
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: snapshotPath,
      elements,
      'skill-root': projectRoot(),
      'url-name': dirName,
      'url-working-path': workingDir,
      redirect,
      loginSkippedByMemory,
      ...cleanResult,
    });
  } catch (e) {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    emitError(e.reason || e.message, 1);
  }
}

main().catch((e) => emitError(e.reason || e.message, 1));
