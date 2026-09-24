'use strict';

// Read-only long-running monitor for the Ubuntu BT sample.  It deliberately
// uses the public daemon RPC plus a read-only SQLite connection and never
// starts, pauses, deletes, or changes VIP state on its own.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.resolve(process.env.THUNDERD_RUNTIME_DIR || path.join(repoRoot, 'daemon', '.runtime'));
const monitorDir = path.join(runtimeDir, 'monitor');
const logPath = path.join(monitorDir, 'ubuntu-vip.ndjson');
const lockPath = path.join(monitorDir, 'ubuntu-vip.lock');
const taskDbPath = path.join(runtimeDir, 'profile', 'TaskDb.dat');
const tasksJsonPath = path.join(runtimeDir, 'data', 'tasks.json');
const rpcPort = Number(process.env.THUNDERD_PORT || 16800);
const intervalMs = Math.min(Math.max(Number(process.env.THUNDERD_MONITOR_INTERVAL_MS) || 10000, 2000), 300000);
const sampleName = String(process.env.THUNDERD_MONITOR_SAMPLE_NAME || 'ubuntu-26.04-desktop-amd64.iso').trim();

let lockFd = null;
let stopping = false;
let previous = null;

function now() { return new Date().toISOString(); }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function acquireLock() {
  fs.mkdirSync(monitorDir, { recursive: true, mode: 0o700 });
  try {
    lockFd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeSync(lockFd, `${process.pid}\n`);
    return true;
  } catch {
    try {
      const oldPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (Number.isSafeInteger(oldPid) && oldPid > 0) {
        try { process.kill(oldPid, 0); return false; } catch {}
      }
      fs.unlinkSync(lockPath);
      lockFd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(lockFd, `${process.pid}\n`);
      return true;
    } catch { return false; }
  }
}

function releaseLock() {
  if (lockFd !== null) { try { fs.closeSync(lockFd); } catch {} lockFd = null; }
  try {
    if (Number(fs.readFileSync(lockPath, 'utf8').trim()) === process.pid) fs.unlinkSync(lockPath);
  } catch {}
}

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: rpcPort, path: '/jsonrpc', method: 'POST',
      timeout: Math.min(Math.max(intervalMs - 500, 1500), 15000),
      headers: { 'content-type': 'application/json' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (payload.error) {
            const error = new Error(payload.error.message || 'RPC failed');
            error.code = payload.error.code;
            error.details = payload.error.details;
            reject(error);
            return;
          }
          resolve(payload.result);
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('RPC timeout')));
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }));
  });
}

function readNativeRows() {
  return new Promise((resolve) => {
    const sql = `SELECT TaskId,Status,FailureErrorCode,TotalReceiveSize,ResourceSize,` +
      `VipReceiveSize,FreeDcdnReceiveSize,Name FROM TaskBase ` +
      `WHERE Name LIKE '${sampleName.replace(/'/g, "''")}%' ` +
      `ORDER BY TotalReceiveSize DESC, TaskId ASC`;
    execFile('sqlite3', ['-json', `file:${taskDbPath}?mode=ro`, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) { resolve({ ok: false, error: String(error.message || error).slice(0, 240), rows: [] }); return; }
      try { resolve({ ok: true, rows: JSON.parse(stdout || '[]') }); }
      catch (cause) { resolve({ ok: false, error: `sqlite JSON parse failed: ${cause.message}`, rows: [] }); }
    });
  });
}

function chooseTask(result) {
  const items = Array.isArray(result && result.items) ? result.items : [];
  return items.find((item) => item && item.displayName === sampleName) || items.find((item) => item && String(item.displayName || '').startsWith(sampleName)) || null;
}

function readHostRecord(taskId) {
  if (!taskId) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf8'));
    return Array.isArray(payload && payload.tasks)
      ? payload.tasks.find((item) => item && String(item.id) === String(taskId)) || null
      : null;
  } catch { return null; }
}

function chooseNativeRow(rows, hostRecord) {
  const list = Array.isArray(rows) ? rows : [];
  const engineId = hostRecord && Number(hostRecord.engineId);
  if (Number.isSafeInteger(engineId) && engineId > 0) {
    const related = list.find((row) => Number(row.TaskId) === engineId);
    if (related) return related;
  }
  // If the host record is absent after a crash, prefer a live, non-failed
  // native row over a completed historical duplicate.
  return list.find((row) => [5, 7].includes(numeric(row.Status)) && numeric(row.FailureErrorCode) === 0) || list[0] || null;
}

function delta(current, key) {
  if (!previous || !previous[key]) return 0;
  return Math.max(0, numeric(current) - numeric(previous[key]));
}

function verdict({ daemon, task, vip, globalVip, native }) {
  if (!daemon) return 'daemon-unavailable';
  if (!task) return 'task-not-found';
  if (task.error) return 'task-failed';
  if (native.row && numeric(native.row.FailureErrorCode) !== 0) return `native-failed-${native.row.FailureErrorCode}`;
  if (['completed', 'failed', 'recycled', 'missing'].includes(task.lifecycle)) {
    return task.lifecycle === 'completed' && vip && vip.state === 'disabled' ? 'terminal-ok' : `terminal-${task.lifecycle}`;
  }
  if (!globalVip || globalVip.availability !== 'available') return `vip-unavailable-${globalVip && globalVip.availability || 'unknown'}`;
  if (!vip || vip.availability !== 'available') return `vip-unavailable-${vip && vip.availability || 'unknown'}`;
  if (vip.state === 'effective' || numeric(vip.vipReceivedBytes) > 0) return 'effective';
  if (['requesting', 'injected', 'backoff', 'waiting', 'waiting-metadata', 'waiting-peer-id'].includes(vip.state)) return `in-progress-${vip.state}`;
  return `not-effective-${vip.state || 'unknown'}`;
}

