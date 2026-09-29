'use strict';
// media-capture（P4 拆分自 product-services）：媒体播放（token 流）+ 浏览器
// 接管（capture）。限流桶 media-token/capture 随本插件贡献并撤销；私密面经
// leifengPrivateSpace 槽（缺席即媒体私密门失效——私有任务流拒发 token）。
const { MediaService } = require('../src/services/media-service');
const { CaptureService } = require('../src/services/capture-service');
const { createMediaCaptureControlMethods } = require('../src/rpc/media-capture-control-methods');
const { createSystemMethods } = require('../src/rpc/system-methods');
const { plugin } = require('./shared.cjs');

const mediaCapture = plugin('leifeng-media-capture', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengTasks', 'leifengRpc', 'leifengRequestPolicy', 'leifengUiRegistry'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const { taskRepository, mediaSecretStore, captureTokenStore } = ctx.leifengRepositories;
  const { createDraftService, safePathResolver } = ctx.leifengTasks;
  // privateSpace 可选消费（禁用 private-space 时媒体私密门失效——私有任务流拒发 token，公网流照常）
  const { privateSpace } = ctx.reflect.get('leifengPrivateSpace', false) ?? { privateSpace: null };
  const withdrawUiCapabilities = ctx.leifengUiRegistry.contribute('media-capture', ['media', 'capture']);

  const mediaService = new MediaService({
    tasks: taskRepository, resolver: safePathResolver,
    secretStore: mediaSecretStore, privateSpace,
  });
  const captureHost = ['0.0.0.0', '::'].includes(appConfig.host) ? '127.0.0.1' : appConfig.host;
  const captureEndpoint = `http://${captureHost.includes(':') ? `[${captureHost}]` : captureHost}:${appConfig.port}`;
  const captureService = new CaptureService({
    tokenStore: captureTokenStore, createDraftService,
    desktopConfigPath: appConfig.captureClientConfigPath,
    endpoint: captureEndpoint,
  });

  ctx.provide('leifengMediaCapture', { mediaService, captureService });
  const withdrawV2 = ctx.leifengRpc.registry.register('media-capture', createSystemMethods({ systemIntegration: null, media: mediaService }));
  const withdrawControl = ctx.leifengRpc.registry.register('media-capture', createMediaCaptureControlMethods({ media: mediaService, capture: captureService, config: appConfig }));
  const withdrawBuckets = ctx.leifengRequestPolicy.rateLimiter.addBuckets({
    'media-token': { limit: 60, windowMs: 60 * 1000 },
    capture: { limit: 60, windowMs: 60 * 1000 },
  });
  ctx.effect(() => () => {
    withdrawV2(); withdrawControl(); withdrawUiCapabilities(); withdrawBuckets();
  });
});

module.exports = { mediaCapture };
