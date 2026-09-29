'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readTasks, readVipTasks, readNativeBtTasks, hasSqlite } = require('../../host/kernels/thunder/taskdb-reader');

test('readTasks returns rows keyed by TaskId', { skip: !hasSqlite && 'sqlite3 missing' }, async () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskdb-')), 'TaskDb.dat');
  execFileSync('sqlite3', [db, 'CREATE TABLE TaskBase(TaskId BIGINT PRIMARY KEY,Status INT,TotalReceiveSize BIGINT,ResourceSize BIGINT,FailureErrorCode INT,Name TEXT);' +
    "INSERT INTO TaskBase VALUES (101,8,2097152,2097152,0,'x.bin'),(102,4,100,5000,0,NULL),(103,9,0,5000,12,'y.bin');"]);
  const m = await readTasks(db, [101, 102, 103, 999]);
  assert.deepStrictEqual(m.get(101), { status: 8, totalReceiveSize: 2097152, resourceSize: 2097152, failureErrorCode: 0, name: 'x.bin' });
  assert.deepStrictEqual(m.get(102), { status: 4, totalReceiveSize: 100, resourceSize: 5000, failureErrorCode: 0, name: null });
  assert.deepStrictEqual(m.get(103), { status: 9, totalReceiveSize: 0, resourceSize: 5000, failureErrorCode: 12, name: 'y.bin' });
  assert.strictEqual(m.has(999), false);
});

test('readTasks on empty id list short-circuits', async () => {
  const m = await readTasks('/nonexistent', []);
  assert.strictEqual(m.size, 0);
});

test('readVipTasks 读取 TaskBase VIP 字段和 BtFile 子文件元数据', { skip: !hasSqlite && 'sqlite3 missing' }, async () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskdb-vip-')), 'TaskDb.dat');
  execFileSync('sqlite3', [db, `
    CREATE TABLE TaskBase(
      TaskId BIGINT PRIMARY KEY, Type INT, Status INT, Url TEXT, Name TEXT,
      ResourceSize BIGINT, Cid BLOB, Gcid BLOB,
      VipReceiveSize BIGINT, FreeDcdnReceiveSize BIGINT,
      VipResourceEnableNecessary INT, Forbidden INT
    );
    CREATE TABLE BtFile(
      BtFileId INTEGER PRIMARY KEY, BtTaskId BIGINT, FileIndex INT,
      Download INT, FileName TEXT, FileSize BIGINT, Cid BLOB, Gcid BLOB
    );
    INSERT INTO TaskBase VALUES
      (201,1,5,'https://example.test/a.bin','a.bin',4096,X'0102',X'A0B0',123,45,1,0),
      (202,2,5,'','bundle',8192,X'AA',X'BB',0,0,0,0);
    INSERT INTO BtFile VALUES
      (1,202,0,1,'one.bin',1024,X'1112',X'2122'),
      (2,202,1,0,'two.bin',2048,X'',NULL);
  `]);
  const m = await readVipTasks(db, [201, 202]);
  assert.deepStrictEqual(m.get(201), {
    engineId: 201, type: 1, status: 5, url: 'https://example.test/a.bin', name: 'a.bin',
    resourceSize: 4096, cid: '0102', gcid: 'A0B0', vipReceiveSize: 123,
    freeDcdnReceiveSize: 45, vipResourceEnableNecessary: 1, forbidden: 0, btFiles: [],
  });
  assert.deepStrictEqual(m.get(202).btFiles, [
    { fileIndex: 0, download: 1, fileName: 'one.bin', fileSize: 1024, cid: '1112', gcid: '2122' },
    { fileIndex: 1, download: 0, fileName: 'two.bin', fileSize: 2048, cid: null, gcid: null },
  ]);
});

test('readVipTasks 空 id 列表和非法 id 不触碰数据库', async () => {
  assert.strictEqual((await readVipTasks('/nonexistent', [])).size, 0);
  assert.strictEqual((await readVipTasks('/nonexistent', [0, -1, 1.2, 'x'])).size, 0);
});

