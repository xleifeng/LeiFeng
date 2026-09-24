'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventOutbox } = require('./event-outbox');
const { mapLegacyLifecycle, normalizeLifecycle, isTerminalLifecycle } = require('../domain/task-status');
const { sanitizeTaskError, mapNativeError } = require('../domain/task-errors');

const SCHEMA_VERSION = 2;
const MAX_DEPTH = 8;
const MAX_STRING = 16 * 1024;
const SENSITIVE_KEY = /(?:accessToken|refreshToken|sessionId|peerId|peer_id|authorization|token|cert|secret|password|cookie)$/i;
const FILE_REVISION_KEYS = new Set(['displayName', 'savePath', 'selectedFileIndices', 'files', 'fileLists', 'seedRef']);
const OBSERVATION_KEYS = new Set(['completedBytes', 'totalBytes', 'downloadBytesPerSecond', 'uploadBytesPerSecond', 'observationRevision', 'updatedAt', 'engineGeneration']);

function nowMs(clock) { return Number(clock && typeof clock.now === 'function' ? clock.now() : Date.now()); }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function normalizeIndices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))].sort((a, b) => a - b);
}

function sanitizeValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item) => sanitizeValue(item, '', depth + 1, seen)).filter((item) => item !== undefined);
  else {
    result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const safe = sanitizeValue(childValue, childKey, depth + 1, seen);
      if (safe !== undefined) result[childKey] = safe;
    }
  }
  seen.delete(value);
  return result;
}

function inferKind(record = {}) {
  const type = String(record.kind || record.taskType || '').toLowerCase();
  if (['http', 'https', 'ftp', 'bt', 'magnet', 'ed2k', 'thunder', 'group'].includes(type)) return type;
  const source = String(record.source || record.url || '');
  if (/^magnet:/i.test(source)) return 'magnet';
  if (/^ed2k:/i.test(source)) return 'ed2k';
  if (/^thunder:/i.test(source)) return 'thunder';
  if (/^ftp:/i.test(source)) return 'ftp';
  return /^https:/i.test(source) ? 'https' : 'http';
}

function sourceFingerprint(kind, source, record = {}) {
  record = record || {};
  if (record.sourceFingerprint) return String(record.sourceFingerprint);
  if (record.infoId) return `${kind}:info:${String(record.infoId).toLowerCase()}`;
  if (record.infoHash) return `${kind}:hash:${String(record.infoHash).toLowerCase()}`;
  return crypto.createHash('sha256').update(`${kind}\0${source || ''}`).digest('hex');
}

function protocolIdentity(kind, source, input = {}) {
  let infoId = input.infoId ? String(input.infoId) : '';
  let infoHash = input.infoHash ? String(input.infoHash) : '';
  const fingerprint = String(input.sourceFingerprint || '');
  if (!infoId) {
    const match = /^(?:bt|magnet):info:(.+)$/i.exec(fingerprint);
    if (match) infoId = match[1];
    else if (kind === 'bt' && /^[a-f0-9]{40}$/i.test(fingerprint)) infoId = fingerprint;
  }
  if (!infoHash) {
    const match = /^magnet:hash:(.+)$/i.exec(fingerprint);
    if (match) infoHash = match[1];
    else {
      const sourceMatch = /(?:^|[?&])xt=urn:btih:([^&]+)/i.exec(String(source || ''));
      if (sourceMatch) {
        try { infoHash = decodeURIComponent(sourceMatch[1]); } catch { infoHash = sourceMatch[1]; }
      }
    }
  }
  return { infoId, infoHash };
}

const VIP_STATES = new Set([
  'disabled', 'stopped', 'waiting', 'waiting-peer-id', 'waiting-metadata',
  'waiting-bt-file', 'waiting-bt-file-metadata', 'metadata-fetching',
  'resource-blocked', 'resource-cold',
  'requesting', 'injected', 'effective', 'backoff', 'pending', 'active',
  'failed', 'unsupported',
]);

