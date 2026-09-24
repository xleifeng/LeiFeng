'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ProtocolParser } = require('../domain/protocol-parser');
const { sourceFingerprint } = require('../repositories/task-repository');
const { mapNativeError } = require('../domain/task-errors');
const { decideOneKey } = require('../domain/one-key-download');
const { safeRelative, selectTorrentRelativePath } = require('./torrent-path');

function serviceError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

function requestProbe(url, { method = 'HEAD', headers = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let request;
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      request = client.request(parsed, { method, timeout: timeoutMs, headers: { 'user-agent': 'thunderd-create-preflight/1', ...headers } }, (response) => {
        let read = 0;
        response.on('data', (chunk) => { read += chunk.length; if (read > 1024) response.destroy(); });
        response.on('end', () => resolve({ status: Number(response.statusCode) || 0, headers: response.headers || {}, location: response.headers && response.headers.location }));
        response.on('close', () => { if (read > 0 && method !== 'HEAD') resolve({ status: Number(response.statusCode) || 0, headers: response.headers || {}, location: response.headers && response.headers.location }); });
      });
      request.on('timeout', () => { request.destroy(); resolve({ status: 0, headers: {} }); });
      request.on('error', () => resolve({ status: 0, headers: {} }));
      request.end();
    } catch { resolve({ status: 0, headers: {} }); }
  });
}

function suggestedNameFromHeaders(url, headers = {}) {
  const contentDisposition = String(headers['content-disposition'] || '');
  const star = /filename\*\s*=\s*([^;]+)/i.exec(contentDisposition);
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
  const candidate = star ? star[1].replace(/^UTF-8''/i, '') : plain && plain[1];
  try { if (candidate) return decodeURIComponent(candidate.trim().replace(/^"|"$/g, '')); } catch {}
  try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'download.bin') || 'download.bin'; } catch { return 'download.bin'; }
}

async function probeUrl(url, timeoutMs = 5000, request = requestProbe) {
  let current = String(url);
  let response = null;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    response = await request(current, { method: 'HEAD', timeoutMs });
    if (response.status >= 300 && response.status < 400 && response.location) {
      try { current = new URL(response.location, current).toString(); continue; } catch {}
    }
    break;
  }
  if (!response || ([405, 501].includes(response.status) || !Number(response.headers['content-length']))) {
    const ranged = await request(current, { method: 'GET', headers: { range: 'bytes=0-0' }, timeoutMs });
    if (ranged.status) response = ranged;
  }
  const headers = response ? response.headers || {} : {};
  const contentRange = String(headers['content-range'] || '');
  const rangeMatch = /\/([0-9]+)$/.exec(contentRange);
  const totalBytes = Number(headers['content-length']) > 0 && !/^bytes 0-0\//i.test(contentRange)
    ? Number(headers['content-length'])
    : rangeMatch ? Number(rangeMatch[1]) : null;
  const status = Number(response && response.status) || 0;
  return { status, reachable: status >= 200 && status < 400, finalUrl: current, suggestedName: suggestedNameFromHeaders(current, headers), totalBytes, acceptRanges: String(headers['accept-ranges'] || '').toLowerCase() === 'bytes' || Boolean(rangeMatch) };
}

class CreateDraftService {
  constructor({ drafts, tasks, parser = null, sourceProbe = probeUrl, pathService, recentPaths = null, settings = null, driver = null, createTaskService = null, seedStore = null, ftpSecrets = null, magnetMetadata = null, groupService = null, oneKeyPolicy = null, clock = Date, runtimeDir = null } = {}) {
    if (!drafts || !tasks || !pathService) throw new Error('CreateDraftService drafts, tasks and pathService are required');
    this.drafts = drafts; this.tasks = tasks; this.parser = parser || new ProtocolParser({ driver }); this.sourceProbe = sourceProbe; this.pathService = pathService; this.recentPaths = recentPaths; this.settings = settings; this.driver = driver; this.createTaskService = createTaskService; this.seedStore = seedStore; this.ftpSecrets = ftpSecrets; this.magnetMetadata = magnetMetadata; this.groupService = groupService; this.oneKeyPolicy = oneKeyPolicy; this.clock = clock; this.runtimeDir = runtimeDir; this.idempotency = new Map();
  }

