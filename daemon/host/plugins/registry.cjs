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

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function plugin(name, inject, apply) {
  return { name, inject, apply };
}

const runtimeConfig = plugin('tlei-runtime-config', [], (ctx, options = {}) => {
  const env = { ...process.env, ...(options.env || {}) };
  const appConfig = loadConfig({ env, repoRoot });
  const runtimeDir = appConfig.runtimeDir;
  const downloadDir = appConfig.downloadDir;
  for (const d of ['data', 'secrets', 'seeds', 'uploads', 'profile/dkcfg', 'profile/Torrents', 'profile/temp', 'log']) {
    fs.mkdirSync(path.join(runtimeDir, d), { recursive: true });
  }
  fs.mkdirSync(downloadDir, { recursive: true });
  const lockPath = path.join(runtimeDir, 'thunderd.lock');
  if (!acquireLock(lockPath, process.pid)) {
    throw new Error(`another thunderd instance is running for runtime ${runtimeDir}`);
  }
  if (appConfig.engineMode === 'wine' && !hasSqlite) {
    console.error('[thunderd] WARN: sqlite3 CLI not found; observation degrades to filesystem-only');
  }
  ctx.provide('tleiConfig', { appConfig, runtimeDir, downloadDir, repoRoot, env });
  return () => releaseLock(lockPath, process.pid);
});

const repositories = plugin('tlei-repositories', ['tleiConfig'], (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.tleiConfig;
  const taskRepository = new TaskRepository({ filePath: appConfig.tasksPath, legacyFilePath: appConfig.legacyRegistryPath });
  taskRepository.load();
  const registry = TaskRegistry.fromRepository(taskRepository);
  registry.load();
  const settingsRepository = new SettingsRepository({ filePath: appConfig.settingsPath, defaults: { downloadDir } });
  settingsRepository.load();
  const ftpSecretStore = new FtpSecretStore({ filePath: appConfig.ftpSecretsPath }); ftpSecretStore.load();
  const proxySecretStore = new ProxySecretStore({ filePath: appConfig.proxySecretsPath }); proxySecretStore.load();
  const scheduleRepository = new ScheduleRepository({ filePath: appConfig.schedulesPath }); scheduleRepository.load();
  const recentPathRepository = new RecentPathRepository({ filePath: appConfig.recentPathsPath }); recentPathRepository.load();
  const draftRepository = new DraftRepository({ filePath: appConfig.draftsPath }); draftRepository.load();
  const operationRepository = new OperationRepository({ filePath: appConfig.operationsPath }); operationRepository.load(); operationRepository.prune();
  const privateSecretStore = new PrivateSpaceSecretStore({ filePath: appConfig.privateSpaceSecretsPath }); privateSecretStore.load();
  const mediaSecretStore = new MediaSecretStore({ filePath: appConfig.mediaSecretPath }); mediaSecretStore.load();
  const captureTokenStore = new CaptureTokenStore({ filePath: appConfig.captureSecretsPath }); captureTokenStore.load();
  const remoteNodeRepository = new RemoteNodeRepository({ filePath: appConfig.remoteNodesPath }); remoteNodeRepository.load();
  const dataDatabase = new SqliteDatabase({ filePath: appConfig.dataDbPath, backupDir: path.join(runtimeDir, 'backups') });
  dataDatabase.open();
  try { dataDatabase.backup(); } catch (error) { console.error('[thunderd] data database backup skipped:', error.message); }
  const historyRepository = new HistoryRepository({ db: dataDatabase });
  const linkRepository = new LinkRepository({ db: dataDatabase });
  const seedStore = new SeedStore({ rootDir: appConfig.seedsDir });
  ctx.provide('tleiRepositories', {
    taskRepository, registry, settingsRepository, ftpSecretStore, proxySecretStore,
    scheduleRepository, recentPathRepository, draftRepository, operationRepository,
    privateSecretStore, mediaSecretStore, captureTokenStore, remoteNodeRepository,
    dataDatabase, historyRepository, linkRepository, seedStore,
  });
  return () => {
    try { dataDatabase.backup(); } catch (error) { console.error('[thunderd] final data backup skipped:', error.message); }
    dataDatabase.close();
    settingsRepository.close();
    scheduleRepository.close();
    taskRepository.close();
  };
});

