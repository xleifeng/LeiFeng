'use strict';
// daemon.v1.web.{media,capture,diagnostics} + daemon.v1.remote.* 的注册工厂
// （rpc-plugin-registration 拆分：product 域归 product-services）。
// 连接语义（lease/rate/暂存校验）经 ctx.dispatcher；远程面权限模型经
// requirePermission + pairing clients 表（远程 principal 属 product 域服务）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { finished } = require('node:stream/promises');
const { controlError, safeFilename, requirePermission } = require('../control/dispatcher');

function remotePrincipalOf(remotePairing, fingerprint) {
  const value = String(fingerprint || '').toLowerCase();
  const principal = remotePairing?.clients?.get?.(value);
  if (!principal || principal.revokedAt) throw controlError('REMOTE_CERT_REJECTED', '远程客户端证书未授权');
  return principal;
}

function createProductControlMethods({ media, capture, diagnostics, remotePairing, taskQueryService, operationService, createDraftService, config }) {
  const methods = [];
  methods.push(['daemon.v1.web.media.issueToken', (params, ctx) => {
    const d = ctx.dispatcher;
    d._assertBearer(params.context);
    d._assertCsrf(params.context, 'media.issueToken');
    d._rate('media-token', params.context);
    return media.issueToken(params.input || {}, params.context || {});
  }]);
  methods.push(['daemon.v1.web.media.open', (params, ctx) => {
    const content = media.resolveContent(params.input || {}, params.context || {});
    const leaseId = ctx.dispatcher._lease(ctx.owner, { release: content.release });
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
  }]);
  methods.push(['daemon.v1.web.capture.originAllowed', (params) =>
    ({ allowed: capture.tokens.isOriginAllowed(String(params.origin || '')) })]);
  methods.push(['daemon.v1.web.capture.acceptPairing', (params, ctx) => {
    ctx.dispatcher._rate('capture', params.context);
    if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
    return capture.acceptPairing(params.input || {});
  }]);
  methods.push(['daemon.v1.web.capture.authenticate', (params) => {
    const principal = capture.authenticate(String(params.token || ''), String(params.origin || ''));
    return { principal: principal ? { ...principal, clientId: principal.id } : null };
  }]);
  methods.push(['daemon.v1.web.capture.submit', (params, ctx) => {
    ctx.dispatcher._rate('capture', params.context);
    if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
    return capture.capture(params.input || {}, params.principal || {});
  }]);
  methods.push(['daemon.v1.web.capture.torrent', (params, ctx) => {
    const d = ctx.dispatcher;
    d._rate('capture', params.context);
    if (!params.context?.isLoopback && !params.allowRemote) throw controlError('CAPTURE_LOOPBACK_ONLY', '浏览器接管只允许 loopback');
    const staged = d._stagedFile(params.filePath);
    if (staged.stat.size > config.maxTorrentUploadBytes) throw controlError('UPLOAD_TOO_LARGE', 'torrent 文件超过大小限制');
    return capture.captureTorrent({ filePath: staged.path, originalName: safeFilename(params.originalName, 'capture.torrent') }, params.principal || {});
  }]);
  methods.push(['daemon.v1.web.diagnostics.export', async (params, ctx) => {
    const d = ctx.dispatcher;
    d._assertBearer(params.context);
    const rate = d._rate('diagnostics-export', params.context);
    let leased = false;
    try {
      const exportId = String(params.exportId || '');
      const manifest = diagnostics.getManifest(exportId);
      const exportDir = path.join(config.runtimeDir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true, mode: 0o700 });
      const target = path.join(exportDir, `${crypto.randomUUID()}.zip`);
      const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
      try {
        const completion = finished(output);
        await diagnostics.createArchive(exportId, output);
        await completion;
      } catch (error) {
        output.destroy();
        try { fs.rmSync(target, { force: true }); } catch {}
        throw error;
      }
      const stat = fs.statSync(target);
      const leaseId = d._lease(ctx.owner, { deletePath: target, release: () => d.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId }) });
      leased = true;
      return { leaseId, path: target, length: stat.size, manifest };
    } finally {
      if (!leased) d.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId });
    }
  }]);
  methods.push(['daemon.v1.remote.hello', (params, ctx) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'view');
    const sections = ctx.registry?.healthSectionsSync?.() || {};
    return { protocolVersion: 1, daemonVersion: config.version, nodeId: params.nodeId, capabilities: { query: true, command: true, submit: true, media: true }, repositoryRevision: Number(sections?.repositories?.revision) || 0 };
  }]);
  methods.push(['daemon.v1.remote.pairing.accept', (params) => remotePairing.acceptClient(params.input || {})]);
  methods.push(['daemon.v1.remote.tasks.query', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'view');
    return taskQueryService.query(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.tasks.command', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'control');
    return operationService.execute(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.drafts.preflight', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'submit');
    return createDraftService.preflight(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.drafts.commit', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'submit');
    return createDraftService.commit(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.media.issueToken', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'stream');
    return media.issueToken(params.input || {}, {});
  }]);
  return methods;
}

module.exports = { createProductControlMethods, remotePrincipalOf };
