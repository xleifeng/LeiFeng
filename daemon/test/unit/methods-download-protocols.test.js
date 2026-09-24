'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMethodHandler, RpcError } = require('../../host/src/methods');

// mock driver + registry + auth，验 addTorrent 流程
// L89 note：driver.lastInfo/driver.lastParsedData 需在 mock driver 里记录（spy 入参）。
// 使用 mkdtemp，避免依赖宿主机固定目录权限。
function makeHandler(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'methods-download-'));
  const registry = { tasks: new Map(), list: () => [...registry.tasks.values()], get: (g) => registry.tasks.get(g),
    create: (o) => { const r = { gid: 'g' + (registry.tasks.size+1), status: 'waiting', completedLength: 0, totalLength: 0, downloadSpeed: 0, savePath: o.savePath, taskName: o.taskName, taskType: o.taskType, infoId: o.infoId, ...o }; registry.tasks.set(r.gid, r); return r; },
    update: (g, p) => { Object.assign(registry.tasks.get(g), p); }, findDuplicate: (tt, k, sp) => { for (const r of registry.tasks.values()) if (r.taskType===tt && !['complete','error','removed'].includes(r.status)) { const rk = tt==='bt'?r.infoId:tt==='magnet'?r.infoHash:r.url; if (rk===k && r.savePath===sp) return r; } return undefined; },
    counts: () => ({ active:0, waiting:0, stopped:0 }) };
  const driver = { createTask: overrides.createTask || (async ({ taskType, savePath, taskName, info }) => { driver.lastInfo = info; driver.lastCreateTaskType = taskType; driver._idCounter = (driver._idCounter || 0) + 1; return driver._idCounter; }),
    parseTaskInfo: overrides.parseTaskInfo || (async ({ kind, data }) => { driver.lastParsedData = data;
      if (kind === 'torrent') return { infoId: 'INFOID', title: 't', trackerUrls: [], fileLists: [{ fileSize: 1024, realIndex: 0, fileOffset: 0, fileName: 'file.bin', filePath: '' }, { fileSize: 2048, realIndex: 1, fileOffset: 1024, fileName: 'file2.bin', filePath: '' }] };
      return {};
    }),
    resolveThunderUrl: overrides.resolveThunderUrl || (async (url) => {   // 镜像真 driver：thunder→urltype 两步
      const r = await driver.parseTaskInfo({ kind: 'thunder', data: url });
      const t = await driver.parseTaskInfo({ kind: 'urltype', data: r.resolvedUrl });
      return { resolvedUrl: r.resolvedUrl, taskType: t.taskType };
    }),
    startTasks: async (ids) => {}, stopTasks: async (ids) => {}, deleteTasks: async (ids) => {},
    isHealthy: () => true };
  const config = { downloadDir: dir, runtimeDir: dir, version: '0.3.0' };
  const auth = { getStatus: () => ({}) };
  return { handler: createMethodHandler({ registry, driver, config, auth }), registry, driver, dir };
}

test('addTorrent：返回 gid + 选文件 → fileRealIndexLists', async () => {
  const { handler, dir } = makeHandler();
  const gid = await handler('aria2.addTorrent', ['/srv/tlei-test/x.torrent', { dir, selectFile: [0] }]);
  assert.ok(gid);
});

test('addTorrent：接受 AriaNg base64 种子内容并物化后解析', async () => {
  const { handler, driver, dir } = makeHandler();
  const content = Buffer.from('d4:infod4:name1:xee', 'utf8').toString('base64');
  await handler('aria2.addTorrent', [content, { dir }]);
  assert.notStrictEqual(driver.lastParsedData, content);
  assert.ok(driver.lastParsedData.startsWith(dir));
  assert.ok(fs.existsSync(driver.lastParsedData) === false, '上传种子在 RPC 完成后应清理');
});

test('addTorrent：缺 torrentFile 抛错', async () => {
  const { handler, dir } = makeHandler();
  await assert.rejects(handler('aria2.addTorrent', [[], { dir }]), /torrent.*required|torrentFile/i);
});

test('addTorrent：selectFile 传给 createTask info.fileRealIndexLists', async () => {
  const { handler, driver, registry, dir } = makeHandler();
  await handler('aria2.addTorrent', ['/srv/tlei-test/x.torrent', { dir, selectFile: [1] }]);
  // driver.createTask 应收到 fileRealIndexLists:[1]
  assert.deepStrictEqual(driver.lastInfo.fileRealIndexLists, [1]);
  assert.strictEqual(driver.lastInfo.origin, 'magnet:?xt=urn:btih:INFOID');
  assert.strictEqual(driver.lastInfo.displayName, 't');
  assert.strictEqual(driver.lastInfo.fileLists.length, 2);
  assert.strictEqual(driver.lastInfo.subFileScheduler, 1);
  assert.deepStrictEqual(registry.list()[0].selectedFileIndices, [1]);
  assert.strictEqual(registry.list()[0].infoId, 'INFOID');
  assert.strictEqual(registry.list()[0].fileLists.length, 2);
});

