'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { TaskRegistry } = require('../../host/src/registry');
const { createMethodHandler } = require('../../host/src/methods');
const { CredentialWallet } = require('../../host/src/auth-wallet');
const { AuthManager } = require('../../host/src/auth-manager');
const { startFakeXluser } = require('./helpers/fake-xluser');

const CLIENT_SECRET = 'cb739ddf62c04899992fed9e07373ec9';
const waitFor = (fn, timeout = 5000) => new Promise((res, rej) => {
  const t = setInterval(() => { try { if (fn()) { clearInterval(t); res(); } } catch (e) {} }, 20);
  setTimeout(() => { clearInterval(t); rej(new Error('waitFor timeout')); }, timeout).unref();
});

class FakeDriver extends EventEmitter {
  constructor() { super(); this.healthy = true; this.notifyCalls = []; this.logoutCalls = 0; }
  isHealthy() { return this.healthy; }
  async notifyAuth(p) { this.notifyCalls.push(p); return { ok: true }; }
  async notifyLogout() { this.logoutCalls++; return { ok: true }; }
}

function scanSecrets(obj, secrets) {
  const found = [];
  const walk = (v) => {
    if (typeof v === 'string') { for (const s of secrets) if (s && v.includes(s)) found.push(s); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  return found;
}
const SECRETS = ['at-1', 'rt-1', 'at-2', 'rt-2', 'sid-1', 'sk-1', 'test-device-001'];

async function setup(script = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-rpc-'));
  const xlconfig = path.join(dir, 'xlconfig.ini');
  fs.writeFileSync(xlconfig, 'DEVICEID=test-device-001\r\n');
  const fx = await startFakeXluser(script);
  const registry = new TaskRegistry(path.join(dir, 'r.json'));
  const driver = new FakeDriver();
  const wallet = new CredentialWallet(path.join(dir, 'auth.json'));
  const auth = new AuthManager({ wallet, driver, apiOrigin: fx.origin, xlconfigPath: xlconfig,
    clientId: 'XW-G4v1H72tgfJym', clientSecret: CLIENT_SECRET, keepAliveMs: 0,
    notifyBackoffMs: [10, 20, 40], request: fx.request, log: () => {} });
  auth.start();
  const handle = createMethodHandler({ registry, driver, config: { downloadDir: dir, version: '0.2.0' }, auth });
  return { dir, fx, registry, driver, auth, wallet, handle };
}

test('startLogin RPC 返回 device-flow payload；重入 code1', async () => {
  const { fx, auth, handle } = await setup();
  const r = await handle('thunder.auth.startLogin', []);
  assert.strictEqual(r.verificationUrl, 'http://verify.x/v?user_code=UC-9');
  assert.strictEqual(r.userCode, 'UC-9');
  assert.strictEqual(r.expiresIn, 60);
  await assert.rejects(handle('thunder.auth.startLogin', []), (e) => e.code === 1 && /in progress/.test(e.message));
  await waitFor(() => auth.sessionRt.registered);
  await assert.rejects(handle('thunder.auth.startLogin', []), (e) => e.code === 1 && /already authenticated/.test(e.message));
  auth.stop(); fx.server.close();
});

test('getLoginStatus 已登录四层 valid + 凭据本体不出响应', async () => {
  const { fx, auth, handle } = await setup();
  await handle('thunder.auth.startLogin', []);
  await waitFor(() => auth.sessionRt.registered);
  const s = await handle('thunder.auth.getLoginStatus', []);
  assert.strictEqual(s.account.valid, true);
  assert.strictEqual(Object.hasOwn(s.account, 'uid'), false);
  assert.strictEqual(s.account.isVip, true);
  assert.strictEqual(s.session.registered, true);
  assert.strictEqual(s.engine.notified, true);
  assert.deepStrictEqual(s.engine.sequence, ['setUserInfo', 'setCurrentPanUserId', 'setGlobalExtInfo']);
  assert.strictEqual(scanSecrets(s, SECRETS).length, 0, '凭据本体不得出现在响应: ' + scanSecrets(s, SECRETS));
  auth.stop(); fx.server.close();
});

test('getLoginStatus refresh=true 现拉 user/me', async () => {
  const { fx, auth, handle } = await setup();
  await handle('thunder.auth.startLogin', []);
  await waitFor(() => auth.sessionRt.registered);
  const meBefore = fx.state.userMeCount;
  await handle('thunder.auth.getLoginStatus', [{ refresh: true }]);
  assert.ok(fx.state.userMeCount > meBefore);
  auth.stop(); fx.server.close();
});

test('logout RPC → loggedOut + wallet 删 + 幂等', async () => {
  const { fx, auth, wallet, handle } = await setup();
  await handle('thunder.auth.startLogin', []);
  await waitFor(() => auth.sessionRt.registered);
  const r = await handle('thunder.auth.logout', []);
  assert.deepStrictEqual(r, { loggedOut: true });
  assert.ok(!wallet.hasSession());
  const s = await handle('thunder.auth.getLoginStatus', []);
  assert.strictEqual(s.session.registered, false);
  assert.strictEqual(s.account.valid, false);
  const r2 = await handle('thunder.auth.logout', []); // 幂等
  assert.deepStrictEqual(r2, { loggedOut: true });
  auth.stop(); fx.server.close();
});

test('getVersion rpcFeatures 含 auth', async () => {
  const { fx, auth, handle } = await setup();
  const v = await handle('thunder.getVersion', []);
  assert.deepStrictEqual(v.rpcFeatures, ['http-download', 'auth', 'bt-download', 'magnet-download', 'ed2k-download', 'vip-dcdn']);
  auth.stop(); fx.server.close();
});
