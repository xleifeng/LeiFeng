'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry } = require('../../host/src/registry');
const { createMethodHandler, RpcError } = require('../../host/src/methods');

class FakeDriver {
  constructor() { this.nextId = 100; this.calls = []; this.healthy = true; this.sdkReady = true; this.restarts = 0; this.bootedAt = Date.now(); this.failStart = false; }
  async createTask({ taskType, savePath, taskName, info }) { this.calls.push(['create', info && info.url]); return this.nextId++; }
  async startTasks(ids) { this.calls.push(['start', ids]); if (this.failStart) throw new Error('start boom'); }
  async stopTasks(ids) { this.calls.push(['stop', ids]); }
  async deleteTasks(ids) { this.calls.push(['delete', ids]); }
  async getQueueCount() { return 3; }
  async getDhtNodeCount() { return 9; }
  async getChannelSwitches() { return { p2p: true, p2s: true }; }
  isHealthy() { return this.healthy && this.sdkReady; }
  enginePid() { return 4321; }
  async restart() { this.restarts++; }
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'methods-'));
  const registry = new TaskRegistry(path.join(dir, 'r.json'));
  const driver = new FakeDriver();
  const auth = {
    async startLogin() { return { verificationUrl: 'http://v.x', userCode: 'UC', expiresIn: 60, interval: 2 }; },
    async getStatus() { return { loginFlow: { state: 'idle', error: '' }, account: { valid: false }, token: {}, session: {}, engine: {} }; },
    async logout() { return { loggedOut: true }; },
    start() {}, stop() {},
  };
  const fixture = { close() {} };
  const baseUrl = 'http://fixture.test';
  const handle = createMethodHandler({ registry, driver, config: { downloadDir: dir, version: '0.1.0' }, auth, contentLengthProbe: async () => 1234 });
  return { dir, registry, driver, fixture, baseUrl, handle };
}

test('addUri: gid, HEAD totalLength, create+start, name from URL', async () => {
  const { registry, driver, fixture, baseUrl, handle } = await setup();
  const gid = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  assert.match(gid, /^[0-9a-f]{16}$/);
  const r = registry.get(gid);
  assert.strictEqual(r.totalLength, 1234);
  assert.strictEqual(r.taskName, 'a.bin');
  assert.deepStrictEqual(driver.calls.map((c) => c[0]), ['create', 'start']);
  fixture.close();
});

test('addUri duplicate returns same gid', async () => {
  const { fixture, baseUrl, handle } = await setup();
  const g1 = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  const g2 = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  assert.strictEqual(g1, g2);
  fixture.close();
});

test('addUri start failure → compensate delete + error record + RpcError', async () => {
  const { registry, driver, fixture, baseUrl, handle } = await setup();
  driver.failStart = true;
  await assert.rejects(handle('aria2.addUri', [[baseUrl + '/x.bin'], {}]), (e) => e instanceof RpcError && e.code === 1);
  const all = registry.list();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].status, 'error');
  assert.strictEqual(all[0].errorCode, 'start-failed');
  assert.ok(driver.calls.some((c) => c[0] === 'delete')); // 补偿删除
  fixture.close();
});

test('addUri rejects unsupported schemes and bad out', async () => {
  const { fixture, handle } = await setup();
  await assert.rejects(handle('aria2.addUri', [['sftp://x/f'], {}]), (e) => e.code === 1);
  await assert.rejects(handle('aria2.addUri', [['http://x/f'], { out: '../evil' }]), (e) => e.code === 1);
  await assert.rejects(handle('aria2.addUri', [['http://x/f'], { out: 'a/b' }]), (e) => e.code === 1);
  fixture.close();
});

test('collision auto-renames instead of clobbering', async () => {
  const { dir, fixture, baseUrl, handle, registry } = await setup();
  fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.alloc(10)); // 已存在
  const gid = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  assert.strictEqual(registry.get(gid).taskName, 'a.1.bin');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.bin')).length, 10); // 原文件未动
  fixture.close();
});

test('tellStatus aria2 shape uses string numerics', async () => {
  const { fixture, baseUrl, handle } = await setup();
  const gid = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  const s = await handle('aria2.tellStatus', [gid]);
  assert.strictEqual(s.totalLength, '1234');
  assert.strictEqual(s.completedLength, '0');
  assert.strictEqual(s.files[0].length, '1234');
  fixture.close();
});

test('pause/unpause/remove state rules', async () => {
  const { registry, driver, fixture, baseUrl, handle } = await setup();
  const gid = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  registry.update(gid, { status: 'active' });
  await handle('aria2.pause', [gid]);
  assert.strictEqual(registry.get(gid).status, 'paused');
  await handle('aria2.unpause', [gid]);
  assert.strictEqual(registry.get(gid).status, 'waiting');
  await handle('aria2.remove', [gid]);
  assert.strictEqual(registry.get(gid).status, 'removed');
  assert.ok(driver.calls.some((c) => c[0] === 'stop') && driver.calls.some((c) => c[0] === 'delete'));
  fixture.close();
});

test('unknown gid → code 1; unknown/reserved method → -32601; auth no longer reserved', async () => {
  const { fixture, handle } = await setup();
  await assert.rejects(handle('aria2.tellStatus', ['deadbeefdeadbeef']), (e) => e.code === 1);
  // getFiles 已实现（不再 reserved）；未知 gid → code 1（同 tellStatus）。
  await assert.rejects(handle('aria2.getFiles', ['deadbeefdeadbeef']), (e) => e.code === 1);
  // thunder.auth.* 已实现（不再 -32601）。
  const r = await handle('thunder.auth.startLogin', []);
  assert.strictEqual(r.userCode, 'UC');
  await assert.rejects(handle('thunder.pan.list', []), (e) => e.code === -32601);
  await assert.rejects(handle('no.such.method', []), (e) => e.code === -32601);
  fixture.close();
});

test('thunder.getVersion/getEngineInfo shape', async () => {
  const { fixture, handle } = await setup();
  assert.deepStrictEqual(await handle('thunder.getVersion', []), { version: '0.1.0', rpcFeatures: ['http-download', 'auth', 'bt-download', 'magnet-download', 'ed2k-download', 'vip-dcdn'] });
  const info = await handle('thunder.getEngineInfo', []);
  assert.strictEqual(info.transportReady, true);
  assert.strictEqual(info.sdkReady, true);
  assert.strictEqual(info.enginePid, 4321);
  assert.strictEqual(info.queue, 3);
  fixture.close();
});

// ---- serialize chains 链尾 settle 后自清，防止长跑无界增长 ----

test('serialize chains self-delete after settle (no unbounded growth)', async () => {
  const { fixture, baseUrl, handle } = await setup();
  const gid = await handle('aria2.addUri', [[baseUrl + '/a.bin'], {}]);
  await handle('aria2.remove', [gid]); // 另一 key（gid），连同 addUri 的 URL key 都须自清
  await new Promise((r) => setImmediate(r)); // flush finally 回调（与 await 续体相对序不保证，setImmediate 后才可断言）
  assert.strictEqual(handle._chainsSize(), 0, 'chains map must be empty after all chains settle');
  fixture.close();
});