test('addTorrent：无 selectFile → 全选（所有 realIndex）', async () => {
  const { handler, driver, dir } = makeHandler();
  await handler('aria2.addTorrent', ['/srv/tlei-test/x.torrent', { dir }]);
  assert.deepStrictEqual(driver.lastInfo.fileRealIndexLists, [0, 1]);
});

test('addTorrent：重复 infoId+savePath → 返回已有 gid', async () => {
  const { handler, dir } = makeHandler();
  const g1 = await handler('aria2.addTorrent', ['/srv/tlei-test/x.torrent', { dir }]);
  const g2 = await handler('aria2.addTorrent', ['/srv/tlei-test/other.torrent', { dir }]); // 同 infoId（mock 固定 INFOID）
  assert.strictEqual(g1, g2);
});

test('addTorrent：file:/// 前缀剥离', async () => {
  const { handler, driver, dir } = makeHandler();
  await handler('aria2.addTorrent', ['file:///srv/tlei-test/x.torrent', { dir }]);
  // parseTaskInfo 收到 Linux 路径（driver 转 Wine）
  assert.strictEqual(driver.lastParsedData, '/srv/tlei-test/x.torrent');
});

test('toAria2Status BT files 报清单（名/大小/index）', async () => {
  const { handler, registry, dir } = makeHandler();
  await handler('aria2.addTorrent', ['/srv/tlei-test/x.torrent', { dir, selectFile: [0] }]);
  const rec = registry.list()[0];
  rec.fileLists = [{ fileSize: 1024, realIndex: 0, fileName: 'file.bin' }, { fileSize: 2048, realIndex: 1, fileName: 'file2.bin' }];
  const { toAria2Status } = require('../../host/src/methods');
  const st = toAria2Status(rec);
  assert.ok(st.files.length >= 1);
  // files 报清单（index/length/fileName），不报每文件 completedLength 粒度
  assert.strictEqual(st.files[0].length, '1024');
});

test('addUri ed2k：→ createEmuleTask (taskType 3)', async () => {
  const { handler, driver, registry, dir } = makeHandler({ parseTaskInfo: async ({ kind, data }) => {
    if (kind === 'urltype') return { taskType: 3 };
    if (kind === 'ed2k') return { fileSize: 100, fileName: 'eMule-test.exe', fileHash: 'H' };
    return {};
  }});
  const gid = await handler('aria2.addUri', [['ed2k://|file|f|100|H|/'], { dir }]);
  assert.ok(gid);
  assert.strictEqual(driver.lastCreateTaskType, 3);
  assert.strictEqual(registry.get(gid).taskName, 'eMule-test.exe');
  assert.strictEqual(registry.get(gid).totalLength, 100);
});

test('addUri thunder://：→ resolveThunderUrl 两步再分派', async () => {
  const { handler, driver, dir } = makeHandler({ parseTaskInfo: async ({ kind, data }) => {
    if (kind === 'thunder') return { resolvedUrl: 'http://127.0.0.1:1/f.bin' };
    if (kind === 'urltype') return { taskType: 1 };
    return {};
  }});
  const gid = await handler('aria2.addUri', [['thunder://abc'], { dir }]);
  assert.ok(gid);
  assert.strictEqual(driver.lastCreateTaskType, 1);
});

test('addMagnetAddress：返回 gid + registry metadataPhase=fetching + 后台轮询', async () => {
  const { handler, registry, driver, dir } = makeHandler({ parseTaskInfo: async ({ kind, data }) => {
    if (kind === 'magnet') return { infoHash: 'INFOHASH', displayName: 'f', trackerUrls: [] };
    if (kind === 'torrent') return { infoId: 'INFOHASH', title: 'metadata-title.iso', fileLists: [{ fileSize: 1024, realIndex: 0, fileName: 'f.bin', filePath: '' }], trackerUrls: [] };
    return {};
  }});
  const gid = await handler('aria2.addMagnetAddress', ['magnet:?xt=urn:btih:INFOHASH', { dir }]);
  assert.ok(gid);
  const rec = registry.get(gid);
  const initialEngineId = rec.engineId;  // 快照 magId：mock registry.get 返回 live 引用，update 原地改
  assert.strictEqual(rec.taskType, 'magnet');
  assert.strictEqual(rec.taskName, 'f', '磁力任务展示名应优先使用 metadata displayName');
  assert.strictEqual(rec.metadataPhase, 'fetching');
  // 模拟 metadata 文件出现（mock fs 或驱动后台立即创文件）→ 验转 BT
  // 模拟 metadata 文件出现 → 后台 poll 命中并转 BT，避免 3s 轮询挂进程
  fs.mkdirSync(path.join(dir, 'f'));
  fs.writeFileSync(path.join(dir, 'f', 'f.bin'), 'existing-data');
  fs.writeFileSync(path.join(dir, 'INFOHASH.torrent'), Buffer.alloc(1200));
  // 因后台轮询异步，测试用 waitFor；200ms 让 setImmediate+await 链跑完
  await new Promise((res) => setTimeout(res, 200));
  const rec2 = registry.get(gid);
  assert.strictEqual(rec2.metadataPhase, 'download', 'metadata 拉到后应转 BT（metadataPhase=download）');
  assert.ok(rec2.engineId !== initialEngineId, 'engineId 应从 magId 切到 btId');
  assert.strictEqual(rec2.taskName, 'metadata-title.iso', '转 BT 后应使用 torrent metadata title');
  assert.ok(fs.existsSync(path.join(dir, 'f', 'f.bin')), '磁力转 BT 不应重命名已有文件');
});

