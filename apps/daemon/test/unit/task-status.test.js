'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapLegacyLifecycle, reduceObservation, canTransition, assertTransition, toLegacyStatus } = require('../../host/src/domain/task-status');

test('legacy lifecycle maps to V2 without aria2 status leaking', () => {
  assert.equal(mapLegacyLifecycle({ status: 'active' }), 'downloading');
  assert.equal(mapLegacyLifecycle({ status: 'waiting', metadataPhase: 'fetching' }), 'metadata');
  assert.equal(mapLegacyLifecycle({ status: 'removed' }), 'recycled');
  assert.equal(toLegacyStatus('completed'), 'complete');
});

test('paused wins over TaskDb Status=5/8 and only observation changes', () => {
  const result = reduceObservation({ lifecycle: 'paused', observationRevision: 4 }, { taskDbFound: true, nativeStatus: 8, receivedSize: 20, resourceSize: 20 }, 100);
  assert.equal(result.lifecycle, 'paused');
  assert.equal(result.patch.downloadBytesPerSecond, 0);
  assert.equal(result.patch.completedBytes, 20);
});

test('metadata without TaskDb row stays metadata', () => {
  const result = reduceObservation({ lifecycle: 'metadata', observationRevision: 1 }, { taskDbFound: false, receivedSize: 0, metadataFileReady: false }, 100);
  assert.equal(result.lifecycle, 'metadata');
  assert.equal(result.transition, false);
});

test('resource size completion wins when SDK keeps Status=5', () => {
  const result = reduceObservation({ lifecycle: 'downloading', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 5, receivedSize: 100, resourceSize: 100 }, 100);
  assert.equal(result.lifecycle, 'completed');
});

test('native queued Status=7 is known and does not create a false warning', () => {
  const result = reduceObservation({ lifecycle: 'queued', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 7, receivedSize: 0, resourceSize: 100 }, 100);
  assert.equal(result.lifecycle, 'queued');
  assert.deepEqual(result.warnings, []);
});

test('state graph rejects impossible transitions', () => {
  assert.equal(canTransition('queued', 'downloading'), true);
  assert.equal(canTransition('recycled', 'downloading'), false);
  assert.throws(() => assertTransition('recycled', 'downloading', 'test'), /invalid lifecycle transition/);
});

// A3：官方 TaskStatus 枚举补全（0-12 全枚举见 domain/task-status.js；4=StartPending/10=Seeding）
test('Status=10 Seeding maps to completed (BT 下载完成转做种)', () => {
  const result = reduceObservation({ lifecycle: 'downloading', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 10, receivedSize: 100, resourceSize: 100 }, 100);
  assert.equal(result.lifecycle, 'completed');
  assert.deepEqual(result.warnings, []);
});

test('Status=4 StartPending keeps downloading alive (引擎标签滞后不降级)', () => {
  const result = reduceObservation({ lifecycle: 'downloading', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 4, receivedSize: 50, resourceSize: 100 }, 100);
  assert.equal(result.lifecycle, 'downloading');
  assert.deepEqual(result.warnings, []);
});

test('Status=4 queued 任务不靠标签迁移（等待增长信号）', () => {
  const result = reduceObservation({ lifecycle: 'queued', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 4, receivedSize: 0, resourceSize: 100 }, 100);
  assert.equal(result.lifecycle, 'queued');
});

test('引擎实时报速兜底：自测 0 而引擎报速 >0 时保持 downloading 并采信引擎值', () => {
  const result = reduceObservation({ lifecycle: 'downloading', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 5, receivedSize: 100, resourceSize: 1000, measuredDownloadBps: 0, receivedGrew: false, engineDownloadBps: 3145728, stalled: true }, 100);
  assert.equal(result.lifecycle, 'downloading');
  assert.equal(result.patch.downloadBytesPerSecond, 3145728);
});

test('引擎报速也能把 queued 迁入 downloading（TaskDb 计数冻结场景)', () => {
  const result = reduceObservation({ lifecycle: 'queued', observationRevision: 1 }, { taskDbFound: true, nativeStatus: 5, receivedSize: 100, resourceSize: 1000, measuredDownloadBps: 0, receivedGrew: false, engineDownloadBps: 1048576 }, 100);
  assert.equal(result.lifecycle, 'downloading');
  assert.equal(result.patch.downloadBytesPerSecond, 1048576);
});
