'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { VipAccelerationManager, accountTier } = require('../../host/src/vip-manager');

function makeFixture({ taskType = 'http', status = 'active', selectedFileIndices = [], fileLists = [], snapshot = {}, runtimeFiles = null, speedup, authContext, peerIdProvider } = {}) {
  const record = { gid: 'g1', engineId: 11, taskType, status, taskName: 'file.bin', url: 'https://example/file.bin',
    infoId: taskType === 'bt' ? 'HASH' : '', infoHash: '', metadataPhase: taskType === 'magnet' ? 'download' : '',
    selectedFileIndices, fileLists, vipEnabled: true, vipState: 'disabled', vipLastResult: '', vipLastErrorCode: '',
    vipLastAttemptAt: 0, vipNextRefreshAt: 0, vipReceivedLength: 0, freeDcdnReceivedLength: 0 };
  const registry = { records: [record], list: () => registry.records.slice(), get: (gid) => registry.records.find((r) => r.gid === gid),
    update: (gid, patch) => Object.assign(registry.get(gid), patch) };
  const driver = new EventEmitter(); driver.isHealthy = () => true; driver.enableCalls = []; driver.disableCalls = [];
  driver.runtimeCalls = [];
  driver.getBtFileRuntime = async (engineId) => { driver.runtimeCalls.push(engineId); return { files: runtimeFiles || [] }; };
  driver.enableVipDcdn = async (engineId, certs) => { driver.enableCalls.push({ engineId, fileIndices: certs.map((c) => c.fileIndex), tokenLengths: certs.map((c) => c.token.length) }); return { ok: true, items: certs.map((c) => ({ fileIndex: c.fileIndex, invoked: true, errorCode: '' })) }; };
  driver.disableVipDcdn = async (engineId, indices) => { driver.disableCalls.push({ engineId, indices: indices.slice() }); return { ok: true, items: indices.map((fileIndex) => ({ fileIndex, invoked: true, errorCode: '' })) }; };
  const resolvedAuthContext = authContext || { ok: true, uid: 'uid', accessToken: 'at', sessionId: 'sid', isVip: true, isDownloadVip: true, userVas: 2, vipType: 5, vipLevel: 9 };
  const auth = new EventEmitter(); auth.calls = []; auth.getVipContext = async (opts) => { auth.calls.push(opts || {}); return resolvedAuthContext; }; auth.getStatus = async () => ({ account: { valid: true, isVip: resolvedAuthContext.isVip, userVas: resolvedAuthContext.userVas, vipType: resolvedAuthContext.vipType, vipLevel: resolvedAuthContext.vipLevel } });
  let currentSnapshot = { engineId: 11, resourceSize: 10, name: 'file.bin', url: record.url, cid: 'CID', gcid: 'GCID', vipReceiveSize: 0, freeDcdnReceiveSize: 0, btFiles: [], ...snapshot };
  const readVipTasks = async () => new Map([[11, currentSnapshot]]);
  let now = 1000000;
  const speedupClient = { calls: [], requestTokens: speedup || (async (_ctx, req) => { speedupClient.calls.push(req); return { intervalSec: 305, items: req.files.map((f) => ({ fileIndex: f.fileIndex, token: `fixture-${speedupClient.calls.length}`, resultCode: 0 })) }; }) };
  const manager = new VipAccelerationManager({ registry, driver, auth, peerIdProvider: peerIdProvider || (() => ({ ok: true, peerId: 'PEER-12345678' })),
    readVipTasks, readBtFileRuntime: (engineId) => driver.getBtFileRuntime(engineId), speedupClient, taskDbPath: '/fake', scanMs: 500, maxBackoffMs: 30000, now: () => now, random: () => 0.5 });
  manager._stopped = false; // 单测手动驱动 _scan，不创建 interval
  return { record, registry, driver, auth, speedupClient, manager, setNow: (n) => { now = n; }, setSnapshot: (s) => { currentSnapshot = { ...currentSnapshot, ...s }; } };
}

test('P2SP 元数据就绪 → request → enable → refresh', async () => {
  const f = makeFixture();
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.deepStrictEqual(f.driver.enableCalls[0].fileIndices, [-1]);
  assert.strictEqual(f.record.vipNextRefreshAt, 1060000); // interval 305 → 最低提前 60s
  f.setNow(1060000);
  await f.manager._scan();
  assert.strictEqual(f.speedupClient.calls.length, 2);
  assert.strictEqual(f.driver.enableCalls.length, 2);
  await f.manager.stop({ disable: true });
  assert.strictEqual(f.driver.disableCalls.length, 1);
});

test('TaskDb 元数据未就绪进入 waiting-metadata，不请求 speedup', async () => {
  const f = makeFixture({ snapshot: { cid: '', gcid: '' } });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'waiting-metadata');
  assert.strictEqual(f.speedupClient.calls.length, 0);
  await f.manager.stop({ disable: false });
});