test('addMagnetAddress：无 dn 时不移动 infoHash.torrent metadata 文件', async () => {
  const { handler, registry, driver, dir } = makeHandler({ parseTaskInfo: async ({ kind }) => {
    if (kind === 'magnet') return { infoHash: 'IH-NO-DN', trackerUrls: [] };
    if (kind === 'torrent') return { infoId: 'IH-NO-DN', title: 'metadata-no-dn.iso', fileLists: [{ fileSize: 1024, realIndex: 0, fileName: 'f.bin', filePath: '' }], trackerUrls: [] };
    return {};
  }});
  const gid = await handler('aria2.addMagnetAddress', ['magnet:?xt=urn:btih:IH-NO-DN', { dir }]);
  const metaFile = path.join(dir, 'IH-NO-DN.torrent');
  fs.writeFileSync(metaFile, Buffer.alloc(1200));
  await new Promise((res) => setTimeout(res, 200));
  assert.strictEqual(registry.get(gid).taskName, 'metadata-no-dn.iso');
  assert.strictEqual(driver.lastInfo.seedFile, metaFile);
  assert.ok(fs.existsSync(metaFile), 'metadata 文件必须保留在 seedFile 路径');
});

test('addMagnetAddress：重复 infoHash+savePath → 返回已有 gid', async () => {
  const { handler, dir } = makeHandler({ parseTaskInfo: async ({ kind, data }) => {
    if (kind === 'magnet') return { infoHash: 'IH', displayName: 'f', trackerUrls: [] };
    if (kind === 'torrent') return { infoId: 'IH', title: 'f', fileLists: [{ fileSize: 1024, realIndex: 0, fileName: 'f.bin', filePath: '' }], trackerUrls: [] };
    return {};
  }});
  const g1 = await handler('aria2.addMagnetAddress', ['magnet:?xt=urn:btih:IH', { dir }]);
  const g2 = await handler('aria2.addMagnetAddress', ['magnet:?xt=urn:btih:IH', { dir }]);
  assert.strictEqual(g1, g2);
  // 模拟 metadata 文件出现 → 后台 poll 命中并转 BT，避免 3s 轮询挂进程
  fs.writeFileSync(path.join(dir, 'IH.torrent'), Buffer.alloc(1200));
  await new Promise((res) => setTimeout(res, 50));
});

test('addMagnetAddress：selectFile 在 metadata 转 BT 后持久化并传给 createTask', async () => {
  const { handler, registry, driver, dir } = makeHandler({ parseTaskInfo: async ({ kind }) => {
    if (kind === 'magnet') return { infoHash: 'IH-SELECT', displayName: 'f', trackerUrls: [] };
    if (kind === 'torrent') return {
      infoId: 'IH-SELECT', title: 'f',
      fileLists: [
        { fileSize: 1024, realIndex: 0, fileName: 'f0.bin', filePath: '' },
        { fileSize: 2048, realIndex: 1, fileName: 'f1.bin', filePath: '' },
      ], trackerUrls: [],
    };
    return {};
  }});
  const gid = await handler('aria2.addMagnetAddress', ['magnet:?xt=urn:btih:IH-SELECT', { dir, selectFile: [1] }]);
  fs.writeFileSync(path.join(dir, 'IH-SELECT.torrent'), Buffer.alloc(1200));
  await new Promise((res) => setTimeout(res, 200));
  const rec = registry.get(gid);
  assert.deepStrictEqual(driver.lastInfo.fileRealIndexLists, [1]);
  assert.strictEqual(driver.lastInfo.origin, 'magnet:?xt=urn:btih:IH-SELECT');
  assert.strictEqual(driver.lastInfo.fileLists.length, 2);
  assert.deepStrictEqual(rec.selectedFileIndices, [1]);
  assert.strictEqual(rec.infoId, 'IH-SELECT');
  assert.deepStrictEqual(rec.fileLists.map((f) => f.realIndex), [0, 1]);
});
