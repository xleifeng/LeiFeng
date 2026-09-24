'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { CredentialWallet } = require('../../host/src/auth-wallet');
const { AuthManager, makeDeviceSign, readDeviceId, parseVipAccount, NOTIFY_SEQUENCE } = require('../../host/src/auth-manager');
const { startFakeXluser } = require('./helpers/fake-xluser');

const CLIENT_SECRET = 'cb739ddf62c04899992fed9e07373ec9'; // 测试显式注入，不依赖生产常量
const waitFor = (fn, timeout = 5000) => new Promise((res, rej) => {
  const t = setInterval(() => { try { if (fn()) { clearInterval(t); res(); } } catch (e) {} }, 20);
  setTimeout(() => { clearInterval(t); rej(new Error('waitFor timeout')); }, timeout).unref();
});

class FakeDriver extends EventEmitter {
  constructor() { super(); this.healthy = true; this.notifyCalls = []; this.logoutCalls = 0; this.notifyFail = 0; }
  isHealthy() { return this.healthy; }
  async notifyAuth(p) { this.notifyCalls.push(p); if (this.notifyFail > 0) { this.notifyFail--; throw new Error('notify boom'); } return { ok: true }; }
  async notifyLogout() { this.logoutCalls++; return { ok: true }; }
}

async function setup(script = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const xlconfig = path.join(dir, 'xlconfig.ini');
  fs.writeFileSync(xlconfig, 'DEVICEID=test-device-001\r\n');
  const fx = await startFakeXluser(script);
  const wallet = new CredentialWallet(path.join(dir, 'auth.json'));
  const driver = new FakeDriver();
  const am = new AuthManager({ wallet, driver, apiOrigin: fx.origin, xlconfigPath: xlconfig,
    clientId: 'XW-G4v1H72tgfJym', clientSecret: CLIENT_SECRET, keepAliveMs: 0,
    notifyBackoffMs: [10, 20, 40], request: fx.request, log: () => {} });
  am.start();
  return { dir, fx, wallet, driver, am };
}

test('makeDeviceSign KAT', () => {
  assert.strictEqual(makeDeviceSign('test-device-001'), 'div101.test-device-001be199aaab92f0d9c4557e2ba7b562820');
  assert.strictEqual(makeDeviceSign('016f2cbbabac1a6f851e1ef67c98ada3'), 'div101.016f2cbbabac1a6f851e1ef67c98ada3c0d3372a91cabb0d2a8eca73dcb08c8a');
});

test('readDeviceId 从 xlconfig.ini 读出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const p = path.join(dir, 'xlconfig.ini');
  fs.writeFileSync(p, 'DEVICEID=abc123\r\n');
  assert.strictEqual(readDeviceId(p), 'abc123');
});

test('缺少 xlconfig 时生成稳定设备 ID 并完成登录', async () => {
  const { dir, fx, am, wallet } = await setup();
  fs.unlinkSync(am.xlconfigPath);
  const login = await am.startLogin();
  assert.strictEqual(login.userCode, 'UC-9');
  assert.match(wallet.data.meta.deviceId, /^[a-f0-9]{32}$/);
  const generated = wallet.data.meta.deviceId;
  await waitFor(() => am.sessionRt.registered);
  assert.strictEqual(wallet.data.meta.deviceId, generated);
  assert.strictEqual(fx.state.requests.find((r) => r.url.startsWith('/v1/auth/device/code')).headers['x-device-id'], generated);
  assert.ok(fx.state.requests.find((r) => r.url.startsWith('/session/v1/register')).url.includes(`devicesign=div101.${generated}`));
  am.stop(); fx.server.close();
});

test('多个会员产品优先选择具备下载加速权益的记录', () => {
  assert.deepStrictEqual(parseVipAccount({ vip_info: [
    { is_vip: '1', user_vas: '306', vas_type: '5', level: '9' },
    { is_vip: '1', user_vas: '2', vas_type: '3', level: '8' },
  ], user_channel: 'thunderd' }), {
    isVip: true, userVas: 2, vipType: 3, vipLevel: 8, userChannel: 'thunderd',
  });
});

