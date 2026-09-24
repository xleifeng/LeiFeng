'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { CreateTaskService } = require('../../host/src/services/create-task-service');
const { FtpSecretStore } = require('../../host/src/secrets/ftp-secret-store');

test('compat create URI preserves create native → repository → start order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const calls = []; let id = 10;
  const driver = { createTask: async () => { calls.push('create'); return ++id; }, startTasks: async () => { calls.push('start'); }, parseTaskInfo: async () => ({}) };
  const service = new CreateTaskService({ tasks: repo, driver, httpProbe: async () => 123, runtimeDir: dir });
  const taskId = await service.createUriCompat({ source: 'http://x/file.bin', savePath: dir });
  assert.equal(repo.get(taskId).lifecycle, 'queued'); assert.deepEqual(calls, ['create', 'start']);
});

test('create start failure leaves retryable failed record and compensates native task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-fail-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  let deleted = false; const driver = { createTask: async () => 11, startTasks: async () => { throw new Error('engine timeout'); }, deleteTasks: async () => { deleted = true; } };
  const service = new CreateTaskService({ tasks: repo, driver, httpProbe: async () => 1, runtimeDir: dir });
  await assert.rejects(service.createUriCompat({ source: 'http://x/file.bin', savePath: dir }), (error) => error.code === 'START_FAILED');
  assert.equal(deleted, true); assert.equal(repo.list()[0].lifecycle, 'failed'); assert.equal(repo.list()[0].error.retryable, true);
});

test('queued create mode persists the native task without starting it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-queued-')); const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load(); let started = false;
  const driver = { createTask: async () => 12, startTasks: async () => { started = true; } };
  const service = new CreateTaskService({ tasks: repo, driver, httpProbe: async () => 1, runtimeDir: dir }); const taskId = await service.createUriCompat({ source: 'http://x/queued.bin', savePath: dir, options: { startMode: 'queued' } });
  assert.equal(started, false); assert.equal(repo.get(taskId).lifecycle, 'queued');
});

test('authenticated FTP separates credentials from the persisted task source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-ftp-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const ftpSecrets = new FtpSecretStore({ filePath: path.join(dir, 'secrets', 'ftp.json') }); ftpSecrets.load();
  let created = null;
  const driver = { createTask: async (input) => { created = input; return 13; }, startTasks: async () => {}, deleteTasks: async () => {} };
  const service = new CreateTaskService({ tasks: repo, driver, ftpSecrets, runtimeDir: dir });
  const taskId = await service.createUriCompat({ source: 'ftp://alice:p%40ss@example.test/releases/a.iso', savePath: dir });
  const task = repo.get(taskId);
  assert.equal(task.kind, 'ftp');
  assert.equal(task.source, 'ftp://example.test/releases/a.iso');
  assert.equal(created.info.loginFtp, true);
  assert.equal(created.info.ftpUserName, 'alice');
  assert.equal(created.info.ftpPassword, 'p@ss');
  assert.match(task.legacy.ftpSecretRef, /^ftp:/);
  assert.equal(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8').includes('p@ss'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8').includes('alice@'), false);
});

test('torrent task records use relative paths when native metadata contains a foreign absolute path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-torrent-path-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  let createdInfo = null;
  const driver = {
    parseTaskInfo: async () => ({ infoId: 'torrent-info', title: 'fixture', trackerUrls: ['https://tracker.example/announce'], fileLists: [{ realIndex: 0, fileName: 'movie.mkv', filePath: 'D:\\Downloads\\movie.mkv', fileSize: 7, fileOffset: 0 }] }),
    createTask: async ({ info }) => { createdInfo = info; return 42; },
    startTasks: async () => {},
    deleteTasks: async () => {},
  };
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir });
  const taskId = await service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'fixture' });
  const task = repo.get(taskId);
  assert.equal(task.infoId, 'torrent-info');
  assert.deepEqual(task.files, [{ index: 0, name: 'movie.mkv', path: 'movie.mkv', size: 7, offset: 0 }]);
  assert.deepEqual(createdInfo.fileRealIndexLists, [0]);
  assert.equal(createdInfo.origin, 'magnet:?xt=urn:btih:torrent-info');
  assert.equal(createdInfo.displayName, 'fixture');
  assert.equal(createdInfo.taskNameModify, false);
  assert.equal(createdInfo.tracker, 'https://tracker.example/announce');
  assert.equal(createdInfo.subFileScheduler, 1);
  assert.deepEqual(createdInfo.fileLists, [{ realIndex: 0, fileName: 'movie.mkv', filePath: 'D:\\Downloads\\movie.mkv', fileSize: 7, fileOffset: 0 }]);
});

