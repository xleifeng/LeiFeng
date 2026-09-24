'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { TaskRegistry } = require('../../host/src/registry');
const { VipSpeedupClient } = require('../../host/src/vip-speedup-client');
const { VipAccelerationManager } = require('../../host/src/vip-manager');
const { startFakeSpeedupServer } = require('./helpers/fake-speedup-server');

test('VIP fake E2E：申请→enable→刷新→pause disable→unpause 新 cert→终态清理', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vip-it-'));
  const registry = new TaskRegistry(path.join(dir, 'registry.json'));
  const record = registry.create({ url: 'https://example.invalid/a.bin', savePath: dir, taskName: 'a.bin', totalLength: 10, engineId: 101, taskType: 'http' });
  record.status = 'active';
  const context = { ok: true, uid: 'uid-secret', accessToken: 'access-secret', sessionId: 'session-secret',
    isVip: true, isDownloadVip: true, userVas: 2, vipType: 5, vipLevel: 9 };
  const speedupFixture = await startFakeSpeedupServer({ context, intervalSec: 305, tokenPrefix: 'fixture-token-' });
  const auth = new EventEmitter(); auth.getVipContext = async () => context;
  auth.getStatus = async () => ({ account: { valid: true, isVip: true, userVas: 2, vipType: 5, vipLevel: 9 } });
  const driver = new EventEmitter(); driver.isHealthy = () => true; driver.enabled = []; driver.disabled = [];
  driver.enableVipDcdn = async (engineId, certs) => { driver.enabled.push({ engineId, indices: certs.map((c) => c.fileIndex), lengths: certs.map((c) => c.token.length) }); return { ok: true, items: certs.map((c) => ({ fileIndex: c.fileIndex, invoked: true, errorCode: '' })) }; };
  driver.disableVipDcdn = async (engineId, indices) => { driver.disabled.push({ engineId, indices }); return { ok: true, items: indices.map((fileIndex) => ({ fileIndex, invoked: true, errorCode: '' })) }; };
  let now = 1000000;
  let snapshot = { engineId: 101, url: record.url, name: record.taskName, resourceSize: 10, cid: 'CID', gcid: 'GCID', vipReceiveSize: 0, freeDcdnReceiveSize: 0, btFiles: [] };
  const manager = new VipAccelerationManager({ registry, driver, auth,
    peerIdProvider: () => ({ ok: true, peerId: 'PEER-12345678' }),
    readVipTasks: async () => new Map([[101, snapshot]]), taskDbPath: 'fixture',
    speedupClient: new VipSpeedupClient({ endpoint: speedupFixture.endpoint,
      statusEndpoint: speedupFixture.statusEndpoint, transport: speedupFixture.transport, log: () => {} }),
    now: () => now, random: () => 0.5, scanMs: 500 });
  manager.start();
  await manager._scan();
  assert.strictEqual(record.vipState, 'injected');
  assert.strictEqual(speedupFixture.state.speedupCount, 1);
  assert.deepStrictEqual(driver.enabled[0].indices, [-1]);

  now = record.vipNextRefreshAt;
  await manager._scan();
  assert.strictEqual(speedupFixture.state.speedupCount, 2);
  assert.strictEqual(driver.enabled.length, 2);

  record.status = 'paused';
  await manager._scan();
  assert.strictEqual(driver.disabled.length, 1);
  assert.strictEqual(record.vipState, 'disabled');
  record.status = 'waiting';
  now += 1;
  await manager._scan();
  assert.strictEqual(speedupFixture.state.speedupCount, 3);
  assert.strictEqual(driver.enabled.length, 3);
  record.status = 'complete';
  await manager._scan();
  assert.strictEqual(driver.disabled.length, 2);

  registry.saveSync();
  const persisted = fs.readFileSync(path.join(dir, 'registry.json'), 'utf8');
  assert.doesNotMatch(persisted, /uid-secret|access-secret|session-secret|fixture-token-|PEER-12345678/);
  assert.strictEqual(speedupFixture.state.requests.length, 4);
  await manager.stop({ disable: false });
  speedupFixture.server.close();
});
