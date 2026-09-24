'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountService } = require('../../host/src/services/account-service');

test('AccountService emits a redacted DTO and logout follows VIP/private/sync/auth order', async () => {
  const order = []; const auth = { getStatus: async () => ({ loginFlow: { state: 'idle' }, account: { valid: true, isVip: true, userVas: '2', vipType: '2', vipLevel: '3', checkedAt: 4 }, token: { refreshTokenPresent: true, accessTokenExpiresAt: 5 }, session: { registered: true, lastKeepAliveAt: 6 }, engine: { notified: true, notifiedAt: 7 } }), logout: async () => { order.push('auth'); return { loggedOut: true }; } };
  const service = new AccountService({ auth, vip: { disableAll: async () => order.push('vip') }, privateSpace: { lockAll: () => order.push('private') }, linkSync: { stopAndClearSession: async () => order.push('sync') } });
  const status = await service.getStatus(); assert.equal(status.account.vipLevel, 3); assert.equal(status.account.isPlatinumVip, true); assert.equal(status.account.isDownloadVip, true); assert.equal(Object.hasOwn(status, 'uid'), false); await service.logout(); assert.deepEqual(order, ['vip', 'private', 'sync', 'auth']);
});
