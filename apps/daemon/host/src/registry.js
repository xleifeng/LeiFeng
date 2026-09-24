'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toLegacyStatus, normalizeLifecycle } = require('./domain/task-status');
const { mapNativeError } = require('./domain/task-errors');

const TERMINAL = new Set(['complete', 'error', 'removed']);
const isTerminal = (s) => TERMINAL.has(s);

const SENSITIVE_KEY = /(?:accessToken|refreshToken|sessionId|peerId|peer_id|authorization|token|cert|secret|uid)$/i;

function normalizeFileIndices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b);
}

function cloneFileLists(value) {
  if (!Array.isArray(value)) return [];
  return value.map((f) => ({
    realIndex: Number.isSafeInteger(Number(f.realIndex)) ? Number(f.realIndex) : 0,
    fileName: typeof f.fileName === 'string' ? f.fileName : '',
    fileSize: Number.isFinite(Number(f.fileSize)) ? Number(f.fileSize) : 0,
    fileOffset: Number.isFinite(Number(f.fileOffset)) ? Number(f.fileOffset) : 0,
    filePath: typeof f.filePath === 'string' ? f.filePath : '',
  }));
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v)).filter((v) => v !== undefined);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const safe = sanitizeValue(v, k);
    if (safe !== undefined) out[k] = safe;
  }
  return Object.keys(out).length ? out : undefined;
}

