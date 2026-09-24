'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertDraftTransition } = require('../domain/create-draft');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function now(clock) { return Number(clock && clock.now ? clock.now() : Date.now()); }
function draftError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

class DraftRepository {
  constructor({ filePath, clock = Date, idFactory = () => crypto.randomBytes(8).toString('hex'), ttlMs = 30 * 60 * 1000 } = {}) {
    if (!filePath) throw new Error('DraftRepository filePath is required');
    this.filePath = filePath; this.clock = clock; this.idFactory = idFactory; this.ttlMs = ttlMs; this.state = { schemaVersion: 1, drafts: [] }; this.loaded = false; this.revision = 0;
  }
  load() { if (this.loaded) return this; this.loaded = true; try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); if (value && value.schemaVersion === 1 && Array.isArray(value.drafts)) this.state = value; } catch {} this.revision = this.state.drafts.reduce((max, item) => Math.max(max, Number(item.revision) || 0), 0); return this; }
  _write() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); const fd = fs.openSync(tmp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, this.filePath); }
  _ensure() { if (!this.loaded) this.load(); }
  create(input = {}) { this._ensure(); const timestamp = now(this.clock); const draft = { schemaVersion: 1, draftId: String(input.draftId || this.idFactory()), revision: 1, state: input.state || 'probing', kind: input.kind, originalSource: input.originalSource || null, normalizedSource: input.normalizedSource || null, sourceFingerprint: String(input.sourceFingerprint || ''), seedRef: input.seedRef || null, displayName: String(input.displayName || 'download.bin'), savePath: String(input.savePath || ''), totalBytes: input.totalBytes === null || input.totalBytes === undefined ? null : Math.max(0, Number(input.totalBytes) || 0), files: Array.isArray(input.files) ? clone(input.files) : [], selectedFileIndices: Array.isArray(input.selectedFileIndices) ? [...new Set(input.selectedFileIndices.map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))] : [], duplicate: input.duplicate || null, metadataJob: input.metadataJob || null, failure: input.failure || null, expiresAt: Number(input.expiresAt) || timestamp + this.ttlMs, commitOperationId: null, createdAt: timestamp, updatedAt: timestamp, options: input.options || {} };
    this.state.drafts.push(draft); this.revision += 1; this._write(); return clone(draft);
  }
  get(draftId) { this._ensure(); const draft = this.state.drafts.find((item) => item.draftId === String(draftId)); return draft ? clone(draft) : null; }
  require(draftId) { const draft = this.get(draftId); if (!draft) throw draftError('DRAFT_NOT_FOUND', '任务草稿不存在或已过期'); return draft; }
  list() { this._ensure(); return this.state.drafts.map(clone); }
  mutate(draftId, expectedRevision, patch = {}) { this._ensure(); const index = this.state.drafts.findIndex((item) => item.draftId === String(draftId)); if (index < 0) throw draftError('DRAFT_NOT_FOUND', '任务草稿不存在或已过期'); const current = this.state.drafts[index]; if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) throw draftError('REVISION_CONFLICT', '草稿状态已变化，请刷新后重试', { draftId: current.draftId, revision: current.revision }); if (patch.state && patch.state !== current.state) assertDraftTransition(current.state, patch.state); const next = { ...current, ...clone(patch), revision: current.revision + 1, updatedAt: now(this.clock) }; this.state.drafts[index] = next; this.revision += 1; this._write(); return clone(next); }
  beginCommit(draftId, expectedRevision, operationId) { const draft = this.require(draftId); if (draft.state === 'committed') return draft; if (draft.state !== 'ready') throw draftError('DRAFT_NOT_READY', '草稿尚未准备完成'); return this.mutate(draftId, expectedRevision, { state: 'committing', commitOperationId: String(operationId) }); }
  finishCommit(draftId, operationId, taskIds) { const draft = this.require(draftId); if (draft.state === 'committed') return draft; if (draft.state !== 'committing' || draft.commitOperationId !== String(operationId)) throw draftError('DRAFT_COMMIT_MISMATCH', '草稿提交操作不匹配'); const nowValue = now(this.clock); return this.mutate(draftId, undefined, { state: 'committed', commitOperationId: String(operationId), taskIds: Array.isArray(taskIds) ? taskIds.map(String) : [], expiresAt: nowValue + 10 * 60 * 1000 }); }
  cancel(draftId, reason = 'user') { const draft = this.require(draftId); if (draft.state === 'committing') return this.mutate(draftId, undefined, { cancelRequested: true, cancelReason: reason }); if (draft.state === 'committed') return draft; return this.mutate(draftId, undefined, { state: 'cancelled', failure: { code: 'DRAFT_CANCELLED', message: reason } }); }
  sweepExpired(at = now(this.clock)) { this._ensure(); let count = 0; const retained = []; for (const draft of this.state.drafts) { if (draft.expiresAt <= at && ['committed', 'cancelled', 'expired'].includes(draft.state)) { count += 1; continue; } if (draft.expiresAt <= at && draft.state !== 'committing') { draft.state = 'expired'; draft.revision += 1; draft.updatedAt = at; count += 1; } retained.push(draft); } if (count) { this.state.drafts = retained; this.revision += count; this._write(); } return count; }
}

module.exports = { DraftRepository, draftError };