test('BT BtFile 为空时使用 native getBtFileRuntime 补齐 VIP 元数据', async () => {
  const f = makeFixture({ taskType: 'bt', selectedFileIndices: [0], fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 10 }], runtimeFiles: [{ fileIndex: 0, download: 1, fileName: 'ubuntu.iso', fileSize: 10, cid: 'CID', gcid: 'GCID' }], snapshot: { cid: '', gcid: '', btFiles: [] } });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.deepStrictEqual(f.driver.runtimeCalls, [11]);
  assert.deepStrictEqual(f.speedupClient.calls[0].files.map((file) => ({ fileIndex: file.fileIndex, cid: file.cid, gcid: file.gcid })), [{ fileIndex: 0, cid: 'CID', gcid: 'GCID' }]);
  await f.manager.stop({ disable: true });
});

test('BT TaskDb 已有完整 CID/GCID 时不调用 callback fallback', async () => {
  const f = makeFixture({ taskType: 'bt', selectedFileIndices: [0], fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 10 }], runtimeFiles: [{ fileIndex: 0, cid: 'WRONG', gcid: 'WRONG' }], snapshot: { cid: '', gcid: '', btFiles: [{ fileIndex: 0, download: 1, fileName: 'ubuntu.iso', fileSize: 10, cid: 'CID', gcid: 'GCID' }] } });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.deepStrictEqual(f.driver.runtimeCalls, []);
  assert.deepStrictEqual(f.speedupClient.calls[0].files.map((file) => ({ cid: file.cid, gcid: file.gcid })), [{ cid: 'CID', gcid: 'GCID' }]);
  await f.manager.stop({ disable: true });
});

test('BT 部分文件元数据就绪时先为可用文件注入证书', async () => {
  const f = makeFixture({ taskType: 'bt', selectedFileIndices: [0, 1], fileLists: [
    { realIndex: 0, fileName: 'ready.bin', fileSize: 10 }, { realIndex: 1, fileName: 'pending.bin', fileSize: 20 },
  ], snapshot: { cid: '', gcid: '', btFiles: [
    { fileIndex: 0, download: 1, fileName: 'ready.bin', fileSize: 10, cid: 'CID0', gcid: 'GCID0' },
    { fileIndex: 1, download: 1, fileName: 'pending.bin', fileSize: 20, cid: '', gcid: '' },
  ] } });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.deepStrictEqual(f.driver.enableCalls[0].fileIndices, [0]);
  await f.manager.stop({ disable: true });
});

test('资源资格探测过滤受限文件并标记超级通道', async () => {
  const f = makeFixture({ taskType: 'bt', selectedFileIndices: [0, 1], fileLists: [
    { realIndex: 0, fileName: 'a.bin', fileSize: 10 }, { realIndex: 1, fileName: 'b.bin', fileSize: 20 },
  ], snapshot: { cid: '', gcid: '', btFiles: [
    { fileIndex: 0, download: 1, fileName: 'a.bin', fileSize: 10, cid: 'C0', gcid: 'G0' },
    { fileIndex: 1, download: 1, fileName: 'b.bin', fileSize: 20, cid: 'C1', gcid: 'G1' },
  ] } });
  f.speedupClient.requestResourceStatus = async () => ({ items: [
    { fileIndex: 0, banned: false, eligible: true }, { fileIndex: 1, banned: true, eligible: false },
  ] });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.deepStrictEqual(f.speedupClient.calls[0].files.map((file) => file.fileIndex), [0]);
  const ui = await f.manager.getTaskUiState('g1');
  assert.strictEqual(ui.resourceStatus, 'partial');
  assert.strictEqual(ui.accelerationChannel, 'super-channel');
  assert.strictEqual(ui.superChannelEligible, true);
  await f.manager.stop({ disable: true });
});

test('资源资格明确受限时不申请证书', async () => {
  const f = makeFixture();
  f.speedupClient.requestResourceStatus = async () => ({ items: [{ fileIndex: -1, banned: true, eligible: false }] });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'resource-blocked');
  assert.strictEqual(f.speedupClient.calls.length, 0);
  const ui = await f.manager.getTaskUiState('g1');
  assert.strictEqual(ui.resourceStatus, 'blocked');
  assert.strictEqual(ui.problemCode, 'resource-blocked');
  await f.manager.stop({ disable: false });
});

test('会员能力区分超级通道与非会员试用促销流程', async () => {
  const f = makeFixture();
  const global = await f.manager.getGlobalUiState();
  assert.strictEqual(global.isSuperVip, true);
  assert.strictEqual(global.accelerationChannel, 'super-channel');
  assert.deepStrictEqual(f.manager.getFeatureCapabilities(), {
    superChannel: true, speedTrial: false, source: 'vip-dcdn-resource-status',
    speedTrialReason: 'account-promotion-flow-not-exposed',
  });
  await f.manager.stop({ disable: false });
});

