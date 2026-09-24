'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { TaskRegistry } = require('../src/registry');
const { ProgressPoller } = require('../src/poller');
const { WineNodeDriver, WindowsNodeDriver } = require('../src/driver');
const { createMethodHandler } = require('../src/methods');
const { hasSqlite, readVipTasks, readNativeBtTasks } = require('../src/taskdb-reader');
const { createWindowsTaskDbReader } = require('../src/windows-taskdb-reader');
const { CredentialWallet } = require('../src/auth-wallet');
const { AuthManager, clampKeepAliveSec } = require('../src/auth-manager');
const { CLIENT_ID, CLIENT_SECRET } = require('../src/xunlei-client-config');
const { readSdkPeerId } = require('../src/sdk-peer-id');
const { VipSpeedupClient } = require('../src/vip-speedup-client');
const { VipAccelerationManager } = require('../src/vip-manager');
const { acquireLock, releaseLock } = require('../src/lockfile');
const { loadConfig, parseListenAddress } = require('../src/config');
const { TaskRepository } = require('../src/repositories/task-repository');
const { SettingsRepository } = require('../src/repositories/settings-repository');
const { DraftRepository } = require('../src/repositories/draft-repository');
const { RecentPathRepository } = require('../src/repositories/recent-path-repository');
const { SeedStore } = require('../src/repositories/seed-store');
const { OperationRepository } = require('../src/repositories/operation-repository');
const { ProtocolParser } = require('../src/domain/protocol-parser');
const { PathService } = require('../src/services/path-service');
const { CreateDraftService } = require('../src/services/create-draft-service');
const { MagnetMetadataService } = require('../src/services/magnet-metadata-service');
const { DomainEventBus } = require('../src/services/domain-event-bus');
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
const { ScheduleRepository } = require('../src/repositories/schedule-repository');
const { ProxySecretStore } = require('../src/secrets/proxy-secret-store');
const { FtpSecretStore } = require('../src/secrets/ftp-secret-store');
const { SystemIdleAdapter } = require('../src/adapters/system-idle-adapter');
const { SystemPowerAdapter } = require('../src/adapters/system-power-adapter');
const { DesktopNotificationAdapter } = require('../src/adapters/desktop-notification-adapter');
const { NotificationService } = require('../src/services/notification-service');
const { ProcessRunner } = require('../src/adapters/process-runner');
const { BootstrapService } = require('../src/services/bootstrap-service');
const { AccountService } = require('../src/services/account-service');
const { PrivateSpaceService } = require('../src/services/private-space-service');
const { HistoryService } = require('../src/services/history-service');
const { LinkLibraryService } = require('../src/services/link-library-service');
const { LinkSyncService } = require('../src/services/link-sync-service');
const { LinkSyncAdapter } = require('../src/adapters/link-sync-adapter');
const { SqliteDatabase } = require('../src/repositories/sqlite-database');
const { HistoryRepository } = require('../src/repositories/history-repository');
const { LinkRepository } = require('../src/repositories/link-repository');
const { PrivateSpaceSecretStore } = require('../src/secrets/private-space-secret-store');
const { MediaSecretStore } = require('../src/secrets/media-secret-store');
const { MediaService } = require('../src/services/media-service');
const { CaptureTokenStore } = require('../src/secrets/capture-token-store');
const { CaptureService } = require('../src/services/capture-service');
const { DiagnosticEventBuffer } = require('../src/domain/diagnostic-events');
const { DiagnosticsService } = require('../src/services/diagnostics-service');
const { RateLimiter } = require('../src/security/rate-limiter');
const { RequestAuth } = require('../src/security/request-auth');
const { RemoteNodeRepository } = require('../src/repositories/remote-node-repository');
const { RemotePairingService } = require('../src/services/remote-pairing-service');
const { RemoteNodeService } = require('../src/services/remote-node-service');
const { RemoteTaskService } = require('../src/services/remote-task-service');
const { MtlsClient } = require('../src/remote/mtls-client');
const { createThunderUiV2Methods } = require('../src/rpc/thunder-ui-v2-methods');
const { DaemonControlServer } = require('../src/control/server');
const { DaemonControlDispatcher } = require('../src/control/dispatcher');
const { productServices } = require('./product-services.cjs');
const { plugin } = require('./shared.cjs');

const controlRpc = plugin('tlei-control-rpc', ['tleiConfig', 'tleiRepositories', 'tleiEngine', 'tleiObservation', 'tleiAuth', 'tleiTasks', 'tleiProducts'], async (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.tleiConfig;
  const r = ctx.tleiRepositories;
  const { driver } = ctx.tleiEngine;
  const { eventBus } = ctx.tleiObservation;
  const { auth, vipManager } = ctx.tleiAuth;
  const t = ctx.tleiTasks;
  const p = ctx.tleiProducts;
  const v2Methods = createThunderUiV2Methods({
    taskService: t.taskService, taskQueryService: t.taskQueryService, operationService: t.operationService,
    createTaskService: t.createTaskService, createDraftService: t.createDraftService,
    groupService: t.taskGroupService, settingsService: t.settingsService,
    bootstrapService: p.bootstrapService, policyService: t.policyService, scheduler: t.scheduler,
    scheduleService: t.scheduleService, completionActions: t.completionActions,
    accountService: p.accountService, vipService: vipManager, taskRepository: r.taskRepository,
    privateSpace: p.privateSpace, historyService: p.historyService, linkService: p.linkService,
    systemIntegration: t.systemIntegrationService, media: p.mediaService, capture: p.captureService,
    remotePairing: p.remotePairingService, remoteNodes: p.remoteNodeService, remoteTasks: p.remoteTaskService,
    diagnostics: p.diagnosticsService, driver, operations: r.operationRepository, eventBus,
  });
  const handle = createMethodHandler({ registry: r.registry, driver, config: appConfig, auth,
    vip: vipManager, v2Methods, taskService: t.taskService, createTaskService: t.createTaskService,
    settingsService: t.settingsService, legacyRpcEnabled: appConfig.legacyRpcEnabled });
  const controlDispatcher = new DaemonControlDispatcher({ config: appConfig, handle, driver,
    tasks: r.taskRepository, seedStore: r.seedStore, createDraftService: t.createDraftService,
    media: p.mediaService, capture: p.captureService, diagnostics: p.diagnosticsService,
    remotePairing: p.remotePairingService, taskQueryService: t.taskQueryService,
    operationService: t.operationService, requestAuth: p.requestAuth,
    rateLimiter: p.requestRateLimiter });
  const controlServer = new DaemonControlServer({ socketPath: appConfig.controlSocketPath,
    dispatch: (method, params, connection) => controlDispatcher.dispatch(method, params, connection),
    onDisconnect: (connection) => controlDispatcher.releaseConnection(connection) });
  const listener = controlServer.start();
  await new Promise((resolve, reject) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  ctx.provide('tleiControl', { controlServer, controlDispatcher, handle, v2Methods });
  t.activate();
  console.log(`[thunderd] core control socket=${appConfig.controlSocketPath}  runtime=${runtimeDir}  downloads=${downloadDir}`);
  return async () => controlServer.stop();
});

module.exports = { controlRpc };
