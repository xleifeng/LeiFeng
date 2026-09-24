'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry } = require('../../host/src/registry');
const { createMethodHandler } = require('../../host/src/methods');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-rpc-'));
  const registry = new TaskRegistry(path.join(dir, 'r.json'));
  const rec = registry.create({ url: 'https://x/a', savePath: dir, taskName: 'a', totalLength: 10, engineId: 7, taskType: 'http' });
  const calls = [];
  const vip = {
    getStatus: async (gid) => ({ enabled: true, accountReady: true, isVip: true, peerIdReady: true, tasks: gid ? [{ gid, vipState: 'injected', vipReceivedLength: 2 }] : [] }),
    setEnabled: async (p) => { calls.push(['setEnabled', p]); return p; },
    retry: async (gid) => { calls.push(['retry', gid]); return { gid, queued: true }; },
    disableAll: async () => { calls.push(['disableAll']); },
    disableTask: async (gid, p) => { calls.push(['disableTask', gid, p.reason]); },
  };
  const auth = { getStatus: async () => ({ account: { valid: true, uid: 'must-not-return', isVip: true, vipType: 5, vipLevel: 9 } }), logout: async () => { calls.push(['logout']); return { loggedOut: true }; } };
  const driver = { isHealthy: () => true, startTasks: async () => {}, stopTasks: async () => {}, deleteTasks: async () => {}, enginePid: () => null, sdkReady: true, restarts: 0, bootedAt: 0 };
  const handler = createMethodHandler({ registry, driver, auth, vip, config: { downloadDir: dir, version: '0.5.0', rpcSecret: 'secret' } });
  return { handler, registry, rec, vip, calls };
}

test('VIP getStatus/setEnabled/retry 受 rpc-secret 保护且字段脱敏', async () => {
  const { handler, rec, calls } = setup();
  await assert.rejects(handler('thunder.vip.getStatus', []), /unauthorized/i);
  const status = await handler('thunder.vip.getStatus', [{ gid: rec.gid }], { rpcSecret: 'secret' });
  assert.strictEqual(status.accountReady, true);
  assert.deepStrictEqual(status.tasks[0], { gid: rec.gid, vipState: 'injected', vipReceivedLength: 2 });
  assert.doesNotMatch(JSON.stringify(status), /must-not-return|access-secret|sid-secret|fixture-token/i);
  await handler('thunder.vip.setEnabled', [{ gid: rec.gid, enabled: false }], { rpcSecret: 'secret' });
  await handler('thunder.vip.retry', [{ gid: rec.gid }], { rpcSecret: 'secret' });
  assert.deepStrictEqual(calls.slice(0, 2), [['setEnabled', { gid: rec.gid, enabled: false }], ['retry', rec.gid]]);
  await assert.rejects(handler('thunder.vip.setEnabled', [{ enabled: 'false' }], { rpcSecret: 'secret' }), /enabled/);
});

test('auth logout 先 disableAll 再清钱包，失败也继续 logout', async () => {
  const { handler, calls } = setup();
  await handler('thunder.auth.logout', [], { rpcSecret: 'secret' });
  assert.deepStrictEqual(calls.slice(0, 2), [['disableAll'], ['logout']]);
});

test('tellStatus 增加脱敏 VIP 通道字段', async () => {
  const { handler, rec } = setup();
  rec.status = 'active'; rec.vipState = 'effective'; rec.vipReceivedLength = 42; rec.freeDcdnReceivedLength = 3; rec.vipNextRefreshAt = 99;
  const status = await handler('aria2.tellStatus', [rec.gid], { rpcSecret: 'secret' });
  assert.strictEqual(status.vipStatus, 'effective');
  assert.strictEqual(status.vipReceivedLength, '42');
  assert.strictEqual(status.freeDcdnReceivedLength, '3');
  assert.strictEqual(status.vipNextRefreshAt, 99);
});
