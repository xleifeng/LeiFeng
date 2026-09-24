'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMethodHandler } = require('../../host/src/methods');

function makeHandler(configOverride = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'methods-operations-'));
  const registry = { tasks: new Map(), list: () => [...registry.tasks.values()], get: (g) => registry.tasks.get(g),
    create: (o) => { const r = { gid: 'g' + (registry.tasks.size + 1), status: 'waiting', downloadSpeed: 0, ...o }; registry.tasks.set(r.gid, r); return r; },
    update: (g, p) => Object.assign(registry.tasks.get(g), p), findDuplicate: () => undefined, counts: () => ({ active: 0, waiting: 0, stopped: 0 }) };
  const driver = { isHealthy: () => true,
    createTask: configOverride.createTask || (async ({ taskType }) => { driver.lastCreateTaskType = taskType; return 1; }),
    parseTaskInfo: configOverride.parseTaskInfo || (async () => ({})),
    startTasks: async () => {}, stopTasks: async () => {}, deleteTasks: async () => {},
    getGlobalLimits: async () => ({ downloadLimit: -1, uploadLimit: -1, connectionLimit: -1, maxTasks: -1 }),
    setGlobalLimits: async () => {} };
  return { handler: createMethodHandler({ registry, driver, config: { downloadDir: dir, version: '0.4.0', ...configOverride }, auth: { getStatus: () => ({}) } }), registry, driver, dir };
}

function makeHandlerSecret(rpcSecret) {
  return makeHandler({ rpcSecret });
}

test('aria2.getVersion 返回 version+enabledFeatures', async () => {
  const { handler } = makeHandler();
  const r = await handler('aria2.getVersion', []);
  assert.strictEqual(r.version, '0.4.0');
  assert.ok(Array.isArray(r.enabledFeatures));
});

test('system.multicall 批量调', async () => {
  const { handler } = makeHandler();
  const r = await handler('system.multicall', [[['aria2.getVersion', []], ['aria2.getGlobalStat', []]]]);
  assert.ok(Array.isArray(r));
  assert.strictEqual(r.length, 2);
  assert.ok(r[0][0].version); // AriaNg 需要每个 nested result 包一层数组
});

test('rpc-secret：兼容 AriaNg 的 nested system.multicall token', async () => {
  const { handler } = makeHandlerSecret('s3cr3t');
  const r = await handler('system.multicall', [[
    ['aria2.getVersion', ['token:s3cr3t']],
    ['aria2.getGlobalStat', ['token:s3cr3t']]
  ]]);
  assert.strictEqual(r.length, 2);
  assert.ok(r[0][0].version);
  await assert.rejects(handler('system.multicall', [[['aria2.getVersion', ['token:wrong']]]]), /unauthorized/i);
});

test('aria2.forcePause 等同 pause', async () => {
  const { handler, registry } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 'f', engineId: 1, taskType: 'http' });
  registry.update(rec.gid, { status: 'active' });
  const gid = await handler('aria2.forcePause', [rec.gid]);
  assert.strictEqual(gid, rec.gid);
  assert.strictEqual(registry.get(rec.gid).status, 'paused');
});

test('aria2.pauseAll 批量 stop', async () => {
  const { handler, registry } = makeHandler();
  const r1 = registry.create({ savePath: '/d', taskName: 'f1', engineId: 1, taskType: 'http' });
  registry.update(r1.gid, { status: 'active' });
  const r2 = registry.create({ savePath: '/d', taskName: 'f2', engineId: 2, taskType: 'http' });
  registry.update(r2.gid, { status: 'waiting' });
  const res = await handler('aria2.pauseAll', []);
  assert.strictEqual(res, 'OK');
  assert.strictEqual(registry.get(r1.gid).status, 'paused');
  assert.strictEqual(registry.get(r2.gid).status, 'paused');
});

test('aria2.unpauseAll 批量 start', async () => {
  const { handler, registry } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 'f', engineId: 1, taskType: 'http' });
  registry.update(rec.gid, { status: 'paused' });
  await handler('aria2.unpauseAll', []);
  assert.strictEqual(registry.get(rec.gid).status, 'waiting');
});

test('aria2.forcePauseAll 等同 pauseAll', async () => {
  const { handler, registry } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 'f', engineId: 1, taskType: 'http' });
  registry.update(rec.gid, { status: 'active' });
  await handler('aria2.forcePauseAll', []);
  assert.strictEqual(registry.get(rec.gid).status, 'paused');
});

test('aria2.getFiles 返回 BT fileLists', async () => {
  const { handler, registry } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 't', engineId: 1, taskType: 'bt' });
  rec.fileLists = [{ fileSize: 1024, realIndex: 0, fileName: 'a.bin' }, { fileSize: 2048, realIndex: 1, fileName: 'b.bin' }];
  const files = await handler('aria2.getFiles', [rec.gid]);
  assert.ok(Array.isArray(files));
  assert.strictEqual(files[0].index, '0');
  assert.strictEqual(files[0].length, '1024');
});

