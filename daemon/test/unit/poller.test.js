'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry } = require('../../host/src/registry');
const { ProgressPoller, STATUS_MAP } = require('../../host/src/poller');

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-'));
  const reg = new TaskRegistry(path.join(dir, 'r.json'));
  return { dir, reg, ...extra };
}
const mkTask = (reg, over = {}) => reg.create({ url: 'u', savePath: '/d', taskName: 'f', totalLength: 100, engineId: 1, ...over });

test('TaskDb complete (Status=8) drives status and sizes', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 42 });
  reg.update(rec.gid, { status: 'active' });
  const readTasksFn = async () => new Map([[42, { status: STATUS_MAP.complete, totalReceiveSize: 100, resourceSize: 100, failureErrorCode: 0 }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  const r = reg.get(rec.gid);
  assert.strictEqual(r.status, 'complete');
  assert.strictEqual(r.completedLength, 100);
  assert.strictEqual(r.totalLength, 100);
  assert.strictEqual(r.downloadSpeed, 0);
});

test('TaskDb FailureErrorCode → error with engine code', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 43 });
  reg.update(rec.gid, { status: 'active' });
  const readTasksFn = async () => new Map([[43, { status: 9, totalReceiveSize: 0, resourceSize: 500, failureErrorCode: 12 }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  const r = reg.get(rec.gid);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.errorCode, '12');
});

test('paused task still refreshes progress from TaskDb (no freeze)', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 44 });
  reg.update(rec.gid, { status: 'paused', completedLength: 10 });
  const readTasksFn = async () => new Map([[44, { status: STATUS_MAP.paused, totalReceiveSize: 60, resourceSize: 100, failureErrorCode: 0 }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  const r = reg.get(rec.gid);
  assert.strictEqual(r.status, 'paused');       // 状态不自动迁移
  assert.strictEqual(r.completedLength, 60);    // 但进度不冻结
});

test('row missing → FS fallback; growth → active; size>=total → complete', async () => {
  const { dir, reg } = setup();
  const file = path.join(dir, 'f.bin');
  const rec = reg.create({ url: 'u', savePath: dir, taskName: 'f.bin', totalLength: 100, engineId: 45 });
  const readTasksFn = async () => new Map(); // TaskDb 无行
  const p = new ProgressPoller(reg, { readTasksFn });
  fs.writeFileSync(file, Buffer.alloc(40));
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).status, 'active');
  fs.writeFileSync(file, Buffer.alloc(100));
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).status, 'complete');
});

test('FS fallback: stalled active → waiting after stallMs', async () => {
  const { dir, reg } = setup();
  const file = path.join(dir, 'f.bin');
  const rec = reg.create({ url: 'u', savePath: dir, taskName: 'f.bin', totalLength: 100, engineId: 46 });
  const p = new ProgressPoller(reg, { readTasksFn: async () => new Map(), stallMs: 30 });
  fs.writeFileSync(file, Buffer.alloc(40));
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).status, 'active');
  await new Promise((r) => setTimeout(r, 60));
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).status, 'waiting');
});

test('terminal tasks untouched', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 47 });
  reg.update(rec.gid, { status: 'removed' });
  const p = new ProgressPoller(reg, { readTasksFn: async () => new Map() });
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).status, 'removed');
});

// F4: paused + Status=8（complete）是 Task 6 修复的真正 bug 路径——
// paused 守卫须前置在 complete 迁移之前，否则 paused 任务会被 TaskDb Status=8 迁移到 complete。
test('paused task with TaskDb Status=8 stays paused (only progress refreshes)', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 48 });
  reg.update(rec.gid, { status: 'paused', completedLength: 30 });
  const readTasksFn = async () => new Map([[48, { status: STATUS_MAP.complete, totalReceiveSize: 100, resourceSize: 100, failureErrorCode: 0 }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  const r = reg.get(rec.gid);
  assert.strictEqual(r.status, 'paused', 'paused task must not auto-migrate to complete even when TaskDb Status=8');
  assert.strictEqual(r.completedLength, 100, 'progress still refreshes');
  assert.strictEqual(r.downloadSpeed, 0);
});

// ---- 限制 1 根治：TaskDb Name 回读对齐真实落盘名 ----

test('Name readback fixes registry.taskName to engine-real name', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 50, taskName: 'custom.bin' });
  reg.update(rec.gid, { status: 'active' });
  const readTasksFn = async () => new Map([[50, { status: 5, totalReceiveSize: 10, resourceSize: 100, failureErrorCode: 0, name: 'real.bin' }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).taskName, 'real.bin');
});

