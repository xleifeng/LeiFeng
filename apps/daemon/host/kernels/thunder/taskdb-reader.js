'use strict';
const { execFile, execFileSync } = require('child_process');

const hasSqlite = (() => {
  try { execFileSync('sqlite3', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

function execJson(dbPath, sql, timeoutMs, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    execFile('sqlite3', ['-json', `file:${dbPath}?mode=ro`, sql],
      { timeout: timeoutMs, maxBuffer },
      (err, stdout, stderr) => {
        if (err) {
          if (stderr) err.message += ': ' + String(stderr).trim().slice(0, 200);
          reject(err);
          return;
        }
        try { resolve(JSON.parse(stdout || '[]')); }
        catch (e) { e.message = 'sqlite JSON parse failed: ' + e.message; reject(e); }
      });
  });
}

// 只读查询 TaskDb；WAL 模式下使用 mode=ro，避免修改 SDK 数据库。
async function readTasks(dbPath, ids, timeoutMs = 5000) {
  const map = new Map();
  if (!ids.length || !hasSqlite) return map;
  const safeIds = ids.map(Number).filter(Number.isInteger);
  if (!safeIds.length) return map;
  const sql = `SELECT TaskId,Status,TotalReceiveSize,ResourceSize,FailureErrorCode,Name FROM TaskBase WHERE TaskId IN (${safeIds.join(',')})`;
  const out = await new Promise((resolve, reject) => {
    execFile('sqlite3', ['-json', `file:${dbPath}?mode=ro`, sql],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  for (const r of JSON.parse(out || '[]')) {
    map.set(r.TaskId, {
      status: r.Status,
      totalReceiveSize: r.TotalReceiveSize || 0,
      resourceSize: r.ResourceSize || 0,
      failureErrorCode: r.FailureErrorCode || 0,
      name: r.Name || null, // 引擎真实落盘名；NULL/空串 → null
    });
  }
  return map;
}

function normalizeHex(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).toUpperCase();
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeComparablePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^z:/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

// 查找 SDK 已持久化、但 host tasks.json 可能已经丢失映射的 BT 任务。
// 这是只读查询：InfoId 由 BtTask 表提供，TaskBase 提供任务状态/路径/进度。
// 不在这里删除或停止 native 任务，调用方必须显式决定是否复用。
async function readNativeBtTasks(dbPath, infoId, { savePath = null, taskName = null, timeoutMs = 5000 } = {}) {
  if (!hasSqlite || !dbPath) {
    const problem = new Error('TaskDb reader unavailable');
    problem.code = 'BT_NATIVE_STATE_UNAVAILABLE';
    throw problem;
  }
  if (infoId === null || infoId === undefined) return [];
  const normalizedInfoId = String(infoId).replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!normalizedInfoId || normalizedInfoId.length < 32) return [];
  const sql = `SELECT b.TaskId, t.Status, t.SavePath, t.Name, t.TotalReceiveSize, t.ResourceSize, t.FailureErrorCode ` +
    `FROM BtTask b JOIN TaskBase t ON t.TaskId = b.TaskId ` +
    `WHERE upper(hex(b.InfoId)) = ${sqlQuote(normalizedInfoId)} ` +
    `ORDER BY t.TotalReceiveSize DESC, b.TaskId ASC`;
  let rows;
  rows = await execJson(dbPath, sql, timeoutMs);
  const wantedPath = savePath === null ? null : normalizeComparablePath(savePath);
  const wantedName = taskName === null ? null : String(taskName);
  return rows.map((row) => ({
    engineId: Number(row.TaskId),
    status: numberOrZero(row.Status),
    savePath: row.SavePath || '',
    name: row.Name || '',
    totalReceiveSize: numberOrZero(row.TotalReceiveSize),
    resourceSize: numberOrZero(row.ResourceSize),
    failureErrorCode: numberOrZero(row.FailureErrorCode),
  })).filter((row) => {
    if (!Number.isSafeInteger(row.engineId) || row.engineId <= 0) return false;
    if (wantedPath !== null && normalizeComparablePath(row.savePath) !== wantedPath) return false;
    if (wantedName !== null && row.name !== wantedName) return false;
    return true;
  });
}

// VIP 专用只读快照。与 readTasks 分开，避免把 poller 的低成本查询和 BT 子文件 join 绑在一起。
async function readVipTasks(dbPath, ids, timeoutMs = 5000) {
  const map = new Map();
  if (!hasSqlite || !Array.isArray(ids) || !ids.length) return map;
  const safeIds = ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!safeIds.length) return map;
  const inList = safeIds.join(',');
  const baseSql = `SELECT TaskId,Type,Status,Url,Name,ResourceSize,` +
    `NULLIF(hex(Cid),'') AS CidHex,NULLIF(hex(Gcid),'') AS GcidHex,` +
    `VipReceiveSize,FreeDcdnReceiveSize,VipResourceEnableNecessary,Forbidden,` +
    `P2pReceiveSize,P2sReceiveSize,OriginReceiveSize ` +
    `FROM TaskBase WHERE TaskId IN (${inList})`;
  const baseRows = await execJson(dbPath, baseSql, timeoutMs);
  for (const row of baseRows) {
    map.set(Number(row.TaskId), {
      engineId: Number(row.TaskId),
      type: numberOrZero(row.Type),
      status: numberOrZero(row.Status),
      url: row.Url || '',
      name: row.Name || null,
      resourceSize: numberOrZero(row.ResourceSize),
      cid: normalizeHex(row.CidHex),
      gcid: normalizeHex(row.GcidHex),
      vipReceiveSize: numberOrZero(row.VipReceiveSize),
      freeDcdnReceiveSize: numberOrZero(row.FreeDcdnReceiveSize),
      vipResourceEnableNecessary: numberOrZero(row.VipResourceEnableNecessary),
      forbidden: numberOrZero(row.Forbidden),
      p2pReceiveSize: numberOrZero(row.P2pReceiveSize),
      p2sReceiveSize: numberOrZero(row.P2sReceiveSize),
      originReceiveSize: numberOrZero(row.OriginReceiveSize),
      btFiles: [],
    });
  }
  if (!map.size) return map;
  const fileSql = `SELECT BtTaskId,FileIndex,Download,FileName,FileSize,ReceivedSize,` +
    `NULLIF(hex(Cid),'') AS CidHex,NULLIF(hex(Gcid),'') AS GcidHex ` +
    `FROM BtFile WHERE BtTaskId IN (${inList}) ORDER BY BtTaskId,FileIndex`;
  let fileRows = [];
  try { fileRows = await execJson(dbPath, fileSql, timeoutMs); }
  catch (e) {
    // 老版本/磁力 metadata 窗口可能暂时没有 BtFile 表；TaskBase 快照仍然有价值。
    if (!/no such table/i.test(e.message || '')) throw e;
  }
  for (const row of fileRows) {
    const task = map.get(Number(row.BtTaskId));
    if (!task) continue;
    task.btFiles.push({
      fileIndex: numberOrZero(row.FileIndex),
      download: numberOrZero(row.Download),
      fileName: row.FileName || null,
      fileSize: numberOrZero(row.FileSize),
      receivedSize: numberOrZero(row.ReceivedSize),
      cid: normalizeHex(row.CidHex),
      gcid: normalizeHex(row.GcidHex),
    });
  }
  return map;
}

// ---- Windows native 模式：node:sqlite 只读直读 ----
// 与 CLI reader 行为对齐（同一组查询语义与降级路径），宿主内直读不再依赖外部命令。
// 查询 SQL 与上面 CLI 版共享常量，防两份漂移。
const TASKS_COLUMNS = 'TaskId,Status,TotalReceiveSize,ResourceSize,FailureErrorCode,Name';
const VIP_BASE_COLUMNS = 'TaskId,Type,Status,Url,Name,ResourceSize,' +
  "NULLIF(hex(Cid),'') AS CidHex,NULLIF(hex(Gcid),'') AS GcidHex," +
  'VipReceiveSize,FreeDcdnReceiveSize,VipResourceEnableNecessary,Forbidden,' +
  'P2pReceiveSize,P2sReceiveSize,OriginReceiveSize';
const VIP_FILE_COLUMNS = 'BtTaskId,FileIndex,Download,FileName,FileSize,ReceivedSize,' +
  "NULLIF(hex(Cid),'') AS CidHex,NULLIF(hex(Gcid),'') AS GcidHex";
const NATIVE_BT_SQL = 'SELECT b.TaskId, t.Status, t.SavePath, t.Name, t.TotalReceiveSize, t.ResourceSize, t.FailureErrorCode ' +
  'FROM BtTask b JOIN TaskBase t ON t.TaskId=b.TaskId WHERE upper(hex(b.InfoId)) = ? ' +
  'ORDER BY t.TotalReceiveSize DESC, b.TaskId ASC';

function createNodeSqliteTaskDbReader({ DatabaseSync } = {}) {
  // 显式传入 null 表示"无实现"（测试用）；undefined 时尝试 node:sqlite。
  const Sqlite = DatabaseSync === undefined ? (() => {
    try { return require('node:sqlite').DatabaseSync; } catch { return null; }
  })() : DatabaseSync;
  const available = Boolean(Sqlite);

  function open(dbPath) {
    if (!available) {
      const problem = new Error('node:sqlite unavailable');
      problem.code = 'TASKDB_READER_UNAVAILABLE';
      throw problem;
    }
    if (!dbPath) {
      const problem = new Error('TaskDb path is required');
      problem.code = 'BT_NATIVE_STATE_UNAVAILABLE';
      throw problem;
    }
    return new Sqlite(dbPath, { readOnly: true }); // 引擎持有写权，宿主只读快照
  }

  function withDatabase(dbPath, timeoutMs, fn) {
    let db;
    try { db = open(dbPath); }
    catch (e) {
      if (e.code === 'SQLITE_CANTOPEN' || /unable to open/i.test(e.message || '')) return null; // TaskDb 尚未建库
      throw e;
    }
    try {
      db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.min(timeoutMs || 5000, 30000))}`);
      return fn(db);
    } finally { try { db.close(); } catch {} }
  }

  async function readTasks(dbPath, ids, timeoutMs = 5000) {
    const map = new Map();
    const selected = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!selected.length) return map;
    const rows = withDatabase(dbPath, timeoutMs, (db) =>
      db.prepare(`SELECT ${TASKS_COLUMNS} FROM TaskBase WHERE TaskId IN (${selected.map(() => '?').join(',')})`).all(...selected)) || [];
    for (const row of rows) {
      const id = Number(row.TaskId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      map.set(id, {
        status: numberOrZero(row.Status),
        totalReceiveSize: numberOrZero(row.TotalReceiveSize),
        resourceSize: numberOrZero(row.ResourceSize),
        failureErrorCode: numberOrZero(row.FailureErrorCode),
        name: row.Name || null, // 引擎真实落盘名；NULL/空串 → null
      });
    }
    return map;
  }

  async function readVipTasks(dbPath, ids, timeoutMs = 5000) {
    const map = new Map();
    const selected = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (!selected.length) return map;
    const baseRows = withDatabase(dbPath, timeoutMs, (db) =>
      db.prepare(`SELECT ${VIP_BASE_COLUMNS} FROM TaskBase WHERE TaskId IN (${selected.map(() => '?').join(',')})`).all(...selected)) || [];
    for (const row of baseRows) {
      map.set(Number(row.TaskId), {
        engineId: Number(row.TaskId),
        type: numberOrZero(row.Type),
        status: numberOrZero(row.Status),
        url: row.Url || '',
        name: row.Name || null,
        resourceSize: numberOrZero(row.ResourceSize),
        cid: normalizeHex(row.CidHex),
        gcid: normalizeHex(row.GcidHex),
        vipReceiveSize: numberOrZero(row.VipReceiveSize),
        freeDcdnReceiveSize: numberOrZero(row.FreeDcdnReceiveSize),
        vipResourceEnableNecessary: numberOrZero(row.VipResourceEnableNecessary),
        forbidden: numberOrZero(row.Forbidden),
        p2pReceiveSize: numberOrZero(row.P2pReceiveSize),
        p2sReceiveSize: numberOrZero(row.P2sReceiveSize),
        originReceiveSize: numberOrZero(row.OriginReceiveSize),
        btFiles: [],
      });
    }
    if (!map.size) return map;
    let fileRows = [];
    try {
      fileRows = withDatabase(dbPath, timeoutMs, (db) =>
        db.prepare(`SELECT ${VIP_FILE_COLUMNS} FROM BtFile WHERE BtTaskId IN (${selected.map(() => '?').join(',')}) ORDER BY BtTaskId,FileIndex`).all(...selected)) || [];
    } catch (e) {
      // 老版本/磁力 metadata 窗口可能暂时没有 BtFile 表；TaskBase 快照仍然有价值。
      if (!/no such table/i.test(e.message || '')) throw e;
    }
    for (const row of fileRows) {
      const task = map.get(Number(row.BtTaskId));
      if (!task) continue;
      task.btFiles.push({
        fileIndex: numberOrZero(row.FileIndex),
        download: numberOrZero(row.Download),
        fileName: row.FileName || null,
        fileSize: numberOrZero(row.FileSize),
        receivedSize: numberOrZero(row.ReceivedSize),
        cid: normalizeHex(row.CidHex),
        gcid: normalizeHex(row.GcidHex),
      });
    }
    return map;
  }

  async function readNativeBtTasks(dbPath, infoId, { savePath = null, taskName = null, timeoutMs = 5000 } = {}) {
    if (!dbPath) {
      const problem = new Error('TaskDb reader unavailable');
      problem.code = 'BT_NATIVE_STATE_UNAVAILABLE';
      throw problem;
    }
    if (infoId === null || infoId === undefined) return [];
    const normalizedInfoId = String(infoId).replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (!normalizedInfoId || normalizedInfoId.length < 32) return [];
    const wantedPath = savePath === null ? null : normalizeComparablePath(savePath);
    const wantedName = taskName === null ? null : String(taskName);
    const rows = withDatabase(dbPath, timeoutMs, (db) => db.prepare(NATIVE_BT_SQL).all(normalizedInfoId)) || [];
    return rows.map((row) => ({
      engineId: Number(row.TaskId),
      status: numberOrZero(row.Status),
      savePath: row.SavePath || '',
      name: row.Name || '',
      totalReceiveSize: numberOrZero(row.TotalReceiveSize),
      resourceSize: numberOrZero(row.ResourceSize),
      failureErrorCode: numberOrZero(row.FailureErrorCode),
    })).filter((row) => {
      if (!Number.isSafeInteger(row.engineId) || row.engineId <= 0) return false;
      if (wantedPath !== null && normalizeComparablePath(row.savePath) !== wantedPath) return false;
      if (wantedName !== null && row.name !== wantedName) return false;
      return true;
    });
  }

  return { available, readTasks, readVipTasks, readNativeBtTasks };
}

module.exports = { readTasks, readVipTasks, readNativeBtTasks, hasSqlite, createNodeSqliteTaskDbReader };
