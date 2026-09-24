'use strict';

class HistoryService {
  constructor({ repository, tasks, eventBus = null, privateSpace = null, createDraftService = null } = {}) { if (!repository) throw new Error('HistoryService repository is required'); this.repository = repository; this.tasks = tasks; this.eventBus = eventBus; this.privateSpace = privateSpace; this.createDraftService = createDraftService; this.unsubscribers = []; }
  start() {
    const consume = (event = {}) => {
      const task = event.task || event.payload?.task || this.tasks?.get?.(event.taskId);
      if (task && ['completed', 'failed', 'recycled', 'missing'].includes(task.lifecycle)) this.repository.upsertFromTask(task, { eventRevision: event.revision || task.revision, privatePayload: task.privatePayload || null });
    };
    if (this.tasks?.listUnacknowledgedEvents) {
      // 批量 ack 单次落盘 + 积压消费包单事务（见 TaskRepository.ackEvents）：逐事件逐条落盘会 fsync 风暴
      //（实测 1013 条积压 × 全量 tasks.json + 每事件多条自提交 sqlite 语句在 synchronous=FULL 下拖死启动）。
      const pending = this.tasks.listUnacknowledgedEvents('history');
      const inTransaction = pending.length > 1 && typeof this.repository.db?.transaction === 'function';
      const run = () => { for (const event of pending) consume(event); };
      if (inTransaction) this.repository.db.transaction(run); else run();  // SqliteDatabase.transaction(fn) 自执行
      const ack = () => this.tasks.ackEvents?.('history', pending.map((event) => event.sequence));
      if (!ack()) for (const event of pending) this.tasks.ackEvent?.('history', event.sequence);
    }
    if (!this.eventBus) return;
    for (const type of ['task.transition', 'task.created', 'task.recycled', 'task.deleted']) this.unsubscribers.push(this.eventBus.on(type, consume));
  }
  _private(context) { if (!context || !context.privateSession || !this.privateSpace?.authorize?.(context.privateSession)) throw Object.assign(new Error('私人空间已锁定'), { code: 'PRIVATE_SPACE_LOCKED' }); return true; }
  _present(row) { if (!row || !row.privateSpace) return row; const payload = this.privateSpace.decryptPayload(row.privatePayload); const { privatePayload: _ignored, ...safe } = row; return { ...safe, displayName: payload.displayName || '私人任务', source: payload.source || null, savePath: payload.savePath || null, seedRef: payload.seedRef || row.seedRef }; }
  query(input = {}, context = {}) { const privateMode = input.privateMode === true; if (privateMode) this._private(context); const result = this.repository.query({ ...input, privateMode }); if (!privateMode) return result; const search = String(input.search || '').toLocaleLowerCase(); return { ...result, items: result.items.map((row) => this._present(row)).filter((row) => !search || `${row.displayName || ''} ${row.source || ''}`.toLocaleLowerCase().includes(search)) }; }
  get(historyId, context = {}) { const row = this.repository.get(historyId, { allowPrivate: context.privateSession && this.privateSpace?.authorize?.(context.privateSession) }); if (!row) throw Object.assign(new Error('下载记录不存在'), { code: 'HISTORY_NOT_FOUND' }); if (row.privateSpace && !row.privatePayload) throw Object.assign(new Error('私人空间已锁定'), { code: 'PRIVATE_SPACE_LOCKED' }); return this._present(row); }
  remove(ids, context = {}) { if (context.privateMode) this._private(context); return this.repository.softDelete(ids); }
  clear(input = {}, context = {}) { if (input.privateMode) this._private(context); return this.repository.clear(input); }
  async createDraft(historyId, context = {}) { const row = this.get(historyId, context); if (!this.createDraftService) throw Object.assign(new Error('创建服务不可用'), { code: 'CREATE_SERVICE_UNAVAILABLE' }); const input = row.kind === 'bt' ? { kind: 'torrent', value: row.seedRef } : { kind: 'link', value: row.source }; return this.createDraftService.preflight({ inputs: [input], savePath: row.savePath }); }
  stop() { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe(); }
}

module.exports = { HistoryService };
