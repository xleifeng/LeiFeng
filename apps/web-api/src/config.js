'use strict';

const os = require('node:os');
const path = require('node:path');
const { controlSocketPath } = require('@leifeng/daemon-client');

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function parseListenAddress(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  let host; let portText;
  if (input.startsWith('[')) {
    const close = input.indexOf(']');
    if (close < 0 || input[close + 1] !== ':') return null;
    host = input.slice(1, close); portText = input.slice(close + 2);
  } else {
    const split = input.lastIndexOf(':');
    if (split <= 0) return null;
    host = input.slice(0, split); portText = input.slice(split + 1);
  }
  const port = Number(portText);
  return host && Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? { host, port } : null;
}

function loadWebApiConfig({ env = process.env, repoRoot = path.resolve(__dirname, '..', '..', '..'), homeDir = env.HOME || os.homedir() } = {}) {
  const runtimeDir = path.resolve(env.THUNDERD_RUNTIME_DIR || path.join(repoRoot, 'apps', 'daemon', '.runtime'));
  if (runtimeDir === path.parse(runtimeDir).root || runtimeDir === path.resolve(homeDir)) throw Object.assign(new Error('runtime directory must not be filesystem root or home directory'), { code: 'UNSAFE_PATH' });
  const host = env.THUNDERD_HOST || '127.0.0.1';
  const port = positiveInt(env.THUNDERD_PORT, 16800, { min: 1, max: 65535 });
  return Object.freeze({
    repoRoot: path.resolve(repoRoot), runtimeDir, uploadsDir: path.join(runtimeDir, 'uploads'),
    controlSocketPath: controlSocketPath({ runtimeDir, explicitPath: env.THUNDERD_CONTROL_SOCKET }),
    host, port, rpcSecret: typeof env.THUNDERD_RPC_SECRET === 'string' ? env.THUNDERD_RPC_SECRET : '',
    maxBodyBytes: positiveInt(env.THUNDERD_MAX_BODY_BYTES, 8 * 1024 * 1024, { min: 1024, max: 64 * 1024 * 1024 }),
    maxTorrentUploadBytes: positiveInt(env.THUNDERD_MAX_TORRENT_UPLOAD_BYTES, 20 * 1024 * 1024, { min: 1024, max: 100 * 1024 * 1024 }),
    webUiDir: path.resolve(env.THUNDERD_WEBUI_DIR || path.join(repoRoot, 'apps', 'webui', 'dist')),
    frontendPluginsDir: path.resolve(env.THUNDERD_FRONTEND_PLUGINS_DIR || path.join(repoRoot, 'plugins-frontend')),
  });
}

module.exports = { loadWebApiConfig, positiveInt, parseListenAddress };
