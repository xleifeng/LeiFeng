'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { TaskRegistry } = require('../src/registry');
const { ProgressPoller } = require('../src/poller');
const { WineNodeDriver, WindowsNodeDriver } = require('../src/driver');
const { createMethodHandler } = require('../src/methods');
const { hasSqlite, readVipTasks, readNativeBtTasks, createNodeSqliteTaskDbReader } = require('../src/taskdb-reader');
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

const engineDriver = plugin('tlei-engine-driver', ['tleiConfig'], (ctx) => {
  const { appConfig, runtimeDir, repoRoot, env } = ctx.tleiConfig;
  const crashInfoPath = env.THUNDERD_XLSDK_CRASHINFO || '';
  const winePrefix = appConfig.winePrefix;
  // native 的 program 目录探测：显式 THUNDERD_PROGRAM_DIR → %LOCALAPPDATA%\tlei-sdk\Thunder-*\program → 仓库内 thunder_x/program。
  function discoverNativeProgramDir() {
    if (appConfig.programDir) return appConfig.programDir;
    const localAppData = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'tlei-sdk') : '';
    if (localAppData) {
      try {
        const candidates = fs.readdirSync(localAppData)
          .filter((name) => /^Thunder-\d/i.test(name))
          .sort()
          .map((name) => path.join(localAppData, name, 'program'))
          .reverse(); // 取最新版本
        const hit = candidates.find((dir) => fs.existsSync(path.join(dir, 'thunder.exe')));
        if (hit) return hit;
      } catch { /* 目录不存在：继续回退 */ }
    }
    return path.join(repoRoot, 'thunder_x', 'program');
  }
  let driver;
  let taskDbReaders;
  // peer id（crashinfo.ini）候选目录：wine 扫 prefix 的各用户 Temp；native 扫 %LOCALAPPDATA%\Temp 与系统 Temp。
  let peerIdCandidates;
  if (appConfig.engineMode === 'native') {
    const programDir = discoverNativeProgramDir();
    if (!fs.existsSync(path.join(programDir, 'thunder.exe'))) {
      throw new Error(`native engine program directory is missing: ${programDir}`);
    }
    peerIdCandidates = [env.LOCALAPPDATA, env.TEMP, env.SystemRoot && path.join(env.SystemRoot, 'Temp')]
      .filter(Boolean).map((dir) => path.join(dir, 'Thunder Network', 'XLSDK'));
    const sdkPeer = readSdkPeerId({ explicitPath: crashInfoPath || undefined, candidateDirs: peerIdCandidates });
    driver = new WindowsNodeDriver({
      repoRoot, programDir, profileDir: runtimeDir,
      sdkVersionName: appConfig.sdkVersionName, sdkVersionCode: appConfig.sdkVersionCode,
      sdkPlatform: appConfig.sdkPlatform,
      sdkGuid: env.THUNDERD_SDK_GUID || (sdkPeer.ok ? sdkPeer.peerId : ''),
    });
    taskDbReaders = createNodeSqliteTaskDbReader();
    if (!taskDbReaders.available) {
      console.error('[thunderd] WARN: node:sqlite unavailable; native TaskDb observation degrades');
    }
  } else {
    driver = new WineNodeDriver({ repoRoot, profileDir: runtimeDir, winePrefix });
    taskDbReaders = { readVipTasks, readNativeBtTasks };
    peerIdCandidates = [winePrefix];
  }
  ctx.provide('tleiEngine', { driver, taskDbReaders, crashInfoPath, peerIdCandidates, start: () => driver.start() });
  return async () => driver.shutdown();
});

module.exports = { engineDriver };
