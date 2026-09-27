'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');

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

// 两态引擎模式：wine（Linux 宿主经 Wine）/ native（Windows 宿主直跑）。
// auto 由平台解析（win32 → native，其余 → wine），loadConfig 内定型后运行时不再出现 auto。
function engineMode(value, platform = process.platform) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (normalized === 'auto') return platform === 'win32' ? 'native' : 'wine';
  if (normalized === 'wine') return 'wine';
  if (normalized === 'native' || normalized === 'windows') return 'native';
  throw new Error('THUNDERD_ENGINE_MODE must be wine, native or auto');
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

// THUNDERD_CONFIG 白名单：文件只允许承载非 secret 的常规配置（环境变量名 → 当前读取点全集）。
const CONFIG_FILE_KEYS = new Set([
  'THUNDERD_PORT', 'THUNDERD_HOST', 'THUNDERD_ENGINE_MODE', 'THUNDERD_PROGRAM_DIR',
  'THUNDERD_RUNTIME_DIR', 'THUNDERD_DOWNLOAD_DIR', 'THUNDERD_CONTROL_SOCKET',
  'THUNDERD_MAX_BODY_BYTES', 'THUNDERD_MAX_TORRENT_UPLOAD_BYTES', 'THUNDERD_MAX_CAPTURE_BODY_BYTES',
  'THUNDERD_MAGNET_TIMEOUT_SEC', 'THUNDERD_VERSION', 'THUNDERD_VIP_ENABLED',
  'THUNDERD_ALLOW_POWER_ACTIONS', 'THUNDERD_CSRF', 'THUNDERD_LEGACY_RPC', 'THUNDERD_WEBUI_DIR',
  'THUNDERD_SDK_VERSION_NAME', 'THUNDERD_SDK_VERSION_CODE', 'THUNDERD_SDK_PLATFORM',
  'WINEPREFIX', 'THUNDERD_CAPTURE_CLIENT_CONFIG',
]);
// secret 类键永不入文件：RPC secret / CSRF token / 凭据只能走环境变量。
const CONFIG_FILE_FORBIDDEN = /(?:SECRET|TOKEN|PASSWORD|PASSKEY|SESSION|CREDENTIAL|AUTH)/i;

function mergeConfigFile({ env, configPath, readFileImpl }) {
  if (!configPath) return env;
  const text = readFileImpl(path.resolve(configPath), 'utf8');
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`THUNDERD_CONFIG is not valid JSON: ${e.message}`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('THUNDERD_CONFIG must contain a JSON object');
  }
  const merged = { ...env };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`THUNDERD_CONFIG: ${key} must be a string, number or boolean`);
    }
    if (CONFIG_FILE_FORBIDDEN.test(key)) {
      throw new Error(`THUNDERD_CONFIG: secret key ${key} is not allowed in the config file`);
    }
    if (!CONFIG_FILE_KEYS.has(key)) {
      throw new Error(`THUNDERD_CONFIG: unknown key ${key}`);
    }
    // 环境变量 > 文件 > 默认：文件只补未由环境变量提供的键。
    if (merged[key] === undefined || merged[key] === '') merged[key] = String(value);
  }
  return merged;
}

