'use strict';

const { OperationLock } = require('./operation-lock');
const { mapNativeError } = require('../domain/task-errors');

function problem(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

class TaskService {
  constructor({ tasks, driver, vip = null, seedStore = null, operationLock = new OperationLock(), eventBus = null, clock = Date } = {}) {
    if (!tasks || !driver) throw new Error('TaskService tasks and driver are required');
    this.tasks = tasks;
    this.driver = driver;
    this.vip = vip || { disableTask: async () => {} };
    this.seedStore = seedStore;
    this.operationLock = operationLock;
    this.eventBus = eventBus;
    this.clock = clock;
    this.idempotency = new Map();
    this.idempotencyTtlMs = 10 * 60 * 1000;
  }

  requireTask(taskId) { return this.tasks.require(taskId); }

  _remember(key, input, result) {
    const now = Number(this.clock.now ? this.clock.now() : Date.now());
    this.idempotency.set(key, { fingerprint: JSON.stringify(input), result, expiresAt: now + this.idempotencyTtlMs });
    while (this.idempotency.size > 1000) this.idempotency.delete(this.idempotency.keys().next().value);
  }

  _lookup(key, input) {
    const item = this.idempotency.get(key);
    if (!item) return null;
    const now = Number(this.clock.now ? this.clock.now() : Date.now());
    if (item.expiresAt <= now) { this.idempotency.delete(key); return null; }
    if (item.fingerprint !== JSON.stringify(input)) throw problem('IDEMPOTENCY_KEY_REUSED', 'idempotencyKey 已用于不同参数');
    return item.result;
  }

  async command({ taskIds, command, expectedRevisions = {}, options = {}, idempotencyKey } = {}) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) throw problem('INVALID_ARGUMENT', 'taskIds 不能为空');
    const ids = [...new Set(taskIds.map(String))].slice(0, 200);
    if (!['start', 'pause', 'remove-record'].includes(command)) throw problem('UNSUPPORTED_COMMAND', `不支持任务命令: ${command}`);
    const input = { taskIds: ids, command, expectedRevisions, options };
    if (idempotencyKey) {
      const old = this._lookup(String(idempotencyKey), input);
      if (old) return old;
    }
    const operationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const acceptedAt = Number(this.clock.now ? this.clock.now() : Date.now());
    const results = [];
    for (const taskId of ids) {
      try {
        const task = this.requireTask(taskId);
        const expectedRevision = expectedRevisions && expectedRevisions[taskId];
        let next;
        if (command === 'start') next = await this.startOne(task, { ...options, expectedRevision });
        else if (command === 'pause') next = await this.pauseOne(task, { ...options, expectedRevision });
        else next = await this.removeRecordCompat(task, { ...options, expectedRevision });
        results.push({ taskId, ok: true, revision: next && next.revision });
      } catch (error) {
        results.push({ taskId, ok: false, error: { code: error.code || 'TASK_COMMAND_FAILED', message: error.message, details: error.details } });
      }
    }
    const response = { operationId, acceptedAt, results };
    if (idempotencyKey) this._remember(String(idempotencyKey), input, response);
    return response;
  }

  async startOne(task, options = {}) {
    return this.operationLock.run(`task:${task.id}`, async () => {
      const current = this.tasks.require(task.id);
      if (current.lifecycle === 'downloading') return current;
      if (current.lifecycle === 'completed' || current.lifecycle === 'recycled') throw problem('INVALID_TASK_STATE', '当前任务不能启动');
      if (!Number.isSafeInteger(current.engineId) || current.engineId <= 0) throw problem('ENGINE_TASK_MISSING', '引擎任务不存在');
      try { await this.driver.startTasks([current.engineId]); }
      catch (error) {
        return this.tasks.mutate(current.id, { expectedRevision: options.expectedRevision, reason: 'start-failed' }, { lifecycle: 'failed', error: mapNativeError(error.message, { code: 'START_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }), downloadBytesPerSecond: 0 });
      }
      const next = this.tasks.mutate(current.id, { expectedRevision: options.expectedRevision, reason: 'start' }, { lifecycle: 'queued', startedAt: current.startedAt || Date.now(), error: null });
      return next;
    });
  }

  async pauseOne(task, options = {}) {
    return this.operationLock.run(`task:${task.id}`, async () => {
      const current = this.tasks.require(task.id);
      if (current.lifecycle === 'paused') return current;
      if (!['downloading', 'queued'].includes(current.lifecycle)) throw problem('INVALID_TASK_STATE', '当前任务不能暂停');
      if (Number.isSafeInteger(current.engineId) && current.engineId > 0) await this.driver.stopTasks([current.engineId]);
      const next = this.tasks.mutate(current.id, { expectedRevision: options.expectedRevision, reason: 'pause' }, { lifecycle: 'paused', downloadBytesPerSecond: 0 });
      await this.vip.disableTask(current.id, { reason: 'paused' }).catch(() => {});
      return next;
    });
  }

  async removeRecordCompat(task, options = {}) {
    return this.operationLock.run(`task:${task.id}`, async () => {
      const current = this.tasks.require(task.id);
      if (current.lifecycle === 'recycled') return current;
      await this.vip.disableTask(current.id, { reason: 'removed' }).catch(() => {});
      if (Number.isSafeInteger(current.engineId) && current.engineId > 0) {
        if (['downloading', 'queued', 'paused'].includes(current.lifecycle)) await this.driver.stopTasks([current.engineId]).catch(() => {});
        try { await this.driver.deleteTasks([current.engineId]); }
        catch (error) { throw problem('REMOVE_FAILED', error.message); }
      }
      const next = this.tasks.mutate(current.id, { expectedRevision: options.expectedRevision, reason: 'remove-record' }, { lifecycle: 'recycled', recycledAt: Date.now(), downloadBytesPerSecond: 0 });
      if (current.seedRef) this.seedStore?.release?.(current.seedRef, `task:${current.id}`);
      return next;
    });
  }

  async onEngineDown({ generation, reason = 'engine restarted' } = {}) {
    const result = this.tasks.markEngineGenerationLost(generation, reason);
    if (this.eventBus) this.eventBus.emit('engine.down', { generation, reason, taskIds: result.map((task) => task.id) });
    return result;
  }
}

module.exports = { TaskService };
