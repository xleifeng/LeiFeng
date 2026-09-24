'use strict';

const fs = require('fs');
const path = require('path');
const { selectTorrentRelativePath } = require('./torrent-path');

class MagnetMetadataService {
  constructor({ drafts, driver, seedStore = null, runtimeDir, timeoutMs = 120000, clock = Date } = {}) { if (!drafts || !driver || !runtimeDir) throw new Error('MagnetMetadataService dependencies are incomplete'); this.drafts = drafts; this.driver = driver; this.seedStore = seedStore; this.runtimeDir = runtimeDir; this.timeoutMs = timeoutMs; this.clock = clock; this.inflight = new Set(); }
  _dir(draftId) { return path.join(this.runtimeDir, 'metadata', String(draftId)); }
  async start({ draft }) {
    if (!draft || draft.kind !== 'magnet') throw new Error('metadata draft must be magnet');
    const dir = this._dir(draft.draftId); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const engineId = await this.driver.createTask({ taskType: 5, savePath: dir, taskName: `${draft.displayName || draft.draftId}.torrent`, info: { url: draft.normalizedSource || draft.originalSource, torrentFilePath: dir } });
    await this.driver.startTasks([engineId]);
    this.drafts.mutate(draft.draftId, draft.revision, { state: 'metadata', metadataJob: { engineId, infoHash: String((draft.options && draft.options.infoHash) || ''), deadlineAt: (this.clock.now ? this.clock.now() : Date.now()) + this.timeoutMs } });
    return this.drafts.get(draft.draftId);
  }
  async pollOnce(draftId) {
    const draft = this.drafts.get(draftId); if (!draft || draft.state !== 'metadata' || !draft.metadataJob) return draft;
    if (this.inflight.has(String(draftId))) return draft;
    this.inflight.add(String(draftId));
    try {
    const now = this.clock.now ? this.clock.now() : Date.now(); const dir = this._dir(draftId); let candidate = null;
    try { candidate = fs.readdirSync(dir).map((name) => path.join(dir, name)).find((file) => file.endsWith('.torrent') && fs.statSync(file).size > 100); } catch {}
    if (candidate) {
      try {
        const parsed = await this.driver.parseTaskInfo({ kind: 'torrent', data: candidate }); const files = (parsed.fileLists || []).map((file, index) => { const realIndex = Number.isSafeInteger(Number(file.realIndex)) ? Number(file.realIndex) : index; const relativePath = selectTorrentRelativePath(file, index); return { index: realIndex, relativePath, displayName: path.posix.basename(relativePath), sizeBytes: Number(file.fileSize) || 0, offsetBytes: Number(file.fileOffset) || 0, selected: true, parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath) }; }); const seedRef = this.seedStore ? this.seedStore.importFile(candidate) : candidate; const ready = this.drafts.mutate(draftId, draft.revision, { state: 'ready', seedRef, files, selectedFileIndices: files.map((file) => file.index), totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), options: { ...(draft.options || {}), infoId: parsed.infoId }, metadataJob: null }); this.seedStore?.retain?.(seedRef, `draft:${draftId}`); await this.driver.stopTasks([draft.metadataJob.engineId]).catch(() => {}); await this.driver.deleteTasks([draft.metadataJob.engineId]).catch(() => {}); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} return ready;
      } catch (error) { this.drafts.mutate(draftId, draft.revision, { failure: { code: 'METADATA_PARSE_FAILED', message: error.message } }); }
    }
    if (now >= Number(draft.metadataJob.deadlineAt)) {
      await this._stopAndCleanup(draft);
      const current = this.drafts.get(draftId);
      if (current && current.state === 'metadata') return this.drafts.mutate(draftId, current.revision, { state: 'failed', metadataJob: null, failure: { code: 'METADATA_TIMEOUT', message: '磁力链接元数据获取超时' } });
    }
    return this.drafts.get(draftId);
    } finally { this.inflight.delete(String(draftId)); }
  }
  async pollAll() { for (const draft of this.drafts.list().filter((item) => item.state === 'metadata')) await this.pollOnce(draft.draftId).catch(() => {}); }
  async _stopAndCleanup(draft) { if (draft.metadataJob && Number.isSafeInteger(draft.metadataJob.engineId)) { await this.driver.stopTasks([draft.metadataJob.engineId]).catch(() => {}); await this.driver.deleteTasks([draft.metadataJob.engineId]).catch(() => {}); } try { fs.rmSync(this._dir(draft.draftId), { recursive: true, force: true }); } catch {} }
  async cancel(draftId, reason = 'user') { const draft = this.drafts.get(draftId); if (!draft) return null; await this._stopAndCleanup(draft); this.inflight.delete(String(draftId)); return ['committed', 'cancelled', 'expired'].includes(draft.state) ? draft : this.drafts.mutate(draftId, draft.revision, { state: 'cancelled', metadataJob: null, failure: { code: 'METADATA_CANCELLED', message: reason } }); }
  async recoverAfterRestart() { for (const draft of this.drafts.list().filter((item) => item.state === 'metadata')) { await this._stopAndCleanup(draft); try { this.drafts.mutate(draft.draftId, draft.revision, { state: 'failed', metadataJob: null, failure: { code: 'METADATA_INTERRUPTED', message: 'daemon 重启导致 metadata 任务中断' } }); } catch {} } }
}

module.exports = { MagnetMetadataService };