function mapLegacyVip(record) {
  const nested = record.vip && typeof record.vip === 'object' ? record.vip : {};
  const state = String(record.vipState !== undefined ? record.vipState : nested.state || '').toLowerCase();
  const enabled = record.vipEnabled !== undefined ? record.vipEnabled !== false : nested.enabled !== false;
  const receivedBytes = record.vipReceivedLength !== undefined ? record.vipReceivedLength : nested.receivedBytes;
  const freeDcdnReceivedBytes = record.freeDcdnReceivedLength !== undefined ? record.freeDcdnReceivedLength : nested.freeDcdnReceivedBytes;
  const nextRefreshAt = record.vipNextRefreshAt !== undefined ? record.vipNextRefreshAt : nested.nextRefreshAt;
  const lastErrorCode = record.vipLastErrorCode !== undefined ? record.vipLastErrorCode : nested.lastErrorCode;
  return {
    enabled,
    state: VIP_STATES.has(state) ? state : 'disabled',
    receivedBytes: normalizeNumber(receivedBytes),
    freeDcdnReceivedBytes: normalizeNumber(freeDcdnReceivedBytes),
    nextRefreshAt: normalizeNumber(nextRefreshAt),
    lastErrorCode: lastErrorCode ? String(lastErrorCode) : null,
  };
}

function normalizeFileList(record) {
  const source = Array.isArray(record.files) ? record.files : Array.isArray(record.fileLists) ? record.fileLists : [];
  return source.map((file) => ({
    index: normalizeInt(file.index === undefined ? file.realIndex : file.index),
    name: typeof (file.name === undefined ? file.fileName : file.name) === 'string' ? (file.name === undefined ? file.fileName : file.name) : '',
    path: typeof (file.path === undefined ? file.filePath : file.path) === 'string' ? (file.path === undefined ? file.filePath : file.path) : '',
    size: normalizeNumber(file.size === undefined ? file.fileSize : file.size),
    offset: normalizeNumber(file.offset === undefined ? file.fileOffset : file.offset),
  }));
}

function legacyExtras(record) {
  const known = new Set([
    'schemaVersion', 'gid', 'id', 'engineId', 'parentId', 'taskType', 'kind', 'status', 'lifecycle', 'url', 'source', 'sourceFingerprint', 'infoId', 'infoHash',
    'taskName', 'displayName', 'savePath', 'selectedFileIndices', 'fileLists', 'files', 'totalLength', 'totalBytes', 'completedLength', 'completedBytes',
    'downloadSpeed', 'downloadBytesPerSecond', 'uploadSpeed', 'uploadBytesPerSecond', 'queuePosition', 'taskSpeedLimit', 'privateSpace', 'createdAt',
    'startedAt', 'completedAt', 'recycledAt', 'updatedAt', 'error', 'errorCode', 'errorMessage', 'vip', 'vipEnabled', 'vipState', 'vipReceivedLength',
    'freeDcdnReceivedLength', 'vipNextRefreshAt', 'vipLastErrorCode', 'metadataPhase', 'seedRef', 'privatePayload', 'btScheduler', 'group', 'groupLabel', 'groupResult', 'childCount', 'priority', 'userPaused', 'schedulerPaused', 'idleEligible', 'lastSlowMoveAt', 'openOnComplete', 'revision', 'observationRevision', 'fileRevision', 'legacy',
  ]);
  const extras = {};
  for (const [key, value] of Object.entries(record)) if (!known.has(key)) extras[key] = value;
  return sanitizeValue(extras);
}

