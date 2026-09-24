'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { TaskSchedulerService } = require('../../host/src/services/task-scheduler-service');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-v2-')); const tasks = new TaskRepository({ filePath: path.join(root, 'tasks.json') }); tasks.load();
  const calls = []; const taskService = { startOne: async (task) => { calls.push(['start', task.id]); return tasks.mutate(task.id, { reason: 'fake-start' }, { lifecycle: 'downloading' }); }, pauseOne: async (task) => { calls.push(['pause', task.id]); return tasks.mutate(task.id, { reason: 'fake-pause' }, { lifecycle: 'paused' }); } };
  for (let i = 0; i < 3; i++) tasks.create({ id: `t${i}`, source: `http://x/${i}`, savePath: root, displayName: `${i}.bin`, lifecycle: i < 2 ? 'downloading' : 'queued', engineId: i + 1, queuePosition: (i + 1) * 10, totalBytes: 100 });
  return { tasks, calls, service: new TaskSchedulerService({ tasks, taskService, policyProvider: () => ({ maxConcurrentTasks: 1, slowTaskThresholdBytesPerSecond: 10 }) }) };
}

test('scheduler enforces max concurrent tasks', async () => {
  const f = setup(); await f.service.reconcile('test');
  assert.deepEqual(f.calls, [['pause', 't1']]);
  assert.equal(f.tasks.get('t1').schedulerPaused, true);
});

test('queue move persists sparse positions and triggers reconcile', async () => {
  const f = setup(); const result = await f.service.move({ taskIds: ['t2'], target: 'top' });
  assert.equal(result.changed[0].taskId, 't2');
  assert.ok(f.tasks.get('t2').queuePosition < f.tasks.get('t0').queuePosition);
});
