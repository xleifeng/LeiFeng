'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OperationLock } = require('./operation-lock');
const { selectTorrentRelativePath } = require('./torrent-path');
const { sourceFingerprint } = require('../repositories/task-repository');
const { mapNativeError } = require('../domain/task-errors');
const { normalizeTorrentHash, parseFtp } = require('../domain/protocol-parser');
const { buildNativeBtInfo } = require('../domain/native-bt-info');
const { normalizeComparableEnginePath } = require('../windows-path');

function error(code, message, details) { const value = new Error(message); value.code = code; value.details = details; return value; }

function safeTaskName(value, fallback = 'download.bin') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const name = path.basename(value.trim().replace(/\\/g, '/'));
  return !name || name === '.' || name === '..' || name.includes('\0') ? fallback : name;
}

function defaultTaskName(source) {
  try { return decodeURIComponent(new URL(source).pathname.split('/').filter(Boolean).pop() || '') || 'download.bin'; }
  catch { return 'download.bin'; }
}

function resolveCollision(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}.${i}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return `${stem}.${Date.now()}${ext}`;
}

function normalizeIndices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))].sort((a, b) => a - b);
}

function fetchContentLength(url, timeoutMs = 5000) {
  if (!url) return Promise.resolve(0);
  return new Promise((resolve) => {
    let request;
    try {
      const client = new URL(url).protocol === 'https:' ? require('https') : require('http');
      request = client.request(url, { method: 'HEAD', timeout: timeoutMs }, (response) => {
        response.resume();
        const length = Number(response.headers['content-length'] || 0);
        resolve(response.statusCode >= 200 && response.statusCode < 400 && length > 0 ? length : 0);
      });
      request.on('timeout', () => { request.destroy(); resolve(0); });
      request.on('error', () => resolve(0));
      request.end();
    } catch { resolve(0); }
  });
}

function materializeTorrent(input, runtimeDir) {
  if (typeof input !== 'string' || !input) throw error('INVALID_ARGUMENT', 'torrentInput 不能为空');
  const maybe = input.startsWith('file://') ? input.slice(7) : input;
  if (fs.existsSync(maybe)) return { path: maybe, temporary: false };
  const normalized = maybe.replace(/-/g, '+').replace(/_/g, '/');
  let bytes;
  try { bytes = Buffer.from(normalized, 'base64'); } catch { bytes = null; }
  if (!bytes || !bytes.length || bytes[0] !== 0x64) throw error('INVALID_TORRENT', 'torrent 文件或 base64 无效');
  const dir = fs.mkdtempSync(path.join(runtimeDir || path.join(process.cwd(), '.torrent-cache'), 'torrent-upload-'));
  const file = path.join(dir, 'upload.torrent');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return { path: file, temporary: true };
}

function removeTemporary(materialized) {
  if (!materialized || !materialized.temporary) return;
  try { fs.rmSync(path.dirname(materialized.path), { recursive: true, force: true }); } catch {}
}

// 引擎侧 Wine 路径 → 本机 Linux 路径（保留大小写；existsSync 必须用这个，
// normalizeComparableEnginePath 为比较而小写化，直接喂给 fs 会误判目录不存在）。
function engineSavePathToLinux(value) {
  let s = String(value || '').replace(/\\/g, '/');
  s = s.replace(/^\/{1,2}wsl(?:\.localhost|\$)\/[^/]+/, '');
  const z = s.match(/^z:\/(.*)$/i);
  if (z) return '/' + z[1];
  const drive = s.match(/^([a-z]):\/(.*)$/i);
  if (drive) return '/mnt/' + drive[1].toLowerCase() + '/' + drive[2];
  return s && s.startsWith('/') ? s : null;
}

function hasNativePartialData(targetDir, taskName) {
  const root = path.join(targetDir, taskName);
  const stack = [{ value: root, depth: 0 }, { value: `${root}.xltd`, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < 256) {
    const current = stack.pop(); visited += 1;
    let stat;
    try { stat = fs.statSync(current.value); } catch { continue; }
    if (stat.isFile()) {
      // SDK partial files use .xltd; a regular target file is also valid.
      // Ignore the portable seed and SDK sidecar/config files that may be
      // placed beside a task by upload/recovery flows.
      const base = path.basename(current.value).toLowerCase();
      if (!base.endsWith('.torrent') && !base.endsWith('.xlbt.cfg') && stat.size > 0) return true;
      continue;
    }
    if (!stat.isDirectory() || current.depth >= 3) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.value, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      stack.push({ value: path.join(current.value, entry.name), depth: current.depth + 1 });
    }
  }
  return false;
}

