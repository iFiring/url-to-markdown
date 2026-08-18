#!/usr/bin/env bash
# init.sh —— 环境自检与修复。stdout 有且仅有一行 JSON；日志/警告走 stderr。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '[init] %s\n' "$*" >&2; }
warn() { log "⚠ 警告（不阻断）: $*"; }
die()  { printf '{"status":"error","reason":"%s"}\n' "$1"; exit 1; }

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

# ── 2. Python3 ≥ 3.11 ────────────────────────────────────────
py_ok() { python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; }
if ! py_ok; then
  log "Python >=3.11 缺失或版本过低，尝试安装"
  if command -v uv >/dev/null 2>&1; then
    uv python install 3.12 >/dev/null 2>&1 || die "uv python install 3.12 失败"
    UV_PY="$(uv python find 3.12 2>/dev/null)" || die "uv python find 失败"
    export PATH="$(dirname "$UV_PY"):$PATH"
  elif command -v brew >/dev/null 2>&1; then
    brew install python@3.12 >/dev/null 2>&1 || die "brew 安装 Python 失败"
  else
    die "Python >=3.11 不满足且无可用安装途径（uv/brew）"
  fi
fi
py_ok || die "Python >=3.11 仍不满足"
PY_VER="$(python3 -c 'import platform; print(platform.python_version())')"

# ── 3. 包管理器探测 pnpm > yarn > npm（不自行安装） ─────────
PM=""
for c in pnpm yarn npm; do
  if command -v "$c" >/dev/null 2>&1; then PM="$c"; break; fi
done
[ -n "$PM" ] || die "未找到 pnpm/yarn/npm，请先安装其中之一"

# ── 4. Node 依赖（有 lock 走 frozen/CI 模式） ────────────────
cd "$ROOT" || die "无法进入项目根目录"
log "使用 $PM 安装 Node 依赖"
case "$PM" in
  pnpm) if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile >&2 || die "pnpm install --frozen-lockfile 失败";
        else pnpm install >&2 || die "pnpm install 失败"; fi ;;
  yarn) if [ -f yarn.lock ]; then yarn install --frozen-lockfile >&2 || die "yarn install 失败";
        else yarn install >&2 || die "yarn install 失败"; fi ;;
  npm)  if [ -f package-lock.json ]; then npm ci >&2 || die "npm ci 失败";
        else npm install >&2 || die "npm install 失败"; fi ;;
esac

# ── 5. Python 依赖（uv 优先） ────────────────────────────────
if command -v uv >/dev/null 2>&1; then
  uv sync >&2 || die "uv sync 失败"
else
  log "无 uv，回退 venv + pip"
  [ -d .venv ] || python3 -m venv .venv || die "创建 .venv 失败"
  .venv/bin/pip install --quiet playwright readability-lxml markdownify pytest >&2 || die "pip 安装依赖失败"
  warn "无 uv：后续请用 .venv/bin/python 运行 Python 脚本与 pytest"
fi

# ── 6. chromium（只修复缺失，不重复安装） ────────────────────
CHROMIUM_OK=false
NODE_CHROMIUM="$(node -e 'try { console.log(require("playwright").chromium.executablePath()) } catch { process.exit(1) }' 2>/dev/null || true)"
if [ -n "$NODE_CHROMIUM" ] && [ -x "$NODE_CHROMIUM" ]; then
  CHROMIUM_OK=true
else
  log "安装 chromium（Node Playwright）"
  npx playwright install chromium >&2 || die "npx playwright install chromium 失败"
  CHROMIUM_OK=true
fi
# Python 侧 chromium（版本不一致时缓存不同）
PY_BIN="$ROOT/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="$(command -v python3)"
PY_CHROMIUM="$("$PY_BIN" - <<'PY' 2>/dev/null || true
from playwright.sync_api import sync_playwright
try:
    p = sync_playwright().start()
    print(p.chromium.executable_path)
    p.stop()
except Exception:
    raise SystemExit(1)
PY
)"
if [ -z "$PY_CHROMIUM" ] || [ ! -x "$PY_CHROMIUM" ]; then
  "$PY_BIN" -m playwright install chromium >&2 && warn "已为 Python Playwright 安装 chromium" || warn "Python chromium 安装失败（若与 Node 共享缓存则无碍）"
fi

# ── 输出 ─────────────────────────────────────────────────────
printf '{"status":"ok","node":"%s","python":"%s","pm":"%s","chromium":%s}\n' \
  "$NODE_VER" "$PY_VER" "$PM" "$CHROMIUM_OK"
