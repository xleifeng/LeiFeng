'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { finished } = require('node:stream/promises');

function controlError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function safeFilename(value, fallback) {
  const name = path.basename(String(value || fallback).replace(/\\/g, '/')).replace(/[\r\n"/\\]+/g, '_').slice(0, 180);
  return name || fallback;
}

function requirePermission(principal, permission) {
  if (!principal || !Array.isArray(principal.permissions) || !principal.permissions.includes(permission)) {
    throw controlError('REMOTE_PERMISSION_DENIED', '远程节点权限不足');
  }
}

class DaemonControlDispatcher {
  constructor({
    config, handle, driver, tasks, seedStore, createDraftService, media, capture,
    diagnostics, remotePairing, taskQueryService, operationService, requestAuth,
    rateLimiter,
  } = {}) {
    if (!config || typeof handle !== 'function') throw new Error('DaemonControlDispatcher dependencies are incomplete');
    this.config = config;
    this.handle = handle;
    this.driver = driver;
    this.tasks = tasks;
    this.seedStore = seedStore;
    this.createDraftService = createDraftService;
    this.media = media;
    this.capture = capture;
    this.diagnostics = diagnostics;
    this.remotePairing = remotePairing;
    this.taskQueryService = taskQueryService;
    this.operationService = operationService;
    this.requestAuth = requestAuth;
    this.rateLimiter = rateLimiter;
    this.startedAt = Date.now();
    this.leases = new Map();
    this.completedUploads = new Map();
  }

  _owner(connection) { return connection && connection.id || 'unknown'; }

  _assertBearer(context = {}) {
    if (!this.config.rpcSecret) return;
    if (context.authorization !== `Bearer ${this.config.rpcSecret}`) throw controlError('UNAUTHORIZED', '需要 Bearer 鉴权');
  }

  _assertCsrf(context = {}, method = '') {
    this.requestAuth?.assertCsrf?.({
      token: context.csrfToken,
      principalId: context.bearerToken || 'loopback',
      origin: context.origin,
      host: context.host || this.config.host,
      port: context.port || this.config.port,
      isLoopback: context.isLoopback === true,
      required: true,
      method,
    });
  }

  _rate(bucket, context = {}) {
    const principalId = context.remoteAddress || context.bearerToken || 'loopback';
    const result = this.rateLimiter?.check?.({ bucket, principalId });
    if (result && !result.allowed) throw controlError('RATE_LIMITED', '请求过于频繁', { retryAfterMs: result.retryAfterMs });
    return { principalId, result };
  }

  _remotePrincipal(fingerprint) {
    const value = String(fingerprint || '').toLowerCase();
    const principal = this.remotePairing?.clients?.get?.(value);
    if (!principal || principal.revokedAt) throw controlError('REMOTE_CERT_REJECTED', '远程客户端证书未授权');
    return principal;
  }

  _stagedFile(filePath) {
    const root = path.resolve(this.config.uploadsDir);
    const target = path.resolve(String(filePath || ''));
    if (!target.startsWith(`${root}${path.sep}`)) throw controlError('STAGED_FILE_INVALID', '暂存文件不属于 daemon uploads 目录');
    let stat;
    try { stat = fs.lstatSync(target); } catch { throw controlError('STAGED_FILE_NOT_FOUND', '暂存文件不存在'); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw controlError('STAGED_FILE_INVALID', '暂存对象必须是普通文件');
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(`${realRoot}${path.sep}`)) throw controlError('STAGED_FILE_INVALID', '暂存文件越过 daemon uploads 边界');
    return { path: realTarget, stat };
  }

  _lease(owner, value) {
    const leaseId = crypto.randomUUID();
    this.leases.set(leaseId, { owner, ...value });
    return leaseId;
  }

  _release(leaseId, owner, { force = false } = {}) {
    const lease = this.leases.get(String(leaseId || ''));
    if (!lease || (!force && lease.owner !== owner)) return false;
    this.leases.delete(String(leaseId));
    try { lease.release?.(); } catch {}
    if (lease.deletePath) { try { fs.rmSync(lease.deletePath, { force: true }); } catch {} }
    return true;
  }

  releaseConnection(connection) {
    const owner = this._owner(connection);
    for (const [leaseId, lease] of this.leases) if (lease.owner === owner) this._release(leaseId, owner, { force: true });
  }

  async dispatch(method, params = {}, connection = {}) {
    const owner = this._owner(connection);
    switch (method) {
      case 'daemon.v1.health':
        return {
          protocolVersion: 1,
          daemonVersion: this.config.version,
          pid: process.pid,
          startedAt: this.startedAt,
          repositoryRevision: Number(this.tasks?.repositoryRevision) || 0,
          engine: {
            transportReady: Boolean(this.driver?.isHealthy?.()),
            sdkReady: this.driver?.sdkReady === true,
            generation: Number(this.driver?._generation) || 0,
          },
        };
      case 'daemon.v1.web.invoke':
        if (typeof params.method !== 'string') throw controlError('INVALID_ARGUMENT', 'Web RPC method is required');
        this.requestAuth?.assertRpc?.({
          method: params.method,
          csrfToken: params.context?.csrfToken,
          principalId: params.context?.bearerToken || 'loopback',
          origin: params.context?.origin,
          host: params.context?.host || this.config.host,
          port: params.context?.port || this.config.port,
          userAgent: params.context?.userAgent || '',
          clientType: params.context?.clientType || '',
          isLoopback: params.context?.isLoopback === true,
        });
        return this.handle(params.method, params.params, params.context || {});
      case 'daemon.v1.web.torrent.import': {
        this._assertBearer(params.context);
        this._assertCsrf(params.context, 'torrent.import');
        const idempotencyKey = String(params.idempotencyKey || '').trim();
        if (idempotencyKey && (idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) throw controlError('INVALID_IDEMPOTENCY_KEY', 'idempotency key 无效');
        const cacheKey = idempotencyKey ? `${params.context?.bearerToken || 'loopback'}:${idempotencyKey}` : '';
        const cached = cacheKey && this.completedUploads.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.result;
        const staged = this._stagedFile(params.filePath);
        if (staged.stat.size > this.config.maxTorrentUploadBytes) throw controlError('UPLOAD_TOO_LARGE', 'torrent 文件超过大小限制');
        const first = fs.readFileSync(staged.path).subarray(0, 1);
        if (!first.length || first[0] !== 0x64) throw controlError('INVALID_TORRENT', 'torrent bencode 无效');
        const draft = await this.createDraftService.createTorrentDraftFromFile(staged.path, { originalName: safeFilename(params.originalName, 'upload.torrent') });
        const result = { draft };
        if (cacheKey) {
          this.completedUploads.set(cacheKey, { result, expiresAt: Date.now() + 10 * 60 * 1000 });
          while (this.completedUploads.size > 256) this.completedUploads.delete(this.completedUploads.keys().next().value);
        }
        return result;
      }
      case 'daemon.v1.web.torrent.export': {
        this._assertBearer(params.context);
        let task;
        try { task = this.tasks.require(String(params.taskId || '')); } catch { throw controlError('TASK_NOT_FOUND', '任务不存在'); }
        if (!task.seedRef) throw controlError('SEED_NOT_FOUND', '任务没有可导出的种子');
        let target;
        try { target = this.seedStore.resolve(task.seedRef); } catch { throw controlError('SEED_NOT_FOUND', '种子不存在'); }
        const stat = fs.statSync(target);
        const leaseId = this._lease(owner, {});
        return { leaseId, path: target, length: stat.size, filename: safeFilename(task.displayName, 'task').replace(/\.torrent$/i, '') + '.torrent' };
      }
      case 'daemon.v1.web.media.issueToken':
        this._assertBearer(params.context);
        this._assertCsrf(params.context, 'media.issueToken');
        this._rate('media-token', params.context);
        return this.media.issueToken(params.input || {}, params.context || {});
      case 'daemon.v1.web.media.open': {
        const content = this.media.resolveContent(params.input || {}, params.context || {});
        const leaseId = this._lease(owner, { release: content.release });
        return {
          leaseId,
          path: content.target,
          status: content.status,
          mimeType: content.mimeType,
          disposition: content.disposition,
          etag: content.etag,
          start: content.start,
          end: content.end,
          length: content.length,
          availableBytes: content.availableBytes,
          complete: content.complete,
          contentRange: content.contentRange,
          displayName: content.task.displayName || 'download',
        };
      }
      case 'daemon.v1.web.lease.release':
        return { released: this._release(params.leaseId, owner) };
      case 'daemon.v1.web.capture.originAllowed':
        return { allowed: this.capture.tokens.isOriginAllowed(String(params.origin || '')) };
      case 'daemon.v1.web.capture.acceptPairing':
        this._rate('capture', params.context);
        if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
        return this.capture.acceptPairing(params.input || {});
      case 'daemon.v1.web.capture.authenticate': {
        const principal = this.capture.authenticate(String(params.token || ''), String(params.origin || ''));
        return { principal: principal ? { ...principal, clientId: principal.id } : null };
      }
      case 'daemon.v1.web.capture.submit':
        this._rate('capture', params.context);
        if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
        return this.capture.capture(params.input || {}, params.principal || {});
      case 'daemon.v1.web.capture.torrent': {
        this._rate('capture', params.context);
        if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
        const staged = this._stagedFile(params.filePath);
        if (staged.stat.size > this.config.maxTorrentUploadBytes) throw controlError('UPLOAD_TOO_LARGE', 'torrent 文件超过大小限制');
        return this.capture.captureTorrent({ filePath: staged.path, originalName: safeFilename(params.originalName, 'capture.torrent') }, params.principal || {});
      }
      case 'daemon.v1.web.diagnostics.export': {
        this._assertBearer(params.context);
        const rate = this._rate('diagnostics-export', params.context);
        let leased = false;
        try {
          const exportId = String(params.exportId || '');
          const manifest = this.diagnostics.getManifest(exportId);
          const exportDir = path.join(this.config.runtimeDir, 'exports');
          fs.mkdirSync(exportDir, { recursive: true, mode: 0o700 });
          const target = path.join(exportDir, `${crypto.randomUUID()}.zip`);
          const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
          try {
            const completion = finished(output);
            await this.diagnostics.createArchive(exportId, output);
            await completion;
          } catch (error) {
            output.destroy();
            try { fs.rmSync(target, { force: true }); } catch {}
            throw error;
          }
          const stat = fs.statSync(target);
          const leaseId = this._lease(owner, { deletePath: target, release: () => this.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId }) });
          leased = true;
          return { leaseId, path: target, length: stat.size, manifest };
        } finally {
          if (!leased) this.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId });
        }
      }
      case 'daemon.v1.remote.hello':
        requirePermission(this._remotePrincipal(params.fingerprint), 'view');
        return { protocolVersion: 1, daemonVersion: this.config.version, nodeId: params.nodeId, capabilities: { query: true, command: true, submit: true, media: true }, repositoryRevision: Number(this.tasks?.repositoryRevision) || 0 };
      case 'daemon.v1.remote.pairing.accept':
        return this.remotePairing.acceptClient(params.input || {});
      case 'daemon.v1.remote.tasks.query':
        requirePermission(this._remotePrincipal(params.fingerprint), 'view');
        return this.taskQueryService.query(params.input || {});
      case 'daemon.v1.remote.tasks.command':
        requirePermission(this._remotePrincipal(params.fingerprint), 'control');
        return this.operationService.execute(params.input || {});
      case 'daemon.v1.remote.drafts.preflight':
        requirePermission(this._remotePrincipal(params.fingerprint), 'submit');
        return this.createDraftService.preflight(params.input || {});
      case 'daemon.v1.remote.drafts.commit':
        requirePermission(this._remotePrincipal(params.fingerprint), 'submit');
        return this.createDraftService.commit(params.input || {});
      case 'daemon.v1.remote.media.issueToken':
        requirePermission(this._remotePrincipal(params.fingerprint), 'stream');
        return this.media.issueToken(params.input || {}, {});
      default:
        throw controlError('CONTROL_METHOD_NOT_FOUND', `Unknown daemon control method: ${method}`);
    }
  }
}

module.exports = { DaemonControlDispatcher, controlError, safeFilename, requirePermission };