test('AriaNg 通过 aria2.addUri 提交 magnet 时转入磁力两步流程', async () => {
  const { handler, registry, driver, dir } = makeHandler({ parseTaskInfo: async ({ kind }) => {
    if (kind === 'magnet') return { infoHash: 'MAGNETINFO' };
    if (kind === 'torrent') return { infoId: 'MAGNETINFO', title: 'bundle',
      fileLists: [{ realIndex: 0, fileSize: 10, fileName: 'a.bin' }] };
    return {};
  }});
  // 模拟引擎已经把 metadata 写入 savePath，使后台转换流程在本测试内收敛。
  fs.writeFileSync(path.join(dir, 'MAGNETINFO.torrent'), Buffer.alloc(1200));
  const gid = await handler('aria2.addUri', [['magnet:?xt=urn:btih:MAGNETINFO'], { dir }]);
  assert.ok(gid);
  assert.strictEqual(registry.list()[0].metadataPhase, 'fetching');
  assert.ok(driver.lastCreateTaskType === undefined || driver.lastCreateTaskType === 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('AriaNg BT 状态包含 bittorrent 标识、选中文件和 peers 空数组', async () => {
  const { handler, registry, dir } = makeHandler();
  const rec = registry.create({ savePath: dir, taskName: 'bundle', engineId: 1, taskType: 'bt',
    fileLists: [{ realIndex: 0, fileSize: 10, fileName: 'a.bin' }, { realIndex: 1, fileSize: 20, fileName: 'b.bin' }],
    selectedFileIndices: [1] });
  const status = await handler('aria2.tellStatus', [rec.gid]);
  assert.strictEqual(status.bittorrent.mode, 'multi');
  assert.strictEqual(status.files[0].selected, 'false');
  assert.strictEqual(status.files[1].selected, 'true');
  assert.deepStrictEqual(await handler('aria2.getPeers', [rec.gid]), []);
});

test('AriaNg 删除和清空停止任务别名可用', async () => {
  const { handler, registry, dir } = makeHandler();
  const rec = registry.create({ savePath: dir, taskName: 'done', engineId: 1, taskType: 'http', status: 'complete' });
  await handler('aria2.removeDownloadResult', [rec.gid]);
  assert.strictEqual(registry.get(rec.gid).status, 'removed');
  const rec2 = registry.create({ savePath: dir, taskName: 'done2', engineId: 2, taskType: 'http', status: 'complete' });
  assert.strictEqual(await handler('aria2.purgeDownloadResult', []), 'OK');
  assert.strictEqual(registry.get(rec2.gid).status, 'removed');
});

test('aria2.getGlobalOption 返回限速', async () => {
  const { handler } = makeHandler();
  const r = await handler('aria2.getGlobalOption', []);
  assert.ok('max-overall-download-limit' in r);
  assert.ok('max-concurrent-downloads' in r);
});

test('aria2.changeGlobalOption 设限速', async () => {
  const { handler, driver } = makeHandler();
  driver.setGlobalLimits = async () => {};
  driver.lastLimits = null;
  // spy
  const origSet = driver.setGlobalLimits;
  driver.setGlobalLimits = async (l) => { driver.lastLimits = l; };
  await handler('aria2.changeGlobalOption', [{ 'max-overall-download-limit': '1M', 'max-concurrent-downloads': '3' }]);
  assert.ok(driver.lastLimits);
});

test('aria2.getOption 返回单任务选项（per-task 限速 stub）', async () => {
  const { handler, registry } = makeHandler();
  const rec = registry.create({ savePath: '/d', taskName: 'f', engineId: 1, taskType: 'http' });
  const r = await handler('aria2.getOption', [rec.gid]);
  assert.ok('max-download-limit' in r);
});

test('rpc-secret 缺失拒绝（配了 secret 时）', async () => {
  const { handler } = makeHandlerSecret('s3cr3t');
  await assert.rejects(handler('aria2.getVersion', [], { rpcSecret: undefined }), /unauthorized/i);
});
test('rpc-secret 错误拒绝', async () => {
  const { handler } = makeHandlerSecret('s3cr3t');
  await assert.rejects(handler('aria2.getVersion', [], { rpcSecret: 'wrong' }), /unauthorized/i);
});
test('rpc-secret 正确放行', async () => {
  const { handler } = makeHandlerSecret('s3cr3t');
  const r = await handler('aria2.getVersion', [], { rpcSecret: 's3cr3t' });
  assert.ok(r.version);
});
test('无 secret 配置时不鉴权', async () => {
  const { handler } = makeHandler(); // 无 rpcSecret
  const r = await handler('aria2.getVersion', []);
  assert.ok(r.version);
});
