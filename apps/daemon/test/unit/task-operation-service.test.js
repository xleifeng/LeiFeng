'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { OperationRepository } = require('../../host/src/repositories/operation-repository');
const { TaskService } = require('../../host/src/services/task-service');
const { TaskOperationService } = require('../../host/src/services/task-operation-service');
const { PathService } = require('../../host/src/services/path-service');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');
const { FileOperationService } = require('../../host/src/services/file-operation-service');

function setup({ lifecycle = 'queued', kind = 'http', source = 'http://example.test/file.bin' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-operation-v2-'));
  const savePath = path.join(root, 'downloads');
  fs.mkdirSync(savePath, { recursive: true });
  const repository = new TaskRepository({ filePath: path.join(root, 'tasks.json') });
  repository.load();
  const task = repository.create({ id: 'task-1', source, savePath, displayName: 'file.bin', kind, lifecycle, engineId: 7, totalBytes: 10 });
  const taskRoot = path.join(savePath, task.displayName);
  fs.mkdirSync(taskRoot, { recursive: true });
  fs.writeFileSync(path.join(taskRoot, 'payload'), 'payload');
  const calls = [];
  const driver = {
    nativeCapabilities: { flat: {} },
    startTasks: async (ids) => calls.push(['start', ids]),
    stopTasks: async (ids) => calls.push(['stop', ids]),
    deleteTasks: async (ids) => calls.push(['delete', ids]),
  };
  const taskService = new TaskService({ tasks: repository, driver, vip: { disableTask: async () => {} } });
  const operations = new OperationRepository({ filePath: path.join(root, 'operations.json') });
  const pathService = new PathService({ defaultPath: savePath });
  const fileOperations = new FileOperationService({ resolver: new SafePathResolver({ allowedRoots: [root] }) });
  const service = new TaskOperationService({ tasks: repository, driver, taskService, operations, pathService, fileOperations });
  return { root, savePath, repository, task, driver, calls, operations, service, taskRoot };
}

test('recycle fallback stops/removes native record, journals the operation, and can delete local files safely', async () => {
  const f = setup();
  const response = await f.service.execute({ taskIds: ['task-1'], command: 'recycle', options: { deleteLocalFiles: true }, expectedRevisions: { 'task-1': f.task.revision }, idempotencyKey: 'recycle-1' });
  assert.equal(response.results[0].ok, true);
  assert.equal(f.repository.get('task-1').lifecycle, 'recycled');
  assert.equal(fs.existsSync(f.taskRoot), false);
  assert.deepEqual(f.calls, [['stop', [7]], ['delete', [7]]]);
  assert.equal(f.operations.list()[0].state, 'committed');
  const repeated = await f.service.execute({ taskIds: ['task-1'], command: 'recycle', options: { deleteLocalFiles: true }, idempotencyKey: 'recycle-1' });
  assert.deepEqual(repeated, response);
});

test('recover requires explicit fallback and records replacement linkage', async () => {
  const f = setup({ lifecycle: 'recycled' });
  f.repository.mutate('task-1', { reason: 'seed' }, { engineId: null });
  let created = 0;
  f.service.createTaskService = { createUriCompat: async (input) => { created++; assert.equal(input.options.allowExistingTarget, true); return 'replacement-1'; } };
  const blocked = await f.service.execute({ taskIds: ['task-1'], command: 'recover' });
  assert.equal(blocked.results[0].error.code, 'NATIVE_CAPABILITY_UNAVAILABLE');
  const response = await f.service.execute({ taskIds: ['task-1'], command: 'recover', options: { allowRecreateFallback: true } });
  assert.equal(response.results[0].replacementTaskId, 'replacement-1');
  assert.equal(created, 1);
  assert.equal(f.repository.get('task-1').legacy.supersededBy, 'replacement-1');
});

test('redownload fallback announces its queued replacement to the scheduler', async () => {
  const f = setup({ lifecycle: 'failed' });
  const replacement = f.repository.create({ id: 'replacement-1', source: f.task.source, savePath: f.savePath, displayName: 'file.bin', kind: 'http', lifecycle: 'queued', engineId: 8, totalBytes: 10 });
  const events = [];
  f.service.eventBus = { emit: (...args) => events.push(args) };
  f.service.createTaskService = { createUriCompat: async (input) => { assert.equal(input.options.startMode, 'queued'); return replacement.id; } };
  const response = await f.service.execute({ taskIds: ['task-1'], command: 'redownload', options: {} });
  assert.equal(response.results[0].replacementTaskId, replacement.id);
  assert.deepEqual(events.map(([type, event]) => [type, event.taskId, event.to]), [
    ['task.transition', replacement.id, 'queued'],
    ['task.transition', 'task-1', 'recycled'],
  ]);
});

test('rename and move pause downloading first, commit filesystem then resume', async () => {
  const f = setup({ lifecycle: 'downloading' });
  const renamed = await f.service.execute({ taskIds: ['task-1'], command: 'rename', options: { displayName: 'renamed.bin' }, expectedRevisions: { 'task-1': f.task.revision } });
  assert.equal(renamed.results[0].ok, true);
  assert.equal(fs.existsSync(path.join(f.savePath, 'renamed.bin')), true);
  assert.equal(f.repository.get('task-1').displayName, 'renamed.bin');
  assert.equal(f.repository.get('task-1').lifecycle, 'queued');

  const target = path.join(f.root, 'moved');
  const moved = await f.service.execute({ taskIds: ['task-1'], command: 'move', options: { targetDirectory: target }, expectedRevisions: { 'task-1': f.repository.get('task-1').revision } });
  assert.equal(moved.results[0].ok, true);
  assert.equal(f.repository.get('task-1').savePath, target);
  assert.equal(fs.existsSync(path.join(target, 'renamed.bin')), true);
  assert.deepEqual(f.calls.map((call) => call[0]), ['stop', 'start']);
});

test('revision conflict is returned without mutating the task', async () => {
  const f = setup();
  const response = await f.service.execute({ taskIds: ['task-1'], command: 'rename', options: { displayName: 'other.bin' }, expectedRevisions: { 'task-1': 99 } });
  assert.equal(response.results[0].ok, false);
  assert.equal(response.results[0].error.code, 'REVISION_CONFLICT');
  assert.equal(f.repository.get('task-1').displayName, 'file.bin');
});

test('BT runtime selection requires explicit reuse fallback when native control is unprobed', async () => {
  const f = setup({ kind: 'bt' });
  f.repository.mutate('task-1', { reason: 'bt-files' }, { files: [{ index: 0, name: 'a.bin', path: 'a.bin', size: 1 }], selectedFileIndices: [0], seedRef: 'seed-ref' });
  f.service.createTaskService = { createTorrentCompat: async (input) => { assert.deepEqual(input.selectedFileIndices, [0]); assert.equal(input.options.startMode, 'queued'); return 'replacement-bt'; } };
  const blocked = await f.service.execute({ taskIds: ['task-1'], command: 'update-bt-selection', options: { selectedFileIndices: [0] } });
  assert.equal(blocked.results[0].error.code, 'NATIVE_CAPABILITY_UNAVAILABLE');
  const accepted = await f.service.execute({ taskIds: ['task-1'], command: 'update-bt-selection', options: { selectedFileIndices: [0], allowRecreateFallback: true } });
  assert.equal(accepted.results[0].replacementTaskId, 'replacement-bt');
  assert.equal(f.repository.get('task-1').legacy.reusedFiles, true);
  assert.deepEqual(f.calls, [['stop', [7]], ['delete', [7]]]);
});

test('BT scheduler fallback carries the requested scheduler into the replacement task', async () => {
  const f = setup({ kind: 'bt' });
  f.repository.mutate('task-1', { reason: 'bt-files' }, { files: [{ index: 0, name: 'a.bin', path: 'a.bin', size: 1 }], selectedFileIndices: [0], seedRef: 'seed-ref' });
  f.service.createTaskService = { createTorrentCompat: async (input) => { assert.equal(input.options.btScheduler, 'sequential'); return 'replacement-bt-scheduler'; } };
  const accepted = await f.service.execute({ taskIds: ['task-1'], command: 'set-bt-scheduler', options: { btScheduler: 'sequential', allowRecreateFallback: true } });
  assert.equal(accepted.results[0].replacementTaskId, 'replacement-bt-scheduler');
  assert.equal(f.repository.get('task-1').btScheduler, 'sequential');
});

test('emptyTrash uses all recycled tasks, chunks large batches, and is a no-op when empty', async () => {
  const f = setup({ lifecycle: 'recycled' });
  for (let index = 2; index <= 205; index += 1) {
    f.repository.create({ id: `trash-${index}`, source: `http://example.test/${index}.bin`, savePath: f.savePath, displayName: `${index}.bin`, kind: 'http', lifecycle: 'recycled', engineId: null, totalBytes: 1 });
  }
  const response = await f.service.emptyTrash({ idempotencyKey: 'empty-trash-1' });
  assert.equal(response.results.length, 205);
  assert.equal(response.results.every((item) => item.ok), true);
  assert.equal(f.repository.list().length, 0);
  const empty = await f.service.emptyTrash({ idempotencyKey: 'empty-trash-empty' });
  assert.deepEqual(empty.results, []);
});

test('emptyTrash clears an unsafe legacy path without deleting outside the safe roots', async () => {
  const f = setup({ lifecycle: 'recycled' });
  f.repository.mutate('task-1', { reason: 'legacy-path' }, { savePath: path.join(os.tmpdir(), 'thunder-legacy-downloads') });
  const response = await f.service.emptyTrash({ deleteLocalFiles: true, idempotencyKey: 'empty-trash-unsafe-path' });
  const result = response.results[0];
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.equal(result.deletedLocal, false);
  assert.equal(result.localFileError.code, 'UNSAFE_PATH');
  assert.equal(f.repository.get('task-1'), null);
  assert.equal(f.operations.list()[0].state, 'committed');
});

test('delete-permanently accepts failed tasks directly (C1: 208/engine-failure residue)', async () => {
  // 产品化 2026-09-23：failed 行此前必须先 recycle 再 delete，直接 delete 被
  // INVALID_TASK_STATE 拒绝，外部清理流程被迫两步。现 failed 与 recycled 同权。
  const f = setup({ lifecycle: 'failed' });
  const response = await f.service.execute({ taskIds: ['task-1'], command: 'delete-permanently', options: { deleteLocalFiles: false }, idempotencyKey: 'del-failed-1' });
  assert.equal(response.results[0].ok, true);
  assert.equal(f.repository.get('task-1'), null);
  assert.deepEqual(f.calls, [['delete', [7]]]);
  // 数据文件按 deleteLocalFiles:false 保留
  assert.equal(fs.existsSync(f.taskRoot), true);
});
