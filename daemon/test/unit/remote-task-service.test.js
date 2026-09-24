'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteTaskService } = require('../../host/src/services/remote-task-service');
const { encodeRemoteTaskId } = require('../../host/src/domain/remote-task-id');

test('remote task service wraps task ids and forwards commands through mTLS client', async () => {
  const node = { id: 'node-a', endpoint: 'https://127.0.0.1:19000', permissions: ['view', 'control'], state: 'online' };
  const calls = [];
  const nodes = { repository: { assertPermission(id, permission) { assert.equal(id, node.id); assert.ok(node.permissions.includes(permission)); return node; } } };
  const service = new RemoteTaskService({ nodes, clientFactory: () => ({ async request(method, pathname, body) { calls.push({ method, pathname, body }); if (pathname.endsWith('/query')) return { items: [{ id: 'task-1', displayName: 'Ubuntu', lifecycle: 'downloading' }], total: 1 }; return { results: [{ taskId: 'task-1', ok: true }] }; } }) });
  const query = await service.query({ nodeId: node.id, taskQuery: { view: 'all' } });
  assert.equal(query.items[0].id, encodeRemoteTaskId(node.id, 'task-1')); assert.deepEqual(query.items[0].badges, ['remote']);
  const command = await service.command({ compositeTaskIds: [query.items[0].id], command: 'pause', idempotencyKey: 'idem-1' });
  assert.equal(command.results[0].taskId, query.items[0].id); assert.equal(calls[1].body.taskIds[0], 'task-1'); assert.equal(calls[1].body.command, 'pause');
});
