'use strict';

const PROXY_MODES = Object.freeze(['direct', 'http', 'socks5']);
const COMPLETION_ACTIONS = Object.freeze(['none', 'pause-all', 'stop-engine', 'suspend', 'poweroff']);

const DEFAULT_DOWNLOAD_POLICY = Object.freeze({
  schemaVersion: 1,
  defaultDownloadPath: '',
  maxConcurrentTasks: 5,
  globalDownloadLimit: null,
  globalUploadLimit: null,
  globalConnectionLimit: null,
  autoResumeUnfinished: true,
  autoMoveSlowTaskToTail: false,
  slowTaskThresholdBytesPerSecond: 16 * 1024,
  p2pEnabled: true,
  p2sEnabled: true,
  proxy: { mode: 'direct', host: '', port: null, username: '', passwordRef: null },
  idleDownload: { enabled: false, idleAfterSeconds: 900, pauseOnActivity: true },
  completionAction: 'none',
  openOnCompleteDefault: false,
  scheduleIds: [],
  updatedAt: 0,
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function boundedInt(value, fallback, min, max) { return Math.min(max, Math.max(min, Math.trunc(finite(value, fallback)))); }
function nullableLimit(value, fallback = null, max = 1024 * 1024 * 1024) {
  if (value === null || value === undefined || value === '' || Number(value) < 0) return value === null || value === undefined || value === '' ? fallback : null;
  return boundedInt(value, fallback === null ? 0 : fallback, 0, max);
}

function normalizePolicy(input = {}, fallback = DEFAULT_DOWNLOAD_POLICY) {
  const base = { ...clone(DEFAULT_DOWNLOAD_POLICY), ...clone(fallback || {}) };
  const source = input && typeof input === 'object' ? input : {};
  const proxy = { ...base.proxy, ...(source.proxy && typeof source.proxy === 'object' ? source.proxy : {}) };
  const idle = { ...base.idleDownload, ...(source.idleDownload && typeof source.idleDownload === 'object' ? source.idleDownload : {}) };
  const mode = PROXY_MODES.includes(String(proxy.mode)) ? String(proxy.mode) : 'direct';
  const completionAction = COMPLETION_ACTIONS.includes(String(source.completionAction)) ? String(source.completionAction) : 'none';
  return {
    schemaVersion: 1,
    defaultDownloadPath: typeof source.defaultDownloadPath === 'string' ? source.defaultDownloadPath : String(base.defaultDownloadPath || ''),
    maxConcurrentTasks: boundedInt(source.maxConcurrentTasks, base.maxConcurrentTasks, 1, 100),
    globalDownloadLimit: nullableLimit(source.globalDownloadLimit, base.globalDownloadLimit),
    globalUploadLimit: nullableLimit(source.globalUploadLimit, base.globalUploadLimit),
    globalConnectionLimit: source.globalConnectionLimit === null || source.globalConnectionLimit === undefined ? base.globalConnectionLimit : boundedInt(source.globalConnectionLimit, 100, 1, 10000),
    autoResumeUnfinished: source.autoResumeUnfinished === undefined ? !!base.autoResumeUnfinished : source.autoResumeUnfinished === true,
    autoMoveSlowTaskToTail: source.autoMoveSlowTaskToTail === undefined ? !!base.autoMoveSlowTaskToTail : source.autoMoveSlowTaskToTail === true,
    slowTaskThresholdBytesPerSecond: boundedInt(source.slowTaskThresholdBytesPerSecond, base.slowTaskThresholdBytesPerSecond, 0, 1024 * 1024 * 1024),
    p2pEnabled: source.p2pEnabled === undefined ? !!base.p2pEnabled : source.p2pEnabled === true,
    p2sEnabled: source.p2sEnabled === undefined ? !!base.p2sEnabled : source.p2sEnabled === true,
    proxy: {
      mode,
      host: typeof proxy.host === 'string' ? proxy.host.trim() : '',
      port: proxy.port === null || proxy.port === undefined || proxy.port === '' ? null : boundedInt(proxy.port, 0, 1, 65535),
      username: typeof proxy.username === 'string' ? proxy.username : '',
      passwordRef: typeof proxy.passwordRef === 'string' && proxy.passwordRef ? proxy.passwordRef : null,
    },
    idleDownload: {
      enabled: idle.enabled === true,
      idleAfterSeconds: boundedInt(idle.idleAfterSeconds, base.idleDownload.idleAfterSeconds, 60, 24 * 60 * 60),
      pauseOnActivity: idle.pauseOnActivity !== false,
    },
    completionAction,
    openOnCompleteDefault: source.openOnCompleteDefault === true,
    scheduleIds: Array.isArray(source.scheduleIds) ? [...new Set(source.scheduleIds.map(String).filter(Boolean))].slice(0, 100) : clone(base.scheduleIds || []),
    updatedAt: Math.max(0, Math.trunc(finite(source.updatedAt, base.updatedAt || 0))),
  };
}

function validatePolicy(policy) {
  const value = normalizePolicy(policy);
  const problems = [];
  if (value.proxy.mode !== 'direct' && !value.proxy.host) problems.push({ path: ['proxy', 'host'], code: 'required', message: '代理地址不能为空' });
  if (value.proxy.mode !== 'direct' && !value.proxy.port) problems.push({ path: ['proxy', 'port'], code: 'required', message: '代理端口不能为空' });
  if (value.proxy.host.length > 253) problems.push({ path: ['proxy', 'host'], code: 'too_big', message: '代理地址过长' });
  if (problems.length) { const error = new Error('下载策略校验失败'); error.code = 'INVALID_POLICY'; error.details = { problems }; throw error; }
  return value;
}

function policyFromLegacy(desired = {}, fallback = DEFAULT_DOWNLOAD_POLICY) {
  return normalizePolicy({
    ...desired,
    defaultDownloadPath: desired.defaultDownloadPath || desired.downloadDir,
    maxConcurrentTasks: desired.maxConcurrentTasks || desired.maxTasks,
    globalDownloadLimit: desired.globalDownloadLimit === undefined ? (desired.downloadLimit >= 0 ? desired.downloadLimit : null) : desired.globalDownloadLimit,
    globalUploadLimit: desired.globalUploadLimit === undefined ? (desired.uploadLimit >= 0 ? desired.uploadLimit : null) : desired.globalUploadLimit,
    globalConnectionLimit: desired.globalConnectionLimit === undefined ? (desired.connectionLimit >= 0 ? desired.connectionLimit : null) : desired.globalConnectionLimit,
  }, fallback);
}

function legacyFromPolicy(policy, fallback = {}) {
  const value = normalizePolicy(policy);
  return {
    ...fallback,
    downloadLimit: value.globalDownloadLimit === null ? -1 : value.globalDownloadLimit,
    uploadLimit: value.globalUploadLimit === null ? -1 : value.globalUploadLimit,
    connectionLimit: value.globalConnectionLimit === null ? -1 : value.globalConnectionLimit,
    maxTasks: value.maxConcurrentTasks,
    downloadDir: value.defaultDownloadPath,
  };
}

module.exports = { PROXY_MODES, COMPLETION_ACTIONS, DEFAULT_DOWNLOAD_POLICY, normalizePolicy, validatePolicy, policyFromLegacy, legacyFromPolicy };
