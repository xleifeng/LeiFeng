'use strict';

const { EventEmitter } = require('events');
const { buildVipDescriptor } = require('./vip-descriptor');
const { readSdkPeerId } = require('./sdk-peer-id');
const { classifyVipAccount } = require('./vip-account');

const TRACKED = new Set(['active', 'waiting']);
const TERMINAL = new Set(['complete', 'error', 'removed']);
const RESOURCE_STATUS_TTL_MS = 5 * 60 * 1000;
const MAX_NATIVE_CERTS = 64;
const FILE_REQUEST_CONCURRENCY = 4;

function clampMs(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function accountTier(account = {}) {
  return classifyVipAccount(account);
}

function chunked(items, size = MAX_NATIVE_CERTS) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function summarizeResourceStatus(files, response) {
  const statusByIndex = new Map((response && Array.isArray(response.items) ? response.items : [])
    .map((item) => [Number(item && item.fileIndex), item]));
  const allowedIndices = [];
  let banned = 0; let cold = 0; let unknown = 0;
  for (const file of files) {
    const item = statusByIndex.get(Number(file.fileIndex));
    if (!item || item.banned === null || item.eligible === null) {
      unknown++;
      allowedIndices.push(Number(file.fileIndex));
    } else if (item.banned === true) banned++;
    else if (item.eligible === false) cold++;
    else allowedIndices.push(Number(file.fileIndex));
  }
  let status = 'eligible'; let problemCode = '';
  if (!allowedIndices.length && banned > 0 && cold === 0) { status = 'blocked'; problemCode = 'resource-filtered'; }
  else if (!allowedIndices.length) { status = 'cold'; problemCode = 'resource-cold'; }
  else if (banned || cold) { status = 'partial'; problemCode = 'resource-partial'; }
  else if (unknown) status = 'unknown';
  return { status, problemCode, allowedIndices };
}

function normalizeBtRuntimeFiles(value) {
  const files = Array.isArray(value) ? value : value && Array.isArray(value.files) ? value.files : [];
  return files.map((file, position) => {
    if (!file || typeof file !== 'object') return null;
    const fileIndex = Number(file.fileIndex ?? file.index ?? file.realIndex ?? position);
    if (!Number.isSafeInteger(fileIndex) || fileIndex < 0) return null;
    const cid = file.cid ?? file.Cid ?? file.fileCid ?? '';
    const gcid = file.gcid ?? file.Gcid ?? file.fileGcid ?? '';
    const fileName = file.fileName ?? file.name ?? file.displayName ?? '';
    const fileSize = numberOrZero(file.fileSize ?? file.size ?? file.length);
    const download = file.download ?? file.selected ?? file.enabled ?? 1;
    return {
      fileIndex,
      download: Number(download) === 0 ? 0 : 1,
      fileName: fileName === null || fileName === undefined ? null : String(fileName),
      fileSize,
      cid: cid === null || cid === undefined || cid === '' ? null : String(cid),
      gcid: gcid === null || gcid === undefined || gcid === '' ? null : String(gcid),
    };
  }).filter(Boolean);
}

function hasSelectedBtFileMetadata(record, snapshot) {
  const listed = Array.isArray(record && record.fileLists) ? record.fileLists : [];
  const selected = Array.isArray(record && record.selectedFileIndices) && record.selectedFileIndices.length
    ? record.selectedFileIndices.map(Number)
    : listed.map((file) => Number(file && (file.realIndex ?? file.index)));
  const indices = [...new Set(selected.filter((index) => Number.isSafeInteger(index) && index >= 0))];
  if (!indices.length) return false;
  const files = new Map((snapshot && Array.isArray(snapshot.btFiles) ? snapshot.btFiles : [])
    .map((file) => [Number(file && file.fileIndex), file]));
  return indices.every((index) => {
    const file = files.get(index);
    return file && Number(file.download) !== 0 && file.cid && file.gcid;
  });
}

class VipAccelerationManager extends EventEmitter {
  constructor({ registry, driver, auth, peerIdProvider, readVipTasks, readBtFileRuntime, speedupClient, taskDbPath,
    scanMs = 2000, maxBackoffMs = 300000, enabled = true, allowBtRootFallback = false,
    now = () => Date.now(), random = Math.random, log = () => {} } = {}) {
    super();
    if (!registry || !driver || !auth || !readVipTasks || !speedupClient) throw new Error('VIP manager dependencies missing');
    this.registry = registry;
    this.driver = driver;
    this.auth = auth;
    this.peerIdProvider = peerIdProvider || (() => readSdkPeerId({ winePrefix: driver.winePrefix }));
    this.readVipTasks = readVipTasks;
    this.readBtFileRuntime = typeof readBtFileRuntime === 'function' ? readBtFileRuntime : null;
    this.speedupClient = speedupClient;
    this.taskDbPath = taskDbPath;
    this.scanMs = clampMs(scanMs, 500, 30000, 2000);
    this.maxBackoffMs = clampMs(maxBackoffMs, 30000, 1800000, 300000);
    this.enabled = enabled !== false;
    this.allowBtRootFallback = allowBtRootFallback === true;
    this.now = now;
    this.random = typeof random === 'function' ? random : Math.random;
    this.log = typeof log === 'function' ? log : () => {};
    this._timer = null;
    this._stopped = true;
    this._scanPromise = null;
    this._states = new Map();
    this._generation = 0;
    this._onAuthState = () => this._poke();
    this._onDriverDown = () => this.onEngineDown();
    this._onDriverUp = () => this.onEngineUp();
  }

  _state(gid) {
    let state = this._states.get(gid);
    if (!state) {
      state = { gid, generation: this._generation, inflight: null, controller: null, attempt: 0,
        nextAttemptAt: 0, nextRefreshAt: 0, baselineVip: 0, baselineFreeDcdn: 0, injectedIndices: [],
        resourceStatus: 'unknown', resourceProblemCode: '', resourceCheckedAt: 0, resourceKey: '',
        resourceAllowedIndices: [], channel: 'none' };
      this._states.set(gid, state);
    }
    return state;
  }

  start() {
    if (!this._stopped) return;
    this._stopped = false;
    if (this.auth && this.auth.on) this.auth.on('state', this._onAuthState);
    if (this.driver && this.driver.on) { this.driver.on('down', this._onDriverDown); this.driver.on('up', this._onDriverUp); }
    this._timer = setInterval(() => this._scan().catch(() => {}), this.scanMs);
    if (this._timer.unref) this._timer.unref();
    this._poke();
  }

  _poke() { if (!this._stopped) this._scan().catch(() => {}); }

  async stop({ disable = true } = {}) {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._stopped = true;
    this._generation++;
    for (const state of this._states.values()) if (state.controller) state.controller.abort();
    if (this.auth && this.auth.off) this.auth.off('state', this._onAuthState);
    if (this.driver && this.driver.off) { this.driver.off('down', this._onDriverDown); this.driver.off('up', this._onDriverUp); }
    if (disable) await this.disableAll({ reason: 'stopped' });
    this._states.clear();
  }

  async _scan() {
    if (this._stopped || this._scanPromise) return this._scanPromise;
    this._scanPromise = this._scanInner().finally(() => { this._scanPromise = null; });
    return this._scanPromise;
  }

  async _scanInner() {
    const records = this.registry.list();
    const work = [];
    const present = new Set(records.map((r) => r.gid));
    for (const gid of this._states.keys()) if (!present.has(gid)) this._states.delete(gid);
    for (const record of records) {
      const state = this._state(record.gid);
      if (state.inflight) continue;
      const shouldDisable = !this.enabled || record.vipEnabled === false || record.status === 'paused' || TERMINAL.has(record.status);
      if (shouldDisable) {
        if (state.injectedIndices.length || record.vipState === 'injected' || record.vipState === 'effective')
          state.inflight = this._disableRecord(record, state, record.status === 'paused' ? 'paused' : 'disabled').finally(() => { state.inflight = null; });
        else if (record.vipState !== 'disabled' && record.vipState !== 'stopped') this.registry.update(record.gid, { vipState: TERMINAL.has(record.status) ? 'stopped' : 'disabled', vipNextRefreshAt: 0 });
        if (state.inflight) work.push(state.inflight);
        continue;
      }
      if (!TRACKED.has(record.status)) continue;
      if (state.nextAttemptAt && this.now() < state.nextAttemptAt) continue;
      state.inflight = this._processRecord(record, state).catch(() => {}).finally(() => { state.inflight = null; });
      work.push(state.inflight);
    }
    if (work.length) await Promise.allSettled(work);
  }

  async _readSnapshot(record) {
    if (!this.taskDbPath) return undefined;
    try {
      const rows = await this.readVipTasks(this.taskDbPath, [record.engineId]);
      let snapshot = rows && typeof rows.get === 'function' ? rows.get(record.engineId) : undefined;
      if (!snapshot || !this.readBtFileRuntime || !['bt', 'magnet'].includes(record.taskType) || hasSelectedBtFileMetadata(record, snapshot)) return snapshot;
      // Some SDK builds keep BtFile empty while the live task object already
      // exposes the same CID/GCID/file-selection metadata. Prefer the native
      // runtime view as an observation fallback; it is read-only and never
      // changes the SDK task.
      let runtime;
      try { runtime = await this.readBtFileRuntime(record.engineId); }
      catch (error) {
        this._safeLog({ event: 'bt-runtime-error', code: error && error.code || 'native-error', message: String(error && error.message || error).slice(0, 160) });
        runtime = null;
      }
      const runtimeFiles = normalizeBtRuntimeFiles(runtime);
      if (!runtimeFiles.length) {
        this._safeLog({ event: 'bt-runtime-empty' });
        return snapshot;
      }
      const byIndex = new Map((Array.isArray(snapshot.btFiles) ? snapshot.btFiles : []).map((file) => [Number(file.fileIndex), file]));
      for (const file of runtimeFiles) byIndex.set(file.fileIndex, { ...(byIndex.get(file.fileIndex) || {}), ...file });
      return { ...snapshot, btFiles: [...byIndex.values()] };
    } catch (e) {
      this._safeLog({ event: 'taskdb-error' });
      return undefined;
    }
  }

  _updateCounters(record, state, snapshot) {
    if (!snapshot) return;
    const vip = Number(snapshot.vipReceiveSize) || 0;
    const free = Number(snapshot.freeDcdnReceiveSize) || 0;
    const patch = { vipReceivedLength: vip, freeDcdnReceivedLength: free };
    if (state.injectedIndices.length && vip > state.baselineVip && record.vipState === 'injected') patch.vipState = 'effective';
    this.registry.update(record.gid, patch);
  }

  async _requestPerFile(method, context, common, files, signal) {
    let activeContext = context;
    let recoveryPromise = null;
    let authRequired = false;
    const attempts = await mapConcurrent(files, FILE_REQUEST_CONCURRENCY, async (file) => {
      if (signal && signal.aborted) {
        const error = new Error('aborted'); error.code = 'aborted';
        return { file, error };
      }
      try {
        const response = await this.speedupClient[method](activeContext, { ...common, files: [file], signal });
        return { file, response };
      } catch (error) {
        if (this._isUnauthorized(error) && !(signal && signal.aborted)) {
          if (!recoveryPromise) recoveryPromise = this.auth.getVipContext({ forceRecover: true });
          let recovered;
          try { recovered = await recoveryPromise; } catch { recovered = null; }
          if (!recovered || !recovered.ok) {
            authRequired = true;
            return { file, error };
          }
          activeContext = recovered;
          try {
            const response = await this.speedupClient[method](activeContext, { ...common, files: [file], signal });
            return { file, response };
          } catch (retryError) {
            return { file, error: retryError };
          }
        }
        return { file, error };
      }
    });
    return { context: activeContext, attempts, authRequired };
  }

  async _enableCerts(engineId, certs) {
    const invoked = [];
    for (const batch of chunked(certs)) {
      const result = await this.driver.enableVipDcdn(engineId, batch);
      const items = result && Array.isArray(result.items) ? result.items : [];
      invoked.push(...items.filter((item) => item && item.invoked).map((item) => Number(item.fileIndex)));
      if (!result || result.ok !== true || items.length !== batch.length || items.some((item) => !item.invoked)) {
        for (const rollback of chunked([...new Set(invoked)])) {
          try { await this.driver.disableVipDcdn(engineId, rollback); } catch {}
        }
        return { ok: false, invoked: [] };
      }
    }
    return { ok: true, invoked };
  }

  async _clearInjected(record, state) {
    const indices = state.injectedIndices.slice();
    if (indices.length && this.driver.isHealthy()) {
      for (const batch of chunked(indices)) {
        try { await this.driver.disableVipDcdn(record.engineId, batch); } catch {}
      }
    }
    state.injectedIndices = [];
  }

  async _waitAfterDisable(record, state, reason) {
    await this._clearInjected(record, state);
    return this._setWaiting(record, state, reason);
  }

  async _processRecord(record, state) {
    const snapshot = await this._readSnapshot(record);
    this._updateCounters(record, state, snapshot);
    if (state.injectedIndices.length && state.nextRefreshAt && this.now() < state.nextRefreshAt) return;
    if (this._stopped || state.generation !== this._generation) return;

    let context;
    try { context = await this.auth.getVipContext(); } catch { context = { ok: false, reason: 'auth-required' }; }
    if (this._stopped) return;
    if (!context || !context.ok) return this._waitAfterDisable(record, state, context && context.reason || 'auth-required');
    let peer;
    try { peer = await this.peerIdProvider(); } catch { peer = { ok: false, reason: 'waiting-peer-id' }; }
    if (typeof peer === 'string') peer = { ok: true, peerId: peer };
    if (!peer || !peer.ok || !peer.peerId) return this._waitAfterDisable(record, state, 'waiting-peer-id');
    const descriptor = buildVipDescriptor(record, snapshot, { allowBtRootFallback: this.allowBtRootFallback });
    if (!descriptor.ok) {
      if (descriptor.kind === 'unsupported') return this._waitAfterDisable(record, state, 'unsupported');
      return this._waitAfterDisable(record, state, descriptor.reason || 'waiting-metadata');
    }

    state.channel = accountTier({ isVip: context.isVip, userVas: context.userVas,
      vipType: context.vipType, vipLevel: context.vipLevel }).channel;
    const resourceKey = descriptor.items.map((item) => `${item.fileIndex}:${item.cid}:${item.gcid}`).join('|');
    if (state.resourceKey !== resourceKey) {
      if (state.resourceKey && state.injectedIndices.length) await this._clearInjected(record, state);
      state.resourceKey = resourceKey;
      state.resourceCheckedAt = 0;
      state.resourceStatus = 'unknown';
      state.resourceProblemCode = '';
      state.resourceAllowedIndices = [];
    }
    const requestGeneration = this._generation;
    state.generation = requestGeneration;
    const controller = new AbortController();
    state.controller = controller;
    const clearController = () => { if (state.controller === controller) state.controller = null; };
    const common = { peerId: peer.peerId, infohash: descriptor.infohash, btTitle: descriptor.btTitle };
    if (typeof this.speedupClient.requestResourceStatus === 'function'
      && (!state.resourceCheckedAt || this.now() - state.resourceCheckedAt >= RESOURCE_STATUS_TTL_MS)) {
      const resource = await this._requestPerFile('requestResourceStatus', context, common,
        descriptor.items, controller.signal);
      if (resource.authRequired) { clearController(); return this._waitAfterDisable(record, state, 'auth-required'); }
      context = resource.context || context;
      if (controller.signal.aborted || this._stopped || requestGeneration !== this._generation) {
        clearController();
        return;
      }
      try {
        const items = resource.attempts.flatMap((attempt) => attempt.response && Array.isArray(attempt.response.items)
          ? attempt.response.items.filter((item) => Number(item && item.fileIndex) === Number(attempt.file.fileIndex)) : []);
        const errors = resource.attempts.filter((item) => item.error);
        const summary = summarizeResourceStatus(descriptor.items, { items });
        state.resourceStatus = summary.status;
        state.resourceProblemCode = summary.problemCode || (errors[0] ? this._errorCode(errors[0].error) : '');
        state.resourceAllowedIndices = summary.allowedIndices;
        state.resourceCheckedAt = this.now();
      } catch (error) {
        state.resourceStatus = 'unknown';
        state.resourceProblemCode = this._errorCode(error);
        state.resourceAllowedIndices = descriptor.items.map((item) => Number(item.fileIndex));
        state.resourceCheckedAt = this.now();
        this._safeLog({ event: 'resource-status-error', code: state.resourceProblemCode });
      }
    }
    if (state.resourceStatus === 'blocked') { clearController(); return this._waitAfterDisable(record, state, 'resource-blocked'); }
    if (state.resourceStatus === 'cold') { clearController(); return this._waitAfterDisable(record, state, 'resource-cold'); }
    const requestItems = state.resourceAllowedIndices.length
      ? descriptor.items.filter((item) => state.resourceAllowedIndices.includes(Number(item.fileIndex)))
      : descriptor.items;
    if (!requestItems.length) { clearController(); return this._waitAfterDisable(record, state, 'resource-cold'); }

    this.registry.update(record.gid, { vipState: 'requesting', vipLastAttemptAt: this.now(), vipLastErrorCode: '' });
    const tokenResult = await this._requestPerFile('requestTokens', context, common, requestItems, controller.signal);
    if (tokenResult.authRequired) { clearController(); return this._waitAfterDisable(record, state, 'auth-required'); }
    if (controller.signal.aborted || this._stopped || requestGeneration !== this._generation) {
      clearController();
      return;
    }
    const successful = tokenResult.attempts.flatMap((attempt) => attempt.response && Array.isArray(attempt.response.items)
      ? attempt.response.items.filter((item) => item && item.token && Number(item.fileIndex) === Number(attempt.file.fileIndex)) : []);
    if (!successful.length) {
      const firstError = tokenResult.attempts.find((item) => item.error);
      clearController();
      return this._backoff(record, state, firstError ? this._errorCode(firstError.error) : 'item-error');
    }
    const certs = successful.map((item) => ({ fileIndex: item.fileIndex, token: item.token }));
    const previousInjected = state.injectedIndices.slice();
    let injected;
    try { injected = await this._enableCerts(record.engineId, certs); }
    catch (error) { clearController(); return this._backoff(record, state, this._errorCode(error)); }
    clearController();
    if (!injected || injected.ok !== true)
      return this._backoff(record, state, 'native-throw');
    const activeIndices = new Set(injected.invoked.map(Number));
    const staleIndices = previousInjected.filter((index) => !activeIndices.has(Number(index)));
    for (const batch of chunked(staleIndices)) {
      try { await this.driver.disableVipDcdn(record.engineId, batch); } catch {}
    }
    state.attempt = 0;
    state.injectedIndices = injected.invoked;
    state.baselineVip = snapshot ? Number(snapshot.vipReceiveSize) || 0 : 0;
    state.baselineFreeDcdn = snapshot ? Number(snapshot.freeDcdnReceiveSize) || 0 : 0;
    const intervals = tokenResult.attempts.map((item) => Number(item.response && item.response.intervalSec))
      .filter((value) => Number.isFinite(value) && value > 0);
    const intervalSec = intervals.length ? Math.min(...intervals) : 3600;
    state.nextRefreshAt = this.now() + Math.max(60000, (intervalSec - 300) * 1000);
    state.nextAttemptAt = 0;
    const complete = successful.length === requestItems.length && state.resourceStatus !== 'partial';
    this.registry.update(record.gid, { vipState: 'injected', vipLastResult: complete ? 'injected' : 'partial',
      vipLastErrorCode: complete ? '' : (state.resourceProblemCode || 'partial-item'), vipNextRefreshAt: state.nextRefreshAt,
      vipReceivedLength: state.baselineVip, freeDcdnReceivedLength: state.baselineFreeDcdn });
    this._safeLog({ event: 'injected', itemCount: certs.length });
  }

  _isUnauthorized(error) { return !!error && (Number(error.status) === 401 || (error.code === 'http-error' && Number(error.status) === 401)); }
  _errorCode(error) { return error && typeof error.code === 'string' ? error.code.slice(0, 64) : 'vip-error'; }

  _setWaiting(record, state, reason) {
    state.nextRefreshAt = 0;
    state.nextAttemptAt = this.now() + (reason === 'not-vip' || reason === 'auth-required' ? 30000
      : reason === 'resource-blocked' || reason === 'resource-cold' ? 60000 : 5000);
    const allowed = new Set(['auth-required', 'not-vip', 'waiting-peer-id', 'waiting-metadata', 'metadata-fetching',
      'waiting-bt-file', 'waiting-bt-file-metadata', 'resource-blocked', 'resource-cold', 'unsupported']);
    const stateName = allowed.has(reason) ? reason : 'waiting-metadata';
    this.registry.update(record.gid, { vipState: stateName, vipLastErrorCode: reason, vipNextRefreshAt: 0 });
  }

  _backoff(record, state, errorCode) {
    state.attempt = Math.min(state.attempt + 1, 30);
    const base = Math.min(this.maxBackoffMs, 1000 * (2 ** Math.min(state.attempt - 1, 10)));
    const jitter = 0.8 + Math.max(0, Math.min(1, Number(this.random()) || 0)) * 0.4;
    state.nextAttemptAt = this.now() + Math.min(this.maxBackoffMs, Math.round(base * jitter));
    state.nextRefreshAt = 0;
    this.registry.update(record.gid, { vipState: 'backoff', vipLastErrorCode: String(errorCode || 'vip-error').slice(0, 64), vipNextRefreshAt: state.nextAttemptAt });
    this._safeLog({ event: 'backoff' });
  }

  async _disableRecord(record, state, reason) {
    await this._clearInjected(record, state);
    state.nextRefreshAt = 0;
    state.nextAttemptAt = 0;
    this.registry.update(record.gid, { vipState: reason === 'stopped' ? 'stopped' : 'disabled', vipNextRefreshAt: 0 });
  }

  async disableAll({ reason = 'disabled' } = {}) {
    const work = [];
    for (const record of this.registry.list()) {
      const state = this._state(record.gid);
      if (state.injectedIndices.length || record.vipState === 'injected' || record.vipState === 'effective') work.push(this._disableRecord(record, state, reason));
    }
    await Promise.all(work);
  }

  async disableTask(gid, { reason = 'disabled' } = {}) {
    const record = this.registry.get(gid);
    if (!record) return;
    const state = this._state(gid);
    if (state.controller) state.controller.abort();
    await this._disableRecord(record, state, reason);
  }

  async setEnabled({ gid, enabled }) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    if (gid === undefined || gid === null) {
      this.enabled = enabled;
      if (!enabled) await this.disableAll({ reason: 'disabled' });
      else this._poke();
      return { enabled: this.enabled };
    }
    const record = this.registry.get(gid);
    if (!record) throw new Error('gid not found');
    this.registry.update(gid, { vipEnabled: enabled });
    if (!enabled) await this._disableRecord(record, this._state(gid), 'disabled');
    else { const state = this._state(gid); state.nextAttemptAt = 0; this._poke(); }
    return { gid, enabled };
  }

  async retry(gid) {
    const record = this.registry.get(gid);
    if (!record) throw new Error('gid not found');
    const state = this._state(gid);
    state.attempt = 0; state.nextAttemptAt = 0; state.nextRefreshAt = 0; state.resourceCheckedAt = 0;
    this.registry.update(gid, { vipState: 'waiting', vipLastErrorCode: '', vipNextRefreshAt: 0 });
    this._poke();
    return { gid, queued: true };
  }

  onEngineDown() {
    this._generation++;
    for (const state of this._states.values()) {
      state.generation = this._generation;
      if (state.controller) state.controller.abort();
      state.controller = null; state.injectedIndices = []; state.nextRefreshAt = 0; state.nextAttemptAt = 0;
    }
    for (const record of this.registry.list()) {
      if (record.vipState === 'requesting' || record.vipState === 'injected' || record.vipState === 'effective')
        this.registry.update(record.gid, { vipState: 'stopped', vipNextRefreshAt: 0 });
    }
  }

  onEngineUp() { if (!this._stopped) this._poke(); }

  async getStatus(gid) {
    const authStatus = this.auth.getStatus ? await this.auth.getStatus() : {};
    const account = authStatus && authStatus.account || {};
    const tier = accountTier(account);
    const records = gid === undefined || gid === null ? this.registry.list() : [this.registry.get(gid)].filter(Boolean);
    let peer;
    try { peer = await this.peerIdProvider(); } catch { peer = null; }
    const peerIdReady = typeof peer === 'string' ? peer.length > 0 : Boolean(peer && peer.ok && peer.peerId);
    return { enabled: this.enabled, accountReady: account.valid === true, isVip: account.isVip === true,
      isDownloadVip: tier.isDownloadVip, userVas: tier.userVas, vipType: tier.vipType, vipLevel: tier.vipLevel,
      isSuperVip: tier.isSuperVip, isPlatinumVip: tier.isPlatinumVip, isPanVip: tier.isPanVip,
      accelerationChannel: tier.channel,
      peerIdReady,
      tasks: records.map((r) => { const state = this._states.get(r.gid); return ({ gid: r.gid, vipEnabled: r.vipEnabled !== false, vipState: r.vipState || 'disabled',
        vipLastResult: r.vipLastResult || '', vipLastErrorCode: r.vipLastErrorCode || '', vipLastAttemptAt: r.vipLastAttemptAt || 0,
        vipNextRefreshAt: r.vipNextRefreshAt || 0, vipReceivedLength: r.vipReceivedLength || 0,
        freeDcdnReceivedLength: r.freeDcdnReceivedLength || 0, resourceStatus: state && state.resourceStatus || 'unknown',
        resourceProblemCode: state && state.resourceProblemCode || '', channel: state && state.channel || tier.channel } ); }) };
  }

  async getGlobalUiState() {
    const status = await this.getStatus();
    return {
      enabled: status.enabled,
      availability: !status.accountReady ? 'account-required' : !status.isDownloadVip ? 'not-vip' : 'available',
      accountReady: status.accountReady,
      isVip: status.isVip,
      isDownloadVip: status.isDownloadVip,
      userVas: status.userVas,
      vipType: status.vipType,
      vipLevel: status.vipLevel,
      isSuperVip: status.isSuperVip,
      isPlatinumVip: status.isPlatinumVip,
      isPanVip: status.isPanVip,
      accelerationChannel: status.accelerationChannel,
      peerIdReady: status.peerIdReady,
      featureCapabilities: this.getFeatureCapabilities(),
    };
  }

  async getTaskUiState(gid) {
    const status = await this.getStatus(gid);
    const task = status.tasks[0];
    if (!task) throw Object.assign(new Error('任务不存在'), { code: 'TASK_NOT_FOUND' });
    const availability = !status.accountReady ? 'account-required' : !status.isDownloadVip ? 'not-vip' : 'available';
    return {
      taskId: String(task.gid),
      availability,
      state: task.vipState,
      vipReceivedBytes: Number(task.vipReceivedLength) || 0,
      freeDcdnReceivedBytes: Number(task.freeDcdnReceivedLength) || 0,
      lastAttemptAt: Number(task.vipLastAttemptAt) || 0,
      nextRetryAt: Number(task.vipNextRefreshAt) || 0,
      problemCode: task.vipLastErrorCode || null,
      resourceStatus: task.resourceStatus,
      resourceProblemCode: task.resourceProblemCode || null,
      accelerationChannel: task.channel,
      superChannelEligible: status.isDownloadVip && (task.resourceStatus === 'eligible' || task.resourceStatus === 'partial'),
      enabled: task.vipEnabled !== false,
    };
  }

  getFeatureCapabilities() {
    return { superChannel: true, speedTrial: false, source: 'vip-dcdn-resource-status',
      speedTrialReason: 'account-promotion-flow-not-exposed' };
  }

  _safeLog(value) { try { this.log(value); } catch {} }
}

module.exports = { VipAccelerationManager, accountTier, summarizeResourceStatus };
