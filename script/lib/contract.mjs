// script/lib/contract.mjs
/** 统一脚本契约：stdout 有且仅有一行 JSON；日志走 stderr；退出码 0/1/2。 */
import fs from 'node:fs';
import path from 'node:path';

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

/**
 * 调试日志（无前缀版）：U2M_DEBUG 非空时原样输出。[net] 逐请求头这类
 * 成组行加时间前缀只是干扰项，裸行便于 grep 与整段粘贴。
 */
export function debugRaw(...parts) {
  if (!process.env.U2M_DEBUG) return;
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

/**
 * 成功路径的精简 emit：完整载荷（统计计数、产物路径等）先写
 * <dir>/logs/<resultName>.json 供排查，stdout 只 emit keepKeys 挑出的
 * 流程驱动字段——agent 手册只关心后者，字段越少上下文噪音越小。
 * result 文件是完整载荷（含 status 与保留字段），排查时一个文件即全部真相。
 * keepKeys 里的键不存在时 stringify 自然丢键，可选字段（如 skipped）无需特判。
 * 写盘失败抛异常由调用方 catch → emitError（系统级故障如实报错）。
 */
export function emitLogged(dir, resultName, payload, keepKeys) {
  const logsDir = path.join(dir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, resultName), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const slim = {};
  for (const k of keepKeys) slim[k] = payload[k];
  emit(slim);
}
