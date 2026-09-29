'use strict';
// daemon.v1.remote.* 注册工厂（P4 拆分：远程面归 remote-access 插件）。
// 远程面权限模型经 requirePermission + pairing clients 表（远程 principal
// 属 remote 域服务）。
const { controlError, requirePermission } = require('../control/dispatcher');

function remotePrincipalOf(remotePairing, fingerprint) {
  const value = String(fingerprint || '').toLowerCase();
  const principal = remotePairing?.clients?.get?.(value);
  if (!principal || principal.revokedAt) throw controlError('REMOTE_CERT_REJECTED', '远程客户端证书未授权');
  return principal;
}

function createRemoteControlMethods({ remotePairing, taskQueryService, operationService, createDraftService, media, config }) {
  const methods = [];
  methods.push(['daemon.v1.remote.hello', (params, ctx) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'view');
    const sections = ctx.registry?.healthSectionsSync?.() || {};
    return { protocolVersion: 1, daemonVersion: config.version, nodeId: params.nodeId, capabilities: { query: true, command: true, submit: true, media: true }, repositoryRevision: Number(sections?.repositories?.revision) || 0 };
  }]);
  methods.push(['daemon.v1.remote.pairing.accept', (params) => remotePairing.acceptClient(params.input || {})]);
  methods.push(['daemon.v1.remote.tasks.query', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'view');
    return taskQueryService.query(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.tasks.command', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'control');
    return operationService.execute(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.drafts.preflight', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'submit');
    return createDraftService.preflight(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.drafts.commit', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'submit');
    return createDraftService.commit(params.input || {});
  }]);
  methods.push(['daemon.v1.remote.media.issueToken', (params) => {
    requirePermission(remotePrincipalOf(remotePairing, params.fingerprint), 'stream');
    return media.issueToken(params.input || {}, {});
  }]);
  return methods;
}

module.exports = { createRemoteControlMethods, remotePrincipalOf };
