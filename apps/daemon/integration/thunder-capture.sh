#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [[ "$#" -ne 2 || "$1" != "--source-uri" ]]; then
  echo "usage: thunder-capture.sh --source-uri <uri>" >&2
  exit 2
fi
exec node "$SCRIPT_DIR/capture-cli.js" --source-uri "$2"
