'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { TaskGroupService } = require('../../host/src/services/task-group-service');
const { aggregate } = require('../../host/src/domain/task-group');

test('group aggregation is byte weighted and preserves partial failure semantics', () => {
  const summary = aggregate([
    { lifecycle: 'completed', totalBytes: 100, completedBytes: 100, downloadBytesPerSecond: 0 },
    { lifecycle: 'failed', totalBytes: 300, completedBytes: 150, downloadBytesPerSecond: 0 },
  ]);
  assert.equal(summary.totalBytes, 400); assert.equal(summary.completedBytes, 250); assert.equal(summary.progress, 0.625); assert.equal(summary.lifecycle, 'failed'); assert.equal(summary.groupResult, 'partial-failed');
});

test('task group attaches children and recomputes parent progress', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-group-v2-')); const tasks = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); tasks.load();
  const first = tasks.create({ kind: 'http', lifecycle: 'completed', displayName: 'a', totalBytes: 100, completedBytes: 100 });
  const second = tasks.create({ kind: 'http', lifecycle: 'downloading', displayName: 'b', totalBytes: 300, completedBytes: 150 });
  const service = new TaskGroupService({ tasks }); const group = service.create({ label: '测试组', taskIds: [first.id, second.id] });
  assert.equal(group.kind, 'group'); assert.equal(group.totalBytes, 400); assert.equal(group.completedBytes, 250); assert.equal(tasks.get(first.id).parentId, group.id); assert.equal(tasks.get(second.id).group.label, '测试组');
});
