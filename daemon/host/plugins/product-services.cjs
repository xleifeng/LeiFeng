'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DesktopNotificationAdapter } = require('../src/adapters/desktop-notification-adapter');
const { NotificationService } = require('../src/services/notification-service');
const { PrivateSpaceService } = require('../src/services/private-space-service');
const { MediaService } = require('../src/services/media-service');
const { CaptureService } = require('../src/services/capture-service');
const { HistoryService } = require('../src/services/history-service');
const { LinkLibraryService } = require('../src/services/link-library-service');
const { LinkSyncService } = require('../src/services/link-sync-service');
const { LinkSyncAdapter } = require('../src/adapters/link-sync-adapter');
const { AccountService } = require('../src/services/account-service');
const { DiagnosticsService } = require('../src/services/diagnostics-service');
const { BootstrapService } = require('../src/services/bootstrap-service');
const { RemotePairingService } = require('../src/services/remote-pairing-service');
const { RemoteNodeService } = require('../src/services/remote-node-service');
const { RemoteTaskService } = require('../src/services/remote-task-service');
const { MtlsClient } = require('../src/remote/mtls-client');
const { RateLimiter } = require('../src/security/rate-limiter');
const { RequestAuth } = require('../src/security/request-auth');
const { parseListenAddress } = require('../src/config');

