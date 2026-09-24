'use strict';

const { sortQueue, eligible, compactPositions } = require('../domain/queue-policy');

class TaskSchedulerService {
  constructor({ tasks, taskService, policyProvider, driver = null, clock = Date, eventBus = null } = {}) {
    if (!tasks || !taskService) throw new Error('TaskSchedulerService dependencies are incomplete');
    this.tasks = tasks; this.taskService = taskService; this.policyProvider = policyProvider || (() => ({})); this.driver = driver; this.clock = clock; this.eventBus = eventBus;
    this.reconciling = false; this.reconcileRequested = false; this.stopped = false; this.slowWindows = new Map(); this.startedByIdle = new Set();
  }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  _policy() { const value = this.policyProvider() || {}; return value.policy || value; }
  requestReconcile(reason = 'unknown') { if (this.stopped) return; this.reconcileRequested = true; Promise.resolve().then(() => this.reconcile(reason)).catch(() => {}); }

  async reconcile(reason = 'manual') {
    if (this.stopped) return { reason, changed: [] };
    if (this.reconciling) { this.reconcileRequested = true; return { reason, queued: true, changed: [] }; }
    this.reconciling = true;
    const changed = [];
    try {
      const policy = this._policy(); const max = Math.max(1, Math.min(100, Number(policy.maxConcurrentTasks) || 1));
      const tasks = this.tasks.list().filter((task) => ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle));
      const running = sortQueue(tasks.filter((task) => task.lifecycle === 'downloading'));
      for (const task of running.slice(max)) {
        try { const paused = await this.taskService.pauseOne(task); const next = this.tasks.mutate(task.id, { expectedRevision: paused.revision, reason: 'scheduler-limit' }, { schedulerPaused: true, userPaused: false }); changed.push({ taskId: task.id, action: 'pause', revision: next.revision }); } catch {}
      }
      const slots = Math.max(0, max - Math.min(max, running.length));
      const candidates = sortQueue(tasks.filter(eligible)).slice(0, slots);
      for (const task of candidates) {
        try { const started = await this.taskService.startOne(task); const next = this.tasks.mutate(task.id, { expectedRevision: started.revision, reason: 'scheduler-start' }, { schedulerPaused: false }); changed.push({ taskId: task.id, action: 'start', revision: next.revision }); } catch {}
      }
      this.eventBus?.emit?.('scheduler.reconciled', { reason, changed });
      return { reason, changed };
    } finally {
      this.reconciling = false;
      if (this.reconcileRequested && !this.stopped) { this.reconcileRequested = false; setImmediate(() => this.reconcile('coalesced').catch(() => {})); }
    }
  }

  async move({ taskIds, target } = {}) {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String).filter(Boolean))];
    if (!ids.length) throw Object.assign(new Error('taskIds 不能为空'), { code: 'INVALID_ARGUMENT' });
    const all = sortQueue(this.tasks.list().filter((task) => task.lifecycle !== 'recycled'));
    const selected = all.filter((task) => ids.includes(task.id));
    if (!selected.length) throw Object.assign(new Error('任务不存在'), { code: 'TASK_NOT_FOUND' });
    const rest = all.filter((task) => !ids.includes(task.id));
    const index = target === 'top' ? 0 : target === 'bottom' ? rest.length : Number.isSafeInteger(Number(target)) ? Math.max(0, Math.min(rest.length, Number(target))) : Math.max(0, Math.min(rest.length, rest.findIndex((task) => ids.includes(task.id))));
    let ordered;
    if (target === 'up' || target === 'down') {
      const first = all.findIndex((task) => ids.includes(task.id));
      const moveTo = Math.max(0, Math.min(all.length - 1, first + (target === 'up' ? -1 : 1)));
      ordered = [...all];
      if (first >= 0 && moveTo >= 0) { const [item] = ordered.splice(first, 1); ordered.splice(moveTo, 0, item); }
    } else { ordered = [...rest.slice(0, index), ...selected, ...rest.slice(index)]; }
    const positions = compactPositions(ordered); const changed = [];
    for (const item of positions) { const current = this.tasks.get(item.taskId); if (current && current.queuePosition !== item.queuePosition) changed.push(this.tasks.mutate(item.taskId, { expectedRevision: current.revision, reason: 'queue-move' }, { queuePosition: item.queuePosition })); }
    this.requestReconcile('queue-move');
    return { changed: changed.map((task) => ({ taskId: task.id, queuePosition: task.queuePosition, revision: task.revision })) };
  }

  recordSpeedSample(event = {}) {
    const task = this.tasks.get(event.taskId); if (!task || task.lifecycle !== 'downloading') return;
    const threshold = Number(this._policy().slowTaskThresholdBytesPerSecond) || 0; const now = this._now(); const speed = Number(event.bytesPerSecond === undefined ? task.downloadBytesPerSecond : event.bytesPerSecond) || 0;
    const belowSince = speed < threshold ? (Number(task.slowBelowSince) || now) : 0;
    if (belowSince !== Number(task.slowBelowSince || 0)) this.tasks.mutate(task.id, { reason: 'speed-sample' }, { slowBelowSince: belowSince || null });
  }

  onTaskTransition(event = {}) { if (event.to === 'downloading' || event.to === 'queued' || event.to === 'paused') this.requestReconcile('task-transition'); }
  onPolicyChanged() { this.requestReconcile('policy-changed'); }
  onEngineUp() { this.requestReconcile('engine-up'); }
  markStartedByIdle(taskId) { this.startedByIdle.add(String(taskId)); }
  consumeStartedByIdle() { const value = [...this.startedByIdle]; this.startedByIdle.clear(); return value; }
  stop() { this.stopped = true; this.reconcileRequested = false; this.startedByIdle.clear(); }
}

module.exports = { TaskSchedulerService };
