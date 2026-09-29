'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMethodHandler } = require('../../host/src/methods');
const { createAccountMethods } = require('../../host/src/rpc/account-methods');
const { createVipMethods } = require('../../host/src/rpc/vip-methods');
const { RpcRegistry } = require('../../host/src/rpc/registry');

// VIP 面 v2 等价：vip.getGlobalState / getTaskState / setTaskEnabled / retryTask，
// 走 VipAccelerationManager 的 UI 投影（getGlobalUiState/getTaskUiState），不再有裸 getStatus(gid)。

function setup() {
  const calls = [];
  const tasks = new Map();
  const taskRepository = {
    require: (id) => { const t = tasks.get(id); if (!t) throw Object.assign(new Error(`任务不存在: ${id}`), { code: 'TASK_NOT_FOUND' }); return t; },
    get: (id) => tasks.get(id),
  };
  tasks.set('t-1', { id: 't-1', revision: 3, kind: 'http', lifecycle: 'downloading' });
  const vipService = {
    getGlobalUiState: async () => ({ availability: 'available', enabled: true, accountReady: true, isVip: true, peerIdReady: true }),
    getTaskUiState: async (taskId) => ({ taskId, vipState: 'injected', vipReceivedLength: 2, freeDcdnReceivedLength: 3 }),
    setEnabled: async (p) => { calls.push(['setEnabled', p]); return p; },
    retry: async (taskId) => { calls.push(['retry', taskId]); return { taskId, queued: true }; },
    disableAll: async () => { calls.push(['disableAll']); },
    disableTask: async (taskId, p) => { calls.push(['disableTask', taskId, p.reason]); },
  };
  // 对齐 control-rpc 真实装配：AccountService 构造注入 vip，logout 时先 disableAll 再清凭据
  const { AccountService } = require('../../host/src/services/account-service');
  const accountService = new AccountService({ auth: { getStatus: async () => ({ account: { valid: true, uid: 'must-not-return', isVip: true, vipType: 5, vipLevel: 9 } }), logout: async () => { calls.push(['logout']); return { loggedOut: true }; } }, vip: vipService });
  // 对齐 kernel-thunder 装配：account.*/vip.* 由内核插件注册（rpc-plugin-registration）
  const registry = new RpcRegistry();
  registry.register('test:kernel', new Map([
    ...createAccountMethods({ accountService }),
    ...createVipMethods({ vipService, taskRepository }),
  ]));
  const handler = createMethodHandler({ config: { rpcSecret: 'secret' }, registry });
  return { handler, tasks, vipService, calls };
}

test('VIP 面受 bearer 鉴权保护且 UI 投影字段脱敏（uid 不出响应）', async () => {
  const { handler, calls } = setup();
  await assert.rejects(handler('leifeng.ui.v2.vip.getGlobalState', [], {}), /unauthorized/i);
  const status = await handler('leifeng.ui.v2.vip.getGlobalState', [], { bearerToken: 'secret' });
  assert.strictEqual(status.accountReady, true);
  assert.strictEqual(status.enabled, true);
  await handler('leifeng.ui.v2.vip.setTaskEnabled', [{ taskId: 't-1', enabled: false, expectedRevision: 3 }], { bearerToken: 'secret' });
  await handler('leifeng.ui.v2.vip.retryTask', [{ taskId: 't-1' }], { bearerToken: 'secret' });
  assert.deepStrictEqual(calls.slice(0, 2), [['setEnabled', { gid: 't-1', enabled: false }], ['retry', 't-1']]);
  await assert.rejects(handler('leifeng.ui.v2.vip.setTaskEnabled', [{ taskId: 't-1', enabled: 'false' }], { bearerToken: 'secret' }), /enabled/);
  await assert.rejects(handler('leifengl.ui.v2.vip.setTaskEnabled', [{ taskId: 't-1', enabled: false }], { bearerToken: 'secret' }), /Method not found/);
});

test('account.logout 经 AccountService 先 disableAll 再清钱包', async () => {
  const { handler, calls } = await (async () => {
    const base = setup();
    return base;
  })();
  const vipCalls = calls;
  await handler('leifeng.ui.v2.account.logout', [], { bearerToken: 'secret' });
  assert.deepStrictEqual(vipCalls.filter(([name]) => name === 'disableAll'), [['disableAll']]);
  assert.deepStrictEqual(vipCalls.filter(([name]) => name === 'logout'), [['logout']]);
  assert.ok(vipCalls.findIndex(([name]) => name === 'disableAll') < vipCalls.findIndex(([name]) => name === 'logout'), 'disableAll 必须先于 logout');
});

test('vip.getTaskState 返回任务级脱敏通道字段', async () => {
  const { handler } = setup();
  const state = await handler('leifeng.ui.v2.vip.getTaskState', [{ taskId: 't-1' }], { bearerToken: 'secret' });
  assert.strictEqual(state.taskId, 't-1');
  assert.strictEqual(state.vipState, 'injected');
  assert.strictEqual(state.vipReceivedLength, 2);
  assert.strictEqual(state.freeDcdnReceivedLength, 3);
});