// 依赖 bundle 的键：
// config: appConfig, env；repositories: task/settings/operation/history/link/remote-node
// repositories 与私密 store；engine: driver；observation: eventBus/diagnosticEvents；
// auth: auth/vipManager；tasks: createDraftService, policyService,
// fileOperationService, pathService, safePathResolver。
const productServices = {
  name: 'tlei-product-services',
  inject: ['tleiConfig', 'tleiRepositories', 'tleiEngine', 'tleiObservation', 'tleiAuth', 'tleiTasks'],
  apply(ctx) {
    const { appConfig, env } = ctx.tleiConfig;
    const {
      taskRepository, settingsRepository, operationRepository, historyRepository,
      linkRepository, remoteNodeRepository, privateSecretStore, mediaSecretStore,
      captureTokenStore,
    } = ctx.tleiRepositories;
    const { driver } = ctx.tleiEngine;
    const { eventBus, diagnosticEvents } = ctx.tleiObservation;
    const { auth, vipManager } = ctx.tleiAuth;
    const {
      createDraftService, policyService, fileOperationService, pathService,
      safePathResolver, processRunner,
    } = ctx.tleiTasks;

    const notificationService = new NotificationService({
      eventBus, tasks: taskRepository,
      adapter: new DesktopNotificationAdapter({ processRunner }),
    });
    const privateSpace = new PrivateSpaceService({
      secretStore: privateSecretStore, tasks: taskRepository,
      fileOperations: fileOperationService, pathService,
      defaultDirectory: appConfig.privateSpaceDir,
    });
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

    const remoteListen = parseListenAddress(env.THUNDERD_REMOTE_LISTEN);
    const remoteCertDir = env.THUNDERD_REMOTE_CERT_DIR ? path.resolve(env.THUNDERD_REMOTE_CERT_DIR) : '';
    const remoteNodeId = String(env.THUNDERD_REMOTE_NODE_ID || 'local-node');
    const remoteKeyPath = remoteCertDir ? path.join(remoteCertDir, `${remoteNodeId}.server.key.pem`) : '';
    const remoteCertPath = remoteCertDir ? path.join(remoteCertDir, `${remoteNodeId}.server.cert.pem`) : '';
    const remoteCaPath = remoteCertDir ? path.join(remoteCertDir, 'ca.cert.pem') : '';
    const remoteCredentialsReady = () => Boolean(remoteListen && remoteCertDir &&
      fs.existsSync(remoteKeyPath) && fs.existsSync(remoteCertPath) && fs.existsSync(remoteCaPath));
    const localRemoteFingerprint = () => {
      if (!remoteCredentialsReady()) return '';
      try {
        return crypto.createHash('sha256')
          .update(new crypto.X509Certificate(fs.readFileSync(remoteCertPath)).raw)
          .digest('hex');
      } catch { return ''; }
    };
    const remoteClientFactory = remoteCredentialsReady()
      ? (node) => new MtlsClient({
        endpoint: node.endpoint, ca: remoteCaPath, cert: remoteCertPath,
        key: remoteKeyPath, serverFingerprint: node.certificateFingerprint,
      }) : null;
    const remoteTransport = remoteClientFactory ? {
      async hello(node) {
        const value = await remoteClientFactory(node).request('GET', '/remote/v1/hello');
        return {
          nodeId: value.nodeId, version: value.daemonVersion,
          capabilities: value.capabilities || {},
          remoteRevision: value.repositoryRevision ?? null,
        };
      },
      pair(input) {
        return remoteClientFactory({ endpoint: input.endpoint, certificateFingerprint: input.serverFingerprint })
          .request('POST', '/remote/v1/pairing/accept', {
            pairingId: input.pairingId, code: input.code,
            clientId: remoteNodeId, name: remoteNodeId,
            requestedPermissions: input.requestedPermissions || ['view', 'submit', 'control'],
          });
      },
    } : null;
    const remotePairingService = new RemotePairingService({
      certificateFingerprint: localRemoteFingerprint(), filePath: appConfig.remoteClientsPath,
    });
    const remoteNodeService = new RemoteNodeService({
      repository: remoteNodeRepository, transport: remoteTransport,
    });
    const remoteTaskService = new RemoteTaskService({
      nodes: remoteNodeService, clientFactory: remoteClientFactory,
    });
    const historyService = new HistoryService({
      repository: historyRepository, tasks: taskRepository, eventBus,
      privateSpace, createDraftService,
    });
    const linkService = new LinkLibraryService({
      repository: linkRepository, tasks: taskRepository, privateSpace,
      createDraftService, eventBus,
    });
    const linkSyncService = new LinkSyncService({ adapter: new LinkSyncAdapter({ enabled: false }) });
    const accountService = new AccountService({
      auth, vip: vipManager, privateSpace, linkSync: linkSyncService, eventBus,
    });
    const diagnosticsService = new DiagnosticsService({
      config: appConfig, tasks: taskRepository, driver, settings: settingsRepository,
      events: diagnosticEvents, privateSpace, media: mediaService,
      remoteNodes: remoteNodeService, operations: operationRepository,
      policy: policyService, auth, vip: vipManager,
    });
    const requestRateLimiter = new RateLimiter({ buckets: {
      'diagnostics-export': { limit: 5, windowMs: 60 * 60 * 1000, concurrency: 1 },
      'media-token': { limit: 60, windowMs: 60 * 1000 },
      capture: { limit: 60, windowMs: 60 * 1000 },
      pairing: { limit: 10, windowMs: 60 * 1000 },
    } });
    const requestAuth = new RequestAuth({ enabled: appConfig.csrfEnabled });
    const bootstrapService = new BootstrapService({
      repository: taskRepository, settings: settingsRepository, driver, auth,
      accountService, vipService: vipManager, privateSpace,
      capabilityProvider: () => driver.nativeCapabilities || {}, config: appConfig,
      policyService, mediaService, requestAuth, remoteEnabledProvider: remoteCredentialsReady,
    });

    ctx.provide('tleiProducts', {
      processRunner, notificationService, privateSpace, mediaService, captureService,
      remotePairingService, remoteNodeService, remoteTaskService, remoteCredentialsReady,
      historyService, linkService, linkSyncService, accountService,
      diagnosticsService, requestRateLimiter, requestAuth, bootstrapService,
    });
    let privateSweepTimer;
    ctx.effect(() => async () => {
      if (privateSweepTimer) clearInterval(privateSweepTimer);
      notificationService.stop();
      remoteNodeService.stop();
      historyService.stop();
      linkService.stop();
      privateSpace.lockAll('shutdown', { clearKey: true });
      await linkSyncService.stopAndClearSession();
    });
    notificationService.start();
    // history/link 消费 outbox 之前先做投影一致性断言（spec §7）：
    // 未确认窗口内的事件快照与 repository 现状矛盾时记脱敏诊断，不阻塞启动。
    try {
      const { replayProjection, compareWithRepository } = require('../src/repositories/projection-replay');
      const pending = taskRepository.listUnacknowledgedEvents('history');
      const { replayed, unsupported } = replayProjection(pending);
      const { inconsistencies } = compareWithRepository({ replayed, tasks: taskRepository.list() });
      if (inconsistencies.length || unsupported.length) {
        console.error('[thunderd] projection consistency:', JSON.stringify({
          inconsistencies: inconsistencies.slice(0, 20), unsupportedEvents: unsupported.length,
        }));
      }
    } catch (error) {
      console.error('[thunderd] projection consistency check failed:', error.code || error.name);
    }
    historyService.start();
    linkService.start();
    if (remoteClientFactory) {
      remoteNodeService.startHealthPolling();
      for (const node of remoteNodeRepository.list()) {
        remoteNodeService.refreshNode(node.id).catch(() => {});
      }
    }
    privateSweepTimer = setInterval(() => privateSpace.sweep(), 60 * 1000);
    privateSweepTimer.unref?.();
  },
};

module.exports = { productServices };