const engineDriver = plugin('tlei-engine-driver', ['tleiConfig'], (ctx) => {
  const { appConfig, runtimeDir, repoRoot, env } = ctx.tleiConfig;
  const crashInfoPath = env.THUNDERD_XLSDK_CRASHINFO || '';
  const sdkPeer = readSdkPeerId({ explicitPath: crashInfoPath || undefined, winePrefix: appConfig.winePrefix });
  let driver;
  let taskDbReaders = { readVipTasks, readNativeBtTasks };
  if (appConfig.engineMode === 'windows-native') {
    if (!appConfig.windowsProgramDir || !fs.existsSync(path.join(appConfig.windowsProgramDir, 'thunder.exe'))) {
      throw new Error('Windows native engine program directory is missing');
    }
    if (!appConfig.windowsPythonExe || !fs.existsSync(appConfig.windowsPythonExe)) {
      throw new Error('Windows Python is required for native TaskDb observation');
    }
    driver = new WindowsNodeDriver({
      repoRoot, programDir: appConfig.windowsProgramDir, profileDir: appConfig.windowsProfileRoot,
      engineMirrorDir: appConfig.windowsEngineMirrorDir, distroName: appConfig.wslDistroName,
      sdkVersionName: appConfig.windowsSdkVersionName, sdkVersionCode: appConfig.windowsSdkVersionCode,
      sdkPlatform: appConfig.windowsSdkPlatform,
      sdkGuid: appConfig.windowsSdkGuid || (sdkPeer.ok ? sdkPeer.peerId : ''),
    });
    taskDbReaders = createWindowsTaskDbReader({ pythonExe: appConfig.windowsPythonExe, distroName: appConfig.wslDistroName });
  } else {
    driver = new WineNodeDriver({ repoRoot, profileDir: runtimeDir, winePrefix: appConfig.winePrefix });
  }
  ctx.provide('tleiEngine', { driver, taskDbReaders, crashInfoPath, start: () => driver.start() });
  return async () => driver.shutdown();
});

const eventObservation = plugin('tlei-event-observation', ['tleiRepositories', 'tleiEngine'], (ctx) => {
  const { taskRepository } = ctx.tleiRepositories;
  const { driver } = ctx.tleiEngine;
  const eventBus = new DomainEventBus();
  const diagnosticEvents = new DiagnosticEventBuffer();
  const poller = new ProgressPoller(taskRepository, {
    dbPath: driver.taskDbPath, readTasksFn: (ids) => driver.getTaskSnapshots(ids), eventBus,
  });
  const unsubs = [
    eventBus.on('task.transition', (event) => diagnosticEvents.record('task.transition', event)),
    eventBus.on('engine.down', (event) => diagnosticEvents.record('engine.down', event, 'warn')),
  ];
  for (const type of ['engine.restart.requested', 'engine.restart.completed', 'task.deleted', 'policy.applied']) {
    unsubs.push(eventBus.on(type, (event) => diagnosticEvents.record(type, event, type.includes('failed') ? 'error' : 'info')));
  }
  ctx.provide('tleiObservation', { eventBus, diagnosticEvents, poller, start: () => poller.start() });
  return () => { poller.stop(); for (const unsubscribe of unsubs) unsubscribe?.(); eventBus.close(); };
});

const authVip = plugin('tlei-auth-vip', ['tleiConfig', 'tleiRepositories', 'tleiEngine', 'tleiObservation'], (ctx) => {
  const { appConfig, runtimeDir, env } = ctx.tleiConfig;
  const { registry } = ctx.tleiRepositories;
  const { driver, taskDbReaders, crashInfoPath } = ctx.tleiEngine;
  const wallet = new CredentialWallet(path.join(runtimeDir, 'auth.json'));
  const winePrefix = appConfig.winePrefix;
  const xlconfigPath = path.join(winePrefix, 'drive_c', 'users', 'Public', 'Thunder Network', 'Thunder', 'xlconfig.ini');
  const auth = new AuthManager({
    wallet, driver, apiOrigin: env.THUNDERD_AUTH_API_ORIGIN || 'https://xluser-ssl.xunlei.com',
    xlconfigPath, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    keepAliveOverride: env.THUNDERD_AUTH_KEEPALIVE_SEC ? clampKeepAliveSec(Number(env.THUNDERD_AUTH_KEEPALIVE_SEC)) : 0,
  });
  const envBool = (value, fallback) => value === undefined ? fallback : value !== '0' && value !== 'false';
  const speedupClient = new VipSpeedupClient({ origin: env.THUNDERD_VIP_API_ORIGIN || undefined,
    log: (entry) => console.error('[vip-speedup]', JSON.stringify(entry)) });
  const vipManager = new VipAccelerationManager({
    registry, driver, auth, readVipTasks: taskDbReaders.readVipTasks,
    readBtFileRuntime: driver.engineMode === 'windows-native' ? null : (engineId) => driver.getBtFileRuntime(engineId),
    taskDbPath: driver.taskDbPath,
    peerIdProvider: () => readSdkPeerId({ explicitPath: crashInfoPath || undefined, winePrefix }),
    speedupClient, enabled: envBool(env.THUNDERD_VIP_ENABLED, true),
    scanMs: Math.min(Math.max(Number(env.THUNDERD_VIP_SCAN_MS) || 2000, 500), 30000),
    maxBackoffMs: Math.min(Math.max((Number(env.THUNDERD_VIP_MAX_BACKOFF_SEC) || 300) * 1000, 30000), 1800000),
    log: (entry) => console.error('[vip]', JSON.stringify(entry)),
  });
  const onDown = () => vipManager.onEngineDown();
  driver.on('down', onDown);
  ctx.provide('tleiAuth', { wallet, auth, vipManager });
  auth.start();
  vipManager.start();
  return async () => { driver.off('down', onDown); await vipManager.stop({ disable: true }); auth.stop(); };
});

