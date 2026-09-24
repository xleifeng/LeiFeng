'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createThunderUiV2Methods } = require('../../host/src/rpc/thunder-ui-v2-methods');

test('V2 method map exposes account/private/history/link/VIP domains with metadata session', async () => {
  const account = { getStatus: async () => ({ account: { valid: false, isVip: false, vipType: 0, vipLevel: 0, checkedAt: null }, loginFlow: { state: 'idle' }, credential: { refreshTokenPresent: false, accessTokenExpiresAt: null }, session: { registered: false, lastKeepAliveAt: null }, engine: { notified: false, notifiedAt: null } }), startLogin: async () => ({ verificationUrl: 'https://example.test', userCode: 'ABC' }), cancelLogin: async () => ({ cancelled: true }), logout: async () => ({ loggedOut: true }) };
  const privateSpace = { getStatus: () => ({ configured: true, unlocked: false }), setup: () => ({ configured: true }), unlock: () => ({ sessionToken: 'secret', expiresAt: 2 }), lock: (token) => ({ locked: !!token }), queryTasks: (_input, ctx) => { assert.equal(ctx.privateSession, 'session'); return []; }, moveIn: async () => ({ task: {} }), moveOut: async () => ({ task: {} }), changePassword: async () => ({ changed: true }) };
  const methods = createThunderUiV2Methods({ taskService: {}, taskQueryService: {}, settingsService: { get: () => ({}) }, bootstrapService: { getSnapshot: async () => ({}) }, accountService: account, vipService: { getGlobalUiState: async () => ({ availability: 'account-required' }), getTaskUiState: async () => ({ taskId: 't' }), setEnabled: async () => {}, retry: async () => ({ queued: true }) }, privateSpace, historyService: { query: () => ({ items: [] }), get: () => ({}), remove: () => ({ deleted: 0 }), clear: () => ({ deleted: 0 }), createDraft: () => ({}) }, linkService: { query: () => ({ items: [] }), get: () => ({}), save: () => ({}), setFavorite: () => ({}), setTags: () => ({}), remove: () => ({ removed: 0 }), createDraft: () => ({}) } });
  for (const name of ['thunder.ui.v2.account.get', 'thunder.ui.v2.account.startLogin', 'thunder.ui.v2.private.getStatus', 'thunder.ui.v2.private.queryTasks', 'thunder.ui.v2.history.query', 'thunder.ui.v2.links.query', 'thunder.ui.v2.vip.getGlobalState']) assert.equal(methods.has(name), true, name);
  assert.equal((await methods.get('thunder.ui.v2.private.queryTasks')([{}], { privateSession: 'session' })).items.length, 0);
  assert.equal((await methods.get('thunder.ui.v2.account.startLogin')([{}], {})).userCode, 'ABC');
});
