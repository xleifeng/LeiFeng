'use strict';

class LinkLibraryService {
  constructor({ repository, tasks = null, privateSpace = null, createDraftService = null, eventBus = null } = {}) { if (!repository) throw new Error('LinkLibraryService repository is required'); this.repository = repository; this.tasks = tasks; this.privateSpace = privateSpace; this.createDraftService = createDraftService; this.eventBus = eventBus; this.unsubscribers = []; }
  start() {
    const consume = (event = {}) => {
      const task = event.task || event.payload?.task || this.tasks?.get?.(event.taskId);
      if (!task || !task.source && !task.seedRef) return;
      if (task.lifecycle === 'recycled' || task.lifecycle === 'missing') return;
      try { this.repository.save({ id: undefined, source: task.source, sourceFingerprint: task.sourceFingerprint, kind: task.kind === 'magnet' ? 'magnet' : task.kind, title: task.displayName, infoHash: task.kind === 'bt' ? task.sourceFingerprint : undefined, seedRef: task.seedRef, totalBytes: task.totalBytes, privateSpace: task.privateSpace === true, privatePayload: task.privatePayload || null, files: task.files }, { autoSaved: true }); } catch {}
    };
    if (this.eventBus && this.eventBus.on) for (const type of ['task.created', 'task.transition', 'task.updated', 'task.deleted']) this.unsubscribers.push(this.eventBus.on(type, consume));
    if (this.tasks?.listUnacknowledgedEvents) {
      // 批量 ack 单次落盘 + 积压消费包单事务（见 TaskRepository.ackEvents / HistoryService.start）：逐事件落盘会 fsync 风暴。
      const pending = this.tasks.listUnacknowledgedEvents('links');
      const inTransaction = pending.length > 1 && typeof this.repository.db?.transaction === 'function';
      const run = () => { for (const event of pending) consume(event); };
      if (inTransaction) this.repository.db.transaction(run); else run();  // SqliteDatabase.transaction(fn) 自执行
      const ack = () => this.tasks.ackEvents?.('links', pending.map((event) => event.sequence));
      if (!ack()) for (const event of pending) this.tasks.ackEvent?.('links', event.sequence);
    }
  }
  _private(context) { if (!context || !context.privateSession || !this.privateSpace?.authorize?.(context.privateSession)) throw Object.assign(new Error('私人空间已锁定'), { code: 'PRIVATE_SPACE_LOCKED' }); }
  _present(row) { if (!row || !row.privateSpace) return row; const payload = this.privateSpace.decryptPayload(row.privatePayload); const { privatePayload: _ignored, ...safe } = row; return { ...safe, title: payload.title || row.title, source: payload.source || null, infoHash: payload.infoHash || row.infoHash, seedRef: payload.seedRef || row.seedRef, files: payload.files || row.files || [] }; }
  query(input = {}, context = {}) { const privateMode = input.privateMode === true; if (privateMode) this._private(context); const result = this.repository.query({ ...input, privateMode }); if (!privateMode) return result; const search = String(input.search || '').toLocaleLowerCase(); return { ...result, items: result.items.map((row) => this._present(row)).filter((row) => !search || `${row.title || ''} ${row.source || ''} ${(row.tags || []).map((tag) => tag.name).join(' ')}`.toLocaleLowerCase().includes(search)) }; }
  get(id, context = {}) { const row = this.repository.get(id, { allowPrivate: context.privateSession && this.privateSpace?.authorize?.(context.privateSession) }); if (!row) throw Object.assign(new Error('链接不存在'), { code: 'LINK_NOT_FOUND' }); if (row.privateSpace && !row.privatePayload) throw Object.assign(new Error('私人空间已锁定'), { code: 'PRIVATE_SPACE_LOCKED' }); return this._present(row); }
  save(input, context = {}) { if (input.privateSpace) { this._private(context); const payload = { source: input.source, title: input.title, kind: input.kind, infoHash: input.infoHash, seedRef: input.seedRef, files: input.files }; return this._present(this.repository.save({ ...input, title: '私人链接', source: null, infoHash: null, seedRef: null, privatePayload: this.privateSpace.encryptPayload(payload), sourceFingerprint: `private-hmac:${input.sourceFingerprint || input.source || input.id || ''}` })); } return this.repository.save(input); }
  setFavorite(id, value, options = {}, context = {}) { const current = this.repository.get(id, { allowPrivate: true }); if (current?.privateSpace) this._private(context); const row = this.repository.setFavorite(id, value, options); return this._present(row); }
  setTags(id, tags, options = {}, context = {}) { const current = this.repository.get(id, { allowPrivate: true }); if (current?.privateSpace) this._private(context); const row = this.repository.setTags(id, tags, options); return this._present(row); }
  remove(ids, context = {}) { if (context.privateMode) this._private(context); return this.repository.remove(ids); }
  async createDraft(id, context = {}) { const row = this.get(id, context); if (!this.createDraftService) throw Object.assign(new Error('创建服务不可用'), { code: 'CREATE_SERVICE_UNAVAILABLE' }); return this.createDraftService.preflight({ inputs: [{ kind: row.kind === 'bt' ? 'torrent' : 'link', value: row.source || row.seedRef }], savePath: row.privateSpace ? undefined : undefined }); }
  stop() { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe(); }
}

module.exports = { LinkLibraryService };
