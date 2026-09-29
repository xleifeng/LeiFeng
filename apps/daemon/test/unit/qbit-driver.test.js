'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { QbitDriver, QBIT_PROTOCOLS } = require('../../host/kernels/qbit/qbit-driver');
const { assertKernel, KERNEL_METHODS } = require('../../host/src/domain/kernel-port');

// transport 注入式 fake qbit（借鉴 vip-speedup-client 测试范式）：
// 路由表驱动的最小 Web API v2 面，403 首次触发登录。
function makeFakeQbit() {
  const state = { torrents: [], prefs: {}, calls: [], cookies: {} };
  const handlers = {
    'POST /api/v2/auth/login': () => { state.cookies.issued = true; return { status: 200, text: 'Ok.', headers: { 'content-type': 'text/plain', 'set-cookie': 'SID=fake-sid; path=/' } }; },
    'GET /api/v2/app/version': () => ({ status: 200, text: 'v4.6.0', headers: { 'content-type': 'text/plain' } }),
    'GET /api/v2/app/preferences': () => ({ status: 200, text: JSON.stringify(state.prefs), headers: { 'content-type': 'application/json' } }),
    'POST /api/v2/app/setPreferences': ({ body }) => {
      const json = /json=([^&]*)/.exec(body);
      Object.assign(state.prefs, JSON.parse(decodeURIComponent(json[1])));
      return { status: 200, text: '', headers: {} };
    },
    'POST /api/v2/torrents/add': ({ body }) => {
      const urls = /urls=([^&]*)/.exec(body);
      if (urls) {
        const magnet = decodeURIComponent(urls[1]);
        const hash = /urn:btih:([a-f0-9]{40})/i.exec(magnet)[1].toLowerCase();
        state.torrents.push({ hash, name: hash, state: 'downloading', completed: 0, size: 1024, dlspeed: 10, save_path: '', magnet_uri: magnet });
      }
      return { status: 200, text: 'Ok.', headers: {} };
    },
    'GET /api/v2/torrents/info': () => ({ status: 200, text: JSON.stringify(state.torrents), headers: { 'content-type': 'application/json' } }),
    'POST /api/v2/torrents/resume': ({ path }) => {
      state.calls.push(['resume', path]);
      for (const t of state.torrents) if (path.includes(t.hash)) t.state = 'downloading';
      return { status: 200, text: '', headers: {} };
    },
    'POST /api/v2/torrents/pause': ({ path }) => {
      state.calls.push(['pause', path]);
      for (const t of state.torrents) if (path.includes(t.hash)) t.state = 'pausedDL';
      return { status: 200, text: '', headers: {} };
    },
  };
  let authed = false;
  const transport = async ({ path, method = 'GET', body = null }) => {
    const key = `${method} ${path.split('?')[0]}`;
    // 未持 cookie 的 API 调用 → 403 触发登录重试（模拟 qbit 鉴权行为）
    if (!authed && key !== 'POST /api/v2/auth/login') return { status: 403, text: 'Forbidden', headers: {} };
    if (key === 'POST /api/v2/auth/login') authed = true;
    const handler = handlers[key];
    if (!handler) return { status: 404, text: '', headers: {} };
    return handler({ path, method, body });
  };
  return { state, transport };
}

function makeDriver(overrides = {}) {
  const fake = makeFakeQbit();
  const driver = new QbitDriver({ transport: fake.transport, ...overrides });
  return { driver, fake };
}

test('QbitDriver 满足 KernelPort 契约（assertKernel 全 36 方法）', () => {
  const { driver } = makeDriver();
  const kernel = assertKernel(driver);
  assert.equal(kernel, driver);
  // prototype 面自证（与 kernel-port.test 的双迅雷实现同范式）
  const missing = KERNEL_METHODS.filter((name) => typeof QbitDriver.prototype[name] !== 'function');
  assert.deepEqual(missing, []);
});

