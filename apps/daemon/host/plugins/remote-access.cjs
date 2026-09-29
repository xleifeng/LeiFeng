'use strict';
// remote-access（P4 拆分自 product-services）：远程节点三服务 + link 同步。
// mTLS 凭据缺席即远程面诚实降级（remoteEnabled=false）；pairing 限流桶随本
// 插件贡献并撤销。daemon.v1.remote.media.issueToken 需要 media——经
// leifengMediaCapture 槽（缺 media 插件时远程流媒体方法不注册）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RemotePairingService } = require('../src/services/remote-pairing-service');
const { RemoteNodeService } = require('../src/services/remote-node-service');
const { RemoteTaskService } = require('../src/services/remote-task-service');
const { LinkSyncService } = require('../src/services/link-sync-service');
const { LinkSyncAdapter } = require('../src/adapters/link-sync-adapter');
const { MtlsClient } = require('../src/remote/mtls-client');
const { createRemoteMethods } = require('../src/rpc/remote-methods');
const { createRemoteControlMethods } = require('../src/rpc/remote-control-methods');
const { parseListenAddress } = require('../src/config');
const { plugin } = require('./shared.cjs');

const remoteAccess = plugin('leifeng-remote-access', ['leifengConfig', 'leifengRepositories', 'leifengTasks', 'leifengRpc', 'leifengRequestPolicy', 'leifengUiRegistry'], (ctx) => {
  const { appConfig, env } = ctx.leifengConfig;
  const { remoteNodeRepository } = ctx.leifengRepositories;
  const { taskQueryService, operationService, createDraftService } = ctx.leifengTasks;
  // mediaService 可选消费（禁用 media-capture 时远程流媒体方法不注册——remote-mtls 插件注释已声明此语义）
  const { mediaService } = ctx.reflect.get('leifengMediaCapture', false) ?? { mediaService: null };
  const withdrawUiCapabilities = ctx.leifengUiRegistry.contribute('remote-access', ['remote']);

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
  const linkSyncService = new LinkSyncService({ adapter: new LinkSyncAdapter({ enabled: false }) });

  ctx.provide('leifengRemoteAccess', {
    remotePairingService, remoteNodeService, remoteTaskService, remoteCredentialsReady, linkSyncService,
  });
  const withdrawV2 = ctx.leifengRpc.registry.register('remote-access', createRemoteMethods({ pairing: remotePairingService, nodes: remoteNodeService, tasks: remoteTaskService }));
  const withdrawControl = ctx.leifengRpc.registry.register('remote-access', createRemoteControlMethods({
    remotePairing: remotePairingService, taskQueryService, operationService, createDraftService,
    media: mediaService, config: appConfig,
  }));
  const withdrawBuckets = ctx.leifengRequestPolicy.rateLimiter.addBuckets({
    pairing: { limit: 10, windowMs: 60 * 1000 },
  });
  ctx.effect(() => async () => {
    withdrawV2(); withdrawControl(); withdrawUiCapabilities(); withdrawBuckets();
    remoteNodeService.stop();
    await linkSyncService.stopAndClearSession();
  });
  if (remoteClientFactory) {
    remoteNodeService.startHealthPolling();
    for (const node of remoteNodeRepository.list()) {
      remoteNodeService.refreshNode(node.id).catch(() => {});
    }
  }
});

module.exports = { remoteAccess };
