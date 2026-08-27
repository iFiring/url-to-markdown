#!/usr/bin/env bash
# init.sh —— 步骤 0：初始化执行环境与核心参数。
# 用法: bash init.sh --url <url>
# stdout 有且仅有一行 JSON（含 skill-root / url-name / url-working-path
# 三个核心参数）；日志/警告走 stderr。
# url-name 与步骤 1 同一生成逻辑：lib/env.mjs 的 urlToDirName（唯一事实源，
# 经 node 调用，避免两套实现漂移）。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '[init] %s\n' "$*" >&2; }
warn() { log "⚠ 警告（不阻断）: $*"; }
die()  { printf '{"status":"error","reason":"%s"}\n' "$1"; exit 1; }
die_usage() { printf '{"status":"usage_error","reason":"%s"}\n' "$1"; exit 2; }

# ── 0. 参数：--url 必填 ─────────────────────────────────────────
URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      [ $# -ge 2 ] || die_usage "--url 需要一个值"
      URL="$2"; shift 2 ;;
    *) die_usage "未知参数: $1（用法: init.sh --url <url>）" ;;
  esac
done
[ -n "$URL" ] || die_usage "缺少必填参数 --url <url>"

# ── 1. Node ≥ 20 ────────────────────────────────────────────
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
  log "Node >=20 缺失或版本过低，尝试 nvm 安装"
  # nvm 是 shell 函数，需 source
  if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
  if command -v nvm >/dev/null 2>&1; then
    nvm install 20 >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1 || die "nvm 安装 Node 20 失败"
  else
    die "Node >=20 不满足且 nvm 不可用"
  fi
fi
[ "$(node_major)" -ge 20 ] || die "Node >=20 不满足"
NODE_VER="$(node -p process.versions.node)"

# ── 2. 包管理器探测 pnpm > yarn > npm（不自行安装） ─────────
PM=""
for c in pnpm yarn npm; do
  if command -v "$c" >/dev/null 2>&1; then PM="$c"; break; fi
done
[ -n "$PM" ] || die "未找到 pnpm/yarn/npm，请先安装其中之一"

# ── 3. Node 依赖（有 lock 走 frozen/CI 模式） ────────────────
cd "$ROOT" || die "无法进入项目根目录"
log "使用 $PM 安装 Node 依赖"
case "$PM" in
  # CI=true：非交互环境下 pnpm 需清空异版 node_modules 时自动确认重建，
  # 否则无 TTY 直接 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY 中止
  pnpm) if [ -f pnpm-lock.yaml ]; then CI=true pnpm install --frozen-lockfile >&2 || die "pnpm install --frozen-lockfile 失败";
        else CI=true pnpm install >&2 || die "pnpm install 失败"; fi ;;
  yarn) if [ -f yarn.lock ]; then yarn install --frozen-lockfile >&2 || die "yarn install --frozen-lockfile 失败";
        else yarn install >&2 || die "yarn install 失败"; fi ;;
  npm)  if [ -f package-lock.json ]; then npm ci >&2 || die "npm ci 失败";
        else npm install >&2 || die "npm install 失败"; fi ;;
esac

# ── 4. chromium（只修复缺失，不重复安装） ────────────────────
CHROMIUM_OK=false
NODE_CHROMIUM="$(node -e 'try { console.log(require("playwright").chromium.executablePath()) } catch { process.exit(1) }' 2>/dev/null || true)"
if [ -n "$NODE_CHROMIUM" ] && [ -x "$NODE_CHROMIUM" ]; then
  CHROMIUM_OK=true
else
  log "安装 chromium（Node Playwright）"
  npx playwright install chromium >&2 || die "npx playwright install chromium 失败"
  CHROMIUM_OK=true
fi

# ── 5. 核心参数：url-name / url-working-path ─────────────────
# 命名规则唯一事实源：lib/env.mjs urlToDirName（与步骤 1 的目录派生一致）
URL_NAME="$(U2M_ROOT="$ROOT" node --input-type=module -e '
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(`${process.env.U2M_ROOT}/script/lib/env.mjs`).href);
console.log(m.urlToDirName(process.argv[1]));
' "$URL")" || die "url-name 推导失败"
WORKING_ROOT="${U2M_WORKING_ROOT:-$ROOT/working}"
URL_WORKING_PATH="$WORKING_ROOT/$URL_NAME"
mkdir -p "$URL_WORKING_PATH" || die "无法创建工作目录: $URL_WORKING_PATH"

# ── 输出 ─────────────────────────────────────────────────────
printf '{"status":"ok","skill-root":"%s","url-name":"%s","url-working-path":"%s","node":"%s","pm":"%s","chromium":%s}\n' \
  "$ROOT" "$URL_NAME" "$URL_WORKING_PATH" "$NODE_VER" "$PM" "$CHROMIUM_OK"