function loadConfig({
  env = {}, repoRoot = path.resolve(__dirname, '..', '..', '..'), homeDir = env.HOME || env.USERPROFILE || os.homedir(),
  platform = process.platform, readFileImpl, configPath = env.THUNDERD_CONFIG || '',
} = {}) {
  const mergedEnv = mergeConfigFile({ env, configPath, readFileImpl: readFileImpl || ((file, encoding) => require('fs').readFileSync(file, encoding)) });
  const runtimeDir = assertSafeWritableRoot(resolveRoot(mergedEnv.THUNDERD_RUNTIME_DIR, path.join(repoRoot, 'apps', 'daemon', '.runtime')), homeDir, 'runtime directory');
  const downloadDir = assertSafeWritableRoot(resolveRoot(mergedEnv.THUNDERD_DOWNLOAD_DIR, path.join(repoRoot, 'downloads')), homeDir, 'download directory');
  const selectedEngineMode = engineMode(mergedEnv.THUNDERD_ENGINE_MODE, platform);
  const programDir = mergedEnv.THUNDERD_PROGRAM_DIR ? path.resolve(mergedEnv.THUNDERD_PROGRAM_DIR) : '';
  const sdkVersionName = mergedEnv.THUNDERD_SDK_VERSION_NAME || versionNameFromProgramDir(programDir, '25.0.82.1562');
  const isWindows = platform === 'win32';
  // control socket：Linux 用 UDS；Windows 用 named pipe（net 模块对 \\.\pipe\ 前缀天然按管道处理）。
  // 管道名含 runtimeDir 哈希，隔离多实例且避免路径长度限制。
  const controlSocketPath = mergedEnv.THUNDERD_CONTROL_SOCKET || (isWindows
    ? `\\\\.\\pipe\\thunderd-control-${crypto.createHash('sha256').update(runtimeDir).digest('hex').slice(0, 8)}`
    : path.resolve(path.join(runtimeDir, 'thunderd-control.sock')));
  // xlconfig（设备 ID 来源）：wine 走 prefix 的 Public 用户；native 走 %PUBLIC%。
  const winePrefix = path.resolve(mergedEnv.WINEPREFIX || path.join(homeDir, '.wine-thunder'));
  const xlconfigPath = isWindows
    ? path.join(mergedEnv.PUBLIC || path.join(path.dirname(path.dirname(homeDir)), 'Public'), 'Thunder Network', 'Thunder', 'xlconfig.ini')
    : path.join(winePrefix, 'drive_c', 'users', 'Public', 'Thunder Network', 'Thunder', 'xlconfig.ini');
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
    captureClientConfigPath: path.resolve(mergedEnv.THUNDERD_CAPTURE_CLIENT_CONFIG || path.join(mergedEnv.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'thunder', 'capture.json')),
    remoteNodesPath: path.join(runtimeDir, 'data', 'remote-nodes.json'),
    remoteClientsPath: path.join(runtimeDir, 'secrets', 'remote-clients.json'),
    remoteSecretsDir: path.join(runtimeDir, 'secrets', 'remote'),
    privateSpaceDir: path.join(downloadDir, '.private'),
    dataDbPath: path.join(runtimeDir, 'data', 'thunder-data.db'),
    seedsDir: path.join(runtimeDir, 'seeds'),
    uploadsDir: path.join(runtimeDir, 'uploads'),
    controlSocketPath,
    downloadDir,
    profileDir: path.join(runtimeDir, 'profile'),
    winePrefix,
    xlconfigPath,
    engineMode: selectedEngineMode,
    programDir,
    sdkVersionName,
    sdkVersionCode: positiveInt(mergedEnv.THUNDERD_SDK_VERSION_CODE, versionCodeFromName(sdkVersionName), { min: 1 }),
    sdkPlatform: String(mergedEnv.THUNDERD_SDK_PLATFORM ?? (selectedEngineMode === 'native' ? '0' : '64')),
    port: positiveInt(mergedEnv.THUNDERD_PORT, 16800, { min: 1, max: 65535 }),
    host: mergedEnv.THUNDERD_HOST || '127.0.0.1',
    rpcSecret: typeof mergedEnv.THUNDERD_RPC_SECRET === 'string' ? mergedEnv.THUNDERD_RPC_SECRET : '',
    maxBodyBytes: positiveInt(mergedEnv.THUNDERD_MAX_BODY_BYTES, 8 * 1024 * 1024, { min: 1024, max: 64 * 1024 * 1024 }),
    maxTorrentUploadBytes: positiveInt(mergedEnv.THUNDERD_MAX_TORRENT_UPLOAD_BYTES, 20 * 1024 * 1024, { min: 1024, max: 100 * 1024 * 1024 }),
    maxCaptureBodyBytes: positiveInt(mergedEnv.THUNDERD_MAX_CAPTURE_BODY_BYTES, 1024 * 1024, { min: 1024, max: 4 * 1024 * 1024 }),
    magnetTimeoutSec: positiveInt(mergedEnv.THUNDERD_MAGNET_TIMEOUT_SEC, 120, { min: 30, max: 600 }),
    version: mergedEnv.THUNDERD_VERSION || '0.4.0',
    vipEnabled: bool(mergedEnv.THUNDERD_VIP_ENABLED, true),
    allowPowerActions: bool(mergedEnv.THUNDERD_ALLOW_POWER_ACTIONS, false),
    csrfEnabled: bool(mergedEnv.THUNDERD_CSRF, true),
    legacyRpcEnabled: bool(mergedEnv.THUNDERD_LEGACY_RPC, false),
    webUiDir: path.resolve(mergedEnv.THUNDERD_WEBUI_DIR || path.join(repoRoot, 'apps', 'webui', 'dist')),
  };
  return freezeDeep(config);
}

module.exports = { loadConfig, freezeDeep, assertSafeWritableRoot, positiveInt, parseListenAddress, engineMode,
  versionCodeFromName, versionNameFromProgramDir, mergeConfigFile, CONFIG_FILE_KEYS };

