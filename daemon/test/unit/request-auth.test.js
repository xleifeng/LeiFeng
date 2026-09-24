'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestAuth } = require('../../host/src/security/request-auth');
const { parseListenAddress } = require('../../host/src/config');

test('CSRF session binds principal and exact origin, then expires', () => {
  let now = 1000;
  const auth = new RequestAuth({ clock: { now: () => now }, ttlMs: 100, idleMs: 50 });
  const issued = auth.issue({ principalId: 'secret', origin: 'http://127.0.0.1:16800' });
  assert.equal(auth.assertRpc({ method: 'thunder.ui.v2.tasks.command', csrfToken: issued.token, principalId: 'secret', origin: 'http://127.0.0.1:16800' }).ok, true);
  assert.throws(() => auth.assertRpc({ method: 'thunder.ui.v2.tasks.command', csrfToken: issued.token, principalId: 'secret', origin: 'http://localhost:16800' }), { code: 'CSRF_INVALID' });
  now = 1051;
  assert.throws(() => auth.assertRpc({ method: 'thunder.ui.v2.tasks.command', csrfToken: issued.token, principalId: 'secret', origin: 'http://127.0.0.1:16800' }), { code: 'CSRF_INVALID' });
  assert.throws(() => auth.assertRpc({ method: 'thunder.ui.v2.tasks.command', principalId: 'secret', isLoopback: false }), { code: 'ORIGIN_REQUIRED' });
});

test('loopback CLI mutation without Origin bypasses browser CSRF session', () => {
  const auth = new RequestAuth({ enabled: true });
  assert.equal(auth.assertCsrf({ principalId: 'secret', isLoopback: true, origin: null }).ok, true);
  assert.throws(() => auth.assertCsrf({ principalId: 'secret', isLoopback: false, origin: null }), { code: 'CSRF_INVALID' });
});

test('remote listen parser handles IPv4, IPv6 and rejects malformed values', () => {
  assert.deepEqual(parseListenAddress('127.0.0.1:7443'), { host: '127.0.0.1', port: 7443 });
  assert.deepEqual(parseListenAddress('[::1]:7443'), { host: '::1', port: 7443 });
  assert.equal(parseListenAddress('bad'), null);
  assert.equal(parseListenAddress('127.0.0.1:0'), null);
});
