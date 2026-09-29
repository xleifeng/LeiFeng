'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OperationRepository } = require('../../host/src/repositories/operation-repository');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-repo-v2-'));
  const filePath = path.join(dir, 'data', 'operations.json');
  return { dir, filePath, repo: new OperationRepository({ filePath }) };
}

test('operation repository persists journal transitions and reloads recoverable records', () => {
  const { filePath } = makeRepo();
  const repo = new OperationRepository({ filePath });
  repo.prepare({ operationId: 'op-1', idempotencyKey: 'idem-1', taskId: 'task-1', command: 'rename', beforeRevision: 3, params: { displayName: 'b.bin' } });
  repo.markNativeCalled('op-1', { engineId: 7 });
  repo.markFilesystem('op-1', { target: '/tmp/b.bin' });
  repo.commit('op-1', { afterRevision: 4, result: { taskId: 'task-1' } });
  assert.equal(repo.get('op-1').state, 'committed');
  assert.equal(repo.findByIdempotencyKey('idem-1').operationId, 'op-1');

  const reloaded = new OperationRepository({ filePath });
  assert.equal(reloaded.get('op-1').afterRevision, 4);
  assert.deepEqual(reloaded.listRecoverable(), []);
});

test('operation repository keeps uncertain operations for restart recovery and prunes completed history', () => {
  const { filePath } = makeRepo();
  const repo = new OperationRepository({ filePath, maxCompleted: 1 });
  repo.prepare({ operationId: 'op-1', taskId: 'task-1', command: 'move' });
  repo.uncertain('op-1', { code: 'FILE_CHANGED_DURING_OPERATION' });
  assert.equal(repo.listRecoverable()[0].state, 'uncertain');
  repo.prepare({ operationId: 'op-2', taskId: 'task-2', command: 'pause' });
  repo.fail('op-2', { code: 'NATIVE_CAPABILITY_UNAVAILABLE' });
  repo.prepare({ operationId: 'op-3', taskId: 'task-3', command: 'start' });
  repo.commit('op-3', { afterRevision: 2 });
  repo.prune();
  assert.equal(repo.get('op-1').state, 'uncertain');
  assert.equal(repo.list().filter((item) => ['committed', 'failed'].includes(item.state)).length, 1);
});
