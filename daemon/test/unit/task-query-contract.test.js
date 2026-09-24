'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { TaskQueryService } = require('../../host/src/services/task-query-service');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-contract-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'data', 'tasks.json') });
  repo.load();
  return { dir, repo, service: new TaskQueryService({ tasks: repo }) };
}

test('task query has stable sort, list capabilities and snapshot cursor', async () => {
  const { repo, service, dir } = setup();
  repo.create({ source: 'http://x/a', savePath: dir, displayName: '同名', kind: 'http', totalBytes: 100, createdAt: 10, lifecycle: 'queued' });
  repo.create({ source: 'http://x/b', savePath: dir, displayName: '同名', kind: 'http', totalBytes: 200, createdAt: 10, lifecycle: 'queued' });
  const first = await service.query({ view: 'downloading', sort: 'created-desc', groupBy: 'none', limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].taskId.length > 0, true);
  assert.equal(Array.isArray(first.items[0].capabilities), true);
  assert.equal('gid' in first.items[0], false);
  assert.equal(first.nextCursor !== null, true);
  const second = await service.query({ view: 'downloading', sort: 'created-desc', groupBy: 'none', limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].taskId, first.items[0].taskId);
});

test('task query cursor expires instead of silently switching snapshots when cache is gone', async () => {
  const { repo, service, dir } = setup();
  repo.create({ source: 'http://x/a', savePath: dir, displayName: 'A', kind: 'http', createdAt: 10 });
  repo.create({ source: 'http://x/b', savePath: dir, displayName: 'B', kind: 'http', createdAt: 9 });
  const first = await service.query({ view: 'downloading', sort: 'created-desc', groupBy: 'none', limit: 1 });
  repo.create({ source: 'http://x/c', savePath: dir, displayName: 'C', kind: 'http', createdAt: 11 });
  service.snapshotCache.clear();
  await assert.rejects(service.query({ view: 'downloading', sort: 'created-desc', groupBy: 'none', limit: 1, cursor: first.nextCursor }), (error) => error.code === 'CURSOR_EXPIRED');
});
