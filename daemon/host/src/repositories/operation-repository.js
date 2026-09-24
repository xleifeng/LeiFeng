'use strict';

const fs = require('fs');
const path = require('path');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

class OperationRepository {
  constructor({ filePath, clock = Date, maxCompleted = 100 } = {}) {
    if (!filePath) throw new Error('OperationRepository filePath is required');
    this.filePath = filePath; this.clock = clock; this.maxCompleted = maxCompleted; this.records = []; this.loaded = false;
  }

  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  load() { if (this.loaded) return this; this.loaded = true; try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); if (value && value.schemaVersion === 1 && Array.isArray(value.operations)) this.records = value.operations; } catch {} return this; }
  _write() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.tmp`; fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, operations: this.records }, null, 2), { mode: 0o600 }); const fd = fs.openSync(temp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, this.filePath); }
  _ensure() { if (!this.loaded) this.load(); }
  prepare(input = {}) { this._ensure(); const record = { operationId: String(input.operationId), idempotencyKey: String(input.idempotencyKey || ''), taskId: String(input.taskId), command: String(input.command), state: 'prepared', beforeRevision: Number(input.beforeRevision) || 0, afterRevision: null, params: clone(input.params || {}), nativeGeneration: Number(input.nativeGeneration) || 0, evidence: {}, problem: null, result: null, createdAt: this._now(), updatedAt: this._now() }; this.records = this.records.filter((item) => item.operationId !== record.operationId); this.records.push(record); this._write(); return clone(record); }
  get(operationId) { this._ensure(); const record = this.records.find((item) => item.operationId === String(operationId)); return record ? clone(record) : null; }
  findByIdempotencyKey(key) { this._ensure(); const record = this.records.find((item) => item.idempotencyKey && item.idempotencyKey === String(key)); return record ? clone(record) : null; }
  update(operationId, patch = {}) { this._ensure(); const index = this.records.findIndex((item) => item.operationId === String(operationId)); if (index < 0) throw new Error('operation not found'); this.records[index] = { ...this.records[index], ...clone(patch), updatedAt: this._now() }; this._write(); return clone(this.records[index]); }
  markNativeCalled(operationId, evidence = {}) { return this.update(operationId, { state: 'native-called', evidence }); }
  markFilesystem(operationId, evidence = {}) { return this.update(operationId, { state: 'filesystem', evidence }); }
  markReconciling(operationId, reason) { return this.update(operationId, { state: 'reconciling', problem: clone(reason) }); }
  commit(operationId, { afterRevision = null, result = null } = {}) { return this.update(operationId, { state: 'committed', afterRevision, result }); }
  fail(operationId, problem) { return this.update(operationId, { state: 'failed', problem: clone(problem) }); }
  uncertain(operationId, problem) { return this.update(operationId, { state: 'uncertain', problem: clone(problem) }); }
  listRecoverable() { this._ensure(); return this.records.filter((item) => !['committed', 'failed'].includes(item.state)).map(clone); }
  list() { this._ensure(); return this.records.map(clone); }
  prune() { this._ensure(); const active = this.records.filter((item) => !['committed', 'failed'].includes(item.state)); const completed = this.records.filter((item) => ['committed', 'failed'].includes(item.state)).slice(-this.maxCompleted); this.records = [...active, ...completed]; this._write(); return this.records.length; }
}

module.exports = { OperationRepository };