test('startLogin 返回 verificationUrl/userCode + 后台轮询至 registered', async () => {
  const { fx, am, wallet } = await setup();
  const r = await am.startLogin();
  assert.strictEqual(r.verificationUrl, 'http://verify.x/v?user_code=UC-9');
  assert.strictEqual(r.userCode, 'UC-9');
  assert.strictEqual(r.expiresIn, 60);
  assert.strictEqual(r.interval, 0.02);
  await waitFor(() => am.sessionRt.registered);
  assert.ok(wallet.hasSession());
  am.stop(); fx.server.close();
});

test('device flow 复刻官方桌面 OAuth2 headers/body', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  const dc = fx.state.requests.find((r) => r.url.startsWith('/v1/auth/device/code'));
  assert.equal(dc.body.client_id, 'XW-G4v1H72tgfJym');
  assert.equal(dc.body.scope, '');
  assert.equal(dc.headers['x-client-id'], 'XW-G4v1H72tgfJym');
  assert.equal(dc.headers['x-sdk-version'], '5.1.4');
  assert.equal(dc.headers['x-protocol-version'], '301');
  assert.equal(dc.headers['x-device-id'], 'test-device-001');
  assert.equal(dc.headers['x-device-model'], undefined);
  assert.equal(dc.headers['x-platform-version'], undefined);
  assert.match(dc.headers['user-agent'], /^thunder\/25\.0\.82\.1562 windows Mozilla\/5\.0 .* Chrome\/108\.0\.5359\.215 Electron\/22\.3\.27 Safari\/537\.36$/);
  am.stop(); fx.server.close();
});

test('登录后 wallet 写入 credentials/session/vip + 0600', async () => {
  const { fx, am, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  assert.strictEqual(fs.statSync(wallet.filePath).mode & 0o777, 0o600);
  assert.strictEqual(wallet.data.credentials.accessToken, 'at-1');
  assert.strictEqual(wallet.data.session.sessionId, 'sid-1');
  assert.strictEqual(wallet.data.vip.isVip, true);
  assert.strictEqual(wallet.data.vip.userVas, 2);
  assert.strictEqual(wallet.data.vip.vipType, 5);
  am.stop(); fx.server.close();
});

test('register 请求含 devicesign+appname+appid', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  const reg = fx.state.requests.find((r) => r.url.startsWith('/session/v1/register'));
  assert.ok(reg.url.includes('devicesign=div101.test-device-001be199aaab92f0d9c4557e2ba7b562820'), reg.url);
  assert.ok(reg.url.includes('appname=com.xunlei.thunderx'));
  assert.ok(reg.url.includes('appid=0'));
  assert.strictEqual(reg.method, 'GET');
  am.stop(); fx.server.close();
});

test('user/me 用 Authorization: Bearer at-1', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  const me = fx.state.requests.find((r) => r.url.startsWith('/v1/user/me'));
  assert.strictEqual(me.headers.authorization, 'Bearer at-1');
  am.stop(); fx.server.close();
});

test('engine notify 调用含 uid+vipStr', async () => {
  const { fx, am, driver } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await waitFor(() => am.engineRt.notified);
  assert.strictEqual(driver.notifyCalls.length, 1);
  assert.strictEqual(driver.notifyCalls[0].uid, '664727041');
  assert.strictEqual(driver.notifyCalls[0].vipStr, 'isvip=1,viptype=5,viplevel=9,userchannel=thunderd,hit_32_64=64');
  am.stop(); fx.server.close();
});

test('startLogin rejects re-entry while login is active or account is authenticated', async () => {
  const { fx, am } = await setup({ pendingCount: 999, interval: 0.02 });
  await am.startLogin();
  await assert.rejects(am.startLogin(), /in progress/);
  am.stop(); fx.server.close();
});

test('startLogin reports already authenticated after login completes', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await assert.rejects(am.startLogin(), /already authenticated/);
  am.stop(); fx.server.close();
});

test('register 失败 → loginFlow failed', async () => {
  const { fx, am } = await setup({ registerStatus: 500 });
  await am.startLogin();
  await waitFor(() => am.loginFlow.state === 'failed');
  assert.strictEqual(am.loginFlow.error, 'register-upstream');
  assert.strictEqual(am.sessionRt.registered, false);
  am.stop(); fx.server.close();
});

