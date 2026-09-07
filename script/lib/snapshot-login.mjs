// script/lib/snapshot-login.mjs
// 步骤 1 登录阶段：goto URL → 六信号两级制检测（含登录入口点击探测）→
// Screencast viewer（如需登录）。
// 跳过记忆 v2（2026-09-07 设计）：viewer「⏭️ 跳过登录」经确认框后，把本次命中的
// **弱信号名**并入 working/cookies/login_decisions_skips.json 的 {hostname: [信号]}；
// 强信号（password/loginConfirmed）永不入档——跳过=一次性。后续运行命中全在记忆内
// 才整体豁免（emit loginSkippedByMemory 如实通报），出现记忆外新信号时照常计票/弹 viewer。
// 旧版 login_decisions.json（{hostname: {信号: "login"|"skip"}}）已废弃：不读不写，
// 磁盘遗留文件自然失效（知乎误判根因 A 的修复）。
// 点击探测会变异页面状态（弹窗/跳转），判定后按四条路径还原（见 restore 调用点），
// 保证 capture 抓到干净页。本模块是 skips 与 storage_state 的唯一写者
// （read-merge-write）；两个 snapshot 进程并行转换不同 URL 时同 last-writer-wins
// 丢写，与 storage_state 同款已接受模式。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { URL as Url } from 'node:url';
import { needsLogin as detectLogin, WEAK_SIGNALS } from './detector.mjs';
import { startScreencastViewer, openViewerCommand } from './screencast.mjs';
import { readStorageState, writeStorageState, mergeStorageState, gotoSettled } from './browser.mjs';

const STRONG_NAMES = { password: '密码框', loginConfirmed: '登录入口点击确认' };
const METHOD_NAMES = { modal: '全屏弹窗', navigate: '跳转登录页' };

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// —— 跳过记忆文件（login_decisions_skips.json，{hostname: [信号名,...]}）——

const skipsFileFor = (ssPath) => (ssPath ? path.join(path.dirname(ssPath), 'login_decisions_skips.json') : null);

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

