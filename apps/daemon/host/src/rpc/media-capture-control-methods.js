'use strict';
// daemon.v1.web.media 注册工厂（P4 拆分：media 域归 media-capture 插件；capture
// 域已随远程下载功能整层删除，2026-09-29）。连接语义（lease/rate）经 ctx.dispatcher。
const { controlError, safeFilename } = require('../control/dispatcher');

function createMediaControlMethods({ media, config }) {
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
  return methods;
}

module.exports = { createMediaControlMethods };
