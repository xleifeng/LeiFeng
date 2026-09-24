#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --systemd) ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "usage: $0 [--systemd] [--check]" >&2; exit 2 ;;
  esac
  shift
done

command -v node >/dev/null || { echo "node >=22.12.0 not found" >&2; exit 1; }
node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 12)) process.exit(1)" || { echo "node $(node --version) is below the supported baseline 22.12.0" >&2; exit 1; }
if [ -f webui/package.json ] && { [ ! -f webui/dist/index.html ] || find webui/src webui/index.html -type f -newer webui/dist/index.html -print -quit 2>/dev/null | grep -q .; }; then
  if [ -d webui/node_modules ] && command -v npm >/dev/null; then npm --prefix webui run build; else echo "WARN: WebUI is not built; run npm --prefix webui ci && npm --prefix webui run build" >&2; fi
fi
if [ "$CHECK_ONLY" -eq 1 ]; then echo "thunder-web-api prerequisites ok"; exit 0; fi
exec node web-api/src/main.js
