'use strict';
const path = require('path');
const fs = require('fs');
const { ProtocolParser } = require('../src/domain/protocol-parser');
const { PathService } = require('../src/services/path-service');
const { CreateDraftService } = require('../src/services/create-draft-service');
const { MagnetMetadataService } = require('../src/services/magnet-metadata-service');
const { OperationLock } = require('../src/services/operation-lock');
const { TaskService } = require('../src/services/task-service');
const { TaskQueryService } = require('../src/services/task-query-service');
const { TaskGroupService } = require('../src/services/task-group-service');
const { SafePathResolver } = require('../src/services/safe-path-resolver');
const { FileOperationService } = require('../src/services/file-operation-service');
const { TaskOperationService } = require('../src/services/task-operation-service');
const { SystemIntegrationService } = require('../src/services/system-integration-service');
const { CreateTaskService } = require('../src/services/create-task-service');
const { SettingsService } = require('../src/services/settings-service');
const { DownloadPolicyService } = require('../src/services/download-policy-service');
const { TaskSchedulerService } = require('../src/services/task-scheduler-service');
const { ScheduleService } = require('../src/services/schedule-service');
const { IdleDownloadController } = require('../src/services/idle-download-controller');
const { CompletionActionService } = require('../src/services/completion-action-service');
const { SystemIdleAdapter } = require('../src/adapters/system-idle-adapter');
const { SystemPowerAdapter } = require('../src/adapters/system-power-adapter');
const { DesktopNotificationAdapter } = require('../src/adapters/desktop-notification-adapter');
const { ProcessRunner } = require('../src/adapters/process-runner');
const { shellFallbackOperations } = require('../src/domain/shell-capabilities');
const { createTaskRpcMethods } = require('../src/rpc/task-rpc-methods');
const { createTaskControlMethods } = require('../src/rpc/task-control-methods');
const { plugin } = require('./shared.cjs');