const taskCore = plugin('tlei-task-core', ['tleiConfig', 'tleiRepositories', 'tleiEngine', 'tleiObservation', 'tleiAuth'], (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.tleiConfig;
  const r = ctx.tleiRepositories;
  const { driver, taskDbReaders } = ctx.tleiEngine;
  const { eventBus } = ctx.tleiObservation;
  const { auth, vipManager } = ctx.tleiAuth;
  const operationLock = new OperationLock();
  const taskService = new TaskService({ tasks: r.taskRepository, driver, vip: vipManager, seedStore: r.seedStore, operationLock, eventBus });
  const taskGroupService = new TaskGroupService({ tasks: r.taskRepository, taskService });
  const createTaskService = new CreateTaskService({ tasks: r.taskRepository, driver, settings: r.settingsRepository,
    operationLock, runtimeDir, seedStore: r.seedStore, ftpSecrets: r.ftpSecretStore,
    taskDbPath: driver.taskDbPath, readNativeBtTasks: taskDbReaders.readNativeBtTasks,
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
      fallbackOperations: { recycle: true, recover: true, rename: true, move: true, redownload: true,
        btSelection: true, btSequential: true, open: systemIntegrationService.getCapabilities().openOnHost === true,
        showInFolder: systemIntegrationService.getCapabilities().showInFolder === true, copyInfo: true } }) });
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
  driver.on('down', onDown); driver.on('bootError', onBootError); driver.on('up', onUp);
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
    ctx.tleiObservation.start();
    ctx.tleiEngine.start();
    scheduler.requestReconcile('startup');
    scheduleService.start();
    idleController.start();
  }
  ctx.provide('tleiTasks', { operationLock, taskService, taskQueryService, taskGroupService,
    createTaskService, createDraftService, operationService, settingsService, policyService,
    scheduler, scheduleService, idleController, completionActions, pathService,
    safePathResolver, fileOperationService, systemIntegrationService, magnetMetadata,
    protocolParser, processRunner, activate });
  return () => {
    for (const timer of timers) clearInterval(timer);
    driver.off('down', onDown); driver.off('bootError', onBootError); driver.off('up', onUp);
    for (const unsubscribe of unsubs) unsubscribe?.();
    scheduler.stop(); scheduleService.stop(); idleController.stop(); completionActions.stop();
  };
});

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

const webApiProcess = plugin('tlei-web-api-process', ['tleiConfig', 'tleiControl'], (ctx) => {
  const { repoRoot, env } = ctx.tleiConfig;
  const entry = path.join(repoRoot, 'web-api', 'src', 'main.js');
  let child = null;
  let timer = null;
  let stopping = false;
  function start() {
    if (stopping) return;
    child = spawn(process.execPath, [entry], { cwd: repoRoot, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return;
      console.error(`[thunderd] web-api exited (${signal || code}); restarting gateway`);
      timer = setTimeout(start, 1000);
      timer.unref?.();
    });
  }
  start();
  ctx.provide('tleiWebApi', { current: () => child });
  return async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (!child) return;
    const running = child;
    running.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => running.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
    if (running.exitCode === null && !running.signalCode) running.kill('SIGKILL');
  };
});

function daemonRegistry() {
  const definitions = [
    ['runtime-config', runtimeConfig, 'tleiConfig'],
    ['repositories', repositories, 'tleiRepositories'],
    ['engine-driver', engineDriver, 'tleiEngine'],
    ['event-observation', eventObservation, 'tleiObservation'],
    ['auth-vip', authVip, 'tleiAuth'],
    ['task-core', taskCore, 'tleiTasks'],
    ['product-services', productServices, 'tleiProducts'],
    ['control-rpc', controlRpc, 'tleiControl'],
    ['web-api-process', webApiProcess, 'tleiWebApi'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided]) => [id, {
    plugin: definition, provides: [provided], requires: definition.inject,
  }]));
}

module.exports = { daemonRegistry, runtimeConfig, repositories, engineDriver, eventObservation,
  authVip, taskCore, productServices, controlRpc, webApiProcess };
