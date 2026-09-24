'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ProgressPoller } = require('../../host/src/poller');

// 复用 poller.test 的 registry stub 模式。
function makeRegistry(tasks) {
  return { list: () => tasks, get: (g) => tasks.find((t) => t.gid === g), update: (g, p) => { const t = tasks.find((x) => x.gid === g); Object.assign(t, p); } };
}

test('磁力 metadata-fetching：TaskDb 无行 → 保持 waiting 不迁 error', async () => {
  const rec = { gid: 'g1', engineId: 100, status: 'waiting', savePath: '/s', taskName: 'H.torrent',
    taskType: 'magnet', metadataPhase: 'fetching', totalLength: 0, completedLength: 0, downloadSpeed: 0, createdAt: Date.now() };
  const registry = makeRegistry([rec]);
  const poller = new ProgressPoller(registry, {
    intervalMs: 50, stallMs: 99999,
    readTasksFn: async () => new Map(),   // TaskDb 无行
    statFn: () => 0,
  });
  await poller._tick();
  assert.strictEqual(rec.status, 'waiting');      // 不迁 error
  assert.strictEqual(rec.metadataPhase, 'fetching');
});

test('磁力转 BT 后（engineId 切 btId）：按新 engineId 读 TaskBase 正常推进', async () => {
  const rec = { gid: 'g1', engineId: 200, status: 'waiting', savePath: '/s', taskName: 'x.iso',
    taskType: 'magnet', metadataPhase: 'download', totalLength: 1024, completedLength: 0, downloadSpeed: 0, createdAt: Date.now() };
  const registry = makeRegistry([rec]);
  const poller = new ProgressPoller(registry, {
    intervalMs: 50, stallMs: 99999,
    readTasksFn: async (ids) => { const m = new Map(); if (ids.includes(200)) m.set(200, { status: 5, totalReceiveSize: 512, resourceSize: 1024, failureErrorCode: 0, name: 'x.iso' }); return m; },
    statFn: () => 0,
  });
  await poller._tick();
  assert.strictEqual(rec.completedLength, 512);
  assert.strictEqual(rec.status, 'active');   // grew → active
});

test('磁力 metadata-fetching 转 complete 不误迁（无行不迁 complete）', async () => {
  const rec = { gid: 'g1', engineId: 100, status: 'waiting', savePath: '/s', taskName: 'H.torrent',
    taskType: 'magnet', metadataPhase: 'fetching', totalLength: 0, completedLength: 0, downloadSpeed: 0, createdAt: Date.now() };
  const registry = makeRegistry([rec]);
  const poller = new ProgressPoller(registry, { intervalMs: 50, stallMs: 99999, readTasksFn: async () => new Map(), statFn: () => 0 });
  await poller._tick();
  await poller._tick();
  assert.strictEqual(rec.status, 'waiting');  // 多 tick 仍 waiting
});
