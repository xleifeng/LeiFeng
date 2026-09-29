'use strict';

class IdleDownloadController {
  constructor({ adapter, scheduler, tasks, policyProvider, clock = Date, pollMs = 15000 } = {}) { this.adapter = adapter; this.scheduler = scheduler; this.tasks = tasks; this.policyProvider = policyProvider || (() => ({})); this.clock = clock; this.pollMs = pollMs; this.timer = null; this.started = new Set(); this.disabled = false; }
  _policy() { const value = this.policyProvider() || {}; return value.policy || value; }
  async tick() { if (this.disabled || !this.adapter?.isAvailable?.()) return; const policy = this._policy(); if (!policy.idleDownload?.enabled) return; try { const idle = await this.adapter.getIdleSeconds(); if (idle >= policy.idleDownload.idleAfterSeconds) { for (const task of this.tasks.list().filter((item) => item.idleEligible !== false && ['queued', 'paused'].includes(item.lifecycle))) { await this.scheduler.taskService.startOne(task).catch(() => {}); this.started.add(task.id); this.scheduler.markStartedByIdle(task.id); } } else if (policy.idleDownload.pauseOnActivity) { for (const id of this.started) { const task = this.tasks.get(id); if (task) await this.scheduler.taskService.pauseOne(task).catch(() => {}); } this.started.clear(); } } catch { this.disabled = true; } }
  start() { if (this.timer) return; this.timer = setInterval(() => this.tick().catch(() => {}), this.pollMs); if (this.timer.unref) this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.adapter?.close?.(); this.started.clear(); }
}

module.exports = { IdleDownloadController };
