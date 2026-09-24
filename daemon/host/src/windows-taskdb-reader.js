'use strict';

const { execFile } = require('node:child_process');
const { linuxToWindowsPath, normalizeComparableEnginePath } = require('./windows-path');

const PYTHON_QUERY = String.raw`
import json
import sqlite3
import sys

db_path, mode, payload_text = sys.argv[1], sys.argv[2], sys.argv[3]
payload = json.loads(payload_text)
connection = sqlite3.connect('file:' + db_path + '?mode=ro', uri=True, timeout=3.0)
connection.row_factory = sqlite3.Row

def rows(sql, values=()):
    return [dict(row) for row in connection.execute(sql, values).fetchall()]

if mode == 'tasks':
    ids = [int(value) for value in payload.get('ids', [])]
    placeholders = ','.join('?' for _ in ids)
    result = rows('SELECT TaskId,Status,TotalReceiveSize,ResourceSize,FailureErrorCode,Name FROM TaskBase WHERE TaskId IN (' + placeholders + ')', ids) if ids else []
    print(json.dumps({'rows': result}))
elif mode == 'vip':
    ids = [int(value) for value in payload.get('ids', [])]
    placeholders = ','.join('?' for _ in ids)
    if not ids:
        print(json.dumps({'base': [], 'files': []}))
    else:
        base = rows('SELECT TaskId,Type,Status,Url,Name,ResourceSize,NULLIF(hex(Cid),\'\') AS CidHex,NULLIF(hex(Gcid),\'\') AS GcidHex,VipReceiveSize,FreeDcdnReceiveSize,VipResourceEnableNecessary,Forbidden FROM TaskBase WHERE TaskId IN (' + placeholders + ')', ids)
        try:
            files = rows('SELECT BtTaskId,FileIndex,Download,FileName,FileSize,NULLIF(hex(Cid),\'\') AS CidHex,NULLIF(hex(Gcid),\'\') AS GcidHex FROM BtFile WHERE BtTaskId IN (' + placeholders + ') ORDER BY BtTaskId,FileIndex', ids)
        except sqlite3.OperationalError as error:
            if 'no such table' not in str(error).lower():
                raise
            files = []
        print(json.dumps({'base': base, 'files': files}))
elif mode == 'native-bt':
    info_id = str(payload.get('infoId', '')).upper()
    result = rows('SELECT b.TaskId,t.Status,t.SavePath,t.Name,t.TotalReceiveSize,t.ResourceSize,t.FailureErrorCode FROM BtTask b JOIN TaskBase t ON t.TaskId=b.TaskId WHERE upper(hex(b.InfoId))=? ORDER BY t.TotalReceiveSize DESC,b.TaskId ASC', (info_id,))
    print(json.dumps({'rows': result}))
else:
    raise ValueError('unsupported query mode')
`;

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeHex(value) {
  return value === null || value === undefined || value === '' ? null : String(value).toUpperCase();
}

function safeIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function createWindowsTaskDbReader({ pythonExe, distroName, execFileImpl = execFile, timeoutMs = 5000 } = {}) {
  if (!pythonExe) throw new Error('Windows Python executable is required');

  function query(dbPath, mode, payload, callTimeoutMs = timeoutMs) {
    return new Promise((resolve, reject) => {
      const dbWindowsPath = linuxToWindowsPath(dbPath, { distroName });
      execFileImpl(pythonExe, ['-c', PYTHON_QUERY, dbWindowsPath, mode, JSON.stringify(payload)], {
        cwd: '/mnt/c/Windows',
        env: { PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
        timeout: callTimeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout) => {
        if (error) {
          const failure = new Error('Windows TaskDb query failed');
          failure.code = error.killed ? 'WINDOWS_TASKDB_TIMEOUT' : 'WINDOWS_TASKDB_QUERY_FAILED';
          reject(failure);
          return;
        }
        try { resolve(JSON.parse(String(stdout || '{}').trim() || '{}')); }
        catch {
          const failure = new Error('Windows TaskDb query returned invalid JSON');
          failure.code = 'WINDOWS_TASKDB_INVALID_JSON';
          reject(failure);
        }
      });
    });
  }

  async function readTasks(dbPath, ids, callTimeoutMs = timeoutMs) {
    const map = new Map();
    const selected = safeIds(ids);
    if (!selected.length) return map;
    const result = await query(dbPath, 'tasks', { ids: selected }, callTimeoutMs);
    for (const row of result.rows || []) {
      const id = Number(row.TaskId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      map.set(id, {
        status: numberOrZero(row.Status),
        totalReceiveSize: numberOrZero(row.TotalReceiveSize),
        resourceSize: numberOrZero(row.ResourceSize),
        failureErrorCode: numberOrZero(row.FailureErrorCode),
        name: row.Name || null,
      });
    }
    return map;
  }

  async function readVipTasks(dbPath, ids, callTimeoutMs = timeoutMs) {
    const map = new Map();
    const selected = safeIds(ids);
    if (!selected.length) return map;
    const result = await query(dbPath, 'vip', { ids: selected }, callTimeoutMs);
    for (const row of result.base || []) {
      const id = Number(row.TaskId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      map.set(id, {
        engineId: id,
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
    for (const row of result.files || []) {
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

  async function readNativeBtTasks(dbPath, infoId, { savePath = null, taskName = null, timeoutMs: callTimeoutMs = timeoutMs } = {}) {
    const normalizedInfoId = String(infoId || '').replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (normalizedInfoId.length < 32) return [];
    const result = await query(dbPath, 'native-bt', { infoId: normalizedInfoId }, callTimeoutMs);
    const wantedPath = savePath === null ? null : normalizeComparableEnginePath(savePath);
    const wantedName = taskName === null ? null : String(taskName);
    return (result.rows || []).map((row) => ({
      engineId: Number(row.TaskId),
      status: numberOrZero(row.Status),
      savePath: row.SavePath || '',
      name: row.Name || '',
      totalReceiveSize: numberOrZero(row.TotalReceiveSize),
      resourceSize: numberOrZero(row.ResourceSize),
      failureErrorCode: numberOrZero(row.FailureErrorCode),
    })).filter((row) => {
      if (!Number.isSafeInteger(row.engineId) || row.engineId <= 0) return false;
      if (wantedPath !== null && normalizeComparableEnginePath(row.savePath) !== wantedPath) return false;
      if (wantedName !== null && row.name !== wantedName) return false;
      return true;
    });
  }

  return { query, readTasks, readVipTasks, readNativeBtTasks };
}

module.exports = { createWindowsTaskDbReader, PYTHON_QUERY, safeIds };