test('getStatus 未登录四层全空 + engine.sequence 常量', async () => {
  const { fx, am } = await setup();
  const s = await am.getStatus();
  assert.strictEqual(s.loginFlow.state, 'idle');
  assert.strictEqual(s.account.valid, false);
  assert.strictEqual(s.session.registered, false);
  assert.strictEqual(s.engine.notified, false);
  assert.deepStrictEqual(s.engine.sequence, NOTIFY_SEQUENCE);
  assert.deepStrictEqual(NOTIFY_SEQUENCE, ['setUserInfo', 'setCurrentPanUserId', 'setGlobalExtInfo']);
  am.stop(); fx.server.close();
});

test('账号刷新会先更换即将过期的 access token 再查询会员权益', async () => {
  const { fx, am, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  const checkedAt = wallet.data.vip.checkedAt;
  wallet.data.credentials.accessTokenExpiresAt = Date.now() - 1;
  wallet.saveSync();
  const status = await am.getStatus({ refresh: true });
  assert.strictEqual(fx.state.refreshCount, 1);
  assert.strictEqual(wallet.data.credentials.accessToken, 'at-2');
  assert.ok(wallet.data.vip.checkedAt >= checkedAt);
  assert.strictEqual(status.account.valid, true);
  assert.strictEqual(status.account.isVip, true);
  assert.strictEqual(status.session.lastError, '');
  am.stop(); fx.server.close();
});

test('过期 token 无法刷新时状态切为需登录且允许启动设备登录', async () => {
  const { fx, am, wallet } = await setup({ refreshStatus: 400 });
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  wallet.data.credentials.accessTokenExpiresAt = Date.now() - 1;
  wallet.saveSync();
  const status = await am.getStatus({ refresh: true });
  assert.strictEqual(status.account.valid, false);
  assert.strictEqual(status.session.registered, false);
  assert.strictEqual(status.session.lastError, 'token refresh failed');
  const login = await am.startLogin();
  assert.strictEqual(login.userCode, 'UC-9');
  am.stop(); fx.server.close();
});

// ---- 保活循环、令牌刷新、降级和引擎通知补偿 ----

test('保活 tick：channel/put 计数+1 + lastKeepAliveAt 设', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await am._keepAliveTick();
  assert.strictEqual(fx.state.channelPutCount, 1);
  assert.ok(am.sessionRt.lastKeepAliveAt > 0);
  am.stop(); fx.server.close();
});

