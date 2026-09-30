'use strict';
// bridge-status 插件单测（kernel-detail-panels）：report 校验/写入、sessions 读取、
// forTask 关联（infoHash 匹配 + stale 标志）、inject 面与撤销。
const test = require('node:test');
const assert = require('node:assert/strict');
const { bridgeStatus } = require('../../host/plugins/bridge-status.cjs');

function makeContext() {
  const registered = new Map();
  const context = {
    leifengRpc: { registry: { register: (ns, entries) => { registered.set(ns, new Map(entries)); return () => registered.delete(ns); } } },
    provide(name, value) { this[name] = value; },
  };
  return { context, registered };
}

const VALID_HASH = 'a'.repeat(40);

test('report 校验 infohash 形态并写入会话', () => {
  const { context, registered } = makeContext();
  const teardown = bridgeStatus.apply(context);
  const report = registered.get('bridge-status').get('leifeng.ui.v2.bridge.report');
  assert.throws(() => report([{ infohash: 'bad' }]), /INVALID_PARAMS|infohash/);
  assert.deepEqual(report([{ infohash: VALID_HASH, verifiedPieces: 3, totalPieces: 10 }]), { accepted: true });
  const sessions = registered.get('bridge-status').get('leifeng.ui.v2.bridge.sessions')().sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].infohash, VALID_HASH);
  assert.equal(sessions[0].verifiedPieces, 3);
  assert.equal(sessions[0].stale, false);
  teardown();
  assert.equal(registered.size, 0, '撤销后 RPC 面清空');
});

test('forTask 按 infoHash 关联，大小写不敏感；无关联返回 null', () => {
  const { context, registered } = makeContext();
  const teardown = bridgeStatus.apply(context);
  const report = registered.get('bridge-status').get('leifeng.ui.v2.bridge.report');
  report([{ infohash: VALID_HASH, taskId: 't-1', serveBytesTotal: 1024 }]);
  const provided = context.leifengBridgeStatus;
  assert.equal(provided.forTask({ infoHash: VALID_HASH.toUpperCase() }).taskId, 't-1');
  assert.equal(provided.forTask({ infoHash: 'b'.repeat(40) }), null);
  assert.equal(provided.forTask({ infoHash: null }), null);
  assert.equal(provided.forTask(null), null);
  teardown();
});

test('enrichDetail 聚合：内核 extras 文件进度 + 通道 + 桥会话（task-shell 装配逻辑）', async () => {
  // 复刻 task-shell 的 enrichDetail 形态直测（服务层钩子），内核/桥双缺席时 dto 不变
  const { TaskQueryService } = require('../../host/src/services/task-query-service');
  const tasks = {
    require: () => ({
      id: 't-1', kernelId: 'thunder', kind: 'bt', lifecycle: 'downloading', sourceFingerprint: 'bt:hash:' + VALID_HASH,
      displayName: 'x', savePath: '/d', totalBytes: 100, completedBytes: 10, infoHash: VALID_HASH,
      selectedFileIndices: [], revision: 1, observationRevision: 1, fileRevision: 1, createdAt: 1, updatedAt: 1,
      files: [{ index: 0, name: 'a.bin', path: 'a.bin', size: 100, offset: 0 }],
      vip: null, error: null, capabilities: {},
    }),
  };
  const enrichDetail = async (task, dto) => {
    // 与 task-shell.cjs 注入逻辑同构（内核 extras + 桥 forTask）
    const kernel = { getTaskDetailExtras: async () => ({ files: [{ index: 0, completedBytes: 64 }], channels: { p2p: 50, p2s: 10, origin: 4, vip: 0, freeDcdn: 0 } }) };
    const extras = await kernel.getTaskDetailExtras(task);
    if (extras) {
      const byIndex = new Map(extras.files.map((f) => [f.index, f.completedBytes]));
      for (const file of dto.files) if (byIndex.has(file.index)) file.completedBytes = byIndex.get(file.index);
      dto.channels = extras.channels;
    }
    dto.bridge = { infohash: VALID_HASH, taskId: 't-1', verifiedPieces: 1, totalPieces: 2, verifiedBytes: 10, serveBytesTotal: 20, serveRateBps: 5, lifecycle: 'verifying', stale: false, updatedAt: Date.now() };
  };
  const service = new TaskQueryService({ tasks, enrichDetail });
  const dto = await service.get({ taskId: 't-1' });
  assert.equal(dto.kernelId, 'thunder');
  assert.equal(dto.files[0].completedBytes, 64);
  assert.deepEqual(dto.channels, { p2p: 50, p2s: 10, origin: 4, vip: 0, freeDcdn: 0 });
  assert.equal(dto.bridge.lifecycle, 'verifying');
});

test('enrichDetail 抛错不阻塞详情主数据（富化失败诚实降级）', async () => {
  const { TaskQueryService } = require('../../host/src/services/task-query-service');
  const tasks = {
    require: () => ({
      id: 't-2', kernelId: 'thunder', kind: 'http', lifecycle: 'downloading', sourceFingerprint: 'x',
      displayName: 'x', savePath: '/d', totalBytes: 100, completedBytes: 10,
      selectedFileIndices: [], revision: 1, observationRevision: 1, fileRevision: 1, createdAt: 1, updatedAt: 1,
      files: [], vip: null, error: null, capabilities: {},
    }),
  };
  const service = new TaskQueryService({ tasks, enrichDetail: async () => { throw new Error('TaskDb locked'); } });
  const dto = await service.get({ taskId: 't-2' });
  assert.equal(dto.taskId, 't-2');
  assert.equal(dto.channels, undefined);
  assert.equal(dto.bridge, undefined);
});
