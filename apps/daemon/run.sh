#!/usr/bin/env bash
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

shopt -s nullglob
native_programs=(/mnt/c/Users/*/AppData/Local/tlei-sdk/Thunder-*/program/thunder.exe)
windows_pythons=(/mnt/c/Users/*/AppData/Local/Programs/Python/Python*/python.exe)
if [ "${#native_programs[@]}" -gt 1 ]; then mapfile -t native_programs < <(printf '%s\n' "${native_programs[@]}" | sort -V); fi
if [ "${#windows_pythons[@]}" -gt 1 ]; then mapfile -t windows_pythons < <(printf '%s\n' "${windows_pythons[@]}" | sort -V); fi
latest_native=""
latest_python=""
if [ "${#native_programs[@]}" -gt 0 ]; then latest_native="${native_programs[$((${#native_programs[@]} - 1))]}"; fi
if [ "${#windows_pythons[@]}" -gt 0 ]; then latest_python="${windows_pythons[$((${#windows_pythons[@]} - 1))]}"; fi

ENGINE_MODE="${THUNDERD_ENGINE_MODE:-}"
if [ -z "$ENGINE_MODE" ]; then
  if [ -n "$latest_native" ] && [ -n "$latest_python" ]; then ENGINE_MODE=windows-native; else ENGINE_MODE=wine; fi
fi
case "$ENGINE_MODE" in
  windows|windows-native) ENGINE_MODE=windows-native ;;
  wine) ;;
  *) echo "THUNDERD_ENGINE_MODE must be wine or windows-native" >&2; exit 1 ;;
esac
export THUNDERD_ENGINE_MODE="$ENGINE_MODE"

if [ "$ENGINE_MODE" = windows-native ]; then
  PROGRAM="${THUNDERD_WINDOWS_PROGRAM_DIR:-${latest_native:+$(dirname "$latest_native")}}"
  WINDOWS_PYTHON="${THUNDERD_WINDOWS_PYTHON:-$latest_python}"
  [ -n "$PROGRAM" ] && [ -d "$PROGRAM" ] || { echo "Windows native Thunder program not found" >&2; exit 1; }
  [ -n "$WINDOWS_PYTHON" ] && [ -f "$WINDOWS_PYTHON" ] || { echo "Windows Python not found" >&2; exit 1; }
  THUNDER_INSTALL_DIR=$(dirname "$PROGRAM")
  THUNDER_SDK_ROOT=$(dirname "$THUNDER_INSTALL_DIR")
  THUNDER_VERSION_DIR=$(basename "$THUNDER_INSTALL_DIR")
  export THUNDERD_WINDOWS_PROGRAM_DIR="$PROGRAM"
  export THUNDERD_WINDOWS_PYTHON="$WINDOWS_PYTHON"
  export THUNDERD_WINDOWS_PROFILE_ROOT="${THUNDERD_WINDOWS_PROFILE_ROOT:-$THUNDER_SDK_ROOT/runtime/thunderd-native}"
  export THUNDERD_WINDOWS_SDK_VERSION="${THUNDERD_WINDOWS_SDK_VERSION:-${THUNDER_VERSION_DIR#Thunder-}}"
  export THUNDERD_WINDOWS_SDK_PLATFORM="${THUNDERD_WINDOWS_SDK_PLATFORM:-0}"
else
  PROGRAM=thunder_x/program
fi

SDK="$PROGRAM/SDK"
[ -d "$PROGRAM" ] || { echo "missing $PROGRAM"; exit 1; }
[ -f "$PROGRAM/thunder.exe" ] || { echo "missing thunder.exe"; exit 1; }
[ -f "$PROGRAM/dk_addon.node" ] || { echo "missing dk_addon.node"; exit 1; }
count=$(find "$SDK" -type f 2>/dev/null | wc -l)
if [ "$ENGINE_MODE" = windows-native ]; then
  [ "$count" -ge 30 ] || { echo "Windows SDK payload incomplete ($count files)"; exit 1; }
else
  [ "$count" -ge 60 ] || { echo "Wine SDK payload incomplete ($count files recursive, expect about 69)"; exit 1; }
  command -v wine >/dev/null || { echo "wine not found"; exit 1; }
fi
for dll in DownloadSDKProxy.dll DownloadSDK.dll XLLiveUDownload.dll; do
  [ -f "$SDK/$dll" ] || { echo "missing core SDK dll: $dll"; exit 1; }
done
command -v node >/dev/null || { echo "node >=22.12.0 not found"; exit 1; }
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 12)) process.exit(1)" || { echo "node ${NODE_VERSION:-$(node --version)} is below V2 baseline 22.12.0"; exit 1; }
command -v sqlite3 >/dev/null || echo "WARN: sqlite3 missing; observation degrades to filesystem-only"
if ! node -e 'require.resolve("better-sqlite3", { paths: [process.cwd() + "/daemon"] })' >/dev/null 2>&1; then
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
export THUNDERD_LEGACY_RPC="${THUNDERD_LEGACY_RPC:-0}"
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "thunderd prerequisites ok: engine=$ENGINE_MODE sdk_files=$count"
  exit 0
fi
# 保留在线实例；同一 runtime 已有进程时直接拒绝启动。
RUNTIME_DIR="${THUNDERD_RUNTIME_DIR:-daemon/.runtime}"
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
if [ "$ENGINE_MODE" = windows-native ]; then mkdir -p "$THUNDERD_WINDOWS_PROFILE_ROOT"; fi
if [ "$CORE_ONLY" -eq 1 ]; then
  exec node apps/daemon/host/src/entry.mjs --profile thunderd-core
fi
# 同一 launcher 选择全量 profile；Web API 仍由独立子进程运行。
exec node apps/daemon/host/src/entry.mjs --profile thunderd
