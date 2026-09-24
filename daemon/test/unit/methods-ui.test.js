'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskRegistry } = require('../../host/src/registry');
const { createMethodHandler } = require('../../host/src/methods');

function makeHandler() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-ui-methods-'));
  const registry = new TaskRegistry(path.join(dir, 'registry.json'));
  const driver = {
    sdkReady: true, restarts: 0, bootedAt: Date.now() - 1000,
    isHealthy: () => true, enginePid: () => 123,
    getQueueCount: async () => 2, getDhtNodeCount: async () => 7,
    getChannelSwitches: async () => ({ p2p: true, p2s: true }),
    getGlobalLimits: async () => ({ downloadLimit: -1, uploadLimit: -1, connectionLimit: -1, maxTasks: 5 }),
    setGlobalLimits: async (limits) => { driver.limits = limits; },
    startTasks: async () => {}, stopTasks: async () => {}, deleteTasks: async () => {},
  };
  const auth = { getStatus: async () => ({ account: { valid: false }, token: {}, session: {}, engine: {} }) };
  const vip = {
    getStatus: async () => ({ enabled: true, accountReady: false, tasks: [] }),
    setEnabled: async ({ gid, enabled }) => { registry.update(gid, { vipEnabled: enabled }); return { gid, enabled }; },
    retry: async (gid) => ({ gid, queued: true }), disableTask: async () => {}, disableAll: async () => {},
  };
  const handler = createMethodHandler({ registry, driver, auth, vip,
    config: { downloadDir: dir, runtimeDir: dir, version: '0.4.0', rpcSecret: '' } });
  return { dir, registry, driver, handler };
}

test('thunder.ui.bootstrap 返回 capability、账号、引擎和设置', async () => {
  const { handler } = makeHandler();
  const result = await handler('thunder.ui.bootstrap', []);
  assert.strictEqual(result.version, '0.4.0');
  assert.ok(result.capabilities.protocols.includes('thunder'));
  assert.ok(result.capabilities.protocols.includes('ftp'));
  assert.strictEqual(result.capabilities.cloudDrive, false);
  assert.strictEqual(result.engine.sdkReady, true);
  assert.ok(result.settings.downloadDir);
});

test('thunder.ui.listTasks 按 scope/query 分页并返回安全 number', async () => {
  const { registry, handler } = makeHandler();
  const a = registry.create({ savePath: '/d', taskName: 'Alpha.iso', totalLength: 100, engineId: 1, taskType: 'http' });
  registry.update(a.gid, { status: 'active', completedLength: 25, downloadSpeed: 10 });
  const b = registry.create({ savePath: '/d', taskName: 'Beta.iso', totalLength: 200, engineId: 2, taskType: 'http' });
  registry.update(b.gid, { status: 'removed' });
  const active = await handler('thunder.ui.listTasks', [{ scope: 'active', query: 'alpha' }]);
  assert.strictEqual(active.total, 1);
  assert.strictEqual(active.items[0].totalLength, 100);
  assert.strictEqual(active.items[0].progress, 0.25);
  assert.strictEqual(active.counts.trash, 1);
});

test('thunder.ui.taskAction 支持暂停、移入回收站和永久删除记录', async () => {
  const { registry, handler } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 'a.bin', totalLength: 1, engineId: 1, taskType: 'http' });
  registry.update(rec.gid, { status: 'active' });
  let result = await handler('thunder.ui.taskAction', [{ gids: [rec.gid], action: 'pause' }]);
  assert.strictEqual(result.results[0].ok, true);
  assert.strictEqual(registry.get(rec.gid).status, 'paused');
  result = await handler('thunder.ui.taskAction', [{ gids: [rec.gid], action: 'remove' }]);
  assert.strictEqual(result.results[0].ok, true);
  assert.strictEqual(registry.get(rec.gid).status, 'removed');
  result = await handler('thunder.ui.taskAction', [{ gids: [rec.gid], action: 'delete' }]);
  assert.strictEqual(result.results[0].ok, true);
  assert.strictEqual(registry.get(rec.gid), undefined);
});

test('thunder.ui.changeSettings 转发实际全局限速', async () => {
  const { handler, driver } = makeHandler();
  await handler('thunder.ui.changeSettings', [{ maxOverallDownloadLimit: '2M', maxOverallUploadLimit: '512K', maxConcurrentDownloads: 3 }]);
  assert.deepStrictEqual(driver.limits, { downloadLimit: 2 * 1024 * 1024, uploadLimit: 512 * 1024, connectionLimit: -1, maxTasks: 3 });
});
