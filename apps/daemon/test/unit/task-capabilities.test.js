'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTaskCapabilities, computeGlobalCapabilities } = require('../../host/src/domain/task-capabilities');

test('capabilities follow lifecycle and verified native methods', () => {
  const caps = computeTaskCapabilities({ id: 't', engineId: 7, lifecycle: 'downloading', kind: 'http', source: 'http://x' }, { native: { startPause: 'present', rename: 'missing' } });
  assert.equal(caps.pause, true);
  assert.equal(caps.rename, false);
  assert.equal(caps.retry, false);
});

test('only native-backed startable tasks expose start', () => {
  const runtime = { native: { startPause: 'present' } };
  assert.equal(computeTaskCapabilities({ engineId: 7, lifecycle: 'paused' }, runtime).start, true);
  assert.equal(computeTaskCapabilities({ engineId: 7, lifecycle: 'completed' }, runtime).start, false);
  assert.equal(computeTaskCapabilities({ engineId: null, lifecycle: 'queued' }, runtime).start, false);
});

test('global capabilities do not advertise unavailable native features', () => {
  const caps = computeGlobalCapabilities({ native: { startPause: 'present', recycle: 'missing' }, protocols: ['http'] });
  assert.equal(caps.taskControl, true);
  assert.equal(caps.recycle, false);
  assert.deepEqual(caps.protocols, ['http']);
});

test('global capabilities advertise implemented host fallbacks', () => {
  const caps = computeGlobalCapabilities({ native: { recycle: 'missing', rename: 'missing', 'bt.updateSelection': 'missing', 'bt.sequential': 'missing' }, environment: { fallbackOperations: { recycle: true, rename: true, btSelection: true, btSequential: true } } });
  assert.equal(caps.recycle, true);
  assert.equal(caps.rename, true);
  assert.equal(caps.recover, false);
  assert.equal(caps.btFileSelection, true);
  assert.equal(caps.btSequential, true);
});

test('BT and metadata-complete magnet tasks expose recreate controls only with a reusable source and native task', () => {
  const runtime = { native: { 'bt.updateSelection': 'missing', 'bt.sequential': 'missing' }, fallbackOperations: { btSelection: true, btSequential: true } };
  const ready = computeTaskCapabilities({ lifecycle: 'downloading', kind: 'magnet', source: 'magnet:?xt=urn:btih:abc', seedRef: 'sha256:seed', engineId: 7, files: [{ index: 0 }] }, runtime);
  assert.equal(ready.btSelection, true); assert.equal(ready.btSequential, true);
  const missingSeed = computeTaskCapabilities({ lifecycle: 'downloading', kind: 'bt', source: null, engineId: 7, files: [{ index: 0 }] }, runtime);
  assert.equal(missingSeed.btSelection, false); assert.equal(missingSeed.btSequential, false);
  const seedBacked = computeTaskCapabilities({ lifecycle: 'paused', kind: 'bt', source: '', seedRef: 'sha256:seed', engineId: 7, files: [{ index: 0 }] }, runtime);
  assert.equal(seedBacked.btSelection, true); assert.equal(seedBacked.btSequential, true);
});