async function sample() {
  const native = await readNativeRows();
  let bootstrap = null;
  let globalVip = null;
  let task = null;
  let vip = null;
  let daemonError = null;
  try {
    bootstrap = await rpc('thunder.ui.v2.bootstrap', [{}]);
    globalVip = await rpc('thunder.ui.v2.vip.getGlobalState', [{}]);
    const queried = await rpc('thunder.ui.v2.tasks.query', [{ search: sampleName, limit: 50 }]);
    task = chooseTask(queried);
    if (task) vip = await rpc('thunder.ui.v2.vip.getTaskState', [{ taskId: task.taskId }]);
  } catch (error) { daemonError = { code: error.code || 'RPC_ERROR', message: String(error.message || error).slice(0, 240) }; }

  const hostRecord = readHostRecord(task && task.taskId);
  const nativeRow = chooseNativeRow(native.rows, hostRecord);
  const record = {
    at: now(),
    verdict: verdict({ daemon: !daemonError && Boolean(bootstrap), task, vip, globalVip, native: { rows: native.rows, row: nativeRow } }),
    daemon: daemonError ? { ok: false, error: daemonError } : {
      ok: true,
      sdkReady: Boolean(bootstrap && bootstrap.engine && bootstrap.engine.sdkReady),
      enginePid: bootstrap && bootstrap.engine && bootstrap.engine.enginePid || null,
      queue: bootstrap && bootstrap.engine && numeric(bootstrap.engine.queue),
      accountReady: Boolean(bootstrap && bootstrap.account && bootstrap.account.valid),
      isVip: Boolean(bootstrap && bootstrap.account && bootstrap.account.isVip),
      peerIdReady: globalVip ? globalVip.peerIdReady === true : null,
    },
    acceleration: globalVip ? {
      enabled: globalVip.enabled === true,
      availability: globalVip.availability,
      accountReady: globalVip.accountReady === true,
      isVip: globalVip.isVip === true,
      peerIdReady: globalVip.peerIdReady === true,
      featureCapabilities: globalVip.featureCapabilities || {},
    } : null,
    task: task ? {
      taskId: task.taskId,
      lifecycle: task.lifecycle,
      completedBytes: numeric(task.completedBytes),
      totalBytes: numeric(task.totalBytes),
      speed: numeric(task.downloadBytesPerSecond),
      error: task.error || null,
    } : null,
    vip: vip ? {
      availability: vip.availability,
      state: vip.state,
      enabled: vip.enabled !== false,
      vipReceivedBytes: numeric(vip.vipReceivedBytes),
      freeDcdnReceivedBytes: numeric(vip.freeDcdnReceivedBytes),
      problemCode: vip.problemCode || null,
    } : null,
    native: {
      dbReadable: native.ok,
      dbError: native.error || null,
      taskId: nativeRow ? numeric(nativeRow.TaskId) : null,
      status: nativeRow ? numeric(nativeRow.Status) : null,
      failureErrorCode: nativeRow ? numeric(nativeRow.FailureErrorCode) : null,
      totalReceiveSize: nativeRow ? numeric(nativeRow.TotalReceiveSize) : 0,
      resourceSize: nativeRow ? numeric(nativeRow.ResourceSize) : 0,
      vipReceiveSize: nativeRow ? numeric(nativeRow.VipReceiveSize) : 0,
      freeDcdnReceiveSize: nativeRow ? numeric(nativeRow.FreeDcdnReceiveSize) : 0,
      relatedToHostTask: Boolean(hostRecord && nativeRow && Number(hostRecord.engineId) === Number(nativeRow.TaskId)),
      duplicateRows: native.rows.length,
    },
    delta: {
      taskBytes: task ? delta(task.completedBytes, 'taskBytes') : 0,
      vipBytes: vip ? delta(vip.vipReceivedBytes, 'vipBytes') : 0,
      freeDcdnBytes: vip ? delta(vip.freeDcdnReceivedBytes, 'freeDcdnBytes') : 0,
      nativeBytes: nativeRow ? delta(nativeRow.TotalReceiveSize, 'nativeBytes') : 0,
    },
  };
  previous = {
    taskBytes: record.task && record.task.completedBytes,
    vipBytes: record.vip && record.vip.vipReceivedBytes,
    freeDcdnBytes: record.vip && record.vip.freeDcdnReceivedBytes,
    nativeBytes: record.native.totalReceiveSize,
  };
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 8 * 1024 * 1024) fs.renameSync(logPath, `${logPath}.1`);
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {}
  const progress = record.task ? `${Math.round(record.task.completedBytes / Math.max(record.task.totalBytes, 1) * 100)}%` : '-';
  console.log(`[ubuntu-vip] ${record.at} verdict=${record.verdict} task=${record.task ? record.task.lifecycle : '-'} progress=${progress} vip=${record.vip ? record.vip.state : '-'} vipBytes=${record.vip ? record.vip.vipReceivedBytes : '-'} nativeError=${record.native.failureErrorCode || 0}`);
  return record;
}

async function main() {
  if (!acquireLock()) { console.error(`[ubuntu-vip] monitor already running: ${lockPath}`); process.exitCode = 2; return; }
  console.log(`[ubuntu-vip] monitoring ${sampleName} every ${intervalMs}ms; log=${logPath}`);
  try {
    while (!stopping) {
      await sample().catch((error) => console.error('[ubuntu-vip] sample failed:', error.message));
      if (!stopping) await sleep(intervalMs);
    }
  } finally { releaseLock(); }
}

function stop() { stopping = true; }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
main().catch((error) => { console.error('[ubuntu-vip] fatal:', error.message); releaseLock(); process.exitCode = 1; });