  _defaultPath() { return this.settings && this.settings.get ? this.settings.get().desired.downloadDir : this.pathService.defaultPath; }
  _safeName(name) { return this.pathService.validateDisplayName(name || 'download.bin'); }
  _draftDto(draft) {
    const copy = { ...draft };
    delete copy.seedRef;
    delete copy.metadataJob;
    const metadataState = draft.state === 'metadata'
      ? 'fetching'
      : draft.failure && String(draft.failure.code || '').startsWith('METADATA_')
        ? 'failed'
        : draft.seedRef && Array.isArray(draft.files) && draft.files.length
          ? 'ready'
          : 'none';
    const safeOptions = {};
    for (const key of ['probe', 'infoHash', 'infoId', 'duplicateResolution', 'btScheduler', 'startMode', 'oneKey', 'collision']) {
      if (draft.options && draft.options[key] !== undefined) safeOptions[key] = draft.options[key];
    }
    if (safeOptions.probe && typeof safeOptions.probe === 'object') {
      safeOptions.probe = {
        status: Number(safeOptions.probe.status) || 0,
        reachable: Boolean(safeOptions.probe.reachable),
        finalUrl: typeof safeOptions.probe.finalUrl === 'string' ? safeOptions.probe.finalUrl : null,
        suggestedName: typeof safeOptions.probe.suggestedName === 'string' ? safeOptions.probe.suggestedName : null,
        totalBytes: safeOptions.probe.totalBytes === null ? null : Number(safeOptions.probe.totalBytes) || null,
        acceptRanges: Boolean(safeOptions.probe.acceptRanges),
      };
    }
    return {
      ...copy,
      options: safeOptions,
      metadata: { state: metadataState },
      expiresAt: Number(copy.expiresAt),
      files: (copy.files || []).map((file) => ({ index: file.index, relativePath: file.relativePath, displayName: file.displayName, sizeBytes: file.sizeBytes, offsetBytes: file.offsetBytes, selected: file.selected, parentPath: file.parentPath })),
    };
  }

  async _preflightOne(input, { savePath, options = {} } = {}) {
    const raw = typeof input === 'string' ? input : input && (input.value || input.source || input.url);
    const parsed = await this.parser.parseInput(raw);
    let ftpSecretRef = null;
    if (parsed.kind === 'ftp' && parsed.ftpAuth) {
      if (!this.ftpSecrets) throw serviceError('FTP_SECRET_STORE_UNAVAILABLE', 'FTP 凭据存储不可用');
      ftpSecretRef = this.ftpSecrets.set(parsed.ftpAuth);
    }
    try {
    let pathCheck = this.pathService.validateDownloadTarget({ path: savePath || this._defaultPath(), estimatedBytes: parsed.totalBytes || 0 });
    if (!pathCheck.creatable || !pathCheck.writable) throw serviceError('PATH_NOT_WRITABLE', pathCheck.warnings.join('；') || '保存目录不可写', pathCheck);
    let probe = null;
    if (parsed.kind === 'http' || parsed.kind === 'https') {
      probe = await this.sourceProbe(parsed.normalizedSource);
      if (probe.status >= 400 && ![405, 501].includes(probe.status)) throw serviceError('SOURCE_UNREACHABLE', `下载源返回 HTTP ${probe.status}`, probe);
      parsed.totalBytes = probe.totalBytes;
      if (probe.suggestedName) parsed.displayName = probe.suggestedName;
      if (parsed.totalBytes !== null) {
        pathCheck = this.pathService.validateDownloadTarget({ path: pathCheck.normalizedPath, estimatedBytes: parsed.totalBytes });
        if (!pathCheck.creatable || !pathCheck.writable) throw serviceError('PATH_NOT_WRITABLE', pathCheck.warnings.join('；') || '保存目录不可写', pathCheck);
      }
    }
    const displayName = this._safeName(options.displayName || parsed.displayName || 'download.bin');
    const collision = this.pathService.resolveCollision({ directory: pathCheck.normalizedPath, displayName, policy: 'ask' });
    const fingerprint = sourceFingerprint(parsed.kind, parsed.normalizedSource, { infoHash: parsed.infoHash });
    const duplicateRecord = this.tasks.findDuplicate(fingerprint, pathCheck.normalizedPath);
    const duplicate = duplicateRecord ? { taskId: duplicateRecord.id, lifecycle: duplicateRecord.lifecycle, samePath: true, allowedResolutions: ['open-existing', 'redownload', 'rename', 'skip'] } : null;
    const configuredPolicy = typeof this.oneKeyPolicy === 'function' ? this.oneKeyPolicy() : this.oneKeyPolicy;
    const oneKey = decideOneKey({ kind: parsed.kind, totalBytes: parsed.totalBytes, duplicate, pathCheck, policy: options.oneKeyPolicy || configuredPolicy || {} });
    const draft = this.drafts.create({ state: parsed.kind === 'magnet' ? 'metadata' : 'ready', kind: parsed.kind, originalSource: parsed.kind === 'ftp' ? parsed.normalizedSource : raw, normalizedSource: parsed.normalizedSource, sourceFingerprint: fingerprint, displayName, totalBytes: parsed.totalBytes, files: parsed.files || [], selectedFileIndices: [], duplicate, savePath: pathCheck.normalizedPath, options: { ...options, probe, oneKey, collision, infoHash: parsed.infoHash || null, ...(ftpSecretRef ? { ftpSecretRef } : {}) } });
    if (parsed.kind === 'magnet' && this.magnetMetadata) {
      try { await this.magnetMetadata.start({ draft: this.drafts.get(draft.draftId) }); }
      catch (error) { try { this.drafts.mutate(draft.draftId, draft.revision, { state: 'failed', failure: { code: error.code || 'METADATA_START_FAILED', message: error.message } }); } catch {} throw error; }
    }
    this.recentPaths?.remember(pathCheck.normalizedPath);
    return this._draftDto(draft);
    } catch (error) {
      if (ftpSecretRef) this.ftpSecrets?.delete?.(ftpSecretRef);
      throw error;
    }
  }

