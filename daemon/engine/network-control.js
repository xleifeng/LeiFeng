'use strict';

function capabilityState(capabilities, name) {
  const flat = capabilities && capabilities.flat;
  if (!flat || !Object.prototype.hasOwnProperty.call(flat, name)) return 'present';
  return flat[name];
}

function requireCapability(capabilities, name) {
  const state = capabilityState(capabilities, name);
  if (state === 'present' || state === 'verified' || state === true) return;
  const error = new Error(`native capability unavailable: ${name}`);
  error.code = 'NATIVE_CAPABILITY_UNAVAILABLE';
  error.details = { capability: name, state };
  throw error;
}

function nonNegative(value, name, { nullable = true, max = 1024 * 1024 * 1024 } = {}) {
  if (value === null || value === undefined) { if (nullable) return null; throw new Error(`${name} is required`); }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) { const error = new Error(`${name} must be a non-negative integer`); error.code = 'INVALID_ARGUMENT'; throw error; }
  return n;
}

function proxyInput(value = {}) {
  const mode = ['direct', 'http', 'socks5'].includes(String(value.mode)) ? String(value.mode) : null;
  if (!mode) { const error = new Error('proxy mode is invalid'); error.code = 'INVALID_ARGUMENT'; throw error; }
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const port = value.port === null || value.port === undefined || value.port === '' ? null : Number(value.port);
  if (mode !== 'direct' && (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535)) { const error = new Error('proxy host/port is invalid'); error.code = 'INVALID_ARGUMENT'; throw error; }
  return { mode, host, port, username: typeof value.username === 'string' ? value.username : '', password: typeof value.password === 'string' ? value.password : '' };
}

function createNetworkControlHandlers({ tm, NativeDkHelper = null, capabilities, runtime = {} } = {}) {
  if (!tm) throw new Error('network control requires NativeTaskManager');
  const cache = { globalDownloadLimit: null, globalUploadLimit: null, globalConnectionLimit: null, maxTasks: null, p2p: null, p2s: null, proxy: { mode: 'direct', host: '', port: null }, autoMoveLowSpeed: null, updatedAt: 0 };
  Object.assign(cache, runtime || {});
  const call = (name, args, capability) => { if (capability) requireCapability(capabilities, capability); if (typeof tm[name] !== 'function') { const error = new Error(`native method unavailable: ${name}`); error.code = 'NATIVE_CAPABILITY_UNAVAILABLE'; throw error; } return tm[name](...args); };
  const setGlobalLimits = ({ downloadLimit = null, uploadLimit = null, connectionLimit = null, maxTasks = null } = {}) => {
    const values = { downloadLimit: nonNegative(downloadLimit, 'downloadLimit'), uploadLimit: nonNegative(uploadLimit, 'uploadLimit'), connectionLimit: connectionLimit === null || connectionLimit === undefined ? null : nonNegative(connectionLimit, 'connectionLimit', { nullable: false, max: 10000 }), maxTasks: maxTasks === null || maxTasks === undefined ? null : nonNegative(maxTasks, 'maxTasks', { nullable: false, max: 100 }) };
    const failures = [];
    const setters = [
      ['globalDownloadLimit', 'updateDownloadSpeedLimit', values.downloadLimit, 'network.globalRateLimit'],
      ['globalUploadLimit', 'updateUploadSpeedLimit', values.uploadLimit, null],
      ['globalConnectionLimit', 'setGlobalConnectionLimit', values.connectionLimit, null],
      ['maxTasks', 'updateMaxDownloadTaskCount', values.maxTasks, null],
    ];
    for (const [key, method, value, capability] of setters) {
      if (value === null || typeof tm[method] !== 'function') { if (value !== null && typeof tm[method] !== 'function') failures.push({ field: key, code: 'NATIVE_CAPABILITY_UNAVAILABLE' }); continue; }
      try { call(method, [value], capability); cache[key] = value; } catch (error) { failures.push({ field: key, code: error.code || 'NATIVE_APPLY_FAILED', message: String(error.message || error).slice(0, 160) }); }
    }
    cache.updatedAt = Date.now();
    return { ok: failures.length === 0, applied: { ...cache }, failures };
  };
  const setChannelSwitches = ({ p2p = null, p2s = null } = {}) => {
    const failures = [];
    for (const [key, value, method, capability] of [['p2p', p2p, 'setP2pChannelSwitch', 'network.p2pSwitch'], ['p2s', p2s, 'setP2sChannelSwitch', 'network.p2sSwitch']]) {
      if (value === null || value === undefined) continue;
      try { call(method, [value === true], capability); cache[key] = value === true; } catch (error) { failures.push({ field: key, code: error.code || 'NATIVE_APPLY_FAILED', message: String(error.message || error).slice(0, 160) }); }
    }
    cache.updatedAt = Date.now();
    return { ok: failures.length === 0, applied: { p2p: cache.p2p, p2s: cache.p2s }, failures };
  };
  const setProxy = (value) => { const proxy = proxyInput(value); if (proxy.mode === 'direct') { cache.proxy = { mode: 'direct', host: '', port: null }; return { ok: true, applied: cache.proxy }; } requireCapability(capabilities, 'network.proxy'); call('setProxy', [proxy.mode, proxy.host, proxy.port, proxy.username, proxy.password], 'network.proxy'); cache.proxy = { mode: proxy.mode, host: proxy.host, port: proxy.port }; return { ok: true, applied: cache.proxy }; };
  const verifyProxy = (value) => { const proxy = proxyInput(value); if (proxy.mode === 'direct') return { ok: true, reachable: true, mode: proxy.mode }; requireCapability(capabilities, 'network.proxyVerify'); const verify = NativeDkHelper && typeof NativeDkHelper.proxyVerify === 'function' ? NativeDkHelper.proxyVerify.bind(NativeDkHelper) : typeof tm.proxyVerify === 'function' ? tm.proxyVerify.bind(tm) : null; if (!verify) { const error = new Error('native proxy verification unavailable'); error.code = 'NATIVE_CAPABILITY_UNAVAILABLE'; throw error; } const result = verify(proxy.mode, proxy.host, proxy.port, proxy.username, proxy.password); return { ok: true, reachable: result !== false, mode: proxy.mode, host: proxy.host, port: proxy.port }; };
  const setAutoMoveLowSpeed = ({ enabled = false } = {}) => { requireCapability(capabilities, 'network.autoMoveLowSpeed'); if (typeof tm.setAutoMoveLowSpeedTaskSwitch !== 'function') { const error = new Error('native low speed switch unavailable'); error.code = 'NATIVE_CAPABILITY_UNAVAILABLE'; throw error; } tm.setAutoMoveLowSpeedTaskSwitch(enabled === true); cache.autoMoveLowSpeed = enabled === true; return { ok: true, enabled: cache.autoMoveLowSpeed }; };
  const getNetworkRuntime = () => ({ ...cache, source: 'applied-cache' });
  return { setGlobalLimits, setChannelSwitches, setProxy, verifyProxy, setAutoMoveLowSpeed, getNetworkRuntime };
}

module.exports = { createNetworkControlHandlers, proxyInput, capabilityState, requireCapability };
