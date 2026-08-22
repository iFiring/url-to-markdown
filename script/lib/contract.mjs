// script/lib/contract.mjs
/** 统一脚本契约：stdout 有且仅有一行 JSON；日志走 stderr；退出码 0/1/2。 */

export function log(...parts) {
  console.error(...parts);
}

const t0 = performance.now();

/**
 * 调试日志：U2M_DEBUG 非空时才输出（本地调试用，如 U2M_DEBUG=1）。
 * stderr + 进程启动起算的耗时前缀，方便定位慢阶段；不影响 stdout 契约。
 */
export function debug(...parts) {
  if (!process.env.U2M_DEBUG) return;
  console.error(`[dbg +${((performance.now() - t0) / 1000).toFixed(2)}s]`, ...parts);
}

/** stdout 输出单行 JSON 后退出。写回调里 exit，保证管道场景不截断。 */
export function emit(result, code = 0) {
  const line = JSON.stringify(result) + '\n';
  process.stdout.write(line, () => process.exit(code));
  // 兜底：极端情况下 1s 内强制退出
  setTimeout(() => process.exit(code), 1000).unref();
}

export function emitError(reason, code = 1) {
  emit({ status: 'error', reason }, code);
}

/** 参数错误：也守契约（先输出 JSON 再退出 2）。 */
export function usage(msg) {
  emit({ status: 'usage_error', reason: msg }, 2);
}