test('name=null does not touch taskName', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 51, taskName: 'custom.bin' });
  reg.update(rec.gid, { status: 'active' });
  const patches = [];
  const origUpdate = reg.update.bind(reg);
  reg.update = (gid, patch) => { patches.push(patch); return origUpdate(gid, patch); };
  const readTasksFn = async () => new Map([[51, { status: 5, totalReceiveSize: 10, resourceSize: 100, failureErrorCode: 0, name: null }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  assert.strictEqual(patches.length, 1);
  assert.ok(!('taskName' in patches[0]), 'patch must not contain taskName when name is null');
  assert.strictEqual(reg.get(rec.gid).taskName, 'custom.bin');
});

test('name equal to taskName does not re-patch (idempotent)', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 52, taskName: 'custom.bin' });
  reg.update(rec.gid, { status: 'active' });
  const patches = [];
  const origUpdate = reg.update.bind(reg);
  reg.update = (gid, patch) => { patches.push(patch); return origUpdate(gid, patch); };
  const readTasksFn = async () => new Map([[52, { status: 5, totalReceiveSize: 10, resourceSize: 100, failureErrorCode: 0, name: 'custom.bin' }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  assert.strictEqual(patches.length, 1);
  assert.ok(!('taskName' in patches[0]), 'no taskName patch when name already aligned');
});

test('complete migration and Name readback land in the same tick', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 53, taskName: 'custom.bin' });
  reg.update(rec.gid, { status: 'active' });
  const readTasksFn = async () => new Map([[53, { status: 8, totalReceiveSize: 100, resourceSize: 100, failureErrorCode: 0, name: 'real.bin' }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  const r = reg.get(rec.gid);
  assert.strictEqual(r.status, 'complete');
  assert.strictEqual(r.taskName, 'real.bin', 'taskName fixed in the same update as complete migration');
});

test('readback sanitizes Name: rejects ".." and normalizes "a/b.bin" to "b.bin"', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 54, taskName: 'custom.bin' });
  reg.update(rec.gid, { status: 'active' });
  const patches = [];
  const origUpdate = reg.update.bind(reg);
  reg.update = (gid, patch) => { patches.push(patch); return origUpdate(gid, patch); };
  const readTasksFn = async () => new Map([[54, { status: 5, totalReceiveSize: 10, resourceSize: 100, failureErrorCode: 0, name: '..' }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  await p._tick();
  assert.ok(!patches.some((pt) => 'taskName' in pt), 'name=".." must be rejected (path escape guard)');
  assert.strictEqual(reg.get(rec.gid).taskName, 'custom.bin');
  // basename 归一化：a/b.bin → b.bin（不是拒绝）
  p.readTasksFn = async () => new Map([[54, { status: 5, totalReceiveSize: 20, resourceSize: 100, failureErrorCode: 0, name: 'a/b.bin' }]]);
  await p._tick();
  assert.strictEqual(reg.get(rec.gid).taskName, 'b.bin');
});

// ---- 顺手项 4：_prev/_warnedUnknown 残留清理（必须早于 tracked 空早退） ----

test('_prev and _warnedUnknown stale entries cleaned even when tracked is empty', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 55 });
  reg.update(rec.gid, { status: 'removed' }); // 不在 tracked → tracked 为空 → 早退路径
  const p = new ProgressPoller(reg, { readTasksFn: async () => new Map() });
  p._prev.set(rec.gid, { size: 10, at: Date.now(), lastGrowthAt: Date.now() });
  p._warnedUnknown.add(rec.gid);
  await p._tick();
  assert.strictEqual(p._prev.size, 0, '_prev cleaned before early return');
  assert.strictEqual(p._warnedUnknown.size, 0, '_warnedUnknown cleaned in same loop');
});

// ---- 顺手项 5：未知 Status 每 gid 只 warn 一次 ----

test('unknown TaskDb Status warns once per gid', async () => {
  const { reg } = setup();
  const rec = mkTask(reg, { engineId: 56 });
  reg.update(rec.gid, { status: 'active' });
  const readTasksFn = async () => new Map([[56, { status: 42, totalReceiveSize: 10, resourceSize: 100, failureErrorCode: 0 }]]);
  const p = new ProgressPoller(reg, { readTasksFn });
  const origWarn = console.warn;
  let warns = 0;
  console.warn = () => { warns++; };
  try {
    await p._tick();
    await p._tick();
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(warns, 1, 'unknown Status must warn exactly once per gid');
});
