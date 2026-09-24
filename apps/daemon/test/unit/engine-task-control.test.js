'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskControlHandlers } = require('../../engine/task-control');
const { createBtControlHandlers } = require('../../engine/bt-control');

function makeFixture() {
  const calls = [];
  const tm = {
    findTaskById: (id) => ({ t: { id, handle: true } }),
    batchRecycleTasks: (ids) => calls.push(['recycle', ids]),
    batchRecoverTasks: (ids) => calls.push(['recover', ids]),
    reDownload: (task, remove) => calls.push(['redownload', task.id, remove]),
    renameTask: (task, name) => calls.push(['rename', task.id, name]),
    moveTask: (task, target) => calls.push(['move', task.id, target]),
    setTaskDownloadSpeedLimit: (task, limit) => calls.push(['speed', task.id, limit]),
    updateBtSubFileDownload: (task, selected) => calls.push(['selection', task.id, selected]),
    updateBtSubFileScheduler: (task, scheduler) => calls.push(['scheduler', task.id, scheduler]),
    getTaskSeedFile: (task) => `seed-${task.id}`,
  };
  const NativeTaskInterface = {
    toTaskExtra: (task) => ({
      waitLoadBtFileFinish: (callback) => callback(),
      getBtFileInfos: (callback) => callback([{ realIndex: task.id, state: 'completed' }]),
    }),
  };
  const capabilities = { flat: {
    recycle: 'verified', recover: 'verified', redownload: 'verified', rename: 'verified', move: 'verified', perTaskRateLimit: 'verified',
    'bt.updateSelection': 'verified', 'bt.sequential': 'verified', 'bt.getFileRuntime': 'verified', 'bt.getSeed': 'verified',
  } };
  return { calls, task: createTaskControlHandlers({ tm, capabilities }), bt: createBtControlHandlers({ tm, NativeTaskInterface, capabilities }) };
}

test('task-control validates handles, invokes verified methods, and redacts native errors', () => {
  const { calls, task } = makeFixture();
  assert.deepEqual(task.recycleTask({ engineId: 4 }), { accepted: true, engineId: 4 });
  assert.deepEqual(task.recoverTask({ engineId: 4 }), { accepted: true, engineId: 4 });
  assert.deepEqual(task.renameTask({ engineId: 4, displayName: 'new.bin' }), { accepted: true, engineId: 4, displayName: 'new.bin' });
  assert.deepEqual(task.moveTask({ engineId: 4, wineTargetPath: 'Z:\\downloads' }), { accepted: true, engineId: 4 });
  assert.deepEqual(task.setTaskSpeedLimit({ engineId: 4, bytesPerSecond: 1024 }), { accepted: true, engineId: 4, bytesPerSecond: 1024 });
  assert.deepEqual(task.redownloadTask({ engineId: 4, deleteLocal: true }), { accepted: true, engineId: 4, deleteLocal: true });
  assert.equal(calls.length, 6);
  assert.throws(() => task.renameTask({ engineId: 0, displayName: 'x' }), (error) => error.code === 'INVALID_ENGINE_TASK_ID');
  assert.throws(() => task.renameTask({ engineId: 4, displayName: '../x' }), (error) => error.code === 'INVALID_TASK_NAME');
});

test('task-control rejects unverified native capability before calling the manager', () => {
  const tm = { findTaskById: () => ({ t: {} }), batchRecycleTasks: () => { throw new Error('must not call'); } };
  const handler = createTaskControlHandlers({ tm, capabilities: { flat: { recycle: 'missing' } } });
  assert.throws(() => handler.recycleTask({ engineId: 4 }), (error) => error.code === 'NATIVE_CAPABILITY_UNAVAILABLE');
});

test('bt-control validates selection, maps scheduler values, and reads TaskExtra metadata', async () => {
  const { calls, bt } = makeFixture();
  assert.deepEqual(bt.updateBtSelection({ engineId: 7, selectedFileIndices: [2, 0, 2] }), { accepted: true, engineId: 7, selectedFileIndices: [0, 2] });
  assert.deepEqual(bt.setBtScheduler({ engineId: 7, scheduler: 'sequential' }), { accepted: true, engineId: 7, scheduler: 'sequential' });
  assert.deepEqual(await bt.getBtFileRuntime({ engineId: 7 }), { engineId: 7, files: [{ realIndex: 7, state: 'completed' }] });
  assert.deepEqual(bt.getSeedDescriptor({ engineId: 7 }), { engineId: 7, seed: 'seed-7' });
  assert.deepEqual(calls.slice(-2), [['scheduler', 7, 1], ['selection', 7, [0, 2]]].reverse());
  assert.throws(() => bt.updateBtSelection({ engineId: 7, selectedFileIndices: [] }), (error) => error.code === 'INVALID_BT_SELECTION');
  assert.throws(() => bt.setBtScheduler({ engineId: 7, scheduler: 'burst' }), (error) => error.code === 'INVALID_BT_SCHEDULER');
});
