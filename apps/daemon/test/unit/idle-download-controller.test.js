'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { IdleDownloadController } = require('../../host/src/services/idle-download-controller');

test('idle controller starts only idle-eligible queued tasks and pauses its own starts on activity', async () => {
  const tasks = { values: [{ id: 't1', lifecycle: 'queued', idleEligible: true }, { id: 't2', lifecycle: 'queued', idleEligible: false }], list() { return this.values; }, get(id) { return this.values.find((task) => task.id === id); } };
  const calls = []; const scheduler = { taskService: { startOne: async (task) => { calls.push(['start', task.id]); task.lifecycle = 'downloading'; }, pauseOne: async (task) => { calls.push(['pause', task.id]); task.lifecycle = 'paused'; } }, markStartedByIdle() {} };
  let idle = 100; const adapter = { isAvailable: () => true, getIdleSeconds: async () => idle, close() {} };
  const controller = new IdleDownloadController({ adapter, scheduler, tasks, policyProvider: () => ({ idleDownload: { enabled: true, idleAfterSeconds: 60, pauseOnActivity: true } }) });
  await controller.tick(); assert.deepEqual(calls, [['start', 't1']]); idle = 0; await controller.tick(); assert.deepEqual(calls, [['start', 't1'], ['pause', 't1']]);
});