function normalizeTaskRecord(input = {}, { clock = Date, idFactory } = {}) {
  const source = input.source === undefined ? (input.url || null) : input.source;
  const kind = inferKind(input);
  const identity = protocolIdentity(kind, source, input);
  const createdAt = normalizeNumber(input.createdAt, nowMs(clock));
  const lifecycle = normalizeLifecycle(input.lifecycle || mapLegacyLifecycle(input), 'queued');
  const id = String(input.id || input.gid || (idFactory ? idFactory() : crypto.randomBytes(8).toString('hex')));
  const task = {
    schemaVersion: SCHEMA_VERSION,
    id,
    engineId: Number.isSafeInteger(Number(input.engineId)) && Number(input.engineId) > 0 ? Number(input.engineId) : null,
    parentId: input.parentId ? String(input.parentId) : null,
    group: input.group && typeof input.group === 'object' ? { id: String(input.group.id || input.parentId || ''), label: String(input.group.label || input.group.name || '任务组') } : input.groupLabel ? { id: String(input.parentId || ''), label: String(input.groupLabel) } : null,
    groupResult: input.groupResult === 'partial-failed' || input.groupResult === 'failed' ? input.groupResult : null,
    childCount: Math.max(0, normalizeInt(input.childCount)),
    kind,
    lifecycle,
    source: source ? String(source) : null,
    sourceFingerprint: sourceFingerprint(kind, source, input),
    infoId: identity.infoId,
    infoHash: identity.infoHash,
    seedRef: input.seedRef ? String(input.seedRef) : null,
    privatePayload: input.privatePayload && typeof input.privatePayload === 'object' ? sanitizeValue(input.privatePayload) : null,
    displayName: String(input.displayName === undefined ? input.taskName || '未命名任务' : input.displayName),
    savePath: String(input.savePath || ''),
    selectedFileIndices: normalizeIndices(input.selectedFileIndices),
    btScheduler: input.btScheduler === 'sequential' ? 'sequential' : 'normal',
    totalBytes: normalizeNumber(input.totalBytes === undefined ? input.totalLength : input.totalBytes),
    completedBytes: normalizeNumber(input.completedBytes === undefined ? input.completedLength : input.completedBytes),
    downloadBytesPerSecond: normalizeNumber(input.downloadBytesPerSecond === undefined ? input.downloadSpeed : input.downloadBytesPerSecond),
    uploadBytesPerSecond: normalizeNumber(input.uploadBytesPerSecond === undefined ? input.uploadSpeed : input.uploadBytesPerSecond),
    queuePosition: normalizeInt(input.queuePosition),
    priority: normalizeInt(input.priority),
    userPaused: input.userPaused === true || (input.userPaused === undefined && lifecycle === 'paused'),
    schedulerPaused: input.schedulerPaused === true,
    idleEligible: input.idleEligible !== false,
    lastSlowMoveAt: input.lastSlowMoveAt ? normalizeNumber(input.lastSlowMoveAt) : null,
    openOnComplete: input.openOnComplete === true,
    taskSpeedLimit: input.taskSpeedLimit === null || input.taskSpeedLimit === undefined ? null : normalizeNumber(input.taskSpeedLimit),
    privateSpace: input.privateSpace === true,
    createdAt,
    startedAt: input.startedAt ? normalizeNumber(input.startedAt) : null,
    completedAt: input.completedAt ? normalizeNumber(input.completedAt) : null,
    recycledAt: input.recycledAt ? normalizeNumber(input.recycledAt) : null,
    updatedAt: normalizeNumber(input.updatedAt, createdAt),
    error: sanitizeTaskError(input.error || (input.errorCode ? mapNativeError(input.errorCode, { message: input.errorMessage }) : null)),
    vip: input.vip ? mapLegacyVip({ ...input, ...input.vip }) : mapLegacyVip(input),
    revision: Math.max(1, normalizeInt(input.revision, 1)),
    observationRevision: Math.max(1, normalizeInt(input.observationRevision, 1)),
    fileRevision: Math.max(1, normalizeInt(input.fileRevision, 1)),
    files: normalizeFileList(input),
  };
  const extras = input.legacy || legacyExtras(input);
  if (extras && Object.keys(extras).length) task.legacy = extras;
  return task;
}

