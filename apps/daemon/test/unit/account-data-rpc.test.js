'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountMethods } = require('../../host/src/rpc/account-methods');
const { createVipMethods } = require('../../host/src/rpc/vip-methods');
const { createProductRpcMethods } = require('../../host/src/rpc/product-rpc-methods');
const { RpcRegistry } = require('../../host/src/rpc/registry');

test('V2 method map exposes account/private/history/link/VIP domains with metadata session', async () => {
  const account = { getStatus: async () => ({ account: { valid: false, isVip: false, vipType: 0, vipLevel: 0, checkedAt: null }, loginFlow: { state: 'idle' }, credential: { refreshTokenPresent: false, accessTokenExpiresAt: null }, session: { registered: false, lastKeepAliveAt: null }, engine: { notified: false, notifiedAt: null } }), startLogin: async () => ({ verificationUrl: 'https://example.test', userCode: 'ABC' }), cancelLogin: async () => ({ cancelled: true }), logout: async () => ({ loggedOut: true }) };
  const privateSpace = { getStatus: () => ({ configured: true, unlocked: false }), setup: () => ({ configured: true }), unlock: () => ({ sessionToken: 'secret', expiresAt: 2 }), lock: (token) => ({ locked: !!token }), queryTasks: (_input, ctx) => { assert.equal(ctx.privateSession, 'session'); return []; }, moveIn: async () => ({ task: {} }), moveOut: async () => ({ task: {} }), changePassword: async () => ({ changed: true }) };
  const registry = new RpcRegistry();
  registry.register('test:kernel', new Map([
    ...createAccountMethods({ accountService: account }),
    ...createVipMethods({ vipService: { getGlobalUiState: async () => ({ availability: 'account-required' }), getTaskUiState: async () => ({ taskId: 't' }), setEnabled: async () => {}, retry: async () => ({ queued: true }) } }),
  ]));
  const methods = createProductRpcMethods({ bootstrapService: { getSnapshot: async () => ({}) }, privateSpace,
    historyService: { query: () => ({ items: [] }), get: () => ({}), remove: () => ({ deleted: 0 }), clear: () => ({ deleted: 0 }), createDraft: () => ({}) },
    linkService: { query: () => ({ items: [] }), get: () => ({}), save: () => ({}), setFavorite: () => ({}), setTags: () => ({}), remove: () => ({ removed: 0 }), createDraft: () => ({}) } });
  registry.register('test:product', methods);
  for (const name of ['leifeng.ui.v2.account.get', 'leifeng.ui.v2.account.startLogin', 'leifeng.ui.v2.private.getStatus', 'leifeng.ui.v2.private.queryTasks', 'leifeng.ui.v2.history.query', 'leifeng.ui.v2.links.query', 'leifeng.ui.v2.vip.getGlobalState']) assert.equal(registry.has(name), true, name);
  assert.equal((await registry.get('leifeng.ui.v2.private.queryTasks')([{}], { privateSession: 'session' })).items.length, 0);
  assert.equal((await registry.get('leifeng.ui.v2.account.startLogin')([{}], {})).userCode, 'ABC');
});
