// script/lib/snapshot-login.mjs
// 步骤 1 登录阶段：goto URL → 六信号两级制检测（含登录入口点击探测）→
// Screencast viewer（如需登录）。
// 2026-09-14 人机门禁重构：viewer promise 机制提取为 screencast.mjs 的
// runViewerSession（三形态共用）+ 本文件的 openLoginViewer（登录专属回调）；
// snapshotLogin 变薄壳（行为逐字不变），生产调用点迁移 gateCheck（snapshot-gate.mjs）。
// 跳过记忆 v2（2026-09-07 设计）：viewer「⏭️ 跳过登录」经确认框后，把本次命中的
// **弱信号名**并入 working/cookies/login_decisions_skips.json 的 {hostname: [信号]}；
// 强信号（password/loginConfirmed）永不入档——跳过=一次性。后续运行命中全在记忆内
// 才整体豁免（emit loginSkippedByMemory 如实通报），出现记忆外新信号时照常计票/弹 viewer。
// 旧版 login_decisions.json（{hostname: {信号: "login"|"skip"}}）已废弃：不读不写，
// 磁盘遗留文件自然失效（知乎误判根因 A 的修复）。
// 点击探测会变异页面状态（弹窗/跳转），判定后按四条路径还原（见 restore 调用点），
// 保证 capture 抓到干净页。skips 与 storage_state 的写者（read-merge-write）：
// 本模块（登录跳过/登录态）与 snapshot-gate.mjs（content_sparse 跳过/挑战 clearance
// cookie）；两个 snapshot 进程并行转换不同 URL 时同 last-writer-wins 丢写，已接受模式。
import fs from 'node:fs';
import path from 'node:path';
import { URL as Url } from 'node:url';
import { needsLogin as detectLogin, WEAK_SIGNALS } from './detector.mjs';
import { runViewerSession } from './screencast.mjs';
import { refreshStorageState, gotoSettled } from './browser.mjs';

const STRONG_NAMES = { password: '密码框', loginConfirmed: '登录入口点击确认' };
const METHOD_NAMES = { modal: '全屏弹窗', navigate: '跳转登录页' };

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// —— 跳过记忆文件（login_decisions_skips.json，{hostname: [信号名,...]}）——

/**
 * 允许入档的信号名全集 = 登录弱信号（WEAK_SIGNALS：url/content/redirected/spa/
 * loginButton）∪ 门禁稀薄信号（content_sparse，2026-09-14 人机门禁）。强信号
 * （password/loginConfirmed）与验证码挑战永不允许入档——跳过=一次性。
 * detector.mjs 的 WEAK_SIGNALS 不动（登录计分语义）；本集合只管「哪些信号名可写进记忆」。
 * 登录计分与 content_sparse 天然隔离：scoreSignals 的 hitNames 只含登录信号 key，
 * dismissed 的 every 判定不受记忆内多余条目影响。
 */
export const RECORDABLE_SIGNALS = [...WEAK_SIGNALS, 'content_sparse'];

/** storage_state.json 同目录的跳过记忆文件路径（gateCheck 稀薄分支同款消费）。 */
export const skipsFileFor = (ssPath) => (ssPath ? path.join(path.dirname(ssPath), 'login_decisions_skips.json') : null);

/** 读该域名的跳过信号名数组；文件缺失/损坏/条目非字符串数组一律容忍为 []。 */
export const loadSkips = (file, hostname) => {
  try {
    const parsed = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    if (!isPlainObject(parsed)) return [];
    const entry = parsed[hostname];
    if (!Array.isArray(entry)) return [];
    return entry.filter((s) => typeof s === 'string');
  } catch { return []; }
};

/** 把本次跳过确认的可入档信号名 merge 入档（read-merge-write，仅本模块写）；允许集外的（强信号等）过滤掉，过滤后为空不写。 */
export const recordSkips = (file, hostname, signals) => {
  if (!file) return;
  const weak = [...new Set((signals || []).filter((s) => RECORDABLE_SIGNALS.includes(s)))];
  if (!weak.length) return;
  const all = (() => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isPlainObject(parsed) ? parsed : {};
    } catch { return {}; }
  })();
  const prev = Array.isArray(all[hostname]) ? all[hostname].filter((s) => typeof s === 'string') : [];
  all[hostname] = [...new Set([...prev, ...weak])];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
};

