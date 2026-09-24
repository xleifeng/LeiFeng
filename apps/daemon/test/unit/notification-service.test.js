'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DomainEventBus } = require('../../host/src/services/domain-event-bus');
const { NotificationService } = require('../../host/src/services/notification-service');

test('notification service aggregates public and private completions', async () => {
  const bus = new DomainEventBus(); const calls = []; const service = new NotificationService({ eventBus: bus, tasks: { get: (id) => id === 'private' ? { id, privateSpace: true } : { id, displayName: `文件-${id}` } }, adapter: { show: async (value) => { calls.push(value); return { delivered: true }; } }, windowMs: 20 });
  service.start(); bus.emit('task.transition', { taskId: 'one', to: 'completed' }); bus.emit('task.transition', { taskId: 'private', to: 'completed' }); bus.emit('task.transition', { taskId: 'bad', to: 'failed' }); await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.length, 1); assert.match(calls[0].body, /已完成 1 个任务/); assert.match(calls[0].body, /私人空间已完成 1 个任务/); assert.match(calls[0].body, /失败 1 个任务/); service.stop();
});