test('全局 Peer ID 就绪状态来自实际 provider 而不是任务状态推断', async () => {
  const f = makeFixture({ peerIdProvider: () => ({ ok: false, reason: 'not-found' }) });
  const global = await f.manager.getGlobalUiState();
  assert.strictEqual(global.peerIdReady, false);
  await f.manager.stop({ disable: false });
});

test('会员产品族按 user_vas 与 vas_type 区分下载权益', () => {
  assert.deepStrictEqual(accountTier({ isVip: true, userVas: 2, vipType: 5, vipLevel: 9 }), {
    isVip: true, userVas: 2, vipType: 5, vipLevel: 9, isSuperVip: true,
    isPlatinumVip: false, isPanVip: false, isDownloadVip: true, channel: 'super-channel',
  });
  assert.equal(accountTier({ isVip: true, userVas: 306, vipType: 10 }).isSuperVip, true);
  assert.equal(accountTier({ isVip: true, userVas: 2, vipType: 3 }).isPlatinumVip, true);
  const pan = accountTier({ isVip: true, userVas: 306, vipType: 5 });
  assert.equal(pan.isPanVip, true);
  assert.equal(pan.isDownloadVip, false);
  assert.equal(pan.channel, 'none');
  assert.equal(accountTier({ isVip: true, vipType: 5 }).isDownloadVip, true);
});

test('多文件 BT 逐文件申请并按原生 64 项上限分批启停证书', async () => {
  const count = 154;
  const selectedFileIndices = Array.from({ length: count }, (_, index) => index);
  const fileLists = selectedFileIndices.map((index) => ({ realIndex: index, fileName: `${index}.bin`, fileSize: index + 1 }));
  const btFiles = selectedFileIndices.map((index) => ({ fileIndex: index, download: 1,
    fileName: `${index}.bin`, fileSize: index + 1, cid: `C${index}`, gcid: `G${index}` }));
  const f = makeFixture({ taskType: 'bt', selectedFileIndices, fileLists,
    snapshot: { cid: '', gcid: '', btFiles } });
  await f.manager._scan();
  assert.equal(f.speedupClient.calls.length, count);
  assert.ok(f.speedupClient.calls.every((call) => call.files.length === 1));
  assert.deepStrictEqual(f.driver.enableCalls.map((call) => call.fileIndices.length), [64, 64, 26]);
  assert.equal(f.record.vipState, 'injected');
  f.record.status = 'paused';
  await f.manager._scan();
  assert.deepStrictEqual(f.driver.disableCalls.map((call) => call.indices.length), [64, 64, 26]);
  await f.manager.stop({ disable: false });
});

test('401 只强制 AuthManager 恢复一次再重试', async () => {
  let first = true;
  const f = makeFixture({ speedup: async (ctx, req) => {
    f.speedupClient.calls.push({ ctx, req });
    if (first) { first = false; const e = new Error('http-error'); e.code = 'http-error'; e.status = 401; throw e; }
    return { intervalSec: 3600, items: req.files.map((x) => ({ fileIndex: x.fileIndex, token: 'fixture-retry', resultCode: 0 })) };
  } });
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  assert.strictEqual(f.auth.calls.filter((x) => x.forceRecover).length, 1);
  await f.manager.stop({ disable: true });
});

test('effective 只由 VipReceiveSize 相对注入基线增长触发', async () => {
  const f = makeFixture();
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  f.setSnapshot({ vipReceiveSize: 1 });
  f.setNow(f.record.vipNextRefreshAt - 1);
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'effective');
  f.setSnapshot({ vipReceiveSize: 0 });
  assert.strictEqual(f.record.vipState, 'effective'); // 已达成状态不因瞬时回读回退
  await f.manager.stop({ disable: true });
});

test('pause/terminal disable，engine down 丢弃旧代 refresh', async () => {
  const f = makeFixture();
  await f.manager._scan();
  f.record.status = 'paused';
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'disabled');
  assert.strictEqual(f.driver.disableCalls.length, 1);
  f.record.status = 'active';
  await f.manager._scan();
  assert.strictEqual(f.record.vipState, 'injected');
  f.manager.onEngineDown();
  assert.strictEqual(f.record.vipState, 'stopped');
  await f.manager.stop({ disable: false });
});

test('引擎在证书请求中断开时取消旧请求且不注入', async () => {
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const f = makeFixture({ speedup: async (_context, request) => {
    f.speedupClient.calls.push(request);
    started();
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.code = 'aborted'; reject(error);
    }, { once: true }));
  } });
  const scan = f.manager._scan();
  await waiting;
  f.manager.onEngineDown();
  await scan;
  assert.equal(f.record.vipState, 'stopped');
  assert.equal(f.driver.enableCalls.length, 0);
  await f.manager.stop({ disable: false });
});

test('状态/RPC 形状不包含凭据', async () => {
  const f = makeFixture();
  const status = await f.manager.getStatus();
  const text = JSON.stringify(status);
  assert.doesNotMatch(text, /access-secret|sid|PEER-|fixture-token|uid-value/i);
  await f.manager.stop({ disable: false });
});
