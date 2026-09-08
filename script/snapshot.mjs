#!/usr/bin/env node
/**
 * snapshot.mjs —— 步骤 1：快照下载。给定 URL，单个 chromium 实例贯穿五个
 * 阶段，产出全保真快照 <url-dir>/1_snapshot.html。
 *
 * 用法:
 *   node snapshot.mjs --url <url> [--timeout 300000] [--scroll-rounds 60]
 *
 * 五阶段（依次执行，共享同一浏览器上下文，避免重复启动开销）:
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
 *    "loginSkippedByMemory":[...]|null} → 退出码 0
 *   {"status":"error","reason":"virtual_list"}  虚拟列表，未写快照 → 1
 *   {"status":"error","reason":"login_timeout"|"login_aborted"|...} → 1
 *
 * 重定向门：登录+滚动后检测「占优内容 iframe」（同源/跨域，见
 * lib/snapshot-redirect.mjs），命中则跳转目标页原生续跑；快照成功后写
 * redirect_to.yaml marker，urlDir() 据此把步骤 2-9 定位到 redirected_ 目录。
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { storageStatePath, ensureUrlDirs, projectRoot, urlToDirName, redirectedDirName, writeRedirectMarker, clearRedirectMarker } from './lib/env.mjs';
import { proxyLaunchOptions, newU2MContext } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { snapshotLogin } from './lib/snapshot-login.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { snapshotDetect } from './lib/snapshot-detect.mjs';
import { snapshotCapture } from './lib/snapshot-capture.mjs';
import { runRedirectGate } from './lib/snapshot-redirect.mjs';

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
  if (!url) return usage('用法: snapshot.mjs --url <url> [--timeout ms] [--scroll-rounds n]');

  const timeout = Number(args.timeout ?? 300000);
  const scrollRounds = Number(args['scroll-rounds'] ?? 60);
  if (!Number.isFinite(timeout)) { usage(`--timeout 须为数字，收到 ${args.timeout}`); return; }
  if (!Number.isFinite(scrollRounds)) { usage(`--scroll-rounds 须为数字，收到 ${args['scroll-rounds']}`); return; }

  const ssPath = storageStatePath();
  debug(`storageState ${fsSync.existsSync(ssPath) ? '已注入' : '不存在'}；timeout=${timeout}ms scroll-rounds=${scrollRounds}`);

  /** 阶段计时（U2M_DEBUG 时打印；finally 保证失败也见耗时）。 */
  const timed = async (name, fn) => {
    const t = performance.now();
    try { return await fn(); } finally { debug(`${name}耗时 ${((performance.now() - t) / 1000).toFixed(2)}s`); }
  };

  // 加载 initScript
  const pageInit = await readSharedScript('page-init.js');

  // 启动浏览器（共享上下文）
  const browser = await chromium.launch({ headless: true, ...proxyLaunchOptions() });
  let context;
  try {
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
    const dirName = gate.redirected ? redirectedDirName(url) : urlToDirName(url);
    const dirs = ensureUrlDirs(url, dirName);
    debug(`url-dir: ${dirs.urlDir}${gate.redirected ? `（重定向自 ${url} → ${gate.to}）` : ''}`);
    const result = await timed('快照阶段', () => snapshotCapture(page, { outDir: dirs.urlDir, log }));

    // marker 生命周期：快照成功后写入；未命中清除 stale（spec §5.2）
    if (gate.redirected) writeRedirectMarker(url, gate.to);
    else clearRedirectMarker(url);

    // 先关浏览器再 emit
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: result.snapshotPath,
      elements: result.elements,
      'skill-root': projectRoot(),
      'url-name': dirName,
      'url-working-path': dirs.urlDir,
      redirect: gate.redirected ? { to: gate.to } : null,
      // 记忆豁免如实通报（入口页或重定向目标页任一命中即报）——「已登录」结论
      // 其实来自跳过记忆压制时，agent/用户必须看得到
      loginSkippedByMemory: login?.loginSkippedByMemory || gate.loginSkippedByMemory || null,
    });
  } catch (e) {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    emitError(e.reason || e.message, 1);
  }
}

main().catch((e) => emitError(e.reason || e.message, 1));
