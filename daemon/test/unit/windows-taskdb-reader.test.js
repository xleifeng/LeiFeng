'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowsTaskDbReader, safeIds } = require('../../host/src/windows-taskdb-reader');

function fakeExec(responses, calls) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    const mode = args[3];
    callback(null, JSON.stringify(responses[mode] || {}), '');
  };
}

test('Windows TaskDb reader maps task and VIP rows without exposing query output', async () => {
  const calls = [];
  const reader = createWindowsTaskDbReader({ pythonExe: '/mnt/c/Python/python.exe', distroName: 'Ubuntu', execFileImpl: fakeExec({
    tasks: { rows: [{ TaskId: 7, Status: 5, TotalReceiveSize: 128, ResourceSize: 1024, FailureErrorCode: 0, Name: 'file.bin' }] },
    vip: { base: [{ TaskId: 7, Type: 2, Status: 5, Url: 'magnet:?x', Name: 'bundle', ResourceSize: 1024, CidHex: 'AA', GcidHex: 'BB', VipReceiveSize: 64, FreeDcdnReceiveSize: 8, VipResourceEnableNecessary: 1, Forbidden: 0 }], files: [{ BtTaskId: 7, FileIndex: 3, Download: 1, FileName: 'file.bin', FileSize: 1024, CidHex: 'CC', GcidHex: 'DD' }] },
  }, calls) });
  const tasks = await reader.readTasks('/mnt/c/runtime/profile/TaskDb.dat', [7, 7, -1]);
  assert.deepEqual(tasks.get(7), { status: 5, totalReceiveSize: 128, resourceSize: 1024, failureErrorCode: 0, name: 'file.bin' });
  const vip = await reader.readVipTasks('/mnt/c/runtime/profile/TaskDb.dat', [7]);
  assert.equal(vip.get(7).vipReceiveSize, 64);
  assert.deepEqual(vip.get(7).btFiles[0], { fileIndex: 3, download: 1, fileName: 'file.bin', fileSize: 1024, cid: 'CC', gcid: 'DD' });
  assert.equal(calls[0].args[2], 'C:\\runtime\\profile\\TaskDb.dat');
  assert.deepEqual(safeIds([7, '7', 0, -1, 'x']), [7]);
});

test('Windows TaskDb reader filters native BT matches by normalized UNC path and task name', async () => {
  const calls = [];
  const reader = createWindowsTaskDbReader({ pythonExe: '/mnt/c/Python/python.exe', distroName: 'Ubuntu', execFileImpl: fakeExec({
    'native-bt': { rows: [
      { TaskId: 9, Status: 5, SavePath: '\\\\wsl.localhost\\Ubuntu\\home\\test\\downloads', Name: 'debian.iso', TotalReceiveSize: 1, ResourceSize: 2, FailureErrorCode: 0 },
      { TaskId: 10, Status: 5, SavePath: 'C:\\other', Name: 'other.iso', TotalReceiveSize: 1, ResourceSize: 2, FailureErrorCode: 0 },
    ] },
  }, calls) });
  const rows = await reader.readNativeBtTasks('/mnt/c/runtime/profile/TaskDb.dat', 'AA'.repeat(20), { savePath: '/home/test/downloads', taskName: 'debian.iso' });
  assert.deepEqual(rows.map((row) => row.engineId), [9]);
  assert.equal(calls[0].args[3], 'native-bt');
});
