'use strict';

// Task 6.2 验收：outbox 事件（含补齐的任务快照）可重放任务投影，
// 且与 repository 持久化现状一致 —— 覆盖创建、状态迁移、暂停、完成、失败、删除。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { replayProjection, compareWithRepository } = require('../../host/src/repositories/projection-replay');

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-replay-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') });
  repo.load();
  return { repo, dir };
}

function assertProjectionConsistent(repo) {
  const pending = repo.listUnacknowledgedEvents('history');
  const { replayed, unsupported } = replayProjection(pending);
  assert.deepEqual(unsupported, [], '窗口内事件应全部带任务快照');
  const { inconsistencies } = compareWithRepository({ replayed, tasks: repo.list() });
  assert.deepEqual(inconsistencies, [], '回放投影与 repository 现状应一致');
  return replayed;
}

test('创建 → 下载中 → 完成：事件快照可重放且与 repository 一致', () => {
  const { repo, dir } = tempRepo();
  try {
    repo.create({ id: 't1', kind: 'http', source: 'https://example.com/a.bin', displayName: 'a.bin', savePath: '/tmp/a', totalBytes: 100, lifecycle: 'queued' });
    repo.mutate('t1', { reason: 'schedule' }, { lifecycle: 'downloading', startedAt: 1, completedBytes: 50 });
    repo.mutate('t1', { reason: 'done' }, { lifecycle: 'completed', completedBytes: 100, completedAt: 2 });
    const replayed = assertProjectionConsistent(repo);
    assert.equal(replayed.get('t1').lifecycle, 'completed');
    assert.equal(replayed.get('t1').completedBytes, 100);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('暂停 → 失败：错误投影随事件携带', () => {
  const { repo, dir } = tempRepo();
  try {
    repo.create({ id: 't2', kind: 'http', source: 'https://example.com/b.bin', displayName: 'b.bin', savePath: '/tmp/b', totalBytes: 10, lifecycle: 'downloading' });
    repo.mutate('t2', { reason: 'user' }, { lifecycle: 'paused', userPaused: true });
    repo.mutate('t2', { reason: 'engine' }, { lifecycle: 'failed', error: { code: 'ENGINE_RESTARTED', category: 'engine', message: 'x', retryable: true } });
    const replayed = assertProjectionConsistent(repo);
    assert.equal(replayed.get('t2').lifecycle, 'failed');
    assert.deepEqual(replayed.get('t2').error, { code: 'ENGINE_RESTARTED', category: 'engine' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('删除后回放不再包含该任务', () => {
  const { repo, dir } = tempRepo();
  try {
    repo.create({ id: 't3', kind: 'http', source: 'https://example.com/c.bin', displayName: 'c.bin', savePath: '/tmp/c', totalBytes: 5, lifecycle: 'queued' });
    repo.mutate('t3', { reason: 'recycle' }, { lifecycle: 'recycled', recycledAt: 3 });
    repo.deletePermanently('t3');
    const replayed = assertProjectionConsistent(repo);
    assert.ok(!replayed.has('t3'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('观察类更新（速度/进度）不产生 task.updated 事件，窗口保持可重放', () => {
  const { repo, dir } = tempRepo();
  try {
    repo.create({ id: 't4', kind: 'http', source: 'https://example.com/d.bin', displayName: 'd.bin', savePath: '/tmp/d', totalBytes: 100, lifecycle: 'downloading' });
    repo.patchObservation('t4', { completedBytes: 30, downloadBytesPerSecond: 1024 });
    repo.patchObservation('t4', { completedBytes: 60, downloadBytesPerSecond: 2048 });
    const events = repo.listUnacknowledgedEvents('history');
    assert.ok(events.every((event) => event.type !== 'task.updated' || event.payload.task), 'task.updated 必须带快照');
    assertProjectionConsistent(repo);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repository 现状与窗口内事件快照矛盾时被一致性检查捕获', () => {
  const { repo, dir } = tempRepo();
  try {
    repo.create({ id: 't5', kind: 'http', source: 'https://example.com/e.bin', displayName: 'e.bin', savePath: '/tmp/e', totalBytes: 10, lifecycle: 'completed' });
    const pending = repo.listUnacknowledgedEvents('history');
    const { replayed } = replayProjection(pending);
    // 模拟外部篡改：repository 现状改成 downloading
    const { inconsistencies } = compareWithRepository({ replayed, tasks: [{ ...replayed.get('t5'), lifecycle: 'downloading' }] });
    assert.ok(inconsistencies.some((item) => item.field === 'lifecycle' && item.taskId === 't5'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('旧格式事件（仅 reason 无快照）被记为 unsupported 而非静默丢弃', () => {
  const events = [{ sequence: 1, type: 'task.updated', taskId: 'legacy', payload: { reason: 'old-format' } }];
  const { replayed, unsupported } = replayProjection(events);
  assert.equal(replayed.size, 0);
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].type, 'task.updated');
});