test('torrent native creation only marks a name as modified when it differs from the parsed title', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-torrent-rename-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  let createdInfo = null;
  const driver = {
    parseTaskInfo: async () => ({ infoId: 'torrent-info', title: 'original.iso', trackerUrls: [], fileLists: [{ realIndex: 0, fileName: 'original.iso', filePath: '', fileSize: 7, fileOffset: 0 }] }),
    createTask: async ({ info }) => { createdInfo = info; return 43; },
    startTasks: async () => {},
    deleteTasks: async () => {},
  };
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir });
  await service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'renamed.iso' });
  assert.equal(createdInfo.taskNameModify, true);
});

test('torrent create adopts the most progressed persisted native task instead of duplicating it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-native-adopt-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'ubuntu.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  fs.writeFileSync(path.join(dir, 'ubuntu.iso.xltd'), 'partial');
  const calls = [];
  const driver = {
    parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'ubuntu.iso', fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 1000, fileOffset: 0 }] }),
    createTask: async () => { calls.push('create'); return 99; },
    getTaskSnapshots: async () => new Map([[51, {}], [52, {}]]),
    startTasks: async (ids) => calls.push(['start', ids]),
    deleteTasks: async () => calls.push('delete'),
  };
  const service = new CreateTaskService({
    tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => [
      { engineId: 51, status: 5, savePath: 'Z:\\' + dir.slice(1).replaceAll('/', '\\'), name: 'ubuntu.iso', totalReceiveSize: 600, resourceSize: 1000, failureErrorCode: 0 },
      { engineId: 52, status: 5, savePath: 'Z:\\' + dir.slice(1).replaceAll('/', '\\'), name: 'ubuntu.iso', totalReceiveSize: 200, resourceSize: 1000, failureErrorCode: 0 },
    ],
  });
  const taskId = await service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'ubuntu.iso', options: { startMode: 'queued' } });
  const task = repo.get(taskId);
  assert.equal(task.engineId, 51);
  assert.equal(task.completedBytes, 600);
  assert.equal(task.legacy.adoptedNativeTask, true);
  assert.deepEqual(calls, []);
});

test('torrent native adoption explicitly starts an existing status-5 row when requested', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-native-adopt-start-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'ubuntu.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  fs.writeFileSync(path.join(dir, 'ubuntu.iso.xltd'), 'partial');
  const calls = [];
  const driver = {
    parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'ubuntu.iso', fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 1000, fileOffset: 0 }] }),
    createTask: async () => { calls.push('create'); return 99; },
    getTaskSnapshots: async () => new Map([[51, {}]]),
    startTasks: async (ids) => calls.push(['start', ids]),
  };
  const service = new CreateTaskService({
    tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => [{ engineId: 51, status: 5, savePath: 'Z:\\' + dir.slice(1).replaceAll('/', '\\'), name: 'ubuntu.iso', totalReceiveSize: 600, resourceSize: 1000, failureErrorCode: 0 }],
  });
  const taskId = await service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'ubuntu.iso' });
  assert.equal(repo.get(taskId).engineId, 51);
  assert.deepEqual(calls, [['start', [51]]]);
});

test('同 hash 原生会话仍活跃时拒绝在其他目录重复建 BT 任务', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-busy-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, 'd4:info');
  let creates = 0;
  const driver = {
    parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'fixture', fileLists: [] }),
    createTask: async () => { creates++; return 1; }, startTasks: async () => {},
    getTaskSnapshots: async () => new Map([[51, {}]]),
  };
  // 引擎行 savePath 下放真实部分数据：数据在盘 → 不是可释放僵尸 → 保持 BUSY（会话被别的目录活跃任务占用）。
  fs.writeFileSync(path.join(dir, 'other-fixture.xltd'), 'partial-data');
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => [{ engineId: 51, status: 5, savePath: dir, name: 'other-fixture', totalReceiveSize: 1, failureErrorCode: 0 }] });
  await assert.rejects(service.createTorrentCompat({ torrentInput: torrent, savePath: path.join(dir, 'elsewhere') }), (e) => e.code === 'BT_NATIVE_SESSION_BUSY');
  assert.equal(creates, 0);
});

test('原生状态读取失败时停止 BT 创建', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-read-fail-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, 'd4:info');
  let creates = 0;
  const driver = { parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'fixture', fileLists: [] }),
    createTask: async () => { creates++; return 1; }, getTaskSnapshots: async () => new Map() };
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => { throw new Error('unavailable'); } });
  await assert.rejects(service.createTorrentCompat({ torrentInput: torrent, savePath: dir }), (e) => e.code === 'BT_NATIVE_STATE_UNAVAILABLE');
  assert.equal(creates, 0);
});

