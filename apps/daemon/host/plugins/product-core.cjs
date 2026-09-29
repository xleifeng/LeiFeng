'use strict';
// product-core（P4 拆分残留聚合核，原 product-services）：bootstrap 快照聚合
// + diagnostics 聚合 + account shell 协作者晚绑定。对 UI 能力不再贡献面板
// （各域插件自持）；本插件消费 private-space / media-capture / remote-access /
// history-links 槽构造装配级聚合视图——它们缺席时各段诚实降级。
const { DiagnosticsService } = require('../src/services/diagnostics-service');
const { BootstrapService } = require('../src/services/bootstrap-service');
const { createDiagnosticsControlMethods } = require('../src/rpc/diagnostics-control-methods');
const { createSystemMethods } = require('../src/rpc/system-methods');
const { plugin } = require('./shared.cjs');

const productCore = plugin('leifeng-product-core', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengTasks', 'leifengRpc', 'leifengRequestPolicy', 'leifengUiRegistry'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const { taskRepository, settingsRepository, operationRepository } = ctx.leifengRepositories;
  // 零内核装配：hub 返回 NullKernel slot（bootstrap/diagnostics 诚实降级，
  // engine 段 sdkReady=false、能力面 protocols 空）——软件与内核不强相关。
  const kernelSlot = ctx.leifengKernelHub.default();
  if (!kernelSlot) throw new Error('product-core: no kernel slot from hub');
  const { kernel: driver, eventBus, diagnosticEvents } = kernelSlot;
  const { auth = null, vipManager = null, accountService = null } = kernelSlot.account || {};
  const { policyService } = ctx.leifengTasks;
  // 四域插件可选消费（域插件被禁用时聚合视图逐段诚实降级——P4 拆分时各服务
  // 构造器已带 = null 缺省，此处只是把「装配期硬依赖」放成运行期缺席）。
  const { privateSpace } = ctx.reflect.get('leifengPrivateSpace', false) ?? { privateSpace: null };
  const { mediaService } = ctx.reflect.get('leifengMediaCapture', false) ?? { mediaService: null };
  const { remoteNodeService = null, remoteCredentialsReady = null, linkSyncService = null } = ctx.reflect.get('leifengRemoteAccess', false) ?? {};
  const { requestAuth } = ctx.leifengRequestPolicy;

  const diagnosticsService = new DiagnosticsService({
    config: appConfig, tasks: taskRepository, driver, settings: settingsRepository,
    events: diagnosticEvents, privateSpace, media: mediaService,
    remoteNodes: remoteNodeService, operations: operationRepository,
    policy: policyService, auth, vip: vipManager,
  });
  const bootstrapService = new BootstrapService({
    repository: taskRepository, settings: settingsRepository, driver, auth,
    accountService, vipService: vipManager, privateSpace,
    capabilityProvider: () => driver.nativeCapabilities || {}, config: appConfig,
    policyService, mediaService, requestAuth, remoteEnabledProvider: remoteCredentialsReady,
    uiCapabilitiesProvider: () => ctx.leifengUiRegistry.snapshot(),
  });
  // AccountService 已随迅雷绑定域归 kernel-thunder：从 kernel account 槽取实例，
  // 本插件只做 shell 协作者晚绑定注入（logout 协调链恢复现语义）——注入前
  // kernel 侧 logout 只做 auth 清理。qbit-only 下 account 槽整体缺席，跳过
  // 注入（与缺席语义一致）。
  if (accountService) accountService.attachShellCollaborators({ privateSpace, linkSync: linkSyncService });

  ctx.provide('leifengProducts', {
    diagnosticsService, requestAuth, bootstrapService,
  });
  const withdrawV2 = ctx.leifengRpc.registry.register('product-core', new Map([
    ['leifeng.ui.v2.bootstrap', (_params, ctx) => bootstrapService.getSnapshot(ctx)],
    // system.restartEngine 是内核生命周期面（driver+operations+eventBus 聚合），
    // P4 拆分时随聚合核注册（media-capture 侧只注册 system.mediaCapabilities）。
    ...createSystemMethods({ systemIntegration: null, media: null, driver, operations: operationRepository, eventBus }),
  ]));
  const withdrawControl = ctx.leifengRpc.registry.register('product-core', createDiagnosticsControlMethods({ diagnostics: diagnosticsService, config: appConfig }));
  const withdrawBuckets = ctx.leifengRequestPolicy.rateLimiter.addBuckets({
    'diagnostics-export': { limit: 5, windowMs: 60 * 60 * 1000, concurrency: 1 },
  });
  ctx.effect(() => () => {
    withdrawV2(); withdrawControl(); withdrawBuckets();
  });
});

module.exports = { productCore };
