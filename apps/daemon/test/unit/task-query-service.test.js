'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { TaskQueryService } = require('../../host/src/services/task-query-service');

test('V2 query returns cursor DTOs without gid/status/aria2 fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-v2-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  repo.create({ source: 'http://x/a', savePath: dir, displayName: 'Alpha', kind: 'http', totalBytes: 100 });
  repo.create({ source: 'http://x/b', savePath: dir, displayName: 'Beta', kind: 'http', totalBytes: 200 });
  const service = new TaskQueryService({ tasks: repo }); const result = await service.query({ query: 'alpha', limit: 1 });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].displayName, 'Alpha'); assert.equal('gid' in result.items[0], false); assert.equal('status' in result.items[0], false);
});

test('task-group view keeps group parent before its children', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-group-v2-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const group = repo.create({ kind: 'group', lifecycle: 'queued', displayName: 'Group' });
  repo.create({ kind: 'http', lifecycle: 'queued', parentId: group.id, group: { id: group.id, label: 'Group' }, displayName: 'Child' });
  const service = new TaskQueryService({ tasks: repo }); const result = await service.query({ groupBy: 'task-group', limit: 10 });
  assert.equal(result.items[0].kind, 'group'); assert.equal(result.items[1].parentTaskId, group.id);
});

test('query clamps protocol overhead bytes to the declared task total', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-clamp-v2-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: dir, displayName: 'Alpha', kind: 'http', totalBytes: 100 });
  repo.patchObservation(task.id, { completedBytes: 120 });
  const service = new TaskQueryService({ tasks: repo }); const result = await service.query({ limit: 10 });
  assert.equal(result.items[0].completedBytes, 100); assert.equal(result.items[0].progress, 1);
});