test('前瞻刷新：accessTokenExpiresAt=now+100s → tick 触发 refresh → wallet 翻转 at-2/rt-2', async () => {
  const { fx, am, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  wallet.data.credentials.accessTokenExpiresAt = Date.now() + 100 * 1000; // <300s 窗口触发 refresh
  wallet.saveSync();
  await am._keepAliveTick();
  await waitFor(() => fx.state.refreshCount >= 1);
  assert.strictEqual(wallet.data.credentials.accessToken, 'at-2');
  assert.strictEqual(wallet.data.credentials.refreshToken, 'rt-2');
  am.stop(); fx.server.close();
});

test('refresh invalid_grant → degraded', async () => {
  const { fx, am } = await setup({ refreshStatus: 400 });
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  am.wallet.data.credentials.accessTokenExpiresAt = Date.now() + 100 * 1000;
  am.wallet.saveSync();
  await am._keepAliveTick();
  assert.strictEqual(am.sessionRt.registered, false);
  assert.strictEqual(am.account.valid, false);
  assert.ok(am.sessionRt.lastError.length > 0);
  am.stop(); fx.server.close();
});

test('channel/put 401 一次性 → 降级梯修复（re-register 200）', async () => {
  const { fx, am } = await setup({ keepAliveFailOnce: true });
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await am._keepAliveTick();
  await waitFor(() => fx.state.registerCount >= 2);
  assert.strictEqual(am.sessionRt.registered, true);
  assert.ok(am.sessionRt.lastKeepAliveAt > 0);
  am.stop(); fx.server.close();
});

test('降级终败 → degraded', async () => {
  const { fx, am } = await setup({ keepAliveFailOnce: true, registerFailAfter: 1 });
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await am._keepAliveTick();
  await waitFor(() => am.sessionRt.registered === false, 3000);
  assert.strictEqual(am.sessionRt.registered, false);
  am.stop(); fx.server.close();
});

test('notify 补偿：driver.notifyAuth throw 一次 → 下 tick 重试成功', async () => {
  const { fx, am, driver } = await setup();
  driver.notifyFail = 1; // 第一次失败
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  // _completeLogin 的 _tryNotify 因 notifyFail=1 失败 → engineRt.notified=false；下个保活 tick 触发 _notifyCompensate 重试
  await waitFor(() => am.engineRt.notified === false, 2000);
  am._notifyCompensate(); // 驱动补偿（backoff[0]=10ms 后重试）
  await waitFor(() => am.engineRt.notified, 3000); // 补偿后成功
  assert.strictEqual(am.engineRt.notified, true);
  am.stop(); fx.server.close();
});

test('logout 停保活 + notifyLogout 调用 + wallet 清空 + 幂等', async () => {
  const { fx, am, driver, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  await am.logout();
  assert.ok(!wallet.hasSession());
  assert.strictEqual(driver.logoutCalls, 1);
  assert.strictEqual(am.sessionRt.registered, false);
  assert.strictEqual(am.engineRt.notified, false);
  const r2 = await am.logout(); // 幂等
  assert.deepStrictEqual(r2, { loggedOut: true });
  am.stop(); fx.server.close();
});

test('getVipContext 有效钱包返回短暂上下文且不触发登录', async () => {
  const { fx, am, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  let loginCalls = 0;
  const original = am.startLogin.bind(am);
  am.startLogin = async (...args) => { loginCalls++; return original(...args); };
  const ctx = await am.getVipContext({ minAccessTtlMs: 1 });
  assert.deepStrictEqual(ctx, { ok: true, uid: '664727041', accessToken: 'at-1', sessionId: 'sid-1',
    isVip: true, isDownloadVip: true, userVas: 2, vipType: 5, vipLevel: 9 });
  assert.strictEqual(loginCalls, 0);
  assert.strictEqual(wallet.data.credentials.accessToken, 'at-1');
  am.stop(); fx.server.close();
});

test('getVipContext 20 路并发只触发一次 refresh', async () => {
  const { fx, am, wallet } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  wallet.data.credentials.accessTokenExpiresAt = Date.now() + 10;
  wallet.saveSync();
  const contexts = await Promise.all(Array.from({ length: 20 }, () => am.getVipContext({ minAccessTtlMs: 300000 })));
  assert.strictEqual(fx.state.refreshCount, 1);
  assert.ok(contexts.every((c) => c.ok && c.accessToken === 'at-2'));
  am.stop(); fx.server.close();
});

test('getVipContext forceRecover 只复用钱包 re-register，不启动 device flow', async () => {
  const { fx, am } = await setup();
  await am.startLogin();
  await waitFor(() => am.sessionRt.registered);
  const before = fx.state.registerCount;
  const contexts = await Promise.all(Array.from({ length: 20 }, () => am.getVipContext({ forceRecover: true })));
  assert.strictEqual(fx.state.registerCount, before + 1);
  assert.ok(contexts.every((c) => c.ok && c.sessionId === 'sid-1'));
  am.stop(); fx.server.close();
});

test('getVipContext 非 VIP/钱包不可恢复只返回原因', async () => {
  const notVip = await setup({ userMeBody: { vip_info: [{ is_vip: '0', vas_type: '0', level: '0' }] } });
  await notVip.am.startLogin();
  await waitFor(() => notVip.am.sessionRt.registered);
  assert.deepStrictEqual(await notVip.am.getVipContext(), { ok: false, reason: 'not-vip' });
  notVip.am.stop(); notVip.fx.server.close();

  const panVip = await setup({ userMeBody: { vip_info: [{ is_vip: '1', user_vas: '306', vas_type: '5', level: '9' }] } });
  await panVip.am.startLogin();
  await waitFor(() => panVip.am.sessionRt.registered);
  assert.deepStrictEqual(await panVip.am.getVipContext(), { ok: false, reason: 'not-vip' });
  panVip.am.stop(); panVip.fx.server.close();

  const empty = await setup();
  assert.deepStrictEqual(await empty.am.getVipContext(), { ok: false, reason: 'auth-required' });
  empty.am.stop(); empty.fx.server.close();
});
