'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRepository, normalizeTaskRecord } = require('../../host/src/repositories/task-repository');
const { TaskRegistry } = require('../../host/src/registry');

function paths() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-repo-v2-')); return { dir, file: path.join(dir, 'data', 'tasks.json'), legacy: path.join(dir, 'registry.json') }; }

test('legacy registry migrates atomically with backup, unknown fields and V2 schema', () => {
  const p = paths();
  fs.writeFileSync(p.legacy, JSON.stringify([{ gid: 'abc', url: 'http://x/a', savePath: p.dir, taskName: 'a', taskType: 'http', totalLength: 10, engineId: 7, status: 'complete', createdAt: 10, customField: 'kept' }]));
  const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy });
  repo.load();
  const task = repo.get('abc');
  assert.equal(task.id, 'abc');
  assert.equal(task.lifecycle, 'completed');
  assert.equal(task.legacy.customField, 'kept');
  assert.ok(fs.existsSync(p.file));
  assert.ok(fs.readdirSync(p.dir).some((name) => name.startsWith('registry.json.v1-backup-')));
  assert.equal(JSON.parse(fs.readFileSync(p.file, 'utf8')).schemaVersion, 2);
});

test('mutation uses revision/fileRevision and appends outbox atomically', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'http' });
  const updated = repo.mutate(task.id, { expectedRevision: task.revision }, { displayName: 'b', lifecycle: 'queued' });
  assert.equal(updated.revision, task.revision + 1);
  assert.equal(updated.fileRevision, task.fileRevision + 1);
  assert.ok(repo.listUnacknowledgedEvents('history').length >= 2);
  assert.throws(() => repo.mutate(task.id, { expectedRevision: 1 }, { displayName: 'c' }), (error) => error.code === 'REVISION_CONFLICT');
});

test('observation revision does not conflict with command revision', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'http' });
  const observed = repo.patchObservation(task.id, { completedBytes: 3, totalBytes: 10, downloadBytesPerSecond: 5 });
  assert.equal(observed.revision, task.revision);
  assert.equal(observed.observationRevision, task.observationRevision + 1);
  assert.equal(repo.mutate(task.id, { expectedRevision: task.revision }, { lifecycle: 'queued' }).revision, task.revision);
});

test('V2 VIP nested state survives repository normalization and legacy registry updates', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'bt', vip: { enabled: true } });
  const updated = repo.mutate(task.id, {}, {
    vip: { enabled: false, state: 'requesting', receivedBytes: 123, freeDcdnReceivedBytes: 7, nextRefreshAt: 99, lastErrorCode: 'retrying' },
  });
  assert.deepEqual(updated.vip, { enabled: false, state: 'requesting', receivedBytes: 123, freeDcdnReceivedBytes: 7, nextRefreshAt: 99, lastErrorCode: 'retrying' });
  const reloaded = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); reloaded.load();
  assert.deepEqual(reloaded.get(task.id).vip, updated.vip);
});

test('BT protocol identity stays raw while sourceFingerprint remains the duplicate key', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const hash = 'DAFC8C076CA2F3ED376EEAE7C76A0D6BE2415C45';
  const task = repo.create({ source: null, savePath: p.dir, displayName: 'ubuntu.iso', kind: 'bt', infoId: hash });
  assert.equal(task.infoId, hash);
  assert.equal(task.sourceFingerprint, `bt:info:${hash.toLowerCase()}`);
  assert.equal(TaskRegistry.fromRepository(repo).get(task.id).infoId, hash);
  const recovered = normalizeTaskRecord({ ...task, infoId: '', sourceFingerprint: task.sourceFingerprint });
  assert.equal(recovered.infoId, hash.toLowerCase());
});

test('permanent delete refuses to silently drop a full outbox', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy, maxOutbox: 1 }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'http' });
  assert.throws(() => repo.deletePermanently(task.id), (error) => error.code === 'OUTBOX_FULL');
});

test('reload converts non-terminal engine records to retryable failed without dropping source', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'http', engineId: 9, lifecycle: 'queued' }); repo.close();
  const reloaded = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); reloaded.load(); const recovered = reloaded.get(task.id);
  assert.equal(recovered.lifecycle, 'failed'); assert.equal(recovered.engineId, null); assert.equal(recovered.source, 'http://x/a'); assert.equal(recovered.error.code, 'ENGINE_RESTARTED');
});

test('ackEvents drains outbox backlog with a single atomic write (fsync storm regression)', () => {
  const p = paths(); const repo = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); repo.load();
  const task = repo.create({ source: 'http://x/a', savePath: p.dir, displayName: 'a', kind: 'http' });
  for (let i = 0, rev = task.revision; i < 50; i += 1, rev += 1) repo.mutate(task.id, { expectedRevision: rev }, { displayName: `a-${i}` });
  const pending = repo.listUnacknowledgedEvents('history');
  assert.ok(pending.length >= 50);
  let writes = 0; const original = repo._writeAtomic.bind(repo); repo._writeAtomic = () => { writes += 1; return original(); };
  assert.equal(repo.ackEvents('history', pending.map((event) => event.sequence)), pending.length);
  assert.equal(writes, 1);                                   // 一次落盘，不是每事件一次
  assert.equal(repo.listUnacknowledgedEvents('history').length, 0);
  assert.equal(repo.listUnacknowledgedEvents('links').length, pending.length);  // 另一消费者不受影响
  let strayWrites = writes; assert.equal(repo.ackEvent('history', 999999), false); assert.equal(writes, strayWrites);  // 未知 sequence：false 且不落盘
  const persist = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); persist.load();
  // 注意：load() 时 _recoverAfterRestart 会把非终态任务标 failed 并追加新事件（task 仍在 queued），
  // 所以 history 待办 = 1（恢复事件）而非 0 —— 这正是生产里 1013 条积压的来源之一。
  const recovered = persist.listUnacknowledgedEvents('history');
  assert.equal(recovered.length, 1); assert.equal(recovered[0].type, 'task.lifecycle.changed');
  persist.ackEvents('history', recovered.map((event) => event.sequence));
  persist.ackEvents('links', persist.listUnacknowledgedEvents('links').map((event) => event.sequence));
  const drained = new TaskRepository({ filePath: p.file, legacyFilePath: p.legacy }); drained.load();
  assert.equal(drained.outbox.events.length, 0);                    // 双消费者都 ack 后 outbox 清空
});
