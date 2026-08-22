// script/lib/snapshot-login.mjs
// 步骤 1 登录阶段：goto URL → 六信号检测 → Screencast viewer（如需登录）
import { needsLogin as detectLogin } from './detector.mjs';
import { startScreencastViewer } from './screencast.mjs';
import { readStorageState, writeStorageState, mergeStorageState, gotoSettled } from './browser.mjs';

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

  // 检测是否需要登录
  const result = await detectLogin(page, page.context(), url);
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

  // 未登录：启动 Screencast viewer 等待人工登录
  return new Promise((resolve, reject) => {
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
      onLoginDone: async (ws) => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500 });
          if (!recheck.needsLogin) {
            if (ssPath) {
              const base = await readStorageState(ssPath);
              const fresh = await page.context().storageState();
              await writeStorageState(ssPath, mergeStorageState(base, fresh));
            }
            finish({ needsLogin: true });
          } else {
            ws.send(JSON.stringify({ type: 'recheck_failed' }));
          }
        } catch (e) { log(`复检异常: ${e.message}`); }
      },
      onClientClose: async () => {
        try {
          const recheck = await detectLogin(page, page.context(), url, { spaWaitMs: 500 });
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
    }).catch((e) => fail(e.message));
  });
}
