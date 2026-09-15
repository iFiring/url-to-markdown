// script/lib/snapshot-gate.mjs
// 步骤 1 人机门禁：三分支不动点循环，替代原「登录阶段」单分支。
//   分支① 登录——六信号两级制（detector.mjs 既有路径，viewer 机制 openLoginViewer）；
//          password 强信号压过挑战占优（验证码内嵌登录表单 → 登录 viewer 一并解决）
//   分支② 验证码/滑块——已知挑战标记占优（page-detect-captcha.js 双通道判定）或
//          登录探测懒触发（probe.captcha——弹窗现场绝不还原，直接进 viewer 最利人工）；
//          viewer 无跳过按钮（跳过=抓挑战页=必然垃圾产物），解决后 refreshStorage
//          （cf_clearance 等落盘，后续运行免验证）；不进 skips 记忆（挑战是瞬态事实）
//   分支③ 稀薄内容兜底——正文 <阈值 ∧ 无 main/article ∧ 无可导航大 iframe（iframe 壳页
//          归重定向门管）∧ 登录零信号（登录墙的稀薄已由分支①/记忆裁决，不二次打扰）；
//          HTTP 状态码分诊：404→error http_404（硬事实，先于一切分支与记忆豁免——
//          404 页不该先让用户登录）；403/503/429→强嫌疑介入 viewer；200→诚实文案介入
//          viewer（「也可能本就是空页面」）。跳过=弱信号 content_sparse 入档（复用
//          login_decisions_skips.json，豁免语义与登录弱信号同构）
// 人工介入后回环复检（解决一个门禁可能露出下一个）。分支再命中的语义按介入类型分：
//   解决型（①②）→ viewer 内 recheck 已挡「未解决就出来」，再次命中=声称解决却未
//   解决（连环门）→ gate_loop_limit（fail-closed，用户裁定）；确认型（③）→ 用户已
//   明确确认「页面正常」，再次稀薄=尊重裁决放行。maxInterventions 是总量保险（防
//   未来的新增分支绕过 settled 约束）。失败语义 fail-closed（用户裁定）：介入 viewer
//   弃窗→gate_aborted、超时→gate_timeout、循环超限→gate_loop_limit。
// 探测会话级熔断：probe 一旦点击过，后续轮 allowProbe=false——验证码解决后的回环
// 复检再点登录入口会二次触发挑战（懒触发滑块站的实测回归），收尾还原也只做一次。
// 超时计时三形态统一（用户裁定）：倒计时自 viewer 首连始，无人连接由 backstopMs
// 绝对上限（默认 1h）兜底——runViewerSession 承载，本模块只透传参数。
// 生产调用点：snapshot.mjs（入口页）+ snapshot-redirect.mjs（重定向目标页，
// sparseTriage:false——目标页空渲染由退化守卫回退原页，语义比 error 更正确）。
import { URL as Url } from 'node:url';
import { needsLogin as detectLogin } from './detector.mjs';
import { collectGatePageSignals } from './detector-captcha.mjs';
import { loadSkips, recordSkips, skipsFileFor, openLoginViewer } from './snapshot-login.mjs';
import { runViewerSession } from './screencast.mjs';
import { refreshStorageState, gotoSettled } from './browser.mjs';
import { resolveViewerLang, viewerText } from './viewer-i18n.mjs';

/** 稀薄兜底的弱信号名（入 login_decisions_skips.json，RECORDABLE_SIGNALS 已含）。 */
export const SPARSE_SIGNAL = 'content_sparse';

const err = (reason) => { const e = new Error(reason); e.reason = reason; return e; };

/** 厂商清单的中文版——**仅限 stderr log 行**（恒中文）；viewer reason 走 viewer-i18n 的 captchaReason。 */
const vendorNote = (pg) => [...new Set(pg.captcha.hits.map((h) => h.vendor))].join('、') || '未知类型';

/** 命中厂商名去重清单（viewer-i18n captchaReason 的纯数据入参）。 */
const vendorList = (pg) => [...new Set(pg.captcha.hits.map((h) => h.vendor))];

/**
 * 验证码 viewer 会话：无跳过；done→recheck（挑战不再占优 ∨ 成功态）通过则
 * refreshStorage + resolve；关窗→同款 recheck，仍见挑战 → captcha_aborted；
 * 超时 → captcha_timeout（计时语义由 runViewerSession 统一）。
 */
