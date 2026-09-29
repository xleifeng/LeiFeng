'use strict';
// private-space（P4 拆分自 product-services）：私密空间 + 桌面通知。
// 独立生命周期：sweep 定时器与锁密清理随本插件 dispose；其他产品域插件
// （media/history/links/bootstrap/diagnostics）经 leifengPrivateSpace 槽消费。
const { DesktopNotificationAdapter } = require('../src/adapters/desktop-notification-adapter');
const { NotificationService } = require('../src/services/notification-service');
const { PrivateSpaceService } = require('../src/services/private-space-service');
const { createPrivateSpaceMethods } = require('../src/rpc/private-space-methods');
const { plugin } = require('./shared.cjs');

const privateSpace = plugin('leifeng-private-space', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengTasks', 'leifengRpc', 'leifengUiRegistry'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const { taskRepository, privateSecretStore } = ctx.leifengRepositories;
  const kernelSlot = ctx.leifengKernelHub?.default?.();
  const eventBus = kernelSlot?.eventBus;
  const { fileOperationService, pathService, processRunner } = ctx.leifengTasks;
  const withdrawUiCapabilities = ctx.leifengUiRegistry.contribute('private-space', ['private-space']);

  const notificationService = new NotificationService({
    eventBus, tasks: taskRepository,
    adapter: new DesktopNotificationAdapter({ processRunner }),
  });
  const privateSpaceService = new PrivateSpaceService({
    secretStore: privateSecretStore, tasks: taskRepository,
    fileOperations: fileOperationService, pathService,
    defaultDirectory: appConfig.privateSpaceDir,
  });

  ctx.provide('leifengPrivateSpace', { privateSpace: privateSpaceService, notificationService });
  const withdrawV2 = ctx.leifengRpc.registry.register('private-space', createPrivateSpaceMethods({ privateSpace: privateSpaceService }));
  let sweepTimer;
  ctx.effect(() => async () => {
    withdrawV2();
    withdrawUiCapabilities();
    if (sweepTimer) clearInterval(sweepTimer);
    notificationService.stop();
    privateSpaceService.lockAll('shutdown', { clearKey: true });
  });
  notificationService.start();
  sweepTimer = setInterval(() => privateSpaceService.sweep(), 60 * 1000);
  sweepTimer.unref?.();
});

module.exports = { privateSpace };
