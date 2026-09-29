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

// 连接语义宿主：跨方法共享的连接状态（lease 表、上传幂等缓存）与 control 面鉴权/
// 限流/暂存文件校验原语。业务方法已全部 registry 化（2026-09-28 rpc-plugin-registration），
// dispatcher 只剩 daemon.v1 三机制方法（health/web.invoke/lease.release）+ 查表分发。
class DaemonControlDispatcher {
  constructor({
    config, handle, registry, requestAuth, rateLimiter, uploadsRoot, startedAt = Date.now(),
  } = {}) {
    if (!config || typeof handle !== 'function') throw new Error('DaemonControlDispatcher dependencies are incomplete');
    this.config = config;
    this.handle = handle;
    this.registry = registry;
    this.requestAuth = requestAuth;
    this.rateLimiter = rateLimiter;
    this.uploadsRoot = uploadsRoot || (config.uploadsDir && path.resolve(config.uploadsDir)) || null;
    this.startedAt = startedAt;
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

  _stagedFile(filePath) {
    const root = this.uploadsRoot || path.resolve(this.config.uploadsDir);
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
    this.leases.delete(String(leaseId || ''));
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
      case 'daemon.v1.health': {
        const sections = await this.registry?.healthSections?.();
        return {
          protocolVersion: 1,
          daemonVersion: this.config.version,
          pid: process.pid,
          startedAt: this.startedAt,
          repositoryRevision: Number(sections?.repositories?.revision) || 0,
          engine: sections?.engine || null,
        };
      }
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
      case 'daemon.v1.web.lease.release':
        return { released: this._release(params.leaseId, owner) };
      default: {
        const handler = this.registry && this.registry.get(method);
        if (!handler) throw controlError('CONTROL_METHOD_NOT_FOUND', `Unknown daemon control method: ${method}`);
        return handler(params, { connection, owner, dispatcher: this, registry: this.registry });
      }
    }
  }
}

module.exports = { DaemonControlDispatcher, controlError, safeFilename, requirePermission };
