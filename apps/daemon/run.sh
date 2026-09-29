#!/usr/bin/env bash
# Linux 启动脚本：Wine 预检 + profile launcher 转发。Windows 原生运行不经此脚本，
# 直接 `node apps\daemon\host\src\entry.mjs --profile thunderd`（见 README）。
set -euo pipefail
cd "$(dirname "$0")/../.."
CHECK_ONLY=0
CORE_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --systemd) ;;
    --check) CHECK_ONLY=1 ;;
    --core-only) CORE_ONLY=1 ;;
    *) echo "usage: $0 [--systemd] [--check] [--core-only]" >&2; exit 2 ;;
  esac
  shift
done

PROGRAM="${THUNDERD_PROGRAM_DIR:-thunder_x/program}"
SDK="$PROGRAM/SDK"
[ -d "$PROGRAM" ] || { echo "missing $PROGRAM" >&2; exit 1; }
[ -f "$PROGRAM/thunder.exe" ] || { echo "missing thunder.exe" >&2; exit 1; }
[ -f "$PROGRAM/dk_addon.node" ] || { echo "missing dk_addon.node" >&2; exit 1; }
count=$(find "$SDK" -type f 2>/dev/null | wc -l)
[ "$count" -ge 60 ] || { echo "Wine SDK payload incomplete ($count files recursive, expect about 69)" >&2; exit 1; }
for dll in DownloadSDKProxy.dll DownloadSDK.dll XLLiveUDownload.dll; do
  [ -f "$SDK/$dll" ] || { echo "missing core SDK dll: $dll" >&2; exit 1; }
done
command -v wine >/dev/null || { echo "wine not found" >&2; exit 1; }
command -v node >/dev/null || { echo "node >=22.12.0 not found" >&2; exit 1; }
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 12)) process.exit(1)" || { echo "node ${NODE_VERSION:-$(node --version)} is below V2 baseline 22.12.0" >&2; exit 1; }
command -v sqlite3 >/dev/null || echo "WARN: sqlite3 missing; observation degrades to filesystem-only"
if ! node -e 'require.resolve("better-sqlite3", { paths: [process.cwd() + "/apps/daemon"] })' >/dev/null 2>&1; then
  echo "missing daemon SQLite dependency; run: npm ci at repository root" >&2
  exit 1
fi
if [ "$CORE_ONLY" -eq 0 ] && [ -f apps/webui/package.json ]; then
  if [ ! -f apps/webui/dist/index.html ] || find apps/webui/src apps/webui/index.html -type f -newer apps/webui/dist/index.html -print -quit 2>/dev/null | grep -q .; then
    if [ -d apps/webui/node_modules ] && command -v npm >/dev/null; then
      echo "building Thunder WebUI"
      npm --prefix apps/webui run build
    else
      echo "WARN: WebUI is not built; run: npm --prefix apps/webui install && npm --prefix apps/webui run build"
    fi
  fi
fi
export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-thunder}"
export THUNDERD_ENGINE_MODE="${THUNDERD_ENGINE_MODE:-wine}"
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "thunderd prerequisites ok: engine=wine sdk_files=$count"
  exit 0
fi
# 保留在线实例；同一 runtime 已有进程时直接拒绝启动。
RUNTIME_DIR="${THUNDERD_RUNTIME_DIR:-apps/daemon/.runtime}"
DOWNLOAD_DIR="${THUNDERD_DOWNLOAD_DIR:-downloads}"
LOCK="$RUNTIME_DIR/thunderd.lock"
if [ -f "$LOCK" ]; then
  OLD=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "thunderd already running for $RUNTIME_DIR (pid $OLD)" >&2
    exit 1
  fi
fi
mkdir -p "$RUNTIME_DIR" "$DOWNLOAD_DIR"
if [ "$CORE_ONLY" -eq 1 ]; then
  exec node apps/daemon/host/src/entry.mjs --profile thunderd-core
fi
# 同一 launcher 选择全量 profile；Web API 仍由独立子进程运行。
exec node apps/daemon/host/src/entry.mjs --profile thunderd
