'use strict';

class CompletionActionService {
  constructor({ tasks, policyProvider, taskService, driver = null, powerAdapter = null, notification = null, clock = Date, countdownMs = 60000 } = {}) { this.tasks = tasks; this.policyProvider = policyProvider || (() => ({})); this.taskService = taskService; this.driver = driver; this.powerAdapter = powerAdapter; this.notification = notification; this.clock = clock; this.countdownMs = countdownMs; this.epoch = { id: 0, completed: false, started: false }; this.pending = null; this.timer = null; }
  _policy() { const value = this.policyProvider() || {}; return value.policy || value; }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  onTaskTransition(event = {}) { if (event.from && event.from !== 'completed') this.epoch.started = true; if (event.to === 'completed') this.epoch.completed = true; if (this.epoch.started) this.evaluate(); }
  evaluate() { if (this.pending || !this.epoch.started || !this.epoch.completed) return null; const active = this.tasks.list().filter((task) => task.privateSpace !== true && !['completed', 'failed', 'recycled', 'missing'].includes(task.lifecycle)); if (active.length) return null; const action = this._policy().completionAction || 'none'; if (action === 'none') return null; return this.scheduleCountdown(action); }
  scheduleCountdown(action) { const operationId = `completion-${this._now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; this.pending = { operationId, action, createdAt: this._now(), expiresAt: this._now() + this.countdownMs, cancelled: false }; this.notification?.notify?.({ title: '下载完成', body: `${action} 将在 ${Math.ceil(this.countdownMs / 1000)} 秒后执行` }).catch?.(() => {}); this.timer = setTimeout(() => this.execute(operationId).catch(() => {}), this.countdownMs); if (this.timer.unref) this.timer.unref(); return { ...this.pending }; }
  getPending() { return this.pending ? { ...this.pending } : null; }
  cancel(operationId) { if (!this.pending || (operationId && this.pending.operationId !== operationId)) return false; if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending.cancelled = true; this.pending = null; return true; }
  async execute(operationId) { if (!this.pending || this.pending.operationId !== operationId || this.pending.cancelled) return { cancelled: true }; const action = this.pending.action; this.pending = null; this.timer = null; if (action === 'pause-all') { const ids = this.tasks.list().filter((task) => ['downloading', 'queued'].includes(task.lifecycle)).map((task) => task.id); if (ids.length) await this.taskService.command({ taskIds: ids, command: 'pause', options: {}, idempotencyKey: operationId }); } else if (action === 'stop-engine') { await this.driver?.shutdown?.(); } else if (action === 'suspend') await this.powerAdapter?.suspend?.(); else if (action === 'poweroff') await this.powerAdapter?.poweroff?.(); return { executed: true, action }; }
  recoverAfterRestart() { this.pending = null; this.timer = null; }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null; }
}

module.exports = { CompletionActionService };