const taskShell = plugin('leifeng-task-shell', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengRpc'], (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.leifengConfig;
  const r = ctx.leifengRepositories;
  // kernel-any-only：经 hub 取默认内核（不再硬编码 thunder 槽）；零内核装配时
  // hub 返回 NullKernel slot（软件与内核不强相关——下载类操作经其诚实报
  // NOT_SUPPORTED，仓库/设置/历史照常服务）；account/nativeBtLookup 是迅雷
  // 富件，缺席即诚实降级（qbit-only / null-kernel）。
  const kernelSlot = ctx.leifengKernelHub.default();
  if (!kernelSlot) throw new Error('task-shell: no kernel slot from hub');
  const { kernel: driver, eventBus } = kernelSlot;
  const { vipManager } = kernelSlot.account || {};
  const operationLock = new OperationLock();
  const taskService = new TaskService({ tasks: r.taskRepository, driver, vip: vipManager ?? null, seedStore: r.seedStore, operationLock, eventBus });
  const taskGroupService = new TaskGroupService({ tasks: r.taskRepository, taskService });
  const createTaskService = new CreateTaskService({ tasks: r.taskRepository, driver, settings: r.settingsRepository,
    operationLock, runtimeDir, seedStore: r.seedStore, ftpSecrets: r.ftpSecretStore,
    nativeBtLookup: kernelSlot.nativeBtLookup ?? null,
    defaultKernelId: kernelSlot.kernelId,
    magnetTimeoutSec: appConfig.magnetTimeoutSec });
  const settingsService = new SettingsService({ settings: r.settingsRepository, driver });
  const policyService = new DownloadPolicyService({ settings: r.settingsRepository, driver,
    proxySecrets: r.proxySecretStore, eventBus, nativeGeneration: () => driver._generation });
  const scheduler = new TaskSchedulerService({ tasks: r.taskRepository, taskService, policyProvider: () => policyService.get(), driver, eventBus });
  policyService.scheduler = scheduler;
  const scheduleService = new ScheduleService({ repository: r.scheduleRepository, taskService, policyService });
  policyService.scheduleService = scheduleService;
  const processRunner = new ProcessRunner();
  const idleController = new IdleDownloadController({ adapter: new SystemIdleAdapter(), scheduler,
    tasks: r.taskRepository, policyProvider: () => policyService.get() });
  const completionActions = new CompletionActionService({ tasks: r.taskRepository,
    policyProvider: () => policyService.get(), taskService, driver,
    powerAdapter: new SystemPowerAdapter({ processRunner, allow: appConfig.allowPowerActions }),
    notification: new DesktopNotificationAdapter({ processRunner }) });
  const pathService = new PathService({ defaultPath: downloadDir, recentPaths: r.recentPathRepository });
  const safeDownloadRoots = [downloadDir, r.settingsRepository.get().desired.downloadDir, appConfig.privateSpaceDir].filter(Boolean);
  const safePathResolver = new SafePathResolver({ allowedRoots: safeDownloadRoots });
  const fileOperationService = new FileOperationService({ resolver: safePathResolver });
  const systemIntegrationService = new SystemIntegrationService({ resolver: safePathResolver, tasks: r.taskRepository, processRunner });
  const taskQueryService = new TaskQueryService({ tasks: r.taskRepository,
    runtimeCapabilities: () => ({ native: driver.nativeCapabilities && driver.nativeCapabilities.flat || driver.nativeCapabilities || {},
      fallbackOperations: shellFallbackOperations(systemIntegrationService) }),
    // 任务详情富化（kernel-detail-panels）：内核 extras（文件进度/通道归因）+
    // 桥会话快照（bridge-status 插件可选消费，缺席即无 bridge 字段）。
    enrichDetail: async (task, dto) => {
      const slot = (task.kernelId && ctx.leifengKernelHub.get(task.kernelId)) || kernelSlot;
      const kernel = slot && slot.kernel;
      if (kernel && typeof kernel.getTaskDetailExtras === 'function') {
        const extras = await kernel.getTaskDetailExtras(task);
        if (extras && typeof extras === 'object') {
          if (Array.isArray(extras.files) && Array.isArray(dto.files)) {
            const byIndex = new Map(extras.files.map((f) => [Number(f && f.index), Math.max(0, Number(f && f.completedBytes) || 0)]));
            for (const file of dto.files) if (byIndex.has(file.index)) file.completedBytes = byIndex.get(file.index);
          }
          if (extras.channels && typeof extras.channels === 'object') dto.channels = extras.channels;
        }
      }
      const bridgeStatus = ctx.reflect.get('leifengBridgeStatus', false);
      if (bridgeStatus && typeof bridgeStatus.forTask === 'function') {
        const bridge = bridgeStatus.forTask(task);
        if (bridge) dto.bridge = bridge;
      }
    } });
  const protocolParser = new ProtocolParser({ driver });
  const magnetMetadata = new MagnetMetadataService({ drafts: r.draftRepository, driver, seedStore: r.seedStore,
    runtimeDir, timeoutMs: appConfig.magnetTimeoutSec * 1000 });
  magnetMetadata.recoverAfterRestart().catch((error) => console.error('[thunderd] metadata recovery failed:', error.message));
  const createDraftService = new CreateDraftService({ drafts: r.draftRepository, tasks: r.taskRepository, parser: protocolParser,
    pathService, recentPaths: r.recentPathRepository, settings: r.settingsRepository, driver,
    createTaskService, seedStore: r.seedStore, ftpSecrets: r.ftpSecretStore, magnetMetadata,
    groupService: taskGroupService, oneKeyPolicy: () => r.settingsRepository.get().desired.oneKey, runtimeDir });
  const operationService = new TaskOperationService({ tasks: r.taskRepository, driver, taskService, createTaskService,
    pathService, fileOperations: fileOperationService, operations: r.operationRepository, seedStore: r.seedStore,
    ftpSecrets: r.ftpSecretStore, systemIntegration: systemIntegrationService, operationLock,
    nativeGeneration: () => driver._generation, eventBus });
  taskGroupService.operationService = operationService;
  const onDown = () => taskService.onEngineDown({ generation: driver._generation, reason: 'engine lost' })
    .catch((error) => console.error('[thunderd] task engine-down transition failed:', error.message));
  const onBootError = (error) => console.error('[thunderd] engine boot failed (retrying):', error.message);
  const onUp = ({ generation } = {}) => { policyService.onEngineUp(generation || driver._generation)
    .catch((error) => console.error('[thunderd] policy apply failed:', error.message)); scheduler.onEngineUp(); };
  // 经域事件订阅内核事件（不再直接订 driver——壳层只见 KernelPort 词汇）
  eventBus.on('kernel.down', onDown); eventBus.on('kernel.bootError', onBootError); eventBus.on('kernel.up', onUp);
  const unsubs = [
    eventBus.on('task.observation', (event) => scheduler.recordSpeedSample(event)),
    eventBus.on('task.transition', (event) => { scheduler.onTaskTransition(event); completionActions.onTaskTransition(event); }),
  ];
  let timers = [];
  let activated = false;
  function activate() {
    if (activated) return;
    activated = true;
    const draftSweepTimer = setInterval(() => {
      (async () => {
        const now = Date.now();
        for (const draft of r.draftRepository.list().filter((item) => item.state === 'metadata' && item.expiresAt <= now)) {
          await magnetMetadata.cancel(draft.draftId, 'draft-ttl').catch(() => {});
        }
        createDraftService.sweepExpired(now);
        r.seedStore.sweepUnreferenced({ olderThanMs: 24 * 60 * 60 * 1000 });
      })().catch((error) => console.error('[thunderd] draft sweep failed:', error.code || error.name));
    }, 60 * 1000);
    const metadataPollTimer = setInterval(() => magnetMetadata.pollAll().catch((error) => console.error('[thunderd] metadata poll failed:', error.code || error.name)), 1000);
    const groupRefreshTimer = setInterval(() => {
      try { for (const task of r.taskRepository.list().filter((item) => item.kind === 'group')) taskGroupService.recompute(task.id); }
      catch (error) { console.error('[thunderd] group refresh failed:', error.code || error.name); }
    }, 1000);
    timers = [draftSweepTimer, metadataPollTimer, groupRefreshTimer];
    for (const timer of timers) timer.unref?.();
    kernelSlot.start();
    scheduler.requestReconcile('startup');
    scheduleService.start();
    idleController.start();
  }
  ctx.provide('leifengTasks', { operationLock, taskService, taskQueryService, taskGroupService,
    createTaskService, createDraftService, operationService, settingsService, policyService,
    scheduler, scheduleService, idleController, completionActions, pathService,
    safePathResolver, fileOperationService, systemIntegrationService, magnetMetadata,
    protocolParser, processRunner, activate });
  // ---- RPC 注册（rpc-plugin-registration）：task 域 v2 面 + daemon.v1.torrent 控制面。
  // activate（引擎拉起）原由 control-rpc 装配完成后代调，rpc-host 在本插件之前
  // 已监听，改装配尾部自激活——对外时序等价（RPC 可达前引擎已在拉起）。
  const withdrawV2 = ctx.leifengRpc.registry.register('task-shell', createTaskRpcMethods({
    taskService, taskQueryService, operationService, createTaskService, createDraftService,
    groupService: taskGroupService, settingsService, policyService, scheduler, scheduleService,
    completionActions, systemIntegration: systemIntegrationService, operations: r.operationRepository, eventBus,
  }));
  const withdrawControl = ctx.leifengRpc.registry.register('task-shell', createTaskControlMethods({
    createDraftService, tasks: r.taskRepository, seedStore: r.seedStore, config: appConfig,
  }));
  const withdrawHealth = ctx.leifengRpc.registry.provideHealthStatus('task-shell', 'repositories', () => ({
    revision: Number(r.taskRepository.repositoryRevision) || 0,
  }));
  activate();
  return () => {
    withdrawV2(); withdrawControl(); withdrawHealth();
    for (const timer of timers) clearInterval(timer);
    eventBus.off('kernel.down', onDown); eventBus.off('kernel.bootError', onBootError); eventBus.off('kernel.up', onUp);
    for (const unsubscribe of unsubs) unsubscribe?.();
    scheduler.stop(); scheduleService.stop(); idleController.stop(); completionActions.stop();
  };
});

module.exports = { taskShell };
