'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository'); const { ProgressPoller, STATUS_MAP } = require('../../host/src/poller');

test('V2 poller collects TaskDb facts and delegates lifecycle to reducer/repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-v2-')); const repository = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repository.load(); const task = repository.create({ source: 'http://x/a', savePath: dir, displayName: 'a', kind: 'http', engineId: 42, lifecycle: 'queued', totalBytes: 100 });
  const events = []; const poller = new ProgressPoller(repository, { readTasksFn: async () => new Map([[42, { status: STATUS_MAP.complete, totalReceiveSize: 100, resourceSize: 100, failureErrorCode: 0, name: 'a' }]]), eventBus: { emit: (type, event) => events.push({ type, event }) } });
  await poller._tick(); const updated = repository.get(task.id); assert.equal(updated.lifecycle, 'completed'); assert.equal(updated.completedBytes, 100); assert.equal(events[0].type, 'task.transition');
});

test('V2 poller 融合引擎实时报速：TaskDb 计数冻结时速度/生命周期来自快照 downloadSpeed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-v2b-')); const repository = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repository.load();
  const task = repository.create({ source: 'magnet:?x', savePath: dir, displayName: 'b', kind: 'bt', engineId: 43, lifecycle: 'queued', totalBytes: 1000, completedBytes: 100 });
  // 快照：Status=4（StartPending 标签滞后）、totalReceiveSize 冻结在 100（=基线，自测增量 0）、引擎报速 3MiB/s
  const poller = new ProgressPoller(repository, { readTasksFn: async () => new Map([[43, { status: 4, totalReceiveSize: 100, resourceSize: 1000, failureErrorCode: 0, name: 'b', downloadSpeed: 3145728 }]]), eventBus: null });
  await poller._tick(); const updated = repository.get(task.id);
  assert.equal(updated.lifecycle, 'downloading');
  assert.equal(updated.downloadBytesPerSecond, 3145728);
});

test('V2 poller Seeding(10) 迁移 completed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-v2c-')); const repository = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repository.load();
  const task = repository.create({ source: 'magnet:?x', savePath: dir, displayName: 'c', kind: 'bt', engineId: 44, lifecycle: 'downloading', totalBytes: 1000 });
  const poller = new ProgressPoller(repository, { readTasksFn: async () => new Map([[44, { status: 10, totalReceiveSize: 500, resourceSize: 1000, failureErrorCode: 0, name: 'c', downloadSpeed: 0 }]]), eventBus: null });
  await poller._tick(); const updated = repository.get(task.id);
  assert.equal(updated.lifecycle, 'completed');
  assert.equal(updated.downloadBytesPerSecond, 0);
});