async function openCaptchaViewer(page, { pg, ssPath, timeout, backstopMs, log }) {
  const T = viewerText(resolveViewerLang()); // viewer 文案双语字典（调用时求值语言）
  return runViewerSession(page, {
    timeout,
    backstopMs,
    timeoutReason: 'captcha_timeout',
    log,
    viewerOpts: {
      ...T.captcha.statics, // 含 skipText:null（无跳过——挑战页抓下来必然是垃圾产物，只有解决或放弃，关窗=报错）与 reasonHint:null
      reason: T.build.captchaReason({ vendors: vendorList(pg), textLen: pg.sparse.textLen }),
    },
    onDone: async (ws, api) => {
      if (api.isSettled()) return; // finish/fail 后 viewer close 触发的迟到消息不再处理
      try {
        const re = await collectGatePageSignals(page, { log });
        if (!re.captcha.dominant || re.captcha.success) {
          // clearance 类 cookie（cf_clearance/极验等）落盘——后续运行直接免验证
          await refreshStorageState(page, ssPath);
          api.finish({ solved: true });
        } else {
          ws.send(JSON.stringify({ type: 'recheck_failed' }));
        }
      } catch (e) { log(`验证复检异常: ${e.message}`); }
    },
    onClose: async (api) => {
      if (api.isSettled()) return; // finish/fail 会 terminate WS 客户端、必然触发本回调（实测竞态）
      try {
        const re = await collectGatePageSignals(page, { log });
        if (!re.captcha.dominant || re.captcha.success) {
          await refreshStorageState(page, ssPath);
          api.finish({ solved: true });
        } else {
          api.fail('captcha_aborted');
        }
      } catch (e) { log(`验证关窗复检异常: ${e.message}`); api.fail('captcha_aborted'); }
    },
  });
}

/**
 * 稀薄内容人工介入 viewer：「✅ 页面正常，继续」→ 回环复检（文本涨→通过；露出
 * 挑战/登录标记→转对应分支）；「⏭️ 仍然继续」→ content_sparse 入档 + 放行；
 * 关窗→recheck：仍稀薄 = gate_aborted（fail-closed，用户裁定），已长出来（迟水合）
 * 视同 done；超时 → gate_timeout。
 */
async function openInterventionViewer(page, { pg, httpStatus, skipsFile, hostname, ssPath, timeout, backstopMs, log }) {
  const T = viewerText(resolveViewerLang()); // viewer 文案双语字典（调用时求值语言；suspicion 分诊在 sparseReason 内）
  return runViewerSession(page, {
    timeout,
    backstopMs,
    timeoutReason: 'gate_timeout',
    log,
    viewerOpts: {
      ...T.sparse.statics, // 含 reasonHint:null
      reason: T.build.sparseReason({ textLen: pg.sparse.textLen, httpStatus }),
      skipConfirmText: T.build.sparseSkipConfirm({ hostname, signal: SPARSE_SIGNAL }),
    },
    onSkip: async (api) => {
      if (api.isSettled()) return;
      // 全程自吞异常：跳过是用户的逃生口，善后失败绝不能炸掉进程破坏单行 JSON 契约
      try {
        recordSkips(skipsFile, hostname, [SPARSE_SIGNAL]);
        await refreshStorageState(page, ssPath);
      } catch (e) { log(`介入跳过善后异常: ${e.message}`); }
      api.finish({ action: 'skip' });
    },
    onDone: (ws, api) => {
      if (api.isSettled()) return;
      api.finish({ action: 'done' }); // 不在 viewer 内 recheck——回环复检负责（露出标记转对应分支）
    },
    onClose: async (api) => {
      if (api.isSettled()) return;
      try {
        const re = await collectGatePageSignals(page, { log });
        if (!re.sparse.thin) api.finish({ action: 'done' }); // 迟水合长出来了 → 视同 done
        else api.fail('gate_aborted');
      } catch (e) { log(`介入关窗复检异常: ${e.message}`); api.fail('gate_aborted'); }
    },
  });
}