  async preflight({ inputs, savePath, options = {} } = {}) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw serviceError('INVALID_ARGUMENT', 'inputs 必须包含 1 到 100 项');
    const inputBytes = inputs.reduce((sum, input) => sum + Buffer.byteLength(typeof input === 'string' ? input : input && (input.value || input.source || input.url) || '', 'utf8'), 0);
    if (inputBytes > 1024 * 1024) throw serviceError('INVALID_ARGUMENT', '批量链接总长度不能超过 1 MiB');
    const results = [];
    for (const input of inputs) { try { results.push({ ok: true, draft: await this._preflightOne(input, { savePath, options }) }); } catch (error) { results.push({ ok: false, error: { code: error.code || 'PREFLIGHT_FAILED', message: error.message, details: error.details } }); } }
    return { results };
  }

  async createTorrentDraftFromFile(filePath, { originalName = 'upload.torrent', savePath, options = {} } = {}) {
    if (!this.driver || typeof this.driver.parseTaskInfo !== 'function') throw serviceError('NATIVE_UNAVAILABLE', 'torrent 解析能力不可用');
    const parsed = await this.driver.parseTaskInfo({ kind: 'torrent', data: filePath });
    const files = (parsed.fileLists || []).map((file, index) => { const realIndex = Number.isSafeInteger(Number(file.realIndex)) ? Number(file.realIndex) : index; const relativePath = selectTorrentRelativePath(file, index); return { index: realIndex, relativePath, displayName: path.posix.basename(relativePath), sizeBytes: Number(file.fileSize) || 0, offsetBytes: Number(file.fileOffset) || 0, selected: true, parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath) }; });
    const target = this.pathService.validateDownloadTarget({ path: savePath || this._defaultPath(), estimatedBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) });
    if (!target.creatable || !target.writable) throw serviceError('PATH_NOT_WRITABLE', target.warnings.join('；') || '保存目录不可写', target);
    const source = parsed.infoId ? `bt:${parsed.infoId}` : `torrent:${originalName}`;
    const fingerprint = sourceFingerprint('bt', parsed.infoId || source, { infoId: parsed.infoId });
    const duplicateRecord = this.tasks.findDuplicate(fingerprint, target.normalizedPath);
    const duplicate = duplicateRecord ? { taskId: duplicateRecord.id, lifecycle: duplicateRecord.lifecycle, samePath: true, allowedResolutions: ['open-existing', 'redownload', 'rename', 'skip'] } : null;
    const displayName = this._safeName(options.displayName || parsed.title || originalName.replace(/\.torrent$/i, '') || 'download');
    const collision = this.pathService.resolveCollision({ directory: target.normalizedPath, displayName, policy: 'ask' });
    const seedRef = this.seedStore ? this.seedStore.importFile(filePath) : filePath;
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const configuredPolicy = typeof this.oneKeyPolicy === 'function' ? this.oneKeyPolicy() : this.oneKeyPolicy;
    const oneKey = decideOneKey({ kind: 'bt', totalBytes, pathCheck: target, policy: options.oneKeyPolicy || configuredPolicy || {} });
    const draft = this.drafts.create({ state: 'ready', kind: 'bt', originalSource: null, normalizedSource: null, sourceFingerprint: fingerprint, seedRef, displayName, totalBytes, files, selectedFileIndices: files.map((file) => file.index), duplicate, savePath: target.normalizedPath, options: { ...options, infoId: parsed.infoId, oneKey, collision } });
    this.seedStore?.retain?.(seedRef, `draft:${draft.draftId}`);
    return this._draftDto(draft);
  }

  async getDraft({ draftId } = {}) { let draft = this.drafts.require(draftId); if (draft.state === 'metadata' && this.magnetMetadata) draft = await this.magnetMetadata.pollOnce(draftId); const now = Number(this.clock.now ? this.clock.now() : Date.now()); if (draft.expiresAt <= now && !['committing', 'committed'].includes(draft.state)) { this.drafts.mutate(draftId, draft.revision, { state: 'expired' }); throw serviceError('DRAFT_EXPIRED', '任务草稿已过期'); } return this._draftDto(this.drafts.get(draftId)); }

  async updateDraft({ draftId, expectedRevision, selectedFileIndices, displayName, savePath, duplicateResolution, options } = {}) {
    const draft = this.drafts.require(draftId); const patch = {};
    if (selectedFileIndices !== undefined) { const selected = [...new Set((selectedFileIndices || []).map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0))]; patch.selectedFileIndices = selected; patch.files = draft.files.map((file) => ({ ...file, selected: selected.includes(file.index) })); }
    if (displayName !== undefined) patch.displayName = this._safeName(displayName);
    if (savePath !== undefined) { const checked = this.pathService.validateDownloadTarget({ path: savePath, estimatedBytes: draft.totalBytes || 0 }); if (!checked.writable) throw serviceError('PATH_NOT_WRITABLE', checked.warnings.join('；'), checked); patch.savePath = checked.normalizedPath; }
    if (duplicateResolution) patch.options = { ...(draft.options || {}), duplicateResolution };
    if (options) {
      const publicOptions = { ...options };
      delete publicOptions.ftpSecretRef;
      patch.options = { ...(patch.options || draft.options || {}), ...publicOptions };
    }
    if (options && options.retryMetadata === true && draft.kind === 'magnet' && draft.state === 'failed' && this.magnetMetadata) {
      const retrying = this.drafts.mutate(draftId, expectedRevision, { ...patch, state: 'metadata', failure: null, metadataJob: null });
      return this._draftDto(await this.magnetMetadata.start({ draft: retrying }));
    }
    return this._draftDto(this.drafts.mutate(draftId, expectedRevision, patch));
  }

  async commit({ draftIds, expectedRevisions = {}, idempotencyKey, group = null } = {}) {
    if (!Array.isArray(draftIds) || !draftIds.length) throw serviceError('INVALID_ARGUMENT', 'draftIds 不能为空');
    const key = idempotencyKey ? String(idempotencyKey) : null; if (key && this.idempotency.has(key)) return this.idempotency.get(key);
    const operationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; const results = [];
    for (const draftId of [...new Set(draftIds.map(String))].slice(0, 100)) {
      let draft;
      try {
        const suppliedRevision = expectedRevisions[draftId];
        draft = this.drafts.require(draftId);
        if (['bt', 'magnet'].includes(draft.kind) && draft.files.length && !draft.selectedFileIndices.length) throw serviceError('EMPTY_SELECTION', '至少选择一个文件后才能创建任务');
        const resolution = draft.options && draft.options.duplicateResolution;
        if (draft.duplicate && !['open-existing', 'redownload', 'rename', 'skip'].includes(resolution)) throw serviceError('DUPLICATE_TASK', '已存在相同任务，请选择处理方式', draft.duplicate);
        if (!draft.duplicate && draft.options && draft.options.collision && draft.options.collision.collision && !['rename', 'overwrite-never'].includes(resolution)) throw serviceError('NAME_COLLISION', '保存目录中已存在同名文件，请选择重命名', draft.options.collision);
        if ((draft.duplicate || draft.options && draft.options.collision && draft.options.collision.collision) && resolution === 'rename') {
          const collision = this.pathService.resolveCollision({ directory: draft.savePath, displayName: draft.displayName, policy: 'auto-rename' });
          if (collision.displayName !== draft.displayName) {
            draft = this.drafts.mutate(draftId, suppliedRevision, { displayName: collision.displayName });
          }
        }
        const commitRevision = draft.revision;
        draft = this.drafts.beginCommit(draftId, commitRevision, operationId);
        if (draft.duplicate && resolution === 'open-existing') {
          this.drafts.finishCommit(draftId, operationId, [draft.duplicate.taskId]);
          this.seedStore?.release?.(draft.seedRef, `draft:${draftId}`);
          if (draft.options && draft.options.ftpSecretRef) this.ftpSecrets?.delete?.(draft.options.ftpSecretRef);
          results.push({ draftId, ok: true, taskIds: [draft.duplicate.taskId] });
          continue;
        }
        if (draft.duplicate && resolution === 'skip') {
          this.drafts.finishCommit(draftId, operationId, []);
          this.seedStore?.release?.(draft.seedRef, `draft:${draftId}`);
          if (draft.options && draft.options.ftpSecretRef) this.ftpSecrets?.delete?.(draft.options.ftpSecretRef);
          results.push({ draftId, ok: true, taskIds: [] });
          continue;
        }
        const taskId = await this.createTaskService.commitDraft({ ...draft, savePath: draft.savePath }, { seedStore: this.seedStore });
        if (taskId && draft.seedRef) { this.seedStore?.retain?.(draft.seedRef, `task:${taskId}`); this.seedStore?.release?.(draft.seedRef, `draft:${draftId}`); }
        this.drafts.finishCommit(draftId, operationId, taskId ? [taskId] : []);
        results.push({ draftId, ok: true, taskIds: taskId ? [taskId] : [] });
      }
      catch (error) { try { if (draft && draft.state === 'committing') this.drafts.mutate(draftId, undefined, { state: 'ready', failure: mapNativeError(error.message, { code: error.code || 'COMMIT_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }) }); } catch {} results.push({ draftId, ok: false, error: { code: error.code || 'COMMIT_FAILED', message: error.message } }); }
    }
    let groupId = null;
    const successfulTaskIds = results.flatMap((item) => item.ok && Array.isArray(item.taskIds) ? item.taskIds : []).filter(Boolean);
    if (group && this.groupService && successfulTaskIds.length > 0) {
      try { groupId = this.groupService.create({ label: group.label || '任务组', taskIds: successfulTaskIds }).id; }
      catch (error) { results.push({ draftId: '__group__', ok: false, error: { code: error.code || 'GROUP_CREATE_FAILED', message: error.message } }); }
    }
    const response = { operationId, results, ...(groupId ? { groupId } : {}) }; if (key) this.idempotency.set(key, response); return response;
  }

  async cancel({ draftIds, reason = 'user' } = {}) { if (!Array.isArray(draftIds)) throw serviceError('INVALID_ARGUMENT', 'draftIds 不能为空'); const results = []; for (const draftId of [...new Set(draftIds.map(String))]) { try { const draft = this.drafts.get(draftId); const cancelled = draft && draft.kind === 'magnet' && this.magnetMetadata ? await this.magnetMetadata.cancel(draftId, reason) : this.drafts.cancel(draftId, reason); if (cancelled && cancelled.state === 'cancelled' && cancelled.seedRef) this.seedStore?.release?.(cancelled.seedRef, `draft:${draftId}`); if (cancelled && cancelled.state === 'cancelled' && draft && draft.options && draft.options.ftpSecretRef) this.ftpSecrets?.delete?.(draft.options.ftpSecretRef); results.push({ draftId, ok: true, draft: this._draftDto(cancelled) }); } catch (error) { results.push({ draftId, ok: false, error: { code: error.code || 'CANCEL_FAILED', message: error.message } }); } } return { results }; }
  sweepExpired(at = Date.now()) { const before = this.drafts.list(); const count = this.drafts.sweepExpired(at); if (count) { const retained = new Set(this.drafts.list().map((draft) => draft.draftId)); for (const draft of before) { if (!retained.has(draft.draftId) && draft.seedRef) this.seedStore?.release?.(draft.seedRef, `draft:${draft.draftId}`); if (draft.expiresAt <= at && !['committed', 'committing'].includes(draft.state) && draft.options && draft.options.ftpSecretRef) this.ftpSecrets?.delete?.(draft.options.ftpSecretRef); } } return count; }
  listRecentPaths() { return { paths: this.pathService.listRecentPaths() }; }
  removeRecentPath(input) { if (!this.recentPaths || typeof this.recentPaths.remove !== 'function') return { paths: this.pathService.listRecentPaths() }; this.recentPaths.remove(this.pathService.normalizeDownloadPath(input && input.path)); return { paths: this.pathService.listRecentPaths() }; }
  clearRecentPaths() { if (this.recentPaths && typeof this.recentPaths.clear === 'function') this.recentPaths.clear(); return { paths: this.pathService.listRecentPaths() }; }
  validatePath({ path: input, estimatedBytes = 0 } = {}) { return this.pathService.validateDownloadTarget({ path: input, estimatedBytes }); }
}

module.exports = { CreateDraftService, probeUrl, safeRelative };