/** viewer 工具栏判定详情：强信号形态 + 票数 + 命中清单（记忆内标注）。 */
const buildReason = (result, memorized) => {
  const strong = result.strong
    .map((k) => (k === 'loginConfirmed' && result.probe?.method)
      ? `${STRONG_NAMES[k]}（${METHOD_NAMES[result.probe.method] || result.probe.method}）`
      : STRONG_NAMES[k] || k)
    .join('、');
  const hits = result.hitNames.map((k) => (memorized.includes(k) ? `${k}(记忆内)` : k)).join('、');
  return `检测到登录信号: ${strong}｜票数 ${result.hits}/6：${hits}`;
};

/** 跳过确认框文案：如实说明将记住什么（弱信号）与不记什么（强信号）。 */
const buildSkipConfirm = (result, hostname) => {
  const weakHits = result.hitNames.filter((k) => WEAK_SIGNALS.includes(k));
  return weakHits.length
    ? `确认跳过登录？将记住：${hostname} 的 ${weakHits.join('、')} 信号——后续命中全部在记忆内时不再弹本窗口；出现新信号仍会照常计票。强信号不记忆。`
    : `确认跳过登录？本次仅由强信号触发（不写入记忆），跳过只对本次转换生效，下次可能再次弹出。`;
};

/**
 * 登录 viewer 会话（登录阶段的人工介入环节）。机制走 runViewerSession 通用骨架
 * （screencast.mjs，2026-09-14 自旧 snapshotLogin 整体平移），本函数只承载登录
 * 专属语义：判定详情/跳过确认文案、跳过时弱信号入档 + storageState 刷新 + 探测
 * 还原、done/close 用 detectLogin 复检。行为与旧版逐字一致。
 * @param {import('playwright').Page} page
 * @param {string} url - 目标 URL（recheck 与探测还原用）
 * @param {{result: object, memorized: string[], hostname: string, skipsFile: string|null,
 *          storageStatePath?: string|null, timeout?: number, backstopMs?: number,
 *          log?: Function, restoreIfProbed?: Function}} ctx
 * @returns {Promise<{needsLogin: true}>}
 * @throws {Error} reason='login_timeout' | 'login_aborted'
 */
export async function openLoginViewer(page, url, ctx) {
  const {
    result, memorized, hostname, skipsFile,
    storageStatePath: ssPath = null, timeout = 300000, backstopMs, log = () => {}, restoreIfProbed,
  } = ctx;
  const refreshStorage = () => refreshStorageState(page, ssPath);
  const restore = async () => { if (restoreIfProbed) await restoreIfProbed(); };

  // 未登录：启动 Screencast viewer 等待人工登录（跳过=经确认框后继续，弱信号入档）
  return runViewerSession(page, {
    timeout,
    ...(backstopMs !== undefined ? { backstopMs } : {}),
    timeoutReason: 'login_timeout',
    log,
    viewerOpts: {
      reason: buildReason(result, memorized),
      skipConfirmText: buildSkipConfirm(result, hostname),
    },
    // 进 viewer 前的状态整理：探测确认（弹窗开着/停在登录页）→ 保留原状进 viewer
    // 最利于登录；点击过但未确认（可能弹出无关 dropdown）→ 还原干净页再进 viewer
    prepare: async () => {
      if (result.probe.clicked && !result.probe.confirmed) await restore();
    },
    onSkip: async (api) => {
      if (api.isSettled()) return; // finish 已发生（viewer 关闭触发的迟到消息不再处理）
      // 全程自吞异常：跳过是用户的逃生口，善后失败绝不能炸掉进程破坏单行 JSON 契约
      try {
        // 也刷新 storageState——用户可能已实际登录（强信号 recheck 永败的场景），跳过不丢会话
        await refreshStorage();
        // 弱信号入档（recordSkips 按 RECORDABLE_SIGNALS 过滤强信号——跳过强信号=一次性）
        recordSkips(skipsFile, hostname, result.hitNames);
        // 还原探测点开的弹窗/跳转——快照必须抓干净的目标页
        await restore();
      } catch (e) { log(`跳过登录善后异常: ${e.message}`); }
      // action:'skip'——gateCheck 据此区分「用户裁决跳过」（次轮再命中不判连环门）
      // 与 done（声称已解决）的语义
      api.finish({ needsLogin: true, action: 'skip' });
    },
    onDone: async (ws, api) => {
      if (api.isSettled()) return; // finish/fail 已发生——迟到的关窗消息不再处理
      try {
        // recheck 关探测（allowProbe:false）：用户刚在画面里操作过，探测点击会造成
        // 二次风控且 gotoSettled 还原会毁掉刚建立的登录现场——recheck 只读
        const recheck = await detectLogin(page, url, { spaWaitMs: 500, log, memorized, allowProbe: false });
        if (!recheck.needsLogin) {
          await refreshStorage();
          api.finish({ needsLogin: true });
        } else {
          ws.send(JSON.stringify({ type: 'recheck_failed' }));
        }
      } catch (e) { log(`复检异常: ${e.message}`); }
    },
    onClose: async (api) => {
      if (api.isSettled()) return; // skip/login_done 后 finish 会 terminate WS 客户端、必然触发本回调——
      // 无守卫则迟到回调会再次变异页面、污染后续 capture 的快照（实测竞态）
      try {
        const recheck = await detectLogin(page, url, { spaWaitMs: 500, log, memorized, allowProbe: false });
        if (!recheck.needsLogin) {
          await refreshStorage();
          api.finish({ needsLogin: true });
        } else {
          api.fail('login_aborted');
        }
      } catch { api.fail('login_aborted'); }
    },
  });
}

