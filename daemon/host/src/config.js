'use strict';

const os = require('os');
const path = require('path');

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function resolveRoot(value, fallback) { return path.resolve(value || fallback); }

function engineMode(value) {
  const normalized = String(value || 'wine').trim().toLowerCase();
  if (normalized === 'windows' || normalized === 'windows-native') return 'windows-native';
  if (normalized === 'wine') return 'wine';
  throw new Error('THUNDERD_ENGINE_MODE must be wine or windows-native');
}

function versionCodeFromName(value, fallback = 2500821562) {
  const match = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/);
  if (!match) return fallback;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)) || parts[0] > 99 || parts[1] > 99 || parts[2] > 99 || parts[3] > 9999) return fallback;
  return Number(`${String(parts[0]).padStart(2, '0')}${String(parts[1]).padStart(2, '0')}${String(parts[2]).padStart(2, '0')}${String(parts[3]).padStart(4, '0')}`);
}

function versionNameFromProgramDir(value, fallback = '') {
  const normalized = String(value || '').replace(/[\\/]+$/, '');
  const match = normalized.match(/[\\/]Thunder-(\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,4})[\\/]program$/i);
  return match ? match[1] : fallback;
}

function parseListenAddress(value, fallback = { host: '127.0.0.1', port: 0 }) {
  const input = String(value || '').trim();
  if (!input) return { ...fallback };
  let host = ''; let portText = '';
  if (input.startsWith('[')) {
    const close = input.indexOf(']');
    if (close < 0 || input[close + 1] !== ':') return null;
    host = input.slice(1, close); portText = input.slice(close + 2);
  } else {
    const index = input.lastIndexOf(':');
    if (index <= 0) return null;
    host = input.slice(0, index); portText = input.slice(index + 1);
  }
  const port = Number(portText);
  if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function assertSafeWritableRoot(candidate, home, label) {
  const resolved = path.resolve(candidate);
  const root = path.parse(resolved).root;
  const homeResolved = path.resolve(home);
  if (!candidate || resolved === root || resolved === homeResolved) {
    const error = new Error(`${label} must not be filesystem root or home directory`);
    error.code = 'UNSAFE_PATH';
    throw error;
  }
  return resolved;
}

function loadConfig({ env = {}, repoRoot = path.resolve(__dirname, '..', '..', '..'), homeDir = env.HOME || os.homedir() } = {}) {
  const runtimeDir = assertSafeWritableRoot(resolveRoot(env.THUNDERD_RUNTIME_DIR, path.join(repoRoot, 'daemon', '.runtime')), homeDir, 'runtime directory');
  const downloadDir = assertSafeWritableRoot(resolveRoot(env.THUNDERD_DOWNLOAD_DIR, path.join(repoRoot, 'downloads')), homeDir, 'download directory');
  const selectedEngineMode = engineMode(env.THUNDERD_ENGINE_MODE);
  const windowsProfileRoot = assertSafeWritableRoot(resolveRoot(env.THUNDERD_WINDOWS_PROFILE_ROOT, path.join(runtimeDir, 'windows-native')), homeDir, 'Windows engine profile directory');
  const windowsProgramDir = env.THUNDERD_WINDOWS_PROGRAM_DIR ? path.resolve(env.THUNDERD_WINDOWS_PROGRAM_DIR) : '';
  const windowsSdkVersionName = env.THUNDERD_WINDOWS_SDK_VERSION || versionNameFromProgramDir(windowsProgramDir, '25.0.82.1562');
  const config = {
    repoRoot: path.resolve(repoRoot),
    runtimeDir,
    runtimeDataDir: path.join(runtimeDir, 'data'),
    runtimeSecretsDir: path.join(runtimeDir, 'secrets'),
    tasksPath: path.join(runtimeDir, 'data', 'tasks.json'),
    legacyRegistryPath: path.join(runtimeDir, 'registry.json'),
    settingsPath: path.join(runtimeDir, 'data', 'download-settings.json'),
    draftsPath: path.join(runtimeDir, 'data', 'create-drafts.json'),
    recentPathsPath: path.join(runtimeDir, 'data', 'recent-paths.json'),
    operationsPath: path.join(runtimeDir, 'data', 'task-operations.json'),
    schedulesPath: path.join(runtimeDir, 'data', 'download-schedules.json'),
    proxySecretsPath: path.join(runtimeDir, 'secrets', 'proxy.json'),
    ftpSecretsPath: path.join(runtimeDir, 'secrets', 'ftp.json'),
    privateSpaceSecretsPath: path.join(runtimeDir, 'secrets', 'private-space.json'),
    mediaSecretPath: path.join(runtimeDir, 'secrets', 'media-hmac.key'),
    captureSecretsPath: path.join(runtimeDir, 'secrets', 'capture.json'),
    captureClientConfigPath: path.resolve(env.THUNDERD_CAPTURE_CLIENT_CONFIG || path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'thunder', 'capture.json')),
    remoteNodesPath: path.join(runtimeDir, 'data', 'remote-nodes.json'),
    remoteClientsPath: path.join(runtimeDir, 'secrets', 'remote-clients.json'),
    remoteSecretsDir: path.join(runtimeDir, 'secrets', 'remote'),
    privateSpaceDir: path.join(downloadDir, '.private'),
    dataDbPath: path.join(runtimeDir, 'data', 'thunder-data.db'),
    seedsDir: path.join(runtimeDir, 'seeds'),
    uploadsDir: path.join(runtimeDir, 'uploads'),
    controlSocketPath: path.resolve(env.THUNDERD_CONTROL_SOCKET || path.join(runtimeDir, 'thunderd-control.sock')),
    downloadDir,
    profileDir: path.join(runtimeDir, 'profile'),
    winePrefix: path.resolve(env.WINEPREFIX || path.join(homeDir, '.wine-thunder')),
    engineMode: selectedEngineMode,
    windowsProgramDir,
    windowsProfileRoot,
    windowsEngineMirrorDir: path.join(windowsProfileRoot, 'engine'),
    windowsPythonExe: env.THUNDERD_WINDOWS_PYTHON ? path.resolve(env.THUNDERD_WINDOWS_PYTHON) : '',
    windowsSdkVersionName,
    windowsSdkVersionCode: positiveInt(env.THUNDERD_WINDOWS_SDK_VERSION_CODE, versionCodeFromName(windowsSdkVersionName), { min: 1 }),
    windowsSdkPlatform: String(env.THUNDERD_WINDOWS_SDK_PLATFORM ?? (selectedEngineMode === 'windows-native' ? '0' : '64')),
    windowsSdkGuid: String(env.THUNDERD_WINDOWS_SDK_GUID || ''),
    wslDistroName: String(env.WSL_DISTRO_NAME || 'Ubuntu'),
    port: positiveInt(env.THUNDERD_PORT, 16800, { min: 1, max: 65535 }),
    host: env.THUNDERD_HOST || '127.0.0.1',
    rpcSecret: typeof env.THUNDERD_RPC_SECRET === 'string' ? env.THUNDERD_RPC_SECRET : '',
    maxBodyBytes: positiveInt(env.THUNDERD_MAX_BODY_BYTES, 8 * 1024 * 1024, { min: 1024, max: 64 * 1024 * 1024 }),
    maxTorrentUploadBytes: positiveInt(env.THUNDERD_MAX_TORRENT_UPLOAD_BYTES, 20 * 1024 * 1024, { min: 1024, max: 100 * 1024 * 1024 }),
    maxCaptureBodyBytes: positiveInt(env.THUNDERD_MAX_CAPTURE_BODY_BYTES, 1024 * 1024, { min: 1024, max: 4 * 1024 * 1024 }),
    magnetTimeoutSec: positiveInt(env.THUNDERD_MAGNET_TIMEOUT_SEC, 120, { min: 30, max: 600 }),
    version: env.THUNDERD_VERSION || '0.4.0',
    vipEnabled: bool(env.THUNDERD_VIP_ENABLED, true),
    allowPowerActions: bool(env.THUNDERD_ALLOW_POWER_ACTIONS, false),
    csrfEnabled: bool(env.THUNDERD_CSRF, true),
    legacyRpcEnabled: bool(env.THUNDERD_LEGACY_RPC, false),
    webUiDir: path.resolve(env.THUNDERD_WEBUI_DIR || path.join(repoRoot, 'webui', 'dist')),
  };
  return freezeDeep(config);
}

module.exports = { loadConfig, freezeDeep, assertSafeWritableRoot, positiveInt, parseListenAddress, engineMode,
  versionCodeFromName, versionNameFromProgramDir };