class TaskRegistry {
  constructor(filePath) {
    if (filePath && typeof filePath.get === 'function' && typeof filePath.list === 'function' && typeof filePath.mutate === 'function') {
      this.repository = filePath;
      this.filePath = filePath.filePath;
      this.tasks = null;
      this._compat = true;
      return;
    }
    this.filePath = filePath;
    this.tasks = new Map();
    this._saveTimer = null;
  }
  static fromRepository(repository) { return new TaskRegistry(repository); }
  _legacyView(task) {
    if (!task) return undefined;
    const error = task.error || null;
    return {
      gid: task.id,
      id: task.id,
      engineId: task.engineId,
      parentId: task.parentId,
      url: task.source || '',
      source: task.source,
      savePath: task.savePath,
      taskName: task.displayName,
      displayName: task.displayName,
      totalLength: task.totalBytes,
      totalBytes: task.totalBytes,
      completedLength: task.completedBytes,
      completedBytes: task.completedBytes,
      downloadSpeed: task.downloadBytesPerSecond,
      downloadBytesPerSecond: task.downloadBytesPerSecond,
      uploadSpeed: task.uploadBytesPerSecond,
      status: toLegacyStatus(task.lifecycle),
      lifecycle: task.lifecycle,
      errorCode: error ? error.code : '',
      errorMessage: error ? error.message : '',
      error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      recycledAt: task.recycledAt,
      updatedAt: task.updatedAt,
      taskType: task.kind,
      kind: task.kind,
      infoId: task.infoId || '',
      infoHash: task.infoHash || '',
      metadataPhase: task.lifecycle === 'metadata' ? 'fetching' : task.kind === 'bt' && task.parentId ? 'download' : '',
      selectedFileIndices: normalizeFileIndices(task.selectedFileIndices),
      fileLists: (task.files || []).map((file) => ({ realIndex: file.index, fileName: file.name, fileSize: file.size, fileOffset: file.offset, filePath: file.path })),
      vipEnabled: !task.vip || task.vip.enabled !== false,
      vipState: task.vip && task.vip.state || 'disabled',
      vipLastErrorCode: task.vip && task.vip.lastErrorCode || '',
      vipReceivedLength: task.vip && task.vip.receivedBytes || 0,
      freeDcdnReceivedLength: task.vip && task.vip.freeDcdnReceivedBytes || 0,
      vipNextRefreshAt: task.vip && task.vip.nextRefreshAt || 0,
      revision: task.revision,
      observationRevision: task.observationRevision,
      fileRevision: task.fileRevision,
    };
  }
  _v2Patch(patch = {}) {
    const next = { ...patch };
    if (Object.hasOwn(next, 'status')) { next.lifecycle = normalizeLifecycle(next.status, 'queued'); delete next.status; }
    if (Object.hasOwn(next, 'taskName')) { next.displayName = next.taskName; delete next.taskName; }
    if (Object.hasOwn(next, 'url')) { next.source = next.url || null; delete next.url; }
    if (Object.hasOwn(next, 'totalLength')) { next.totalBytes = next.totalLength; delete next.totalLength; }
    if (Object.hasOwn(next, 'completedLength')) { next.completedBytes = next.completedLength; delete next.completedLength; }
    if (Object.hasOwn(next, 'downloadSpeed')) { next.downloadBytesPerSecond = next.downloadSpeed; delete next.downloadSpeed; }
    if (Object.hasOwn(next, 'uploadSpeed')) { next.uploadBytesPerSecond = next.uploadSpeed; delete next.uploadSpeed; }
    if (Object.hasOwn(next, 'fileLists')) {
      next.files = (next.fileLists || []).map((file) => ({ index: file.realIndex, name: file.fileName, path: file.filePath, size: file.fileSize, offset: file.fileOffset }));
      delete next.fileLists;
    }
    if (Object.hasOwn(next, 'errorCode')) {
      next.error = next.errorCode ? mapNativeError(next.errorCode, { message: next.errorMessage }) : null;
      delete next.errorCode; delete next.errorMessage;
    }
    if (['vipEnabled', 'vipState', 'vipLastErrorCode', 'vipReceivedLength', 'freeDcdnReceivedLength', 'vipNextRefreshAt'].some((key) => Object.hasOwn(next, key))) {
      next.vip = {
        ...(this.repository.get(next.id) || {}).vip,
        ...(Object.hasOwn(next, 'vipEnabled') ? { enabled: next.vipEnabled } : {}),
        ...(Object.hasOwn(next, 'vipState') ? { state: next.vipState } : {}),
        ...(Object.hasOwn(next, 'vipLastErrorCode') ? { lastErrorCode: next.vipLastErrorCode } : {}),
        ...(Object.hasOwn(next, 'vipReceivedLength') ? { receivedBytes: next.vipReceivedLength } : {}),
        ...(Object.hasOwn(next, 'freeDcdnReceivedLength') ? { freeDcdnReceivedBytes: next.freeDcdnReceivedLength } : {}),
        ...(Object.hasOwn(next, 'vipNextRefreshAt') ? { nextRefreshAt: next.vipNextRefreshAt } : {}),
      };
      for (const key of ['vipEnabled', 'vipState', 'vipLastErrorCode', 'vipReceivedLength', 'freeDcdnReceivedLength', 'vipNextRefreshAt']) delete next[key];
    }
    return next;
  }
  load() {
    if (this._compat) { this.repository.load(); return; }
    let arr = null;
    try {
      arr = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        try {
          const bak = this.filePath + '.corrupt-' + Date.now();
          fs.copyFileSync(this.filePath, bak);
          console.error('[registry] corrupted registry backed up to', bak);
        } catch {}
      }
      arr = [];
    }
    if (!Array.isArray(arr)) arr = [];
    for (const r of arr) this.tasks.set(r.gid, r);
    // 上次异常退出留下的非终态任务 → interrupted（跨重启语义）
    for (const r of this.tasks.values()) {
      if (!isTerminal(r.status)) {
        r.status = 'error'; r.errorCode = 'interrupted'; r.errorMessage = 'daemon restarted';
      }
    }
  }
  create({ url, savePath, taskName, totalLength, engineId, taskType, infoId, infoHash, metadataPhase,
    selectedFileIndices, fileLists, vipEnabled = true }) {
    if (this._compat) {
      const task = this.repository.create({ id: crypto.randomBytes(8).toString('hex'), source: url || null, savePath, displayName: taskName, totalBytes: totalLength || 0, engineId, kind: taskType || 'http', infoId: infoId || '', infoHash: infoHash || '', selectedFileIndices, files: (fileLists || []).map((file) => ({ index: file.realIndex, name: file.fileName, size: file.fileSize, offset: file.fileOffset, path: file.filePath })), lifecycle: metadataPhase === 'fetching' ? 'metadata' : 'queued', vip: { enabled: vipEnabled !== false } });
      return this._legacyView(task);
    }
    const gid = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const rec = { gid, engineId, url: url || '', savePath, taskName, totalLength: totalLength || 0,
      completedLength: 0, downloadSpeed: 0, status: 'waiting', errorCode: '', errorMessage: '',
      createdAt: now, updatedAt: now,
      taskType: taskType || 'http', infoId: infoId || '', infoHash: infoHash || '', metadataPhase: metadataPhase || '',
      selectedFileIndices: normalizeFileIndices(selectedFileIndices), fileLists: cloneFileLists(fileLists),
      vipEnabled: vipEnabled !== false, vipState: 'disabled', vipLastResult: '', vipLastErrorCode: '',
      vipLastAttemptAt: 0, vipNextRefreshAt: 0, vipReceivedLength: 0, freeDcdnReceivedLength: 0 };
    this.tasks.set(gid, rec);
    this._scheduleSave();
    return rec;
  }
  get(gid) { return this._compat ? this._legacyView(this.repository.get(gid)) : this.tasks.get(gid); }
  findDuplicate(taskType, key, savePath) {
    if (this._compat) {
      return this.list().find((record) => !isTerminal(record.status) && record.taskType === taskType && (taskType === 'bt' ? record.infoId : taskType === 'magnet' ? record.infoHash : record.url) === key && record.savePath === savePath);
    }
    for (const r of this.tasks.values()) {
      if (isTerminal(r.status)) continue;
      if (r.taskType !== taskType) continue;
      const rKey = taskType === 'bt' ? r.infoId : taskType === 'magnet' ? r.infoHash : r.url;
      if (rKey === key && r.savePath === savePath) return r;
    }
    return undefined;
  }
  update(gid, patch) {
    if (this._compat) {
      const current = this.repository.get(gid);
      if (!current) return undefined;
      const next = this.repository.mutate(gid, { reason: 'legacy-update' }, this._v2Patch({ ...patch, id: gid }));
      return this._legacyView(next);
    }
    const r = this.tasks.get(gid);
    if (!r) return undefined;
    const safePatch = sanitizeValue(patch || {});
    if (safePatch && Object.hasOwn(safePatch, 'selectedFileIndices'))
      safePatch.selectedFileIndices = normalizeFileIndices(safePatch.selectedFileIndices);
    if (safePatch && Object.hasOwn(safePatch, 'fileLists'))
      safePatch.fileLists = cloneFileLists(safePatch.fileLists);
    Object.assign(r, safePatch, { updatedAt: Date.now() });
    this._scheduleSave();
    return r;
  }
  delete(gid) {
    if (this._compat) return this.repository.deletePermanently(gid);
    const existed = this.tasks.delete(gid);
    if (existed) this._scheduleSave();
    return existed;
  }
  list() { return this._compat ? this.repository.list().map((task) => this._legacyView(task)) : [...this.tasks.values()]; }
  counts() {
    if (this._compat) {
      let active = 0; let waiting = 0; let stopped = 0;
      for (const record of this.list()) {
        if (record.status === 'active') active += 1;
        else if (record.status === 'waiting' || record.status === 'paused') waiting += 1;
        else stopped += 1;
      }
      return { active, waiting, stopped };
    }
    let active = 0, waiting = 0, stopped = 0;
    for (const r of this.tasks.values()) {
      if (r.status === 'active') active++;
      else if (r.status === 'waiting' || r.status === 'paused') waiting++;
      else stopped++;
    }
    return { active, waiting, stopped };
  }
  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.saveSync(); }, 200);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }
  saveSync() {
    if (this._compat) return this.repository.flushSync();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.list(), null, 1));
    fs.renameSync(tmp, this.filePath);
  }
}

module.exports = { TaskRegistry, isTerminal, normalizeFileIndices, cloneFileLists, sanitizeValue };