/**
 * 登录检测 + Screencast 人工登录（薄壳：gotoSettled → 六信号检测 → 早退或
 * openLoginViewer）。2026-09-14 viewer 机制提取后行为与旧版逐字一致；生产调用点
 * （snapshot.mjs / snapshot-redirect.mjs）已迁移 gateCheck（snapshot-gate.mjs），
 * 本函数保留单轮登录路由语义供直连消费方（测试）使用。
 * @param {import('playwright').Page} page - 已创建的页面（浏览器由 snapshot.mjs 管理）
 * @param {string} url - 目标 URL
 * @param {{timeout?: number, backstopMs?: number, storageStatePath?: string, log?: Function}} opts
 * @returns {Promise<{needsLogin: boolean, loginSkippedByMemory?: string[]}>}
 * @throws {Error} reason='login_timeout' | 'login_aborted' | 其他错误
 */
export async function snapshotLogin(page, url, opts = {}) {
  const { timeout = 300000, backstopMs, storageStatePath: ssPath, log = () => {} } = opts;

  // 导航到目标 URL
  await gotoSettled(page, url, log);

  const skipsFile = skipsFileFor(ssPath);
  const hostname = new Url(page.url()).hostname;
  const memorized = loadSkips(skipsFile, hostname);
  if (memorized.length) log(`跳过记忆: ${hostname} [${memorized.join(', ')}]`);

  // 检测是否需要登录
  const result = await detectLogin(page, url, { log, memorized });

  /** 探测点击变异了页面（弹窗/跳转/dropdown）→ 重载原 URL 还原干净状态。 */
  const restoreIfProbed = async () => {
    if (!result.probe.clicked && !result.probe.confirmed) return;
    log('探测点击后还原原页面状态');
    await gotoSettled(page, url, log);
  };

  if (!result.needsLogin) {
    // 已登录 / 记忆豁免：刷新 storageState；探测过则还原页面
    await refreshStorageState(page, ssPath);
    await restoreIfProbed();
    if (result.dismissed) {
      log(`判定豁免：命中 ${result.hitNames.join('+')} 全在跳过记忆`);
      return { needsLogin: false, loginSkippedByMemory: result.hitNames };
    }
    log('检测为已登录');
    return { needsLogin: false };
  }

  log('判定需要登录，进入 Screencast 登录模式');
  return openLoginViewer(page, url, {
    result, memorized, hostname, skipsFile,
    storageStatePath: ssPath, timeout, backstopMs, log, restoreIfProbed,
  });
}