test('readNativeBtTasks finds persisted BT rows and filters by native path/name', { skip: !hasSqlite && 'sqlite3 missing' }, async () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'taskdb-bt-match-')), 'TaskDb.dat');
  execFileSync('sqlite3', [db, `
    CREATE TABLE TaskBase(
      TaskId BIGINT PRIMARY KEY, Status INT, SavePath TEXT, Name TEXT,
      TotalReceiveSize BIGINT, ResourceSize BIGINT, FailureErrorCode INT
    );
    CREATE TABLE BtTask(TaskId BIGINT PRIMARY KEY, InfoId BLOB, SeedFile TEXT);
    INSERT INTO TaskBase VALUES
      (11,5,'Z:\\srv\\leifeng-test\\downloads','ubuntu.iso',100,1000,0),
      (12,9,'Z:\\srv\\leifeng-test\\downloads','ubuntu.iso',900,1000,8),
      (13,5,'Z:\\home\\other','ubuntu.iso',800,1000,0);
    INSERT INTO BtTask VALUES
      (11,X'00112233445566778899AABBCCDDEEFF00112233','seed-a'),
      (12,X'00112233445566778899AABBCCDDEEFF00112233','seed-b'),
      (13,X'00112233445566778899AABBCCDDEEFF00112233','seed-c');
  `]);
  const rows = await readNativeBtTasks(db, '00112233445566778899AABBCCDDEEFF00112233', { savePath: '/srv/leifeng-test/downloads', taskName: 'ubuntu.iso' });
  assert.deepEqual(rows, [
    { engineId: 12, status: 9, savePath: 'Z:\\srv\\leifeng-test\\downloads', name: 'ubuntu.iso', totalReceiveSize: 900, resourceSize: 1000, failureErrorCode: 8 },
    { engineId: 11, status: 5, savePath: 'Z:\\srv\\leifeng-test\\downloads', name: 'ubuntu.iso', totalReceiveSize: 100, resourceSize: 1000, failureErrorCode: 0 },
  ]);
});

// ---- node:sqlite reader（Windows native 模式）----
const { createNodeSqliteTaskDbReader } = require('../../host/kernels/thunder/taskdb-reader');
const { DatabaseSync } = require('node:sqlite');

test('node:sqlite reader 与 CLI reader 行为对齐（tasks/vip/native-bt）', async () => {
  // 构造与 CLI 测试同构的 TaskDb fixture（含 BtFile 缺表降级场景由 try/catch 覆盖）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sqlite-reader-'));
  const dbPath = path.join(dir, 'TaskDb.dat');
  const setup = new DatabaseSync(dbPath);
  setup.exec(`
    CREATE TABLE TaskBase (TaskId INTEGER PRIMARY KEY, Type INTEGER, Status INTEGER, Url TEXT, Name TEXT,
      ResourceSize INTEGER, Cid BLOB, Gcid BLOB, VipReceiveSize INTEGER, FreeDcdnReceiveSize INTEGER,
      VipResourceEnableNecessary INTEGER, Forbidden INTEGER, TotalReceiveSize INTEGER,
      FailureErrorCode INTEGER, SavePath TEXT);
    CREATE TABLE BtTask (TaskId INTEGER PRIMARY KEY, InfoId BLOB);
    CREATE TABLE BtFile (BtTaskId INTEGER, FileIndex INTEGER, Download INTEGER, FileName TEXT, FileSize INTEGER, Cid BLOB, Gcid BLOB);
    INSERT INTO TaskBase VALUES (7, 2, 5, 'magnet:?x', 'bundle', 1024, x'AA', x'BB', 64, 8, 1, 0, 128, 0, 'C:\\d');
    INSERT INTO TaskBase VALUES (8, 5, 5, '', 'other', 10, NULL, NULL, 0, 0, 0, 0, 10, 0, 'C:\\d');
    INSERT INTO BtTask VALUES (7, x'${'AA'.repeat(20)}');
    INSERT INTO BtTask VALUES (8, x'${'CC'.repeat(20)}');
    INSERT INTO BtFile VALUES (7, 3, 1, 'file.bin', 1024, x'CC', x'DD');
  `);
  setup.close();

  const reader = createNodeSqliteTaskDbReader({ DatabaseSync });
  assert.equal(reader.available, true);

  const tasks = await reader.readTasks(dbPath, [7, 7, -1]);
  assert.deepEqual(tasks.get(7), { status: 5, totalReceiveSize: 128, resourceSize: 1024, failureErrorCode: 0, name: 'bundle' });

  const vip = await reader.readVipTasks(dbPath, [7]);
  assert.equal(vip.get(7).vipReceiveSize, 64);
  assert.equal(vip.get(7).cid, 'AA');
  assert.deepEqual(vip.get(7).btFiles[0], { fileIndex: 3, download: 1, fileName: 'file.bin', fileSize: 1024, cid: 'CC', gcid: 'DD' });

  const bt = await reader.readNativeBtTasks(dbPath, 'aa'.repeat(20), { savePath: 'c:\\D', taskName: 'bundle' });
  assert.equal(bt.length, 1);
  assert.equal(bt[0].engineId, 7);

  // 缺库返回空而非抛错（引擎尚未建 TaskDb 的窗口期）
  const empty = await reader.readTasks(path.join(dir, 'missing.dat'), [7]);
  assert.equal(empty.size, 0);
  // 只读连接拒绝写入（防误操作 SDK 数据库）
  assert.throws(() => { const ro = new DatabaseSync(dbPath, { readOnly: true }); try { ro.exec('DELETE FROM TaskBase'); } finally { ro.close(); } });
});

test('node:sqlite reader 在模块不可用时报告不可用', async () => {
  const reader = createNodeSqliteTaskDbReader({ DatabaseSync: null });
  assert.equal(reader.available, false);
  await assert.rejects(reader.readTasks('/tmp/whatever.dat', [1]), (e) => e.code === 'TASKDB_READER_UNAVAILABLE');
});
