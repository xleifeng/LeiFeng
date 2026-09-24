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
    `VipReceiveSize,FreeDcdnReceiveSize,VipResourceEnableNecessary,Forbidden ` +
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
      btFiles: [],
    });
  }
  if (!map.size) return map;
  const fileSql = `SELECT BtTaskId,FileIndex,Download,FileName,FileSize,` +
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
      cid: normalizeHex(row.CidHex),
      gcid: normalizeHex(row.GcidHex),
    });
  }
  return map;
}

module.exports = { readTasks, readVipTasks, readNativeBtTasks, hasSqlite };