/**
 * 人机门禁：三分支不动点循环（登录 / 验证码 / 稀薄兜底）。
 * @param {import('playwright').Page} page - 已创建的页面（浏览器由调用方管理）
 * @param {string} url - 目标 URL
 * @param {{timeout?: number, backstopMs?: number, storageStatePath?: string, log?: Function,
 *          maxInterventions?: number, sparseTriage?: boolean}} opts
 *   sparseTriage=false 关闭分支③与 404 分诊（重定向目标页——退化守卫接管）
 * @returns {Promise<{needsLogin: boolean, loginSkippedByMemory: string[]|null,
 *                    gateSkippedByMemory: string[]|null, httpStatus: number|null}>}
 * @throws {Error} reason='captcha_timeout'|'captcha_aborted'|'http_404'|'gate_aborted'
 *                 |'gate_timeout'|'gate_loop_limit'|'login_timeout'|'login_aborted'
 */
export async function gateCheck(page, url, opts = {}) {
  const {
    timeout = 300000, backstopMs = 3600000, storageStatePath: ssPath,
    log = () => {}, maxInterventions = 3, sparseTriage = true, spaWaitMs,
  } = opts;

  // 门禁导航仅首轮——HTTP 状态码分诊只消费本次响应；回环轮不重新导航
  // （懒触发滑块弹窗/登录后现场是最利人工介入的状态）
  const httpStatus = await gotoSettled(page, url, log);

  const skipsFile = skipsFileFor(ssPath);
  const settledBranches = new Set();
  let interventions = 0;
  let needsLogin = false;
  let loginSkippedByMemory = null;
  let gateSkippedByMemory = null;
  let lastLogin = null;
  // 会话级状态：探测一旦发生即熔断（后续轮不再点击）；任何 viewer 打开后
  // loginSkippedByMemory 不再置值——该字段语义是「进门前已有的记忆」豁免通报，
  // 本会话内交互产生的跳过不是记忆豁免（用户刚点的，不是记住的）
  let probedThisRun = false;
  let interacted = false;
  let loginSkipConfirmed = false; // 用户点过「跳过登录」——次轮再命中不判连环门

  const bump = () => {
    interventions += 1;
    // fail-closed（用户裁定）：每轮推进都来自「人工声称已解决」，超限说明站点
    // 连环弹挑战或检测持续误判——明确失败比产出可疑 markdown 诚实
    if (interventions > maxInterventions) throw err('gate_loop_limit');
  };

  for (;;) {
    const hostname = new Url(page.url()).hostname;
    const memorized = loadSkips(skipsFile, hostname);

    // 只读采集（一次合并 evaluate：挑战标记+iframe 特征+稀薄度+标题；再同源 frames 扫描）
    const pg = await collectGatePageSignals(page, { log });
    // 登录六信号——probe 双重门控：挑战占优页不点（无意义且二次风控）；本会话已
    // 探测过不点（验证码解决后的回环再点会重新触发挑战——懒滑块站实测回归）
    const login = await detectLogin(page, url, {
      log, memorized, allowProbe: !probedThisRun && !pg.captcha.dominant,
      ...(spaWaitMs !== undefined ? { spaWaitMs } : {}),
    });
    lastLogin = login;
    if (login.probe.clicked || login.probe.confirmed) probedThisRun = true;
    const captchaFirst = pg.captcha.dominant || login.probe.captcha;

    if (login.dismissed && !loginSkippedByMemory && !interacted) {
      log(`登录判定豁免：命中 ${login.hitNames.join('+')} 全在跳过记忆`);
      loginSkippedByMemory = login.hitNames;
    }

    // 404∧稀薄 = 硬事实（修复：先于登录分支与记忆豁免——典型 404 页
    // 常带登录链接/URL 子串命中，藏在其后会让 http_404 永不可达）；404∧正文充实
    // 照常放行（thin 条件保证）
    if (sparseTriage && httpStatus === 404 && pg.sparse.thin) throw err('http_404');

    // 分支①：登录（password 强信号压过挑战占优——内嵌验证码一并解决）。
    // 登录 viewer 内 recheck 已挡「未解决就出来」——done 出来后再次命中 = 声称
    // 解决却未解决（连环门）→ fail-closed；但用户点过「跳过登录」（一次性裁决，
    // 强信号不入档所以次轮必然复活）→ 忽略本分支继续评估②③
    if (login.needsLogin && (login.signals.password || !captchaFirst)) {
      if (settledBranches.has('login') && !loginSkipConfirmed) throw err('gate_loop_limit');
      if (!settledBranches.has('login')) {
        bump();
        needsLogin = true;
        interacted = true;
        log('门禁: 判定需要登录，进入 Screencast 登录模式');
        // 进 viewer 前的状态整理由 openLoginViewer 的 prepare 承载（确认 → 保留现场
        // 最利登录；点击过未确认 → 还原干净页）——此处不再重复还原（双重 gotoSettled
        // 会对目标站加倍请求且拖慢 viewer 出现）
        const r = await openLoginViewer(page, url, {
          result: login, memorized, hostname, skipsFile,
          storageStatePath: ssPath, timeout, backstopMs, log,
          restoreIfProbed: async () => {
            if (!login.probe.clicked && !login.probe.confirmed) return;
            log('探测点击后还原原页面状态');
            await gotoSettled(page, url, log);
          },
        });
        settledBranches.add('login');
        if (r?.action === 'skip') loginSkipConfirmed = true;
        continue; // 回环复检（skip 场景：次轮 dismissed/hits>0 天然抑制后续分支）
      }
    }

    // 分支②：挑战占优（含 probe 懒触发滑块——弹窗开着直接进 viewer，绝不还原现场）。
    // 验证码 viewer 的 done/close recheck 已挡「挑战仍在就放行」——已 settle 后再次
    // 占优 = 连环挑战站，抓了也是垃圾
    if (captchaFirst && !pg.captcha.success) {
      if (settledBranches.has('captcha')) throw err('gate_loop_limit');
      bump();
      interacted = true;
      // probe 懒触发的挑战是点击后才出现的——本轮 pg 采集于点击前，重采一次拿到
      // 现场（viewer reason 报告真实厂商；只读零扰动）
      const livePg = (login.probe.captcha && !pg.captcha.dominant)
        ? await collectGatePageSignals(page, { log })
        : pg;
      log(`门禁: 人机验证挑战（${login.probe.captcha ? '探测懒触发 ' : ''}${vendorNote(livePg)}，正文 ${livePg.sparse.textLen} 字符），进入 Screencast 验证模式`);
      await openCaptchaViewer(page, { pg: livePg, ssPath, timeout, backstopMs, log });
      settledBranches.add('captcha');
      continue;
    }

    // 分支③：稀薄兜底——仅登录零信号时（登录墙的稀薄已被分支①/跳过记忆裁决，
    // 不二次打扰）；iframe 壳页（hasFrame）归重定向门管。确认型介入：用户点过
    // 「页面正常」后再次稀薄 = 尊重裁决放行（与①②解决型的 throw 语义不同）
    if (sparseTriage && login.hits === 0 && pg.sparse.thin) {
      if (!settledBranches.has('sparse')) {
        if (memorized.includes(SPARSE_SIGNAL)) {
          log(`门禁: 正文稀薄（${pg.sparse.textLen} 字符）但 ${hostname} 有 ${SPARSE_SIGNAL} 跳过记忆 → 豁免放行`);
          gateSkippedByMemory = [SPARSE_SIGNAL];
          break;
        }
        bump();
        interacted = true;
        log(`门禁: 正文仅 ${pg.sparse.textLen} 字符且无主体结构（HTTP ${httpStatus}）→ 人工介入确认`);
        const r = await openInterventionViewer(page, {
          pg, httpStatus, skipsFile, hostname, ssPath, timeout, backstopMs, log,
        });
        settledBranches.add('sparse');
        if (r?.action === 'skip') break; // 用户裁决继续——放行抓取（行为已入档 + stderr 留痕）
        continue; // done/关窗时已长出 → 回环（露出挑战/登录标记转对应分支；文本涨则通过）
      }
      break; // 用户已确认「页面正常」——尊重裁决放行
    }

    break; // 无门禁信号 → 通过
  }

  // 通过路径收尾（旧 snapshotLogin「已登录/豁免」分支同款）：刷新 storageState
  // （会话 cookie 保鲜）；本会话探测点脏的页面（dropdown/弹窗/跳转/懒触发挑战残留）
  // 还原干净——capture 必须抓干净页。懒触发挑战已解决的场景：clearance cookie 已
  // 落盘（验证码 viewer 通过时 refreshStorage），重导航不再弹挑战
  await refreshStorageState(page, ssPath);
  if (probedThisRun || lastLogin?.probe.confirmed) {
    log('探测点击后还原原页面状态');
    await gotoSettled(page, url, log);
  }

  return { needsLogin, loginSkippedByMemory, gateSkippedByMemory, httpStatus };
}
