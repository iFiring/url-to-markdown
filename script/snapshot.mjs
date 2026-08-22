#!/usr/bin/env node
/**
 * snapshot.mjs —— 步骤 1：快照下载。给定 URL，单个 chromium 实例贯穿四个
 * 阶段，产出全保真快照 <url-dir>/1_snapshot.html。
 *
 * 用法:
 *   node snapshot.mjs <url> [--timeout 300000] [--scroll-rounds 60]
 *
 * 四阶段（依次执行，共享同一浏览器上下文，避免重复启动开销）:
 *   1. 登录阶段（lib/snapshot-login.mjs）—— 六信号检测是否需要登录：
 *      全 frames 密码框 / URL 特征 / 标题与正文关键词 / 认证 cookie 反查 /
 *      重定向 / SPA 等待，≥2 命中判定需登录；此时弹出 CDP Screencast
 *      viewer（地址记到 stderr）供人工登录，登录态写入全局唯一的
 *      working/cookies/storage_state.json（后续脚本只读）
 *   2. 滚动阶段（lib/snapshot-scroll.mjs）—— 渐进滚动到底再回顶，触发
 *      懒加载，等待 DOM 稳定
 *   3. 检测阶段（lib/snapshot-detect.mjs）—— 虚拟列表检测门：顶部取正文
 *      签名，滚到底后检查签名是否仍在 innerText，消失即虚拟列表（页面仅
 *      渲染可见窗口，无法全文转化），直接终止、不写快照
 *   4. 快照阶段（lib/snapshot-capture.mjs）—— 注入 page-init.js +
 *      page-prepare.js：同源 iframe 合并、外部 CSS 内联、剥尽 JS、<base>、
 *      资源 src 绝对化、标记 data-u2m-id，序列化全保真快照
 *
 * data-u2m-id 标记规则: 覆盖 body 内所有元素（文档序连续编号），仅排除
 * 纯文本修饰/薄语义行内标签（strong/em/b/i/br/wbr/abbr/q/time/kbd 等）与
 * svg/math 的内部后代（根元素本身仍标记）。
 *
 * 环境变量: U2M_WORKING_ROOT 覆盖工作根目录；U2M_PROXY 控制代理
 * （未设置继承系统代理 / direct 绕过 / URL 显式钉住）。
 *
 * stdout 输出（有且仅有一行 JSON，日志一律走 stderr）:
 *   {"status":"ok","snapshot":"...","elements":N}              → 退出码 0
 *   {"status":"error","reason":"virtual_list"}  虚拟列表，未写快照 → 1
 *   {"status":"error","reason":"login_timeout"|"login_aborted"|...} → 1
 *
 * 退出码: 0 成功；1 失败；2 参数错误。
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { emit, emitError, usage, log, debug } from './lib/contract.mjs';
import { storageStatePath, ensureUrlDirs } from './lib/env.mjs';
import { proxyLaunchOptions } from './lib/browser.mjs';
import { readSharedScript } from './lib/placeholder.mjs';
import { snapshotLogin } from './lib/snapshot-login.mjs';
import { snapshotScroll } from './lib/snapshot-scroll.mjs';
import { snapshotDetect } from './lib/snapshot-detect.mjs';
import { snapshotCapture } from './lib/snapshot-capture.mjs';

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
  const url = args._[0];
  if (!url || url.startsWith('--')) return usage('用法: snapshot.mjs <url> [--timeout ms] [--scroll-rounds n]');

  const timeout = Number(args.timeout ?? 300000);
  const scrollRounds = Number(args['scroll-rounds'] ?? 60);
  if (!Number.isFinite(timeout)) { usage(`--timeout 须为数字，收到 ${args.timeout}`); return; }
  if (!Number.isFinite(scrollRounds)) { usage(`--scroll-rounds 须为数字，收到 ${args['scroll-rounds']}`); return; }

  const ssPath = storageStatePath();
  const dirs = ensureUrlDirs(url);
  debug(`url-dir: ${dirs.urlDir}；storageState ${fsSync.existsSync(ssPath) ? '已注入' : '不存在'}；timeout=${timeout}ms scroll-rounds=${scrollRounds}`);

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
    const ctxOpts = { viewport: { width: 1280, height: 3000 }, bypassCSP: true };
    if (ssPath && fsSync.existsSync(ssPath)) ctxOpts.storageState = ssPath;
    context = await browser.newContext(ctxOpts);
    await context.route('**/*', (route) =>
      route.request().resourceType() === 'media' ? route.abort() : route.continue());
    await context.addInitScript({ content: pageInit });
    const page = await context.newPage();

    await timed('登录阶段', () => snapshotLogin(page, url, { timeout, storageStatePath: ssPath, log }));
    await timed('滚动阶段', () => snapshotScroll(page, { scrollRounds, log: debug }));
    await timed('检测阶段', () => snapshotDetect(page, { log: debug }));
    const result = await timed('快照阶段', () => snapshotCapture(page, { outDir: dirs.urlDir, log }));

    // 先关浏览器再 emit
    await context.close().catch(() => {});
    await browser.close().catch(() => {});

    emit({
      status: 'ok',
      snapshot: result.snapshotPath,
      elements: result.elements,
    });
  } catch (e) {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    emitError(e.reason || e.message, 1);
  }
}

main().catch((e) => emitError(e.reason || e.message, 1));