function hasMeaningfulChange(before, after, patch) {
  return Object.keys(patch).some((key) => !OBSERVATION_KEYS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

class TaskRepository {
  constructor({ filePath, legacyFilePath, clock = Date, idFactory, log = console, maxOutbox = 100000 } = {}) {
    if (!filePath) throw new Error('TaskRepository filePath is required');
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath || path.join(path.dirname(filePath), '..', 'registry.json');
    this.clock = clock;
    this.idFactory = idFactory || (() => crypto.randomBytes(8).toString('hex'));
    this.log = log;
    this.maxOutbox = maxOutbox;
    this.state = { schemaVersion: SCHEMA_VERSION, repositoryRevision: 0, writtenAt: 0, tasks: [], outbox: [], outboxSequence: 0 };
    this.outbox = new EventOutbox({ maxEvents: maxOutbox, clock, idFactory: () => crypto.randomBytes(12).toString('hex') });
    this.loaded = false;
    this.readOnly = false;
    this.loadError = null;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        this.state = this._readV2(this.filePath);
        this.outbox.hydrate({ events: this.state.outbox, sequence: this.state.outboxSequence });
        if (this._recoverAfterRestart()) this._writeAtomic();
        return this;
      }
      if (fs.existsSync(this.legacyFilePath)) {
        const migrated = this._readLegacy(this.legacyFilePath);
        this._backup(this.legacyFilePath, 'v1-backup');
        this.state = migrated;
        this.outbox.hydrate({ events: migrated.outbox, sequence: migrated.outboxSequence });
        this._recoverAfterRestart();
        this._writeAtomic();
        return this;
      }
    } catch (error) {
      this.readOnly = true;
      this.loadError = error;
      this._backup(fs.existsSync(this.filePath) ? this.filePath : this.legacyFilePath, 'corrupt');
      this.log.error?.('[task-repository] load failed; starting read-only', error.message);
    }
    return this;
  }

  _recoverAfterRestart() {
    let changed = false;
    for (const task of this.state.tasks) {
      if (['completed', 'failed', 'recycled', 'missing'].includes(task.lifecycle)) continue;
      task.lifecycle = 'failed';
      task.engineId = null;
      task.error = mapNativeError('engine restarted', { code: 'ENGINE_RESTARTED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] });
      task.updatedAt = nowMs(this.clock);
      task.revision += 1;
      task.observationRevision += 1;
      try { this._appendEvent({ type: 'task.lifecycle.changed', taskId: task.id, revision: task.revision, payload: { from: 'engine-running', to: 'failed', reason: 'engine restarted' }, requiredConsumers: ['history', 'links'] }); } catch (error) {
        this.log.error?.('[task-repository] recovery event could not be queued:', error.message);
      }
      changed = true;
    }
    if (changed) this.state.repositoryRevision += 1;
    return changed;
  }

  _readV2(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.tasks)) throw new Error('invalid TaskRepository schema');
    return {
      schemaVersion: SCHEMA_VERSION,
      repositoryRevision: Math.max(0, normalizeInt(value.repositoryRevision)),
      writtenAt: normalizeNumber(value.writtenAt),
      tasks: value.tasks.map((task) => normalizeTaskRecord(task, { clock: this.clock, idFactory: this.idFactory })),
      outbox: Array.isArray(value.outbox) ? sanitizeValue(value.outbox) : [],
      outboxSequence: normalizeInt(value.outboxSequence),
    };
  }

  _readLegacy(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) throw new Error('legacy registry must be an array');
    const sorted = value.map((item) => normalizeTaskRecord(item, { clock: this.clock, idFactory: this.idFactory }))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    sorted.forEach((task, index) => { task.queuePosition = index; });
    return { schemaVersion: SCHEMA_VERSION, repositoryRevision: sorted.length ? 1 : 0, writtenAt: nowMs(this.clock), tasks: sorted, outbox: [], outboxSequence: 0 };
  }

  _backup(file, suffix) {
    if (!file || !fs.existsSync(file)) return null;
    const target = `${file}.${suffix}-${nowMs(this.clock)}`;
    try { fs.copyFileSync(file, target); return target; } catch { return null; }
  }

  _ensureLoaded() { if (!this.loaded) this.load(); }
  _ensureWritable() {
    this._ensureLoaded();
    if (this.readOnly) {
      const error = new Error(this.loadError ? `repository is read-only: ${this.loadError.message}` : 'repository is read-only');
      error.code = 'REPOSITORY_READ_ONLY';
      throw error;
    }
  }

  _writeAtomic() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const payload = JSON.stringify({ ...this.state, outbox: this.outbox.snapshot().events, outboxSequence: this.outbox.sequence, writtenAt: nowMs(this.clock) }, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, payload, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.filePath);
    this.state.writtenAt = nowMs(this.clock);
  }

  _appendEvent(event) { return this.outbox.append(event); }

  get repositoryRevision() { this._ensureLoaded(); return this.state.repositoryRevision; }
  isReadOnly() { this._ensureLoaded(); return this.readOnly; }
  get(taskId) { this._ensureLoaded(); const task = this.state.tasks.find((item) => item.id === String(taskId)); return task ? clone(task) : null; }
  require(taskId) {
    const task = this.get(taskId);
    if (!task) { const error = new Error('任务不存在或已被删除'); error.code = 'TASK_NOT_FOUND'; error.details = { taskId: String(taskId) }; throw error; }
    return task;
  }
  list() { this._ensureLoaded(); return this.state.tasks.map(clone); }

  findDuplicate(fingerprint, savePath) {
    this._ensureLoaded();
    return this.state.tasks.find((task) => !isTerminalLifecycle(task.lifecycle) && task.sourceFingerprint === String(fingerprint) && task.savePath === String(savePath)) || null;
  }

  findByEngineId(engineId) {
    this._ensureLoaded();
    const value = Number(engineId);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    const task = this.state.tasks.find((item) => Number(item.engineId) === value);
    return task ? clone(task) : null;
  }

  create(input = {}) {
    this._ensureWritable();
    const task = normalizeTaskRecord({ ...input, id: input.id || this.idFactory(), revision: 1, observationRevision: 1, fileRevision: 1, createdAt: input.createdAt || nowMs(this.clock), updatedAt: nowMs(this.clock) }, { clock: this.clock, idFactory: this.idFactory });
    if (this.state.tasks.some((item) => item.id === task.id)) { const error = new Error('task id already exists'); error.code = 'TASK_ID_CONFLICT'; throw error; }
    this.state.tasks.push(task);
    this.state.repositoryRevision += 1;
    this._appendEvent({ type: 'task.created', taskId: task.id, revision: task.revision, payload: { task: clone(task) }, requiredConsumers: ['history', 'links'] });
    this._writeAtomic();
    return clone(task);
  }

  mutate(taskId, { expectedRevision, reason = 'mutation' } = {}, reducer) {
    this._ensureWritable();
    const index = this.state.tasks.findIndex((item) => item.id === String(taskId));
    if (index < 0) return null;
    const current = this.state.tasks[index];
    if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) {
      const error = new Error('任务状态已变化，请刷新后重试'); error.code = 'REVISION_CONFLICT'; error.details = { taskId: current.id, currentRevision: current.revision }; throw error;
    }
    const before = clone(current);
    const proposed = typeof reducer === 'function' ? reducer(clone(current)) : reducer;
    const patch = proposed && proposed.id === undefined && proposed.schemaVersion === undefined ? proposed : proposed || {};
    const next = normalizeTaskRecord({ ...current, ...sanitizeValue(patch), updatedAt: nowMs(this.clock) }, { clock: this.clock, idFactory: this.idFactory });
    const lifecycleChanged = next.lifecycle !== current.lifecycle;
    const meaningful = hasMeaningfulChange(current, next, patch || {}) || lifecycleChanged;
    if (meaningful) next.revision = current.revision + 1;
    else next.revision = current.revision;
    next.observationRevision = Math.max(current.observationRevision, next.observationRevision);
    if ([...FILE_REVISION_KEYS].some((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]))) next.fileRevision = current.fileRevision + 1;
    this.state.tasks[index] = next;
    this.state.repositoryRevision += 1;
    // 事件随 tasks.json 同一持久化事务落盘；payload 带任务快照使 UI 状态可从 outbox 重放
    // （task.updated 曾只有 reason，compact 后无法重建投影，见 spec §7）。
    if (lifecycleChanged) this._appendEvent({ type: 'task.lifecycle.changed', taskId: next.id, revision: next.revision, payload: { from: current.lifecycle, to: next.lifecycle, reason, task: clone(next) }, requiredConsumers: ['history', 'links'] });
    else if (meaningful) this._appendEvent({ type: 'task.updated', taskId: next.id, revision: next.revision, payload: { reason, task: clone(next) }, requiredConsumers: ['history', 'links'] });
    this._writeAtomic();
    return clone(next);
  }

  patchObservation(taskId, patch = {}) {
    this._ensureWritable();
    const current = this.require(taskId);
    const nextPatch = sanitizeValue(patch) || {};
    const lifecycle = nextPatch.lifecycle || current.lifecycle;
    if (lifecycle !== current.lifecycle || nextPatch.error !== undefined) {
      return this.mutate(taskId, { reason: nextPatch.reason || 'observation-transition' }, (task) => ({ ...nextPatch, lifecycle }));
    }
    const updated = this.mutate(taskId, { reason: 'observation' }, (task) => ({ ...nextPatch, observationRevision: task.observationRevision + 1 }));
    return updated;
  }

  deletePermanently(taskId, { expectedRevision } = {}) {
    this._ensureWritable();
    if (this.outbox.isFull()) { const error = new Error('event outbox is full'); error.code = 'OUTBOX_FULL'; throw error; }
    const index = this.state.tasks.findIndex((item) => item.id === String(taskId));
    if (index < 0) return false;
    const task = this.state.tasks[index];
    if (expectedRevision !== undefined && Number(expectedRevision) !== task.revision) { const error = new Error('任务状态已变化，请刷新后重试'); error.code = 'REVISION_CONFLICT'; throw error; }
    this.state.tasks.splice(index, 1);
    this.state.repositoryRevision += 1;
    this._appendEvent({ type: 'task.deleted', taskId: task.id, revision: task.revision + 1, payload: { task: clone(task) }, requiredConsumers: ['history', 'links'] });
    this._writeAtomic();
    return true;
  }

  markEngineGenerationLost(generation, reason = 'engine restarted') {
    this._ensureWritable();
    const changed = [];
    for (const task of this.list()) {
      if (['completed', 'failed', 'recycled', 'missing'].includes(task.lifecycle)) continue;
      const next = this.mutate(task.id, { reason: 'engine-down' }, { lifecycle: 'failed', error: mapNativeError(reason, { code: 'ENGINE_RESTARTED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }), engineGeneration: generation });
      changed.push(next);
    }
    return changed;
  }

  appendEventInMutation(event) {
    this._ensureWritable();
    const appended = this._appendEvent(event);
    this._writeAtomic();
    return appended;
  }

  listUnacknowledgedEvents(consumerName) { this._ensureLoaded(); return this.outbox.listUnacknowledged(consumerName); }
  ackEvent(consumerName, sequence) { return this.ackEvents(consumerName, [sequence]) === 1; }
  // 批量 ack 单次落盘：drain 积压时逐条 _writeAtomic 会造成 O(n×文件全量) 写放大
  // （实测 1013 条积压 × 844KB tasks.json ≈ 855MB fsync/消费者，jbd2 排队拖死启动）。
  ackEvents(consumerName, sequences) {
    this._ensureWritable();
    let acked = 0;
    for (const sequence of Array.isArray(sequences) ? sequences : []) {
      if (this.outbox.ack(consumerName, sequence)) acked += 1;
    }
    if (acked) { this.state.repositoryRevision += 1; this._writeAtomic(); }
    return acked;
  }
  flushSync() { this._ensureLoaded(); this._writeAtomic(); }
  close() { if (this.loaded && !this.readOnly) this._writeAtomic(); }
}

module.exports = { TaskRepository, normalizeTaskRecord, sanitizeValue, sourceFingerprint, SCHEMA_VERSION };
