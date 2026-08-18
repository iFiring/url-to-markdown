// script/lib/contract.mjs
/** 统一脚本契约：stdout 有且仅有一行 JSON；日志走 stderr；退出码 0/1/2。 */

export function log(...parts) {
  console.error(...parts);
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
