'use strict';
// daemon.v1.web.{media,capture} 注册工厂（P4 拆分：media/capture 域归
// media-capture 插件）。连接语义（lease/rate/暂存校验）经 ctx.dispatcher。
const { controlError, safeFilename } = require('../control/dispatcher');

function createMediaCaptureControlMethods({ media, capture, config }) {
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
  return methods;
}

module.exports = { createMediaCaptureControlMethods };
