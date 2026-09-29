'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { createTaskRpcMethods } = require('../../host/src/rpc/task-rpc-methods');
const { RpcRegistry } = require('../../host/src/rpc/registry');

test('V2 policy RPC exposes policy, queue, schedule and completion domains', async () => {
  const calls = [];
  const registry = new RpcRegistry();
  const methods = createTaskRpcMethods({ taskService: {}, taskQueryService: {}, settingsService: { get: () => ({}), update: async () => ({}) }, policyService: { get: () => ({ revision: 0, policy: {} }), update: async (input) => { calls.push(['update', input]); return { revision: 1, policy: {} }; }, enableFullSpeed: async () => ({}), restoreLimits: async () => ({}), testProxy: async () => ({ ok: true }) }, scheduler: { move: async (input) => { calls.push(['move', input]); return {}; } }, scheduleService: { query: () => ({ revision: 0, schedules: [] }), save: async (input) => input, delete: async (input) => input, getDownloadLimitWindow: () => ({ enabled: false }), setDownloadLimitWindow: async (input) => { calls.push(['limit-window', input]); return input; } }, completionActions: { getPending: () => null, cancel: () => true } });
  registry.register('test:task', methods);
  await methods.get('leifeng.ui.v2.policies.update')([{ expectedRevision: 0, patch: { maxConcurrentTasks: 2 } }]);
  await methods.get('leifeng.ui.v2.queue.move')([{ taskIds: ['a'], target: 'top' }]);
  await methods.get('leifeng.ui.v2.schedules.setDownloadLimitWindow')([{ enabled: true, startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' }]);
  assert.deepEqual(calls, [['update', { expectedRevision: 0, patch: { maxConcurrentTasks: 2 } }], ['move', { taskIds: ['a'], target: 'top' }], ['limit-window', { enabled: true, startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' }]]);
});