test('TaskDb 历史行不在实时队列时允许新建', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-stale-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, 'd4:info');
  let creates = 0;
  const driver = { parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'fixture', fileLists: [] }),
    getTaskSnapshots: async () => new Map(), createTask: async () => { creates++; return 77; }, startTasks: async () => {} };
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => [{ engineId: 51, status: 5, savePath: '/old', name: 'fixture', totalReceiveSize: 1, failureErrorCode: 0 }] });
  await service.createTorrentCompat({ torrentInput: torrent, savePath: dir });
  assert.equal(creates, 1);
});

test('不同保存目录并发创建同 hash 时仅生成一条原生任务', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-concurrent-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'fixture.torrent'); fs.writeFileSync(torrent, 'd4:info');
  const rows = []; let creates = 0;
  const driver = { parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'fixture', fileLists: [] }),
    getTaskSnapshots: async () => new Map(rows.map((row) => [row.engineId, {}])),
    createTask: async ({ savePath, taskName }) => { creates++; rows.push({ engineId: creates, status: 5, savePath, name: taskName, totalReceiveSize: 0, failureErrorCode: 0 }); return creates; },
    startTasks: async () => {} };
  const service = new CreateTaskService({ tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => rows });
  const results = await Promise.allSettled(['a', 'b'].map((name) =>
    service.createTorrentCompat({ torrentInput: torrent, savePath: path.join(dir, name) })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected')?.reason?.code, 'BT_NATIVE_SESSION_BUSY');
  assert.equal(creates, 1);
});

test('stopped orphan native rows without host reference are released once, then create proceeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-orphan-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  const torrent = path.join(dir, 'ubuntu.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  const calls = [];
  let snapshotCall = 0;
  let nativeRows = [{ engineId: 77, status: 7, savePath: 'Z:\\gone', name: 'ubuntu.iso', totalReceiveSize: 5, resourceSize: 1000, failureErrorCode: 0 }];
  const driver = {
    parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'ubuntu.iso', fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 1000, fileOffset: 0 }] }),
    createTask: async () => { calls.push('create'); return 99; },
    // 第 1 次查占用（77 在）；释放 deleteTasks 后第 2 次查（77 已出快照）→ 放行
    getTaskSnapshots: async (ids) => { snapshotCall += 1; return new Map(snapshotCall === 1 ? [[77, { status: 7 }]] : []); },
    startTasks: async (ids) => calls.push(['start', ids]),
    deleteTasks: async (ids) => { calls.push(['delete', ids]); nativeRows = []; },
  };
  const service = new CreateTaskService({
    tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => nativeRows,
  });
  const taskId = await service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'ubuntu.iso', options: { startMode: 'queued' } });
  const task = repo.get(taskId);
  assert.equal(task.engineId, 99);                                   // 释放后真新建
  assert.deepEqual(calls.filter((c) => Array.isArray(c) && c[0] === 'delete'), [['delete', [77]]]);  // 恰好一次孤儿释放
});

test('stopped native row still owned by a host task is NOT released (explicit BUSY)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-v2-orphan-owned-'));
  const repo = new TaskRepository({ filePath: path.join(dir, 'tasks.json') }); repo.load();
  // host 面仍引用 engineId=77 的活跃任务 → 不是孤儿
  repo.create({ source: 'http://x/seed', savePath: dir, displayName: 'owned', kind: 'bt', engineId: 77, lifecycle: 'paused' });
  const torrent = path.join(dir, 'ubuntu.torrent'); fs.writeFileSync(torrent, Buffer.from('d4:infod4:name', 'ascii'));
  const calls = [];
  const driver = {
    parseTaskInfo: async () => ({ infoId: '00112233445566778899AABBCCDDEEFF00112233', title: 'ubuntu.iso', fileLists: [{ realIndex: 0, fileName: 'ubuntu.iso', fileSize: 1000, fileOffset: 0 }] }),
    createTask: async () => { calls.push('create'); return 99; },
    getTaskSnapshots: async () => new Map([[77, { status: 7 }]]),
    startTasks: async (ids) => calls.push(['start', ids]),
    deleteTasks: async () => calls.push('delete'),
  };
  const service = new CreateTaskService({
    tasks: repo, driver, runtimeDir: dir, taskDbPath: path.join(dir, 'TaskDb.dat'),
    readNativeBtTasks: async () => [{ engineId: 77, status: 7, savePath: 'Z:\\gone', name: 'ubuntu.iso', totalReceiveSize: 5, resourceSize: 1000, failureErrorCode: 0 }],
  });
  await assert.rejects(service.createTorrentCompat({ torrentInput: torrent, savePath: dir, displayName: 'ubuntu.iso' }), (e) => {
    assert.equal(e.code, 'BT_NATIVE_SESSION_BUSY');
    assert.match(e.message, /77/);                                   // 诊断里带占用行
    return true;
  });
  assert.ok(!calls.includes('delete'));                              // 有主行绝不删
});