/** 把本次跳过确认的弱信号名 merge 入档（read-merge-write，仅本模块写）；强信号过滤掉，过滤后为空不写。 */
export const recordSkips = (file, hostname, signals) => {
  if (!file) return;
  const weak = [...new Set((signals || []).filter((s) => WEAK_SIGNALS.includes(s)))];
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
 * 登录检测 + Screencast 人工登录。
 * @param {import('playwright').Page} page - 已创建的页面（浏览器由 snapshot.mjs 管理）
 * @param {string} url - 目标 URL
 * @param {{timeout?: number, storageStatePath?: string, log?: Function}} opts
 * @returns {Promise<{needsLogin: boolean, loginSkippedByMemory?: string[]}>}
 * @throws {Error} reason='login_timeout' | 'login_aborted' | 其他错误
 */
export async function snapshotLogin(page, url, opts = {}) {
  const { timeout = 300000, storageStatePath: ssPath, log = () => {} } = opts;

  // 导航到目标 URL
  await gotoSettled(page, url, log);

  const skipsFile = skipsFileFor(ssPath);
  const hostname = new Url(page.url()).hostname;
  const memorized = loadSkips(skipsFile, hostname);
  if (memorized.length) log(`跳过记忆: ${hostname} [${memorized.join(', ')}]`);

  // 检测是否需要登录
  const result = await detectLogin(page, url, { log, memorized });

  const refreshStorage = async () => {
    if (!ssPath) return;
    const base = await readStorageState(ssPath);
    const fresh = await page.context().storageState();
    await writeStorageState(ssPath, mergeStorageState(base, fresh));
  };
  /** 探测点击变异了页面（弹窗/跳转/dropdown）→ 重载原 URL 还原干净状态。 */
  const restoreIfProbed = async () => {
    if (!result.probe.clicked && !result.probe.confirmed) return;
    log('探测点击后还原原页面状态');
    await gotoSettled(page, url, log);
  };

  if (!result.needsLogin) {
    // 已登录 / 记忆豁免：刷新 storageState；探测过则还原页面
    await refreshStorage();
    await restoreIfProbed();
    if (result.dismissed) {
      log(`判定豁免：命中 ${result.hitNames.join('+')} 全在跳过记忆`);
      return { needsLogin: false, loginSkippedByMemory: result.hitNames };
    }
    log('检测为已登录');
    return { needsLogin: false };
  }

  log('判定需要登录，进入 Screencast 登录模式');

  const reason = buildReason(result, memorized);
  const skipConfirmText = buildSkipConfirm(result, hostname);

  // viewer 以 1280×800 呈现（原 login_url.mjs 同款）；本管线上下文是 1280×3000
  // 懒加载视口——3000px 塞 800px 画布会纵向压扁 + 模糊，登录期间临时切换、
  // 结束后恢复，滚动阶段仍用高视口
  const origViewport = page.viewportSize();
  if (origViewport) await page.setViewportSize({ width: origViewport.width || 1280, height: 800 });

  // 进 viewer 前的状态整理：探测确认（弹窗开着/停在登录页）→ 保留原状进 viewer
  // 最利于登录；点击过但未确认（可能弹出无关 dropdown）→ 还原干净页再进 viewer
  if (result.probe.clicked && !result.probe.confirmed) await restoreIfProbed();

  // 未登录：启动 Screencast viewer 等待人工登录（跳过=经确认框后继续，弱信号入档）
  try {
    return await new Promise((resolve, reject) => {
    let settled = false;
    let viewer = null;

    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      resolve(res);
    };
    const fail = (reason2) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      const err = new Error(reason2);
      err.reason = reason2;
      reject(err);
    };

    const timer = setTimeout(() => fail('login_timeout'), timeout);
    timer.unref?.();

    startScreencastViewer({
      page,
      reason,
      skipConfirmText,
      quality: 85, // 文本可读性：800 高原生分辨率下 q80 的 jpeg 压缩伪影偏明显
      onSkipLogin: async () => {
        if (settled) return; // finish 已发生（viewer 关闭触发的迟到消息不再处理）
        // 全程自吞异常：跳过是用户的逃生口，善后失败绝不能炸掉进程破坏单行 JSON 契约
        try {
          // 也刷新 storageState——用户可能已实际登录（强信号 recheck 永败的场景），跳过不丢会话
          await refreshStorage();
          // 弱信号入档（强信号 recordSkips 内部过滤——跳过强信号=一次性）
          recordSkips(skipsFile, hostname, result.hitNames);
          // 还原探测点开的弹窗/跳转——快照必须抓干净的目标页
          await restoreIfProbed();
        } catch (e) { log(`跳过登录善后异常: ${e.message}`); }
        finish({ needsLogin: true });
      },
      onLoginDone: async (ws) => {
        if (settled) return; // finish/fail 已发生——recheck 的探测点击会再次变异页面，绝不能在管线续跑后重入
        try {
          const recheck = await detectLogin(page, url, { spaWaitMs: 500, log, memorized });
          if (!recheck.needsLogin) {
            await refreshStorage();
            // recheck 自身的探测点击（若有）也要还原——登录后页面可能被点开 dropdown
            if (recheck.probe.clicked) await gotoSettled(page, page.url(), log);
            finish({ needsLogin: true });
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        if (settled) return; // skip/login_done 后 finish 会 terminate WS 客户端、必然触发本回调——
        // 无守卫则 recheck 的探测点击会把弹窗重新点开、污染后续 capture 的快照（实测竞态）
        try {
          const recheck = await detectLogin(page, url, { spaWaitMs: 500, log, memorized });
          if (!recheck.needsLogin) {
            await refreshStorage();
            if (recheck.probe.clicked) await gotoSettled(page, page.url(), log);
            finish({ needsLogin: true });
          } else {
            fail('login_aborted');
          }
        } catch { fail('login_aborted'); }
      },
      log,
    }).then((v) => {
      viewer = v;
      log(`[snapshot] viewer: ${v.url}`);
      // 自动打开用户默认浏览器（打不开不致命——URL 已记 stderr；测试用
      // U2M_VIEWER_NOOPEN=1 关闭）
      if (process.env.U2M_VIEWER_NOOPEN !== '1') {
        const { cmd, args } = openViewerCommand(process.platform, v.url);
        execFile(cmd, args, () => {});
      }
    }).catch((e) => fail(e.message));
    });
  } finally {
    if (origViewport) {
      try { await page.setViewportSize(origViewport); } catch { /* 页面已关 */ }
    }
  }
}
