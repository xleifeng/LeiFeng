'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createMethodHandler } = require('../../host/src/methods');
const { createAccountMethods } = require('../../host/src/rpc/account-methods');
const { RpcRegistry } = require('../../host/src/rpc/registry');
const { AuthManager } = require('../../host/kernels/thunder/auth-manager');
const { CredentialWallet } = require('../../host/kernels/thunder/auth-wallet');
const { AccountService } = require('../../host/src/services/account-service');
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
  const xlconfigPath = path.join(dir, 'xlconfig.ini');
  fs.writeFileSync(xlconfigPath, 'DEVICEID=test-device-001\r\n');
  const fx = await startFakeXluser(script);
  const driver = new FakeDriver();
  const wallet = new CredentialWallet(path.join(dir, 'auth.json'));
  const auth = new AuthManager({ wallet, driver, apiOrigin: fx.origin, xlconfigPath,
    clientId: 'XW-G4v1H72tgfJym', clientSecret: CLIENT_SECRET, keepAliveMs: 0,
    notifyBackoffMs: [10, 20, 40], request: fx.request, log: () => {} });
  auth.start();
  // V2 RPC 面走 AccountService（脱敏 DTO）而非裸 AuthManager
  const accountService = new AccountService({ auth });
  // 对齐 kernel-thunder 装配：account.* 由内核插件注册（rpc-plugin-registration）
  const registry = new RpcRegistry();
  registry.register('test:kernel', createAccountMethods({ accountService }));
  const handle = createMethodHandler({ config: { downloadDir: dir, version: '0.2.0' }, registry });
  return { dir, fx, auth, wallet, handle };
}

test('account.startLogin 返回 device-flow payload；重入 code1；已登录再启拒绝', async () => {
  const { fx, auth, handle } = await setup();
  const r = await handle('leifeng.ui.v2.account.startLogin', [{}]);
  assert.strictEqual(r.verificationUrl, 'http://verify.x/v?user_code=UC-9');
  assert.strictEqual(r.userCode, 'UC-9');
  assert.strictEqual(r.expiresIn, 60);
  await assert.rejects(handle('leifeng.ui.v2.account.startLogin', [{}]), (e) => e.code === 1 && /in progress/.test(e.message));
  await waitFor(() => auth.sessionRt.registered);
  await assert.rejects(handle('leifeng.ui.v2.account.startLogin', [{}]), (e) => e.code === 1 && /already authenticated/.test(e.message));
  auth.stop(); fx.server.close();
});

test('account.get 已登录四层 valid + 凭据本体不出响应', async () => {
  const { fx, auth, handle } = await setup();
  await handle('leifeng.ui.v2.account.startLogin', [{}]);
  await waitFor(() => auth.sessionRt.registered);
  const s = await handle('leifeng.ui.v2.account.get', []);
  assert.strictEqual(s.account.valid, true);
  assert.strictEqual(Object.hasOwn(s.account, 'uid'), false);
  assert.strictEqual(s.account.isVip, true);
  assert.strictEqual(s.credential.refreshTokenPresent, true);
  assert.strictEqual(s.session.registered, true);
  assert.strictEqual(s.engine.notified, true);
  assert.strictEqual(scanSecrets(s, SECRETS).length, 0, '凭据本体不得出现在响应: ' + scanSecrets(s, SECRETS));
  auth.stop(); fx.server.close();
});

test('account.refresh 现拉 user/me', async () => {
  const { fx, auth, handle } = await setup();
  await handle('leifeng.ui.v2.account.startLogin', [{}]);
  await waitFor(() => auth.sessionRt.registered);
  const meBefore = fx.state.userMeCount;
  await handle('leifeng.ui.v2.account.refresh', []);
  assert.ok(fx.state.userMeCount > meBefore);
  auth.stop(); fx.server.close();
});

test('account.logout 返回 loggedOut + wallet 清空 + 幂等', async () => {
  const { fx, auth, wallet, handle } = await setup();
  await handle('leifeng.ui.v2.account.startLogin', [{}]);
  await waitFor(() => auth.sessionRt.registered);
  const r = await handle('leifeng.ui.v2.account.logout', []);
  assert.deepStrictEqual(r, { loggedOut: true });
  assert.ok(!wallet.hasSession());
  const s = await handle('leifeng.ui.v2.account.get', []);
  assert.strictEqual(s.session.registered, false);
  assert.strictEqual(s.account.valid, false);
  const r2 = await handle('leifeng.ui.v2.account.logout', []); // 幂等
  assert.deepStrictEqual(r2, { loggedOut: true });
  auth.stop(); fx.server.close();
});
