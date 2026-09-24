#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MODE=user
if [[ "${1:-}" == "--system" ]]; then MODE=system; elif [[ "${1:-}" == "--user" || -z "${1:-}" ]]; then MODE=user; else echo "usage: $0 [--user|--system]" >&2; exit 2; fi
if [[ "$MODE" == user ]]; then DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"; BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"; else DATA_HOME="/usr/local/share"; BIN_DIR="/usr/local/bin"; fi
APP_DIR="$DATA_HOME/applications"; mkdir -p "$APP_DIR" "$BIN_DIR"
install -m 0755 "$SCRIPT_DIR/thunder-capture.sh" "$BIN_DIR/thunder-capture.sh"
install -m 0755 "$SCRIPT_DIR/capture-cli.js" "$BIN_DIR/capture-cli.js"
INSTALL_DIR="$BIN_DIR" sed "s|@INSTALL_DIR@|$(printf '%s' "$BIN_DIR" | sed 's/[&|]/\\&/g')|g" "$SCRIPT_DIR/thunder-capture.desktop.in" > "$APP_DIR/thunder-capture.desktop"
chmod 0644 "$APP_DIR/thunder-capture.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" || true
command -v xdg-mime >/dev/null 2>&1 && { xdg-mime default thunder-capture.desktop application/x-bittorrent || true; xdg-mime default thunder-capture.desktop x-scheme-handler/magnet || true; xdg-mime default thunder-capture.desktop x-scheme-handler/ed2k || true; xdg-mime default thunder-capture.desktop x-scheme-handler/thunder || true; } || true
echo "installed Thunder capture desktop integration ($MODE)"