class CreateTaskService {
  constructor({ tasks, driver, settings = null, httpProbe = fetchContentLength, seedStore = null, ftpSecrets = null, operationLock = new OperationLock(), clock = Date, runtimeDir = null, magnetTimeoutSec = 120, taskDbPath = null, readNativeBtTasks = null } = {}) {
    if (!tasks || !driver) throw new Error('CreateTaskService tasks and driver are required');
    this.tasks = tasks;
    this.driver = driver;
    this.settings = settings;
    this.httpProbe = httpProbe;
    this.seedStore = seedStore;
    this.ftpSecrets = ftpSecrets;
    this.operationLock = operationLock;
    this.clock = clock;
    this.runtimeDir = runtimeDir;
    this.magnetTimeoutSec = Math.min(600, Math.max(30, Number(magnetTimeoutSec) || 120));
    this.taskDbPath = taskDbPath;
    this.readNativeBtTasks = typeof readNativeBtTasks === 'function' ? readNativeBtTasks : null;
  }

  _savePath(savePath) {
    const value = path.resolve(savePath || (this.settings && this.settings.get().desired.downloadDir) || process.cwd());
    fs.mkdirSync(value, { recursive: true });
    return value;
  }

  _validateName(name) {
    if (name === undefined) return;
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.includes('..')) throw error('INVALID_ARGUMENT', '文件名无效');
  }

  async createUriCompat({ source, savePath, displayName, selectedFileIndices = [], options = {}, allowDuplicate = false, sourceFingerprintOverride = null, taskKindOverride = null } = {}) {
    if (typeof source !== 'string' || !source) throw error('INVALID_ARGUMENT', 'source 不能为空');
    const pastedHash = normalizeTorrentHash(source);
    if (pastedHash) {
      return this.createMagnetCompat({ source: `magnet:?xt=urn:btih:${pastedHash}`, savePath, displayName, selectedFileIndices, options, allowDuplicate });
    }
    let realSource = source;
    let ftpSecretRef = options.ftpSecretRef || null;
    let createdFtpSecret = false;
    let ftpAuth = null;
    const isFtpInput = /^ftp:\/\//i.test(source);
    if (isFtpInput) {
      const parsedFtp = parseFtp(source);
      realSource = parsedFtp.normalizedSource;
      ftpAuth = parsedFtp.ftpAuth;
    }
    const targetDir = this._savePath(savePath);
    this._validateName(displayName);
    const isHttp = /^https?:\/\//i.test(realSource);
    const isFtp = /^ftp:\/\//i.test(realSource);
    const isEd2k = /^ed2k:\/\//i.test(realSource);
    const isThunder = /^thunder:\/\//i.test(realSource);
    if (/^magnet:\?/i.test(source)) return this.createMagnetCompat({ source, savePath: targetDir, displayName, selectedFileIndices, options });
    if (!isHttp && !isFtp && !isEd2k && !isThunder) throw error('UNSUPPORTED_PROTOCOL', '仅支持 http/https/ftp/magnet/ed2k/thunder');
    if (ftpAuth && !ftpSecretRef) {
      if (!this.ftpSecrets) throw error('FTP_SECRET_STORE_UNAVAILABLE', 'FTP 凭据存储不可用');
      ftpSecretRef = this.ftpSecrets.set(ftpAuth);
      createdFtpSecret = true;
    }
    return this.operationLock.run(`create:${realSource}:${targetDir}:${displayName || ''}`, async () => {
      let taskType = isEd2k ? 3 : 1;
      let kind = isEd2k ? 'ed2k' : isFtp ? 'ftp' : /^https:/i.test(realSource) ? 'https' : 'http';
      let parsed = null;
      let persisted = false;
      try {
      if (isThunder) {
        const resolved = await this.driver.resolveThunderUrl(source);
        realSource = resolved.resolvedUrl || source;
        taskType = Number(resolved.taskType) || 1;
        if (taskType === 5 || /^magnet:/i.test(realSource)) return this.createMagnetCompat({ source: realSource, savePath: targetDir, displayName, selectedFileIndices, options });
        if (/^ftp:\/\//i.test(realSource)) {
          const resolvedFtp = parseFtp(realSource);
          realSource = resolvedFtp.normalizedSource;
          kind = 'ftp';
          if (resolvedFtp.ftpAuth && !ftpSecretRef) {
            if (!this.ftpSecrets) throw error('FTP_SECRET_STORE_UNAVAILABLE', 'FTP 凭据存储不可用');
            ftpSecretRef = this.ftpSecrets.set(resolvedFtp.ftpAuth);
            createdFtpSecret = true;
          }
        } else kind = taskType === 3 ? 'ed2k' : /^https:/i.test(realSource) ? 'https' : 'http';
      }
      if (taskType === 3) {
        parsed = await this.driver.parseTaskInfo({ kind: 'ed2k', data: realSource });
        kind = 'ed2k';
      }
      const fingerprint = sourceFingerprint(kind, realSource, parsed ? { infoId: parsed.fileHash } : {});
      const duplicate = allowDuplicate ? null : this.tasks.findDuplicate(fingerprint, targetDir);
      if (duplicate) { if (createdFtpSecret) this.ftpSecrets?.delete?.(ftpSecretRef); return duplicate.id; }
      const name = safeTaskName(displayName || (parsed && parsed.fileName) || defaultTaskName(realSource));
      const taskName = options.allowExistingTarget === true ? name : resolveCollision(targetDir, name);
      const totalBytes = taskType === 3 ? Number(parsed && parsed.fileSize) || 0 : kind === 'ftp' ? 0 : await this.httpProbe(realSource);
      const ftpSecret = ftpSecretRef ? this.ftpSecrets?.get?.(ftpSecretRef) : null;
      if (ftpSecretRef && !ftpSecret) throw error('FTP_SECRET_MISSING', 'FTP 凭据已失效，请重新添加链接');
      const info = taskType === 3 ? { url: realSource } : { url: realSource, refUrl: '', useOriginResourceOnly: false, originResourceThreadCount: 5, loginFtp: kind === 'ftp' && !!ftpSecret, ftpUserName: ftpSecret ? ftpSecret.username : '', ftpPassword: ftpSecret ? ftpSecret.password : '', origin: 'thunderd' };
      const engineId = await this.driver.createTask({ taskType, savePath: targetDir, taskName, info });
      const storedSource = kind === 'ftp' ? realSource : options.sourceOverride === undefined ? realSource : options.sourceOverride;
      const task = this.tasks.create({ source: storedSource, savePath: targetDir, displayName: taskName, totalBytes, engineId, kind: taskKindOverride || kind, sourceFingerprint: sourceFingerprintOverride || fingerprint, selectedFileIndices: normalizeIndices(selectedFileIndices), lifecycle: 'preparing', legacy: { ...(options && options.legacy ? options.legacy : {}), ...(ftpSecretRef ? { ftpSecretRef } : {}) } });
      persisted = true;
      try {
        if (options.startMode === 'queued') return this.tasks.mutate(task.id, { expectedRevision: task.revision, reason: 'create-queued' }, { lifecycle: 'queued' }).id;
        await this.driver.startTasks([engineId]);
        return this.tasks.mutate(task.id, { expectedRevision: task.revision, reason: 'create-start' }, { lifecycle: 'queued' }).id;
      } catch (cause) {
        await this.driver.deleteTasks([engineId]).catch(() => {});
        this.tasks.mutate(task.id, { reason: 'start-failed' }, { lifecycle: 'failed', error: mapNativeError(cause.message, { code: 'START_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }) });
        throw error('START_FAILED', `任务已创建但启动失败: ${cause.message}`);
      }
      } catch (cause) {
        if (createdFtpSecret && !persisted) this.ftpSecrets?.delete?.(ftpSecretRef);
        throw cause;
      }
    });
  }

  async createTorrentCompat({ torrentInput, savePath, displayName, selectedFileIndices = [], options = {}, allowDuplicate = false, source = null, sourceFingerprintOverride = null, taskKindOverride = 'bt' } = {}) {
    const targetDir = this._savePath(savePath);
    this._validateName(displayName);
    const materialized = materializeTorrent(torrentInput, this.runtimeDir);
    try {
      return await this.operationLock.run(`create:torrent:${materialized.path}:${targetDir}`, async () => {
        const parsed = await this.driver.parseTaskInfo({ kind: 'torrent', data: materialized.path });
        return this.operationLock.run(`create:bt:${String(parsed.infoId || '').toUpperCase()}`, async () => {
        const fingerprint = sourceFingerprint('bt', parsed.infoId || '', { infoId: parsed.infoId });
        const duplicate = allowDuplicate ? null : this.tasks.findDuplicate(sourceFingerprintOverride || fingerprint, targetDir);
        if (duplicate) return duplicate.id;
        const allIndices = normalizeIndices((parsed.fileLists || []).map((file) => file.realIndex));
        const selected = normalizeIndices(selectedFileIndices).filter((index) => allIndices.includes(index));
        const indices = selected.length ? selected : allIndices;
        const requestedName = safeTaskName(displayName || parsed.title || path.basename(materialized.path));
        const seedRef = this.seedStore && typeof this.seedStore.importFile === 'function' ? this.seedStore.importFile(materialized.path) : materialized.path;

        // A daemon restart can leave a valid BT row in the SDK TaskDb while
        // tasks.json has already marked the old host record failed/recycled.
        // Creating another native BT task for the same InfoId/path/name is
        // unsafe: the SDK then runs duplicate writers and one commonly ends
        // in FailureErrorCode=8. Reuse the most progressed active native row
        // instead of creating a third task. The reader is deliberately
        // injected so unit tests and deployments without sqlite keep the old
        // create path unchanged.
        if (this.readNativeBtTasks && this.taskDbPath) {
          let nativeMatches;
          try {
            // Match the requested native name before filesystem collision
            // suffixing. A previous redownload may have left only the seed
            // directory on disk, which would otherwise turn the name into
            // "*.1.iso" and hide the persisted SDK task we intend to reuse.
            nativeMatches = await this.readNativeBtTasks(this.taskDbPath, parsed.infoId);
          } catch (cause) {
            throw error('BT_NATIVE_STATE_UNAVAILABLE', '无法确认同 hash 原生任务状态，已停止创建');
          }
          let liveRows;
          try {
            if (typeof this.driver.getTaskSnapshots !== 'function') throw new Error('snapshot unavailable');
            const snapshots = await this.driver.getTaskSnapshots(nativeMatches.map((item) => item.engineId));
            liveRows = nativeMatches.filter((item) => snapshots.has(item.engineId)).map((item) => {
              const snapshot = snapshots.get(item.engineId);
              return {
                ...item,
                status: Number.isFinite(Number(snapshot?.status)) ? Number(snapshot.status) : item.status,
                failureErrorCode: Number.isFinite(Number(snapshot?.failureErrorCode)) ? Number(snapshot.failureErrorCode) : item.failureErrorCode,
              };
            });
          } catch {
            throw error('BT_NATIVE_STATE_UNAVAILABLE', '无法读取同 hash 引擎实时队列，已停止创建');
          }
          const sameTarget = liveRows.filter((item) =>
            normalizeComparableEnginePath(item.savePath) === normalizeComparableEnginePath(targetDir) &&
            item.name === requestedName);
          const reusable = sameTarget.find((item) =>
            item && (Number(item.status) === 5 || Number(item.status) === 7) && Number(item.failureErrorCode || 0) === 0 &&
            Number.isSafeInteger(Number(item.engineId)) && Number(item.engineId) > 0 &&
            ((Number(item.totalReceiveSize) || 0) <= 0 || hasNativePartialData(targetDir, requestedName)));
          if (reusable) {
            const files = (parsed.fileLists || []).map((file, index) => {
              const realIndex = Number.isSafeInteger(Number(file.realIndex)) ? Number(file.realIndex) : index;
              const relativePath = selectTorrentRelativePath(file, index);
              return { index: realIndex, name: path.posix.basename(relativePath), path: relativePath, size: Number(file.fileSize) || 0, offset: Number(file.fileOffset) || 0 };
            });
            const totalBytes = files.filter((file) => indices.includes(file.index)).reduce((sum, file) => sum + file.size, 0);
            const existingHost = typeof this.tasks.findByEngineId === 'function' ? this.tasks.findByEngineId(reusable.engineId) : null;
            if (existingHost && !['completed', 'failed', 'recycled', 'missing'].includes(existingHost.lifecycle)) return existingHost.id;
            const adopted = this.tasks.create({
              source, seedRef, savePath: targetDir, displayName: requestedName, totalBytes, engineId: reusable.engineId,
              infoId: parsed.infoId,
              completedBytes: Math.min(Math.max(0, Number(reusable.totalReceiveSize) || 0), totalBytes || Number.MAX_SAFE_INTEGER),
              kind: taskKindOverride, sourceFingerprint: sourceFingerprintOverride || fingerprint,
              selectedFileIndices: indices, files, lifecycle: 'preparing',
              legacy: { ...(options && options.legacy ? options.legacy : {}), adoptedNativeTask: true, adoptedNativeTaskId: reusable.engineId },
            });
            this.seedStore?.retain?.(seedRef, `task:${adopted.id}`);
            try {
              // TaskDb Status=5 is shared by downloading and paused tasks.  A
              // reused row may be paused after an engine restart, so queued
              // recovery must explicitly delegate both 5 and 7 to the native
              // start API.  Calling start on an already-running row is
              // idempotent in the SDK; skipping it leaves the adopted host
              // record permanently queued with no progress.
              if (options.startMode !== 'queued' && [5, 7].includes(Number(reusable.status))) await this.driver.startTasks([reusable.engineId]);
              return this.tasks.mutate(adopted.id, { expectedRevision: adopted.revision, reason: 'adopt-native-bt' }, { lifecycle: 'queued' }).id;
            } catch (cause) {
              this.tasks.mutate(adopted.id, { reason: 'adopt-native-start-failed' }, { lifecycle: 'failed', error: mapNativeError(cause.message, { code: 'START_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }) });
              throw error('START_FAILED', `已复用的迅雷任务启动失败: ${cause.message}`);
            }
          }
          // TaskDb rows can remain Status=5 after deleteTasks, including after
          // minutes of apparent disk silence. A second native create then ends
          // in asynchronous 208. Only a proven same-target reuse is safe.
          // 孤儿行回收：引擎 deleteTasks 不清理 TaskBase 行，重启后 SDK 会把残留行
          // auto-resume 回内存占住同 hash 会话。host 面已删除（或从未持有）这些行时
          // 用户无从释放——这里对「无 host 引用且 Stopped(7)」的孤儿行做一次性
          // deleteTasks 释放后重查快照；释放不可证明则维持明确拒绝（不退回静默 208）。
          let effective = liveRows;
          if (effective.some((item) => ![8, 9].includes(Number(item.status))) && options.orphansReleased !== true) {
            const hostOwned = new Set();
            if (typeof this.tasks.list === 'function') for (const item of this.tasks.list()) { if (Number.isSafeInteger(Number(item.engineId)) && Number(item.engineId) > 0) hostOwned.add(Number(item.engineId)); }
            const engineSaveRoot = (item) => { const linux = engineSavePathToLinux(item.savePath); return linux && linux !== '/' ? linux : null; };
            const orphans = effective.filter((item) => {
              if (hostOwned.has(Number(item.engineId))) return false;
              if (Number(item.failureErrorCode || 0) !== 0) return false;
              const status = Number(item.status);
              if (status === 7) return true;                       // Stopped：安全释放
              const saveRoot = engineSaveRoot(item);
              if (!saveRoot) return false;
              // Running(5) 的僵尸判定：目录消失，或目录在但引擎行声称已收的数据
              // 实际不在盘上（被清理流程删掉）——两者都无数据可续，host 无引用即可释放。
              if (status !== 5) return false;
              try {
                if (!fs.existsSync(saveRoot)) return true;
                const received = Number(item.totalReceiveSize) || 0;
                return received > 0 && !hasNativePartialData(saveRoot, item.name);
              } catch { return false; }
            });
            if (orphans.length > 0) {
              await this.driver.deleteTasks(orphans.map((item) => Number(item.engineId))).catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, 4000));
              const refreshed = await this.driver.getTaskSnapshots(nativeMatches.map((item) => item.engineId)).catch(() => new Map());
              effective = nativeMatches.filter((item) => refreshed.has(item.engineId) && ![8, 9].includes(Number(refreshed.get(item.engineId)?.status ?? item.status)));
            }
          }
          // TaskDb rows can remain Status=5 after deleteTasks, including after
          // minutes of apparent disk silence. A second native create then ends
          // in asynchronous 208. Only a proven same-target reuse is safe.
          if (effective.some((item) => ![8, 9].includes(Number(item.status)))) {
            const blocking = effective.filter((item) => ![8, 9].includes(Number(item.status)))
              .map((item) => ({ engineId: item.engineId, status: Number(item.status), savePath: item.savePath, name: item.name }));
            throw error('BT_NATIVE_SESSION_BUSY', `同 hash 原生任务仍占用引擎会话，已停止重复创建（占用行: ${JSON.stringify(blocking)}；删除对应任务后可释放会话）`);
          }
        }
        const taskName = options.allowExistingTarget === true ? requestedName : resolveCollision(targetDir, requestedName);
        const taskNameModify = Boolean(displayName && String(displayName) !== String(parsed.title || ''));
        const files = (parsed.fileLists || []).map((file, index) => { const realIndex = Number.isSafeInteger(Number(file.realIndex)) ? Number(file.realIndex) : index; const relativePath = selectTorrentRelativePath(file, index); return { index: realIndex, name: path.posix.basename(relativePath), path: relativePath, size: Number(file.fileSize) || 0, offset: Number(file.fileOffset) || 0 }; });
        const totalBytes = files.filter((file) => indices.includes(file.index)).reduce((sum, file) => sum + file.size, 0);
        const engineId = await this.driver.createTask({
          taskType: 2,
          savePath: targetDir,
          taskName,
          info: buildNativeBtInfo({
            infoId: parsed.infoId,
            seedFile: materialized.path,
            selectedFileIndices: indices,
            fileLists: parsed.fileLists,
            displayName: taskName,
            trackerUrls: parsed.trackerUrls,
            origin: source || options.sourceOverride,
            scheduler: options.btScheduler,
            taskNameModify,
          }),
        });
        const task = this.tasks.create({ source, seedRef, savePath: targetDir, displayName: taskName, totalBytes, engineId, kind: taskKindOverride, infoId: parsed.infoId, sourceFingerprint: sourceFingerprintOverride || fingerprint, selectedFileIndices: indices, files, lifecycle: 'preparing', legacy: { ...(options && options.legacy ? options.legacy : {}) } });
        this.seedStore?.retain?.(seedRef, `task:${task.id}`);
        try {
          if (options.startMode === 'queued') return this.tasks.mutate(task.id, { expectedRevision: task.revision, reason: 'create-queued' }, { lifecycle: 'queued' }).id;
          await this.driver.startTasks([engineId]);
          return this.tasks.mutate(task.id, { expectedRevision: task.revision, reason: 'create-start' }, { lifecycle: 'queued' }).id;
        } catch (cause) {
          await this.driver.deleteTasks([engineId]).catch(() => {});
          this.tasks.mutate(task.id, { reason: 'start-failed' }, { lifecycle: 'failed', error: mapNativeError(cause.message, { code: 'START_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }) });
          throw error('START_FAILED', `任务已创建但启动失败: ${cause.message}`);
        }
        });
      });
    } finally { removeTemporary(materialized); }
  }

  async createMagnetCompat({ source, savePath, displayName, selectedFileIndices = [], options = {}, allowDuplicate = false } = {}) {
    if (!/^magnet:\?/i.test(source || '')) throw error('INVALID_ARGUMENT', 'magnet source 无效');
    const targetDir = this._savePath(savePath);
    return this.operationLock.run(`create:magnet:${source}:${targetDir}`, async () => {
      const parsed = await this.driver.parseTaskInfo({ kind: 'magnet', data: source });
      const fingerprint = sourceFingerprint('magnet', parsed.infoHash || source, { infoHash: parsed.infoHash });
      const duplicate = allowDuplicate ? null : this.tasks.findDuplicate(fingerprint, targetDir);
      if (duplicate) return duplicate.id;
      const requestedName = safeTaskName(displayName || parsed.displayName || `${parsed.infoHash || 'magnet'}.torrent`);
      const taskName = options.allowExistingTarget === true ? requestedName : resolveCollision(targetDir, requestedName);
      const engineId = await this.driver.createTask({ taskType: 5, savePath: targetDir, taskName, info: { url: source, torrentFilePath: targetDir } });
      const task = this.tasks.create({ source, savePath: targetDir, displayName: taskName, totalBytes: 0, engineId, kind: 'magnet', infoHash: parsed.infoHash, sourceFingerprint: fingerprint, selectedFileIndices: normalizeIndices(selectedFileIndices), lifecycle: 'metadata', legacy: { metadataPhase: 'fetching' } });
      await this.driver.startTasks([engineId]).catch(() => {});
      this._pollMagnetMetadata(task.id, { source, targetDir, taskName, engineId, selectedFileIndices, options }).catch((cause) => {
        try { this.tasks.mutate(task.id, { reason: 'magnet-metadata-failed' }, { lifecycle: 'failed', error: mapNativeError(cause.message, { code: 'METADATA_FAILED', category: 'source', retryable: true, actions: ['retry', 'change-source', 'diagnose'] }) }); } catch {}
      });
      return task.id;
    });
  }

  async _pollMagnetMetadata(taskId, { source, targetDir, taskName, engineId, selectedFileIndices, options }) {
    const parsed = await this.driver.parseTaskInfo({ kind: 'magnet', data: source });
    const infoHash = parsed.infoHash;
    const metaFile = path.join(targetDir, `${infoHash}.torrent`);
    const deadline = Date.now() + this.magnetTimeoutSec * 1000;
    while (Date.now() <= deadline) {
      if (fs.existsSync(metaFile) && fs.statSync(metaFile).size > 1000) {
        const btParsed = await this.driver.parseTaskInfo({ kind: 'torrent', data: metaFile });
        const allIndices = normalizeIndices((btParsed.fileLists || []).map((file) => file.realIndex));
        const requested = normalizeIndices(selectedFileIndices);
        const indices = requested.length ? requested.filter((index) => allIndices.includes(index)) : allIndices;
        const files = (btParsed.fileLists || []).map((file, index) => { const realIndex = Number.isSafeInteger(Number(file.realIndex)) ? Number(file.realIndex) : index; const relativePath = selectTorrentRelativePath(file, index); return { index: realIndex, name: path.posix.basename(relativePath), path: relativePath, size: Number(file.fileSize) || 0, offset: Number(file.fileOffset) || 0 }; });
        const selectedFiles = files.filter((file) => indices.includes(file.index));
        const finalName = options && options.out ? taskName : safeTaskName(btParsed.title || taskName, taskName);
        const btTaskName = finalName === taskName ? taskName : resolveCollision(targetDir, finalName);
        const taskNameModify = Boolean(btTaskName && String(btTaskName) !== String(btParsed.title || ''));
        await this.operationLock.run(`create:bt:${String(btParsed.infoId || '').toUpperCase()}`, async () => {
        if (this.readNativeBtTasks && this.taskDbPath) {
          let matches;
          try {
            matches = await this.readNativeBtTasks(this.taskDbPath, btParsed.infoId);
            const snapshots = await this.driver.getTaskSnapshots(matches.map((item) => item.engineId));
            const liveMagnet = matches.filter((item) => snapshots.has(item.engineId) && ![8, 9].includes(Number(item.status)));
            if (liveMagnet.length > 0 && options.orphansReleased !== true) {
              // 与 torrent 路径同型的孤儿行回收：Stopped(7) 且 host 面无引用 → deleteTasks 释放后重查。
              const hostOwned = new Set();
              if (typeof this.tasks.list === 'function') for (const item of this.tasks.list()) { if (Number.isSafeInteger(Number(item.engineId)) && Number(item.engineId) > 0) hostOwned.add(Number(item.engineId)); }
              const orphans = liveMagnet.filter((item) => {
                if (hostOwned.has(Number(item.engineId))) return false;
                if (Number(item.failureErrorCode || 0) !== 0) return false;
                const status = Number(item.status);
                if (status === 7) return true;
                if (status !== 5) return false;
                const linux = engineSavePathToLinux(item.savePath);
                if (!linux || linux === '/') return false;
                try {
                  if (!fs.existsSync(linux)) return true;
                  const received = Number(item.totalReceiveSize) || 0;
                  return received > 0 && !hasNativePartialData(linux, item.name);
                } catch { return false; }
              });
              if (orphans.length > 0) {
                await this.driver.deleteTasks(orphans.map((item) => Number(item.engineId))).catch(() => {});
                await new Promise((resolve) => setTimeout(resolve, 1500));
                const refreshed = await this.driver.getTaskSnapshots(matches.map((item) => item.engineId));
                const stillLive = matches.filter((item) => refreshed.has(item.engineId) && ![8, 9].includes(Number(refreshed.get(item.engineId)?.status ?? item.status)));
                if (stillLive.length === 0) {
                  options = { ...options, orphansReleased: true };
                } else {
                  const blockingMagnet = stillLive.map((item) => ({ engineId: item.engineId, status: Number(item.status), savePath: item.savePath, name: item.name }));
                  throw error('BT_NATIVE_SESSION_BUSY', `同 hash 原生任务仍占用引擎会话，磁力元数据不能重复建 BT 任务（占用行: ${JSON.stringify(blockingMagnet)}；删除对应任务后可释放会话）`);
                }
              } else {
                const blockingMagnet = liveMagnet.map((item) => ({ engineId: item.engineId, status: Number(item.status), savePath: item.savePath, name: item.name }));
                throw error('BT_NATIVE_SESSION_BUSY', `同 hash 原生任务仍占用引擎会话，磁力元数据不能重复建 BT 任务（占用行: ${JSON.stringify(blockingMagnet)}；删除对应任务后可释放会话）`);
              }
            } else if (liveMagnet.length > 0) {
              // 已尝试过孤儿释放仍占用：明确拒绝（不退回静默 208）。
              const blockingMagnet = liveMagnet.map((item) => ({ engineId: item.engineId, status: Number(item.status), savePath: item.savePath, name: item.name }));
              throw error('BT_NATIVE_SESSION_BUSY', `同 hash 原生任务仍占用引擎会话，磁力元数据不能重复建 BT 任务（占用行: ${JSON.stringify(blockingMagnet)}；删除对应任务后可释放会话）`);
            }
          } catch (cause) {
            if (cause.code === 'BT_NATIVE_SESSION_BUSY') throw cause;
            throw error('BT_NATIVE_STATE_UNAVAILABLE', '无法确认同 hash 原生任务状态，已停止磁力转 BT 创建');
          }
        }
        const btId = await this.driver.createTask({
          taskType: 2,
          savePath: targetDir,
          taskName: btTaskName,
          info: buildNativeBtInfo({
            infoId: btParsed.infoId,
            seedFile: metaFile,
            selectedFileIndices: indices,
            fileLists: btParsed.fileLists,
            displayName: btTaskName,
            trackerUrls: btParsed.trackerUrls,
            origin: source,
            scheduler: options && options.btScheduler,
            taskNameModify,
          }),
        });
        await this.driver.startTasks([btId]).catch(() => {});
        this.tasks.mutate(taskId, { reason: 'magnet-metadata-ready' }, { engineId: btId, kind: 'bt', infoId: btParsed.infoId, seedRef: metaFile, displayName: btTaskName, sourceFingerprint: sourceFingerprint('bt', btParsed.infoId, { infoId: btParsed.infoId }), selectedFileIndices: indices, files, totalBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0), lifecycle: 'queued' });
        await this.driver.stopTasks([engineId]).catch(() => {});
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw error('METADATA_TIMEOUT', '磁力链接元数据获取超时');
  }

  async commitDraft(draft, { seedStore = null } = {}) {
    if (!draft || !draft.kind) throw error('INVALID_DRAFT', '草稿无效');
    if (!['ready', 'committing'].includes(draft.state)) throw error('DRAFT_NOT_READY', '草稿尚未准备完成');
    const common = { savePath: draft.savePath || draft.options && draft.options.savePath, displayName: draft.displayName, selectedFileIndices: draft.selectedFileIndices || [], options: { ...(draft.options || {}), sourceOverride: draft.originalSource || undefined } };
    const allowDuplicate = draft.options && ['redownload', 'rename'].includes(draft.options.duplicateResolution);
    if (draft.kind === 'bt') {
      const torrentInput = seedStore && draft.seedRef ? seedStore.resolve(draft.seedRef) : draft.seedRef;
      return this.createTorrentCompat({ ...common, torrentInput, allowDuplicate, source: draft.originalSource, sourceFingerprintOverride: draft.sourceFingerprint, taskKindOverride: 'bt' });
    }
    if (draft.kind === 'magnet') {
      // Metadata-ready magnet drafts already own a validated torrent seed.  Commit
      // the BT primitive directly while preserving the original magnet kind/source
      // in TaskRepository; never start a second metadata job.
      if (draft.seedRef && draft.files && draft.files.length) {
        const torrentInput = seedStore ? seedStore.resolve(draft.seedRef) : draft.seedRef;
        return this.createTorrentCompat({ ...common, torrentInput, allowDuplicate, source: draft.originalSource || draft.normalizedSource, sourceFingerprintOverride: draft.sourceFingerprint, taskKindOverride: 'magnet' });
      }
      return this.createMagnetCompat({ ...common, source: draft.normalizedSource || draft.originalSource, allowDuplicate });
    }
    return this.createUriCompat({ ...common, source: draft.normalizedSource || draft.originalSource, allowDuplicate, sourceFingerprintOverride: draft.sourceFingerprint, taskKindOverride: draft.kind });
  }

  async createBatchCompat({ items, options = {} } = {}) {
    if (!Array.isArray(items)) throw error('INVALID_ARGUMENT', 'items 必须是数组');
    const results = [];
    for (const item of items.slice(0, 100)) {
      try {
        const common = { savePath: options.savePath || options.dir, displayName: options.displayName || options.out, selectedFileIndices: options.selectedFileIndices || options.selectFile, options };
        let taskId;
        if (item && (item.kind === 'torrent' || item.type === 'torrent')) taskId = await this.createTorrentCompat({ ...common, torrentInput: item.data || item.value });
        else if (item && (item.kind === 'magnet' || /^magnet:/i.test(item.value || item.source || ''))) taskId = await this.createMagnetCompat({ ...common, source: item.value || item.source });
        else taskId = await this.createUriCompat({ ...common, source: item && (item.value || item.source) });
        results.push({ taskId, ok: true });
      } catch (cause) { results.push({ ok: false, error: { code: cause.code || 'CREATE_FAILED', message: cause.message } }); }
    }
    return { results };
  }
}

module.exports = { CreateTaskService, safeTaskName, defaultTaskName, resolveCollision, fetchContentLength, materializeTorrent };
