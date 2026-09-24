'use strict';

class NotificationService {
  constructor({ eventBus, tasks, adapter, clock = Date, windowMs = 10 * 1000 } = {}) {
    this.eventBus = eventBus; this.tasks = tasks; this.adapter = adapter; this.clock = clock; this.windowMs = windowMs; this.bucket = null; this.timer = null; this.unsubscribe = null;
  }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  start() { if (!this.eventBus || this.unsubscribe) return this; this.unsubscribe = this.eventBus.on('task.transition', (event) => this.onTransition(event)); return this; }
  stop() { this.unsubscribe?.(); this.unsubscribe = null; if (this.timer) clearTimeout(this.timer); this.timer = null; this.bucket = null; }
  onTransition(event = {}) {
    if (!['completed', 'failed'].includes(String(event.to))) return;
    const task = event.task || this.tasks?.get?.(event.taskId) || {};
    if (!this.bucket) this.bucket = { completed: [], privateCompleted: 0, failed: [] };
    if (event.to === 'completed') { if (task.privateSpace === true) this.bucket.privateCompleted += 1; else this.bucket.completed.push({ id: task.id || event.taskId, name: task.displayName || '下载任务' }); }
    else this.bucket.failed.push({ id: task.id || event.taskId, name: task.privateSpace === true ? '私人空间任务' : task.displayName || '下载任务' });
    if (!this.timer) { this.timer = setTimeout(() => this.flush().catch(() => {}), this.windowMs); this.timer.unref?.(); }
  }
  async flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = null; const bucket = this.bucket; this.bucket = null; if (!bucket || !this.adapter) return { delivered: false };
    const lines = []; if (bucket.completed.length) lines.push(`已完成 ${bucket.completed.length} 个任务${bucket.completed.length <= 3 ? `：${bucket.completed.map((item) => item.name).join('、')}` : ''}`); if (bucket.privateCompleted) lines.push(`私人空间已完成 ${bucket.privateCompleted} 个任务`); if (bucket.failed.length) lines.push(`失败 ${bucket.failed.length} 个任务`);
    return this.adapter.show ? this.adapter.show({ title: '迅雷下载', body: lines.join('\n') }) : this.adapter.notify?.({ title: '迅雷下载', body: lines.join('\n') });
  }
}

module.exports = { NotificationService };
