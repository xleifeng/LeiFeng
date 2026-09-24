'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { isTerminal, normalizeFileIndices } = require('./registry');
const { normalizeTorrentHash } = require('./domain/protocol-parser');
const { buildNativeBtInfo } = require('./domain/native-bt-info');
const RESERVED = new Set([]); // 兼容 RPC 的方法已全部实现。

class RpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fetchContentLength(urlStr, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let mod;
    try { mod = new URL(urlStr).protocol === 'https:' ? https : http; }
    catch { return resolve(0); }
    const req = mod.request(urlStr, { method: 'HEAD', timeout: timeoutMs }, (res) => {
      res.resume();
      const len = Number(res.headers['content-length'] || 0);
      resolve(res.statusCode === 200 && len > 0 ? len : 0);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

function defaultTaskName(urlStr) {
  try {
    const base = decodeURIComponent(new URL(urlStr).pathname.split('/').filter(Boolean).pop() || '');
    return base || 'download.bin';
  } catch { return 'download.bin'; }
}

function safeTaskName(value, fallback = 'download.bin') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const name = path.basename(value.trim().replace(/\\/g, '/'));
  if (!name || name === '.' || name === '..' || name.includes('\0')) return fallback;
  return name;
}

function resolveCollision(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const cand = `${stem}.${i}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
  return `${stem}.${Date.now()}${ext}`;
}

// aria2.addTorrent accepts a torrent path, while browser clients send torrent
// bytes as base64. Materialize uploads in the daemon runtime so the existing
// native parser/driver path can consume both forms.
function materializeTorrentInput(input, runtimeDir) {
  let torrentPath = input.startsWith('file://') ? input.replace(/^file:\/\//, '') : input;
  torrentPath = torrentPath.replace(/^Z:/, '');

  // Accept both standard base64 and base64url payloads.
  if (torrentPath.length >= 16 && /^[A-Za-z0-9+/_=-]+$/.test(torrentPath)) {
    try {
      const normalized = torrentPath.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Buffer.from(normalized, 'base64');
      // A .torrent is a bencoded dictionary (root byte 'd'). This check must
      // happen before path detection because base64 payloads may contain '/'.
      if (bytes.length && bytes[0] === 0x64) {
        const base = runtimeDir || path.join(process.cwd(), '.torrent-cache');
        fs.mkdirSync(base, { recursive: true });
        const dir = fs.mkdtempSync(path.join(base, 'torrent-upload-'));
        const file = path.join(dir, 'upload.torrent');
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        return { path: file, temporary: true };
      }
    } catch {}
  }

  const looksLikePath = torrentPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(torrentPath)
    || torrentPath.includes('/') || torrentPath.includes('\\');
  if (looksLikePath) return { path: torrentPath, temporary: false };
  return { path: torrentPath, temporary: false };
}

function removeTemporaryTorrent(materialized) {
  if (!materialized || !materialized.temporary) return;
  try { fs.rmSync(path.dirname(materialized.path), { recursive: true, force: true }); } catch {}
}

function toAria2Status(r) {
  const isBt = r.taskType === 'bt' || (r.taskType === 'magnet' && r.metadataPhase === 'download');
  const selected = (index) => !Array.isArray(r.selectedFileIndices)
    || r.selectedFileIndices.includes(Number(index));
  const uris = !isBt && r.url ? [{ uri: r.url, status: 'used' }] : [];
  const out = {
    gid: r.gid, status: r.status,
    totalLength: String(r.totalLength), completedLength: String(r.completedLength),
    downloadSpeed: String(r.downloadSpeed), uploadSpeed: '0',
    dir: r.savePath,
    files: r.fileLists && r.fileLists.length
      ? r.fileLists.map((f) => ({ index: String(f.realIndex), path: path.join(r.savePath, r.taskName, f.fileName),
          length: String(f.fileSize), completedLength: '0', selected: selected(f.realIndex) ? 'true' : 'false', uris }))
      : [{ index: '1', path: path.join(r.savePath, r.taskName),
          length: String(r.totalLength), completedLength: String(r.completedLength), selected: 'true', uris }],
  };
  if (isBt) {
    out.bittorrent = {
      mode: r.fileLists && r.fileLists.length > 1 ? 'multi' : 'single',
      info: { name: r.taskName },
    };
  }
  if (r.metadataPhase) out.metadataPhase = r.metadataPhase;   // 磁力阶段暴露
  if (r.errorCode) { out.errorCode = r.errorCode; out.errorMessage = r.errorMessage || ''; }
  out.vipStatus = r.vipState || 'disabled';
  out.vipReceivedLength = String(Number(r.vipReceivedLength) || 0);
  out.freeDcdnReceivedLength = String(Number(r.freeDcdnReceivedLength) || 0);
  out.vipNextRefreshAt = Number(r.vipNextRefreshAt) || 0;
  return out;
}

function toUiTask(r, { includeFiles = false } = {}) {
  const totalLength = Math.max(0, Number(r.totalLength) || 0);
  const completedLength = Math.max(0, Number(r.completedLength) || 0);
  const task = {
    gid: r.gid,
    name: r.taskName || '未命名任务',
    kind: r.taskType || 'http',
    status: r.status || 'waiting',
    totalLength,
    completedLength,
    downloadSpeed: Math.max(0, Number(r.downloadSpeed) || 0),
    uploadSpeed: 0,
    savePath: r.savePath || '',
    source: r.url || '',
    progress: totalLength > 0 ? Math.min(1, completedLength / totalLength) : 0,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
    metadataPhase: r.metadataPhase || '',
    error: r.errorCode ? { code: String(r.errorCode), message: r.errorMessage || '' } : null,
    canRestore: !!r.url && /^(?:https?|magnet|ed2k|thunder):/i.test(r.url),
    vip: {
      enabled: r.vipEnabled !== false,
      state: r.vipState || 'disabled',
      receivedLength: Math.max(0, Number(r.vipReceivedLength) || 0),
      freeDcdnReceivedLength: Math.max(0, Number(r.freeDcdnReceivedLength) || 0),
      nextRefreshAt: Math.max(0, Number(r.vipNextRefreshAt) || 0),
      lastErrorCode: r.vipLastErrorCode || '',
    },
  };
  if (includeFiles) {
    const selected = new Set(normalizeFileIndices(r.selectedFileIndices));
    task.files = (r.fileLists || []).map((f) => ({
      index: Number(f.realIndex),
      name: f.fileName || '',
      path: f.filePath || '',
      length: Math.max(0, Number(f.fileSize) || 0),
      selected: !selected.size || selected.has(Number(f.realIndex)),
    }));
  }
  return task;
}

function safeDeleteTaskFiles(r) {
  const base = path.resolve(r.savePath || '');
  const name = safeTaskName(r.taskName, '');
  if (!base || !name || base === path.parse(base).root) throw new RpcError(1, 'unsafe task path');
  const target = path.resolve(base, name);
  if (target === base || !target.startsWith(`${base}${path.sep}`)) throw new RpcError(1, 'unsafe task target');
  try { fs.rmSync(target, { recursive: true, force: true }); }
  catch (e) { throw new RpcError(1, `delete local files failed: ${e.message}`); }
}

function createMethodHandler({ registry, driver, config, auth, vip, v2Methods = null, taskService = null, createTaskService = null, settingsService = null, contentLengthProbe = fetchContentLength, legacyRpcEnabled = true }) {
  if (!auth) throw new Error('createMethodHandler: auth (AuthManager) is required');
  const vipApi = vip || {
    getStatus: async () => ({ enabled: false, accountReady: false, isVip: false, peerIdReady: false, tasks: [] }),
    setEnabled: async ({ gid, enabled }) => ({ gid, enabled }),
    retry: async (gid) => ({ gid, queued: false }),
    disableAll: async () => {},
    disableTask: async () => {},
  };
  const rpcSecret = config.rpcSecret; // 可空：未配 THUNDERD_RPC_SECRET 时不鉴权
  const legacyEnabled = legacyRpcEnabled !== false;
  // 变更操作按 key 串行执行以消除并发/去重竞态；链尾 settle 后自清，防止长跑无界增长。
  const chains = new Map();
  const serialize = (key, fn) => {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const stored = next.catch(() => {});
    chains.set(key, stored);
    // 守卫 === stored：同 key 后续操作已把链尾推进到新 promise 时，旧链尾 settle 不误删新条目
    stored.finally(() => { if (chains.get(key) === stored) chains.delete(key); });
    return next;
  };

  const needTask = (params) => {
    const gid = Array.isArray(params) ? params[0] : undefined;
    const r = gid && registry.get(gid);
    if (!r) throw new RpcError(1, `GID ${gid} not found`);
    return r;
  };

  const removeCommonLegacy = (r, deleteFile) => serialize(r.gid, async () => {
    await vipApi.disableTask(r.gid, { reason: 'removed' }).catch(() => {});
    if (r.status === 'active' || r.status === 'waiting') await driver.stopTasks([r.engineId]).catch(() => {});
    try {
      await driver.deleteTasks([r.engineId]);
    } catch (e) {
      registry.update(r.gid, { status: 'error', errorCode: 'remove-failed', errorMessage: e.message });
      throw new RpcError(1, `remove failed: ${e.message}`);
    }
    if (deleteFile) { try { fs.unlinkSync(path.join(r.savePath, r.taskName)); } catch {} }
    registry.update(r.gid, { status: 'removed', downloadSpeed: 0 });
    return r.gid;
  });

  const removeCommon = taskService
    ? (r, deleteFile) => taskService.removeRecordCompat({ id: r.gid }, {}).then((task) => {
      if (deleteFile) safeDeleteTaskFiles(r);
      return task.id;
    })
    : removeCommonLegacy;

  // pauseCommon：aria2.pause 与 aria2.forcePause 共用（本 daemon 实现下两者语义等价，
  // 均为 stopTasks + 标 paused；forcePause 的"立即停"语义在引擎层无差别——SDK stop 即时）
  const pauseCommonLegacy = (r) => serialize(r.gid, async () => {
    if (r.status !== 'active' && r.status !== 'waiting') throw new RpcError(1, `cannot pause ${r.status} task`);
    await driver.stopTasks([r.engineId]);
    registry.update(r.gid, { status: 'paused', downloadSpeed: 0 });
    await vipApi.disableTask(r.gid, { reason: 'paused' }).catch(() => {});
    return r.gid;
  });
  const pauseCommon = taskService
    ? (r) => taskService.pauseOne({ id: r.gid }, {}).then((task) => task.id)
    : pauseCommonLegacy;

  const MAGNET_TIMEOUT_SEC = Math.min(Math.max(Number(config.magnetTimeoutSec || process.env.THUNDERD_MAGNET_TIMEOUT_SEC || 120), 30), 600);
  const doAddMagnet = async (magnet, savePath, opts) => {
    const parsed = await driver.parseTaskInfo({ kind: 'magnet', data: magnet });
    const infoHash = parsed.infoHash;
    const dup = registry.findDuplicate('magnet', infoHash, savePath);
    if (dup) return dup.gid;
    fs.mkdirSync(savePath, { recursive: true });
    if (opts.out !== undefined && (typeof opts.out !== 'string' || !opts.out || opts.out.includes('/') || opts.out.includes('\\') || opts.out.includes('..')))
      throw new RpcError(1, 'invalid out option');
    const displayName = opts.out
      ? safeTaskName(opts.out, `${infoHash}.torrent`)
      : safeTaskName(parsed.displayName, `${infoHash}.torrent`);
    const taskName = resolveCollision(savePath, displayName);
    const magId = await driver.createTask({ taskType: 5, savePath, taskName,
      info: { url: magnet, torrentFilePath: savePath } });
    const rec = registry.create({ url: magnet, savePath, taskName, totalLength: 0, engineId: magId,
      taskType: 'magnet', infoHash, metadataPhase: 'fetching',
      selectedFileIndices: normalizeFileIndices(opts.selectFile) });
    await driver.startTasks([magId]).catch(() => {});   // 拉 metadata
    // 后台轮询等 metadata 文件 → createBtTask
    setImmediate(async () => {
      const metaFile = path.join(savePath, infoHash + '.torrent');
      const deadline = Date.now() + MAGNET_TIMEOUT_SEC * 1000;
      const poll = async () => {
        if (Date.now() > deadline) {
          registry.update(rec.gid, { status: 'error', errorCode: 'metadata-timeout', errorMessage: 'magnet metadata fetch timeout' });
          return;
        }
        try {
          if (fs.existsSync(metaFile) && fs.statSync(metaFile).size > 1000) {
            const btParsed = await driver.parseTaskInfo({ kind: 'torrent', data: metaFile });
            const allIndices = normalizeFileIndices(btParsed.fileLists.map((f) => f.realIndex));
            const requested = normalizeFileIndices(opts.selectFile);
            const selectedFileIndices = requested.length
              ? requested.filter((i) => allIndices.includes(i))
              : allIndices;
            const selectedFiles = btParsed.fileLists.filter((f) => selectedFileIndices.includes(Number(f.realIndex)));
            // Magnet 的 dn/displayName 只是链接侧提示；metadata 中的 info.name
            // 才是实际种子名称。没有显式 out 覆盖时，以它作为最终任务名。
            const metadataName = opts.out === undefined
              ? safeTaskName(btParsed.title, taskName)
              : taskName;
            let btTaskName = metadataName;
            if (btTaskName !== taskName) {
              // 同目录已有同名任务时保留 metadata 名称并追加可预测的碰撞后缀。
              if (fs.existsSync(path.join(savePath, btTaskName))) {
                btTaskName = resolveCollision(savePath, btTaskName);
              }
            }
            const btId = await driver.createTask({ taskType: 2, savePath, taskName: btTaskName,
              info: buildNativeBtInfo({
                infoId: btParsed.infoId,
                seedFile: metaFile,
                selectedFileIndices,
                fileLists: btParsed.fileLists,
                displayName: btTaskName,
                trackerUrls: btParsed.trackerUrls,
                origin: magnet,
                scheduler: opts.btScheduler,
                taskNameModify: opts.out !== undefined,
              }) });
            await driver.startTasks([btId]).catch(() => {});
            registry.update(rec.gid, { engineId: btId, taskName: btTaskName, metadataPhase: 'download',
              infoId: btParsed.infoId, selectedFileIndices, fileLists: btParsed.fileLists,
              totalLength: selectedFiles.reduce((s, f) => s + f.fileSize, 0) });
            // createMagnetTask 拉 metadata 的 magId 引擎任务，转 BT 后防御性停止（若引擎已自动终态则 no-op）
            await driver.stopTasks([magId]).catch(() => {});
            return;
          }
        } catch (e) {
          console.warn('[magnet-poll] iteration error for gid', rec.gid, ':', e.message);
        }
        setTimeout(poll, 3000);
      };
      poll();
    });
    return rec.gid;
  };

  const handler = async function handle(method, params, ctx = {}) {
    if (method.startsWith('thunder.ui.v2.')) {
      if (!v2Methods || !v2Methods.has(method)) throw new RpcError(-32601, `Method not found: ${method}`);
      // V2 never accepts the legacy token:<secret> parameter shape. When a
      // secret is configured it must arrive through Authorization: Bearer.
      if (rpcSecret && (ctx.rpcSecret !== undefined || ctx.bearerToken !== rpcSecret))
        throw new RpcError(1, 'unauthorized: V2 requires Authorization bearer header');
      try { return await v2Methods.get(method)(params || [], ctx); }
      catch (error) {
        if (error instanceof RpcError) throw error;
        const wrapped = new RpcError(error.code || 1, error.message || String(error));
        wrapped.details = error.details;
        throw wrapped;
      }
    }
    if (!legacyEnabled) throw new RpcError(-32601, 'V2 模式不提供旧版 RPC');
    // Some aria2 clients omit the token on the outer system.multicall request
    // and put it on each nested call. Validate and normalize that shape here.
    const nestedMulticall = method === 'system.multicall'
      && Array.isArray(params) && Array.isArray(params[0]) ? params[0] : null;
    const nestedAuth = rpcSecret && nestedMulticall
      && nestedMulticall.every((call) => Array.isArray(call) && Array.isArray(call[1])
        && typeof call[1][0] === 'string' && call[1][0] === `token:${rpcSecret}`);
    if (rpcSecret && ctx.rpcSecret !== rpcSecret && !nestedAuth)
      throw new RpcError(1, 'unauthorized: rpc-secret mismatch');
    if (RESERVED.has(method) || method.startsWith('thunder.pan.')) {
      throw new RpcError(-32601, `Method not found (reserved): ${method}`);
    }
    switch (method) {
      case 'aria2.addUri': {
        const [uris, opts = {}] = params || [];
        const url = Array.isArray(uris) ? uris[0] : undefined;
        if (!url || typeof url !== 'string') throw new RpcError(1, 'uri is required');
        const savePath = path.resolve(opts.dir || config.downloadDir);
        let requestedName = opts.out ? safeTaskName(opts.out) : defaultTaskName(url);
        if (opts.out !== undefined && (typeof opts.out !== 'string' || !opts.out || opts.out.includes('/') || opts.out.includes('\\') || opts.out.includes('..')))
          throw new RpcError(1, 'invalid out option');
        // 按 URL 协议类型分派。
        const isHttp = /^https?:\/\//i.test(url);
        const isFtp = /^ftp:\/\//i.test(url);
        const pastedHash = normalizeTorrentHash(url);
        const magnetUrl = pastedHash ? `magnet:?xt=urn:btih:${pastedHash}` : url;
        const isMagnet = /^magnet:\?/i.test(magnetUrl);
        const isEd2k = /^ed2k:\/\//i.test(url);
        const isThunder = /^thunder:\/\//i.test(url);
        if (!isHttp && !isFtp && !isMagnet && !isEd2k && !isThunder) throw new RpcError(1, 'unsupported uri scheme (http/https/ftp/magnet/ed2k/thunder)');
        if (createTaskService) return createTaskService.createUriCompat({ source: magnetUrl, savePath, displayName: opts.out, selectedFileIndices: opts.selectFile, options: opts });
        // Browser clients may submit magnet links through addUri; keep the
        // daemon's explicit addMagnetAddress API as well.
        if (isMagnet) return serialize(`magnet:${magnetUrl}:${savePath}`, () => doAddMagnet(magnetUrl, savePath, opts));
        return serialize(`${url}${savePath}/${requestedName}`, async () => {
          let taskType = 1, realUrl = url;
          let parsedUrlInfo = null;
          if (isEd2k) taskType = 3;
          else if (isThunder) {
            const r = await driver.resolveThunderUrl(url);
            realUrl = r.resolvedUrl || url;
            taskType = r.taskType || 1;
            if (taskType === 5) { // thunder→磁力，转 addMagnetAddress 逻辑
              return doAddMagnet(realUrl, savePath, opts);
            }
          }
          // The URL basename is meaningless for ed2k and thunder wrappers
          // (it becomes download.bin). Ask the native parser for the real
          // filename/size before creating the task so the list and on-disk
          // name match the source metadata.
          if (taskType === 3) {
            parsedUrlInfo = await driver.parseTaskInfo({ kind: 'ed2k', data: realUrl });
            if (!opts.out) requestedName = safeTaskName(parsedUrlInfo.fileName, requestedName);
          } else if (taskType === 1 && !opts.out) {
            requestedName = safeTaskName(defaultTaskName(realUrl), requestedName);
          }
          const dup = registry.findDuplicate(taskType === 3 ? 'ed2k' : 'http', realUrl, savePath);
          if (dup) return dup.gid;
          fs.mkdirSync(savePath, { recursive: true });
          const taskName = resolveCollision(savePath, requestedName);
          const info = taskType === 3
            ? { url: realUrl }
            : { url: realUrl, refUrl: '', useOriginResourceOnly: false, originResourceThreadCount: 5, loginFtp: false, ftpUserName: '', ftpPassword: '', origin: 'thunderd' };
          const totalLength = taskType === 3
            ? Number(parsedUrlInfo && parsedUrlInfo.fileSize) || 0
            : await contentLengthProbe(realUrl);
          const engineId = await driver.createTask({ taskType, savePath, taskName, info });
          const rec = registry.create({ url: realUrl, savePath, taskName, totalLength, engineId, taskType: taskType === 3 ? 'ed2k' : 'http' });
          try { await driver.startTasks([engineId]); }
          catch (e) {
            await driver.deleteTasks([engineId]).catch(() => {});
            registry.update(rec.gid, { status: 'error', errorCode: 'start-failed', errorMessage: e.message });
            throw new RpcError(1, `task created but failed to start: ${e.message}`);
          }
          return rec.gid;
        });
      }
      case 'aria2.tellStatus': return toAria2Status(needTask(params));
      case 'aria2.tellActive': return registry.list().filter((r) => r.status === 'active').map(toAria2Status);
      case 'aria2.tellWaiting': return registry.list().filter((r) => r.status === 'waiting' || r.status === 'paused').map(toAria2Status);
      case 'aria2.tellStopped': return registry.list().filter((r) => isTerminal(r.status)).map(toAria2Status);
      case 'aria2.pause': return pauseCommon(needTask(params));
      case 'aria2.forcePause': return pauseCommon(needTask(params));
      case 'aria2.unpause': {
        const r = needTask(params);
        if (taskService) return taskService.startOne({ id: r.gid }, {}).then((task) => task.id);
        return serialize(r.gid, async () => {
          if (r.status !== 'paused') throw new RpcError(1, `cannot unpause ${r.status} task`);
          await driver.startTasks([r.engineId]);
          registry.update(r.gid, { status: 'waiting' });
          return r.gid;
        });
      }
      case 'aria2.pauseAll':
      case 'aria2.forcePauseAll': {
        // 批量 pause：active+waiting → stopTasks(批量 engineId) → 全标 paused
        const targets = registry.list().filter((r) => r.status === 'active' || r.status === 'waiting');
        await driver.stopTasks(targets.map((r) => r.engineId)).catch(() => {});
        for (const r of targets) { registry.update(r.gid, { status: 'paused', downloadSpeed: 0 }); await vipApi.disableTask(r.gid, { reason: 'paused' }).catch(() => {}); }
        return 'OK';
      }
      case 'aria2.unpauseAll': {
        // 批量 unpause：paused → startTasks(批量 engineId) → 全标 waiting
        const targets = registry.list().filter((r) => r.status === 'paused');
        await driver.startTasks(targets.map((r) => r.engineId)).catch(() => {});
        for (const r of targets) registry.update(r.gid, { status: 'waiting' });
        return 'OK';
      }
      case 'aria2.addTorrent': {
        const [torrentFile, opts = {}] = params || [];
        const tf = Array.isArray(torrentFile) ? torrentFile[0] : torrentFile;
        if (!tf || typeof tf !== 'string') throw new RpcError(1, 'torrentFile is required');
        const materialized = materializeTorrentInput(tf, config.runtimeDir);
        const torrentPath = materialized.path;
        const savePath = path.resolve(opts.dir || config.downloadDir);
        if (createTaskService) {
          try { return await createTaskService.createTorrentCompat({ torrentInput: torrentPath, savePath, displayName: opts.out, selectedFileIndices: opts.selectFile, options: opts }); }
          finally { removeTemporaryTorrent(materialized); }
        }
        try {
          return await serialize(`bt:${torrentPath}:${savePath}`, async () => {
            const parsed = await driver.parseTaskInfo({ kind: 'torrent', data: torrentPath });
            const dup = registry.findDuplicate('bt', parsed.infoId, savePath);
            if (dup) return dup.gid;
            fs.mkdirSync(savePath, { recursive: true });
            const allIndices = normalizeFileIndices(parsed.fileLists.map((f) => f.realIndex));
            const requested = normalizeFileIndices(opts.selectFile);
            const fileRealIndexLists = requested.length
              ? requested.filter((i) => allIndices.includes(i))
              : allIndices;
            const requestedName = opts.out || parsed.title || defaultTaskName(torrentPath);
            if (opts.out !== undefined && (typeof opts.out !== 'string' || !opts.out || opts.out.includes('/') || opts.out.includes('\\') || opts.out.includes('..')))
              throw new RpcError(1, 'invalid out option');
            const taskName = resolveCollision(savePath, requestedName);
            const engineId = await driver.createTask({ taskType: 2, savePath, taskName,
              info: buildNativeBtInfo({
                infoId: parsed.infoId,
                seedFile: torrentPath,
                selectedFileIndices: fileRealIndexLists,
                fileLists: parsed.fileLists,
                displayName: taskName,
                trackerUrls: parsed.trackerUrls,
                scheduler: opts.btScheduler,
                taskNameModify: opts.out !== undefined,
              }) });
            const selectedFiles = parsed.fileLists.filter((f) => fileRealIndexLists.includes(Number(f.realIndex)));
            const rec = registry.create({ url: '', savePath, taskName,
              totalLength: selectedFiles.reduce((s, f) => s + f.fileSize, 0),
              engineId, taskType: 'bt', infoId: parsed.infoId,
              selectedFileIndices: fileRealIndexLists, fileLists: parsed.fileLists });
            try { await driver.startTasks([engineId]); }
            catch (e) {
              await driver.deleteTasks([engineId]).catch(() => {});
              registry.update(rec.gid, { status: 'error', errorCode: 'start-failed', errorMessage: e.message });
              throw new RpcError(1, `task created but failed to start: ${e.message}`);
            }
            return rec.gid;
          });
        } finally {
          // The native SDK has consumed the seed file during createTask. Keep
          // path-based seeds intact, but remove daemon-owned upload material.
          removeTemporaryTorrent(materialized);
        }
      }
      case 'aria2.addMagnetAddress': {
        const [mags, opts = {}] = params || [];
        const magnet = Array.isArray(mags) ? mags[0] : mags;
        if (!magnet || typeof magnet !== 'string' || !/^magnet:\?/i.test(magnet)) throw new RpcError(1, 'magnet uri is required');
        const savePath = path.resolve(opts.dir || config.downloadDir);
        if (createTaskService) return createTaskService.createMagnetCompat({ source: magnet, savePath, displayName: opts.out, selectedFileIndices: opts.selectFile, options: opts });
        return serialize(`magnet:${magnet}:${savePath}`, () => doAddMagnet(magnet, savePath, opts));
      }
      case 'aria2.remove': return removeCommon(needTask(params), false);
      // Compatibility clients use different removal methods for running and
      // terminal rows; both map to the daemon's single safe removal path.
      case 'aria2.forceRemove': return removeCommon(needTask(params), false);
      case 'aria2.removeDownloadResult': return removeCommon(needTask(params), false);
      case 'aria2.purgeDownloadResult': {
        for (const r of registry.list().filter((item) => isTerminal(item.status)))
          await removeCommon(r, false);
        return 'OK';
      }
      case 'aria2.changePosition': return Number((params || [])[1]) || 0; // native queue order is not exposed
      case 'aria2.getPeers': return needTask(params).peers || [];
      case 'aria2.getGlobalStat': {
        const c = registry.counts();
        const speed = registry.list().reduce((s, r) => s + (r.status === 'active' ? r.downloadSpeed : 0), 0);
        return { downloadSpeed: String(speed), uploadSpeed: '0', numActive: String(c.active),
          numWaiting: String(c.waiting), numStopped: String(c.stopped), numStoppedTotal: String(c.stopped) };
      }
      case 'aria2.getVersion': {
        // aria2 客户端依据 enabledFeatures 字段识别服务能力。
        return { version: config.version, enabledFeatures: ['http-download', 'bt-download', 'magnet-download', 'ed2k-download', 'auth'] };
      }
      case 'aria2.getFiles': {
        const r = needTask(params);
        const files = (r.fileLists || []).map((f) => ({ index: String(f.realIndex), path: path.join(r.savePath, r.taskName, f.fileName), length: String(f.fileSize), completedLength: '0', selected: 'false' }));
        return files.length ? files : [{ index: '1', path: path.join(r.savePath, r.taskName), length: String(r.totalLength), completedLength: String(r.completedLength), selected: 'true' }];
      }
      case 'aria2.getGlobalOption': {
        if (settingsService) {
          const state = settingsService.get();
          return { 'max-overall-download-limit': state.desired.downloadLimit > 0 ? `${state.desired.downloadLimit}B/s` : '0', 'max-overall-upload-limit': state.desired.uploadLimit > 0 ? `${state.desired.uploadLimit}B/s` : '0', 'max-concurrent-downloads': String(state.desired.maxTasks), dir: state.desired.downloadDir || config.downloadDir };
        }
        let limits = { downloadLimit: -1, uploadLimit: -1, connectionLimit: -1, maxTasks: -1 };
        try { if (driver.isHealthy()) limits = await driver.getGlobalLimits(); } catch {}
        return { 'max-overall-download-limit': limits.downloadLimit > 0 ? limits.downloadLimit + 'B/s' : '0', 'max-overall-upload-limit': limits.uploadLimit > 0 ? limits.uploadLimit + 'B/s' : '0', 'max-concurrent-downloads': String(limits.maxTasks > 0 ? limits.maxTasks : 5), 'dir': config.downloadDir };
      }
      case 'aria2.changeGlobalOption': {
        if (settingsService) {
          const opts = (params || [])[0] || {};
          const parseLimit = (value) => { if (!value || value === '0') return -1; const match = /^(\d+)([KM]?)$/.exec(String(value)); if (!match) throw new RpcError(1, 'invalid rate limit'); const number = Number(match[1]); return match[2] === 'K' ? number * 1024 : match[2] === 'M' ? number * 1048576 : number; };
          await settingsService.update({ downloadLimit: parseLimit(opts['max-overall-download-limit']), uploadLimit: parseLimit(opts['max-overall-upload-limit']), maxTasks: Number(opts['max-concurrent-downloads']) || 5 });
          return 'OK';
        }
        const opts = (params || [])[0] || {};
        const parseLimit = (v) => { if (!v || v === '0') return -1; const m = /^(\d+)([KM]?)$/.exec(String(v)); if (!m) return -1; const n = Number(m[1]); return m[2] === 'K' ? n * 1024 : m[2] === 'M' ? n * 1048576 : n; };
        const limits = { downloadLimit: parseLimit(opts['max-overall-download-limit']), uploadLimit: parseLimit(opts['max-overall-upload-limit']), connectionLimit: -1, maxTasks: opts['max-concurrent-downloads'] ? Number(opts['max-concurrent-downloads']) : -1 };
        try { if (driver.isHealthy()) await driver.setGlobalLimits(limits); } catch (e) { throw new RpcError(1, `setGlobalLimits failed: ${e.message}`); }
        return 'OK';
      }
      case 'aria2.getOption': {
        const r = needTask(params);
        return { 'max-download-limit': '0', 'dir': r.savePath, 'out': r.taskName }; // per-task 限速 stub（native setTaskDownloadSpeedLimit 需 ntask.t 复杂，本阶段返默认）
      }
      case 'aria2.changeOption': {
        // per-task 选项本阶段只接受 dir/out（只读），限速 stub 返 OK 不实调
        return 'OK';
      }
      case 'system.multicall': {
        // params[0] = [[method, params], ...]；批量调 handler，逐个返回值或 {error:{code,message}}
        const calls = (params || [])[0] || [];
        const out = [];
        for (const [m, originalParams] of calls) {
          let p = originalParams;
          let nestedCtx = ctx;
          if (Array.isArray(p) && typeof p[0] === 'string' && p[0].startsWith('token:')) {
            nestedCtx = { ...ctx, rpcSecret: p[0].slice(6) };
            p = p.slice(1);
          }
          try {
            // JSON-RPC system.multicall follows the XML-RPC-compatible shape:
            // every nested result is a one-item array, not a bare result.
            out.push([await handler(m, p, nestedCtx)]);
          } catch (e) {
            out.push([{ error: { code: e.code || 1, message: e.message } }]);
          }
        }
        return out;
      }
      case 'thunder.getVersion': return { version: config.version, rpcFeatures: ['http-download', 'auth', 'bt-download', 'magnet-download', 'ed2k-download', 'vip-dcdn'] };
      case 'thunder.getEngineInfo': {
        let queue = null, dht = null, sw = null;
        if (driver.isHealthy()) {
          try { queue = await driver.getQueueCount(); } catch {}
          try { dht = await driver.getDhtNodeCount(); } catch {}
          try { sw = await driver.getChannelSwitches(); } catch {}
        }
        return { transportReady: driver.isHealthy(), sdkReady: driver.sdkReady === true,
          enginePid: driver.enginePid(), queue, dht,
          p2p: sw && sw.p2p, p2s: sw && sw.p2s,
          restarts: driver.restarts, uptimeMs: driver.bootedAt ? Date.now() - driver.bootedAt : 0 };
      }
      case 'thunder.restartEngine': await driver.restart(); return { healthy: driver.isHealthy() };
      case 'thunder.removeAndDelete': return removeCommon(needTask(params), true);
      // 登录 RPC 凭据本体不出 RPC 面。
      case 'thunder.auth.startLogin': {
        try { return await auth.startLogin(); }
        catch (e) { throw new RpcError(e.code || 1, e.message); }
      }
      case 'thunder.auth.getLoginStatus': {
        const opts = (params && params[0]) || {};
        const status = await auth.getStatus({ refresh: opts.refresh === true });
        const account = status.account || {};
        return { ...status, account: { valid: !!account.valid, isVip: !!account.isVip,
          userVas: Number(account.userVas) || 0, vipType: Number(account.vipType) || 0,
          vipLevel: Number(account.vipLevel) || 0, checkedAt: account.checkedAt || null } };
      }
      case 'thunder.auth.logout': {
        let warning = '';
        try { await vipApi.disableAll({ reason: 'logout' }); } catch { warning = 'vip-disable-failed'; }
        try { const result = await auth.logout(); return warning ? { ...result, warning } : result; }
        catch (e) { throw new RpcError(e.code || 1, e.message); }
      }
      case 'thunder.vip.getStatus': {
        const opts = (params && params[0]) || {};
        if (opts.gid !== undefined && !registry.get(opts.gid)) throw new RpcError(1, `GID ${opts.gid} not found`);
        return vipApi.getStatus(opts.gid);
      }
      case 'thunder.vip.setEnabled': {
        const opts = (params && params[0]) || {};
        if (typeof opts.enabled !== 'boolean') throw new RpcError(1, 'enabled must be boolean');
        if (opts.gid !== undefined && !registry.get(opts.gid)) throw new RpcError(1, `GID ${opts.gid} not found`);
        try { return await vipApi.setEnabled({ gid: opts.gid, enabled: opts.enabled }); }
        catch (e) { throw new RpcError(1, e.message && /gid/i.test(e.message) ? e.message : 'vip setEnabled failed'); }
      }
      case 'thunder.vip.retry': {
        const opts = (params && params[0]) || {};
        if (!opts.gid || !registry.get(opts.gid)) throw new RpcError(1, `GID ${opts.gid || ''} not found`);
        try { return await vipApi.retry(opts.gid); }
        catch (e) { throw new RpcError(1, e.message && /gid|state/i.test(e.message) ? e.message : 'vip retry failed'); }
      }
      case 'thunder.ui.bootstrap': {
        const [engine, account, vipStatus, settings] = await Promise.all([
          handler('thunder.getEngineInfo', [], ctx),
          handler('thunder.auth.getLoginStatus', [{}], ctx),
          handler('thunder.vip.getStatus', [{}], ctx),
          handler('aria2.getGlobalOption', [], ctx),
        ]);
        return {
          version: config.version,
          capabilities: {
            protocols: ['http', 'https', 'ftp', 'magnet', 'bt', 'ed2k', 'thunder'],
            btFileSelection: true,
            taskFileSelection: false,
            trash: true,
            trashRestore: true,
            vipPerTask: true,
            globalRateLimit: true,
            perTaskRateLimit: false,
            queueReorder: false,
            cloudDrive: false,
            mediaPlayer: false,
          },
          account,
          vip: vipStatus,
          engine,
          settings: {
            downloadDir: settings.dir || config.downloadDir,
            maxOverallDownloadLimit: settings['max-overall-download-limit'] || '0',
            maxOverallUploadLimit: settings['max-overall-upload-limit'] || '0',
            maxConcurrentDownloads: Number(settings['max-concurrent-downloads']) || 5,
          },
        };
      }
      case 'thunder.ui.listTasks': {
        const opts = (params && params[0]) || {};
        const scope = ['all', 'active', 'completed', 'trash'].includes(opts.scope) ? opts.scope : 'all';
        const query = String(opts.query || '').trim().toLowerCase();
        const offset = Math.max(0, Number(opts.offset) || 0);
        const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100));
        const source = registry.list();
        const matchesScope = (r) => {
          if (scope === 'trash') return r.status === 'removed';
          if (scope === 'active') return r.status === 'active' || r.status === 'waiting' || r.status === 'paused';
          if (scope === 'completed') return r.status === 'complete' || r.status === 'error';
          return r.status !== 'removed';
        };
        let items = source.filter(matchesScope).filter((r) => !query
          || String(r.taskName || '').toLowerCase().includes(query)
          || String(r.url || '').toLowerCase().includes(query)
          || String(r.savePath || '').toLowerCase().includes(query));
        const order = String(opts.order || 'updated-desc');
        items.sort((a, b) => {
          if (order === 'name-asc') return String(a.taskName || '').localeCompare(String(b.taskName || ''), 'zh-CN');
          if (order === 'speed-desc') return (Number(b.downloadSpeed) || 0) - (Number(a.downloadSpeed) || 0);
          if (order === 'progress-desc') {
            const ap = Number(a.totalLength) > 0 ? Number(a.completedLength) / Number(a.totalLength) : 0;
            const bp = Number(b.totalLength) > 0 ? Number(b.completedLength) / Number(b.totalLength) : 0;
            return bp - ap;
          }
          return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
        });
        const counts = { all: 0, active: 0, completed: 0, trash: 0 };
        for (const r of source) {
          if (r.status === 'removed') counts.trash++;
          else {
            counts.all++;
            if (r.status === 'active' || r.status === 'waiting' || r.status === 'paused') counts.active++;
            if (r.status === 'complete' || r.status === 'error') counts.completed++;
          }
        }
        return { items: items.slice(offset, offset + limit).map((r) => toUiTask(r)), total: items.length, counts };
      }
      case 'thunder.ui.getTask': return toUiTask(needTask(params), { includeFiles: true });
      case 'thunder.ui.addTasks': {
        const opts = (params && params[0]) || {};
        const items = Array.isArray(opts.items) ? opts.items.slice(0, 100) : [];
        const taskOptions = opts.options && typeof opts.options === 'object' ? opts.options : {};
        const results = [];
        for (const item of items) {
          try {
            let gid;
            if (item && item.kind === 'torrent') gid = await handler('aria2.addTorrent', [item.data, taskOptions], ctx);
            else gid = await handler('aria2.addUri', [[item && item.value], taskOptions], ctx);
            results.push({ ok: true, gid });
          } catch (e) {
            results.push({ ok: false, error: { code: e.code || 1, message: e.message || '创建任务失败' } });
          }
        }
        return { results };
      }
      case 'thunder.ui.taskAction': {
        const opts = (params && params[0]) || {};
        const gids = [...new Set(Array.isArray(opts.gids) ? opts.gids.map(String) : [])].slice(0, 200);
        const action = String(opts.action || '');
        const results = [];
        for (const gid of gids) {
          try {
            const r = registry.get(gid);
            if (!r) throw new RpcError(1, `GID ${gid} not found`);
            let resultGid = gid;
            if (action === 'pause') {
              if (r.status === 'active' || r.status === 'waiting') await pauseCommon(r);
            } else if (action === 'start') {
              if (r.status === 'paused') await handler('aria2.unpause', [gid], ctx);
              else if (r.status === 'error' || r.status === 'removed') {
                if (!r.url || !/^(?:https?|magnet|ed2k|thunder):/i.test(r.url)) throw new RpcError(1, '该任务缺少可重建来源，请重新添加');
                resultGid = await handler('aria2.addUri', [[r.url], { dir: r.savePath, out: r.taskName }], ctx);
                if (r.status === 'removed') registry.delete(gid);
              }
            } else if (action === 'remove') {
              if (r.status !== 'removed') await removeCommon(r, false);
            } else if (action === 'restore' || action === 'retry') {
              if (!r.url || !/^(?:https?|magnet|ed2k|thunder):/i.test(r.url)) throw new RpcError(1, '该任务缺少可恢复来源，请重新添加');
              resultGid = await handler('aria2.addUri', [[r.url], { dir: r.savePath, out: r.taskName }], ctx);
              if (r.status === 'removed') registry.delete(gid);
            } else if (action === 'delete') {
              if (r.status !== 'removed') await removeCommon(r, false);
              if (opts.deleteFiles === true) safeDeleteTaskFiles(r);
              registry.delete(gid);
            } else {
              throw new RpcError(1, `unsupported task action: ${action}`);
            }
            results.push({ gid, ok: true, resultGid });
          } catch (e) {
            results.push({ gid, ok: false, error: { code: e.code || 1, message: e.message || '任务操作失败' } });
          }
        }
        return { results };
      }
      case 'thunder.ui.setTaskOptions': {
        const opts = (params && params[0]) || {};
        const r = opts.gid && registry.get(opts.gid);
        if (!r) throw new RpcError(1, `GID ${opts.gid || ''} not found`);
        if (typeof opts.vipEnabled === 'boolean') await vipApi.setEnabled({ gid: r.gid, enabled: opts.vipEnabled });
        return toUiTask(registry.get(r.gid), { includeFiles: true });
      }
      case 'thunder.ui.getSettings': {
        const settings = await handler('aria2.getGlobalOption', [], ctx);
        return { downloadDir: settings.dir || config.downloadDir,
          maxOverallDownloadLimit: settings['max-overall-download-limit'] || '0',
          maxOverallUploadLimit: settings['max-overall-upload-limit'] || '0',
          maxConcurrentDownloads: Number(settings['max-concurrent-downloads']) || 5,
          downloadDirWritable: false };
      }
      case 'thunder.ui.changeSettings': {
        const opts = (params && params[0]) || {};
        await handler('aria2.changeGlobalOption', [{
          'max-overall-download-limit': opts.maxOverallDownloadLimit,
          'max-overall-upload-limit': opts.maxOverallUploadLimit,
          'max-concurrent-downloads': opts.maxConcurrentDownloads,
        }], ctx);
        return handler('thunder.ui.getSettings', [], ctx);
      }
      default: throw new RpcError(-32601, `Method not found: ${method}`);
    }
  };
  handler._chainsSize = () => chains.size; // 测试钩子（下划线前缀 = 私有，不进 RPC 面）
  return handler;
}

module.exports = { createMethodHandler, RpcError, toAria2Status, toUiTask, safeDeleteTaskFiles, fetchContentLength, defaultTaskName, resolveCollision };
