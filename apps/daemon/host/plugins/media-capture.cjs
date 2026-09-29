'use strict';
// media-capture（P4 拆分自 product-services）：媒体播放（token 流）。浏览器
// 接管（capture）已随远程下载功能整层删除（2026-09-29）；插件 id 与槽名
// 保留（media-capture / leifengMediaCapture）避免迁移。私密面经
// leifengPrivateSpace 槽（缺席即媒体私密门失效——私有任务流拒发 token）。
const { MediaService } = require('../src/services/media-service');
const { createSystemMethods } = require('../src/rpc/system-methods');
const { createMediaControlMethods } = require('../src/rpc/media-capture-control-methods');
const { plugin } = require('./shared.cjs');

const mediaCapture = plugin('leifeng-media-capture', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengTasks', 'leifengRpc', 'leifengRequestPolicy', 'leifengUiRegistry'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const { taskRepository, mediaSecretStore } = ctx.leifengRepositories;
  const { safePathResolver } = ctx.leifengTasks;
  // privateSpace 可选消费（禁用 private-space 时媒体私密门失效——私有任务流拒发 token，公网流照常）
  const { privateSpace } = ctx.reflect.get('leifengPrivateSpace', false) ?? { privateSpace: null };
  const withdrawUiCapabilities = ctx.leifengUiRegistry.contribute('media-capture', ['media']);

  const mediaService = new MediaService({
    tasks: taskRepository, resolver: safePathResolver,
    secretStore: mediaSecretStore, privateSpace,
  });
  ctx.provide('leifengMediaCapture', { mediaService });
  const withdrawV2 = ctx.leifengRpc.registry.register('media-capture', createSystemMethods({ systemIntegration: null, media: mediaService }));
  const withdrawControl = ctx.leifengRpc.registry.register('media-capture', createMediaControlMethods({ media: mediaService, config: appConfig }));
  const withdrawBuckets = ctx.leifengRequestPolicy.rateLimiter.addBuckets({
    'media-token': { limit: 60, windowMs: 60 * 1000 },
  });
  ctx.effect(() => () => {
    withdrawV2(); withdrawControl(); withdrawUiCapabilities(); withdrawBuckets();
  });
});

module.exports = { mediaCapture };
