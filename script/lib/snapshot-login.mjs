// script/lib/snapshot-login.mjs
// 步骤 1 登录阶段：goto URL → 七信号两级制检测 → Screencast viewer（如需登录）
// 强信号裁决记忆：用户在 viewer 的「登录完成/跳过登录」选择按 (hostname, 信号) 记入
// login_decisions.json；skip 的信号在该域名视为不存在——不单票、不计票。
// 本模块是 decisions 与 storage_state 的唯一写者（read-merge-write）；两个
// snapshot 进程并行转换不同 URL 时同 last-writer-wins 丢写，与 storage_state 同款已接受模式。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { URL as Url } from 'node:url';
import { needsLogin as detectLogin } from './detector.mjs';
import { startScreencastViewer, openViewerCommand } from './screencast.mjs';
import { readStorageState, writeStorageState, mergeStorageState, gotoSettled } from './browser.mjs';

const STRONG_NAMES = { password: '密码框', loginButton: '登录/注册按钮' };

const decisionsFileFor = (ssPath) => (ssPath ? path.join(path.dirname(ssPath), 'login_decisions.json') : null);

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const loadDecisions = (file) => {
  try {
    const parsed = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    // 形状强转：字面 null / 数组等手编损坏内容不得毒化整次快照
    return isPlainObject(parsed) ? parsed : {};
  } catch { return {}; }
};

/** 把本次触发 viewer 的强信号裁决 merge 回写（read-modify-write，仅本模块写 decisions）。 */
const recordStrongDecisions = (file, hostname, strong, choice) => {
  if (!file || !strong.length) return;
  const all = loadDecisions(file);
  const host = isPlainObject(all[hostname]) ? all[hostname] : {};
  all[hostname] = host;
  for (const k of strong) host[k] = choice;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
};

/**
 * 登录检测 + Screencast 人工登录。
 * @param {import('playwright').Page} page - 已创建的页面（浏览器由 snapshot.mjs 管理）
 * @param {string} url - 目标 URL
 * @param {{timeout?: number, storageStatePath?: string, log?: Function}} opts
 * @returns {Promise<{needsLogin: boolean}>}
 * @throws {Error} reason='login_timeout' | 'login_aborted' | 其他错误
 */
export async function snapshotLogin(page, url, opts = {}) {
  const { timeout = 300000, storageStatePath: ssPath, log = () => {} } = opts;

  // 导航到目标 URL
  await gotoSettled(page, url, log);

  // 裁决记忆：该 hostname 上被用户裁决为 skip 的强信号 → 降级
  const decisionsFile = decisionsFileFor(ssPath);
  const hostname = new Url(page.url()).hostname;
  const demoted = Object.entries(loadDecisions(decisionsFile)[hostname] || {})
    .filter(([, choice]) => choice === 'skip').map(([signal]) => signal);

  // 检测是否需要登录
  const result = await detectLogin(page, page.context(), url, { log, demoted });
  if (!result.needsLogin) {
    // 已登录：刷新 storageState
    if (ssPath) {
      const base = await readStorageState(ssPath);
      const fresh = await page.context().storageState();
      await writeStorageState(ssPath, mergeStorageState(base, fresh));
    }
    log('检测为已登录');
    return { needsLogin: false };
  }

  log('判定需要登录，进入 Screencast 登录模式');

  const reason = result.strong.length
    ? `检测到登录信号: ${result.strong.map((k) => STRONG_NAMES[k] || k).join('、')}`
    : '';

  // viewer 以 1280×800 呈现（原 login_url.mjs 同款）；本管线上下文是 1280×3000
  // 懒加载视口——3000px 塞 800px 画布会纵向压扁 + 模糊，登录期间临时切换、
  // 结束后恢复，滚动阶段仍用高视口
  const origViewport = page.viewportSize();
  if (origViewport) await page.setViewportSize({ width: origViewport.width || 1280, height: 800 });

  // 未登录：启动 Screencast viewer 等待人工登录（跳过=用户裁决该信号非真，记录并继续）
  try {
    return await new Promise((resolve, reject) => {
    let settled = false;
    let viewer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      resolve(result);
    };
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { viewer?.close(); } catch { /* 忽略 */ }
      const err = new Error(reason);
      err.reason = reason;
      reject(err);
    };

    const timer = setTimeout(() => fail('login_timeout'), timeout);
    timer.unref?.();

    startScreencastViewer({
      page,
      reason,
      quality: 85, // 文本可读性：800 高原生分辨率下 q80 的 jpeg 压缩伪影偏明显
      onSkipLogin: async () => {
        // 全程自吞异常：跳过是用户的逃生口，善后失败绝不能炸掉进程破坏单行 JSON 契约
        try {
          // 也刷新 storageState——用户可能已实际登录（强信号 recheck 永败的场景），跳过不丢会话
          if (ssPath) {
            const base = await readStorageState(ssPath);
            const fresh = await page.context().storageState();
            await writeStorageState(ssPath, mergeStorageState(base, fresh));
          }
          recordStrongDecisions(decisionsFile, hostname, result.strong, 'skip');
        } catch (e) { log(`跳过登录善后异常: ${e.message}`); }
        finish({ needsLogin: true });
      },
      onLoginDone: async (ws) => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500, log, demoted });
          if (!recheck.needsLogin) {
            if (ssPath) {
              const base = await readStorageState(ssPath);
              const fresh = await page.context().storageState();
              await writeStorageState(ssPath, mergeStorageState(base, fresh));
            }
            recordStrongDecisions(decisionsFile, hostname, result.strong, 'login');
            finish({ needsLogin: true });
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500, log, demoted });
          if (!recheck.needsLogin) {
            if (ssPath) {
              const base = await readStorageState(ssPath);
              const fresh = await page.context().storageState();
              await writeStorageState(ssPath, mergeStorageState(base, fresh));
            }
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
