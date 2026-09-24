'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startFakeEngine } = require('./helpers/fake-engine');

// engine 在 Wine 下跑，单测用 fake-engine 模拟分派逻辑；
// 真引擎行为由 integration 验。本测验证 engine.js 的 validateInfo/分派/parseTaskInfo 形状。
// 因 engine.js 无法在系统 Node 直接 require（依赖 dk_addon.node），单测改测
// fake-engine 暴露的 createTask/parseTaskInfo 是否符合 spec 接口（形状对齐）。

test('TASKTYPE 枚举与 CREATORS 对齐', async () => {
  const fx = await startFakeEngine();
  // fake-engine 暴露 TASKTYPE/CREATORS 供测
  assert.deepStrictEqual(fx.TASKTYPE, { P2SP:1, BT:2, EMULE:3, MAGNET:5 });
  assert.ok(fx.CREATORS[1] && fx.CREATORS[2] && fx.CREATORS[3] && fx.CREATORS[5]);
  fx.server.close();
});

test('createTask BT 缺 seedFile 抛 invalid info', async () => {
  const fx = await startFakeEngine();
  await assert.rejects(
    fx.call('createTask', { taskType: 2, taskInfo: { taskBaseInfo: {} }, info: { infoId: 'X' } }),
    /invalid info: btInfo\.seedFile missing/
  );
  fx.server.close();
});

test('createTask BT 缺 infoId 抛 invalid info', async () => {
  const fx = await startFakeEngine();
  await assert.rejects(
    fx.call('createTask', { taskType: 2, taskInfo: { taskBaseInfo: {} }, info: { seedFile: 'Z:\\x.torrent' } }),
    /invalid info: btInfo\.infoId missing/
  );
  fx.server.close();
});

test('createTask 磁力缺 url 抛 invalid info', async () => {
  const fx = await startFakeEngine();
  await assert.rejects(
    fx.call('createTask', { taskType: 5, taskInfo: { taskBaseInfo: {} }, info: { torrentFilePath: 'Z:\\save' } }),
    /invalid info: magnetInfo\.url missing/
  );
  fx.server.close();
});

test('createTask 未知 taskType 抛 unsupported', async () => {
  const fx = await startFakeEngine();
  await assert.rejects(
    fx.call('createTask', { taskType: 99, taskInfo: {}, info: { url: 'x' } }),
    /unsupported taskType: 99/
  );
  fx.server.close();
});

test('createTask BT 合法 → 返回 engineId 且 taskInfo.taskType 被填', async () => {
  const fx = await startFakeEngine();
  const r = await fx.call('createTask', { taskType: 2, taskInfo: { taskBaseInfo: { savePath: 'Z:\\s', taskName: 'x.iso' } },
    info: { infoId: 'ABC', seedFile: 'Z:\\x.torrent', fileRealIndexLists: [0], autoRenameWhenRepeat: false } });
  assert.ok(r.engineId > 0);
  // fake-engine 记录调用以验 taskType 冗余消除
  const call = fx.state.createCalls[0];
  assert.strictEqual(call.taskInfo.taskType, 2);
  fx.server.close();
});

test('parseTaskInfo torrent/magnet/ed2k/thunder/urltype 分派', async () => {
  const fx = await startFakeEngine();
  const t = await fx.call('parseTaskInfo', { kind: 'torrent', data: 'Z:\\x.torrent' });
  assert.ok(t.infoId && t.fileLists);
  const mag = await fx.call('parseTaskInfo', { kind: 'magnet', data: 'magnet:?xt=urn:btih:ABC' });
  assert.ok(mag.infoHash);
  const e = await fx.call('parseTaskInfo', { kind: 'ed2k', data: 'ed2k://|file|x|1|HASH|/' });
  assert.ok(e.fileHash !== undefined);
  const th = await fx.call('parseTaskInfo', { kind: 'thunder', data: 'thunder://abc' });
  assert.ok('resolvedUrl' in th);
  const ut = await fx.call('parseTaskInfo', { kind: 'urltype', data: 'magnet:?xt=urn:btih:ABC' });
  assert.strictEqual(ut.taskType, 5);
  fx.server.close();
});

test('parseTaskInfo 未知 kind 抛 unknown', async () => {
  const fx = await startFakeEngine();
  await assert.rejects(fx.call('parseTaskInfo', { kind: 'foo', data: 'x' }), /unknown parse kind: foo/);
  fx.server.close();
});