test('协议能力只声明 bt/magnet；生命周期 up 事件与探活', async () => {
  const { driver } = makeDriver();
  const events = [];
  driver.on('up', (payload) => events.push(['up', payload]));
  await driver.start();
  assert.deepEqual([...await driver.getSupportedProtocols()], [...QBIT_PROTOCOLS]);
  assert.equal(driver.isHealthy(), true);
  assert.equal(driver.enginePid(), null);
  assert.equal(events.length, 1);
  assert.ok(events[0][1].generation >= 1);
  await driver.shutdown();
  assert.equal(driver.isHealthy(), false);
});

test('磁力 createTask → startTasks/pause → snapshot 形态与迅雷词汇对齐', async () => {
  const { driver, fake } = makeDriver();
  await driver.start();
  const hash = 'a'.repeat(40);
  const created = await driver.createTask({ taskType: 5, savePath: '/d', taskName: 't', info: { magnet: `magnet:?xt=urn:btih:${hash}` } });
  assert.equal(typeof created.engineId, 'number');
  fake.state.torrents[0].completed = 512;
  fake.state.torrents[0].name = 'ubuntu.iso';
  const snapshots = await driver.getTaskSnapshots([created.engineId]);
  const snap = snapshots.get(created.engineId);
  assert.equal(snap.totalReceiveSize, 512);
  assert.equal(snap.resourceSize, 1024);
  assert.equal(snap.name, 'ubuntu.iso');
  assert.equal(snap.status, 1); // downloading → 迅雷进行中词汇
  await driver.stopTasks({ ids: [created.engineId] });
  assert.ok(fake.state.calls.some(([op, path]) => op === 'pause' && path.includes(hash)));
  await driver.startTasks({ ids: [created.engineId] });
  assert.ok(fake.state.calls.some(([op, path]) => op === 'resume' && path.includes(hash)));
  await driver.shutdown();
});

test('全局限速走 setPreferences；getGlobalLimits 回读', async () => {
  const { driver } = makeDriver();
  await driver.start();
  await driver.setGlobalLimits({ downloadLimit: 2 * 1024 * 1024, uploadLimit: 512 * 1024 });
  const limits = await driver.getGlobalLimits();
  assert.equal(limits.downloadLimit, 2 * 1024 * 1024);
  assert.equal(limits.uploadLimit, 512 * 1024);
  await driver.shutdown();
});

test('NOT_SUPPORTED 面：显式拒绝且带 kernelId 与错误码（契约允许拒绝不允许缺失）', async () => {
  const { driver } = makeDriver();
  await driver.start();
  for (const call of [
    () => driver.resolveThunderUrl('thunder://x'),
    () => driver.notifyAuth({}),
    () => driver.notifyLogout(),
    () => driver.getBtFileRuntime(1),
    () => driver.getSeedDescriptor(1),
    () => driver.setAutoMoveLowSpeed({}),
    () => driver.recycleTask({}),
    () => driver.recoverTask({}),
    () => driver.verifyProxy({}),
  ]) {
    await assert.rejects(call, (error) => error.code === 'NOT_SUPPORTED' && error.kernelId === 'qbit');
  }
  await driver.shutdown();
});

test('parseTaskInfo 磁力 hash 提取与 normalizeTorrentHash', async () => {
  const { driver } = makeDriver();
  const hash = 'ab'.repeat(20);
  const parsed = await driver.parseTaskInfo({ kind: 'magnet', data: `magnet:?xt=urn:btih:${hash}&dn=x` });
  assert.equal(parsed.infoHash, hash);
  const normalized = await driver.normalizeTorrentHash(`urn:btih:${hash.toUpperCase()}`);
  assert.deepEqual(normalized, { infoHash: hash });
});

test('EventEmitter 形态：bootError 在不可达时发出', async () => {
  const transport = async () => ({ status: 500, text: 'down', headers: {} });
  const driver = new QbitDriver({ transport });
  const errors = [];
  driver.on('bootError', (error) => errors.push(error));
  await driver.start();
  assert.equal(errors.length, 1);
  await driver.shutdown();
});

test('QbitDriver 是 EventEmitter 子类（契约 on/off 事件接口）', () => {
  const { driver } = makeDriver();
  assert.ok(driver instanceof EventEmitter);
  assert.equal(typeof driver.on, 'function');
  assert.equal(typeof driver.off, 'function');
});
