#!/usr/bin/env bash
set -euo pipefail
MODE=user
if [[ "${1:-}" == "--system" ]]; then MODE=system; elif [[ "${1:-}" == "--user" || -z "${1:-}" ]]; then MODE=user; else echo "usage: $0 [--user|--system]" >&2; exit 2; fi
if [[ "$MODE" == user ]]; then DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"; BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"; else DATA_HOME="/usr/local/share"; BIN_DIR="/usr/local/bin"; fi
rm -f "$DATA_HOME/applications/thunder-capture.desktop" "$BIN_DIR/thunder-capture.sh" "$BIN_DIR/capture-cli.js"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA_HOME/applications" || true
echo "uninstalled Thunder capture desktop integration ($MODE)"
