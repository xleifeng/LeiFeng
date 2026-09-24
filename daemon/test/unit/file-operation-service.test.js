'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');
const { FileOperationService } = require('../../host/src/services/file-operation-service');

function makeTask() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-op-v2-'));
  const savePath = path.join(root, 'downloads');
  fs.mkdirSync(savePath, { recursive: true });
  return { root, savePath, task: { id: 'task-1', savePath, displayName: 'folder' } };
}

test('file operation service renames and moves a task directory without escaping allowed roots', () => {
  const { root, savePath, task } = makeTask();
  const source = path.join(savePath, task.displayName);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'payload.bin'), 'data');
  const service = new FileOperationService({ resolver: new SafePathResolver({ allowedRoots: [root] }) });

  const renamed = service.renameTaskFile(task, 'renamed');
  assert.equal(fs.existsSync(renamed.target), true);
  const moved = service.moveTaskFiles({ ...task, displayName: 'renamed' }, path.join(root, 'other'));
  assert.equal(fs.existsSync(moved.target), true);
  assert.equal(fs.readFileSync(path.join(moved.target, 'payload.bin'), 'utf8'), 'data');
});

test('file operation service refuses collisions and deletes only the task root', () => {
  const { root, savePath, task } = makeTask();
  const source = path.join(savePath, task.displayName);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'payload.bin'), 'data');
  fs.mkdirSync(path.join(savePath, 'other'));
  const service = new FileOperationService({ resolver: new SafePathResolver({ allowedRoots: [root] }) });
  assert.throws(() => service.moveTaskFiles(task, savePath), (error) => error.code === 'NAME_COLLISION');
  assert.equal(service.deleteTaskFiles(task).deleted, true);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.existsSync(savePath), true);
});
