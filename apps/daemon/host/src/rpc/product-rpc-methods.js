'use strict';
// product 域 RPC 注册工厂（rpc-plugin-registration：product-services 消费）。
// 方法面 = 原 leifeng-ui-v2-methods.js 里服务主人是 product-services 的条目；
// account/vip 已归 kernel-thunder，history/links/private/media/capture/remote/
// diagnostics 是本地重实现域（零迅雷依赖），bootstrap 是装配快照聚合。

const validators = require('./validators');
const { createPrivateSpaceMethods } = require('./private-space-methods');
const { createHistoryLinkMethods } = require('./history-link-methods');
const { createSystemMethods } = require('./system-methods');
const { createCaptureMethods } = require('./capture-methods');
const { createRemoteMethods } = require('./remote-methods');
const { createDiagnosticsMethods } = require('./diagnostics-methods');

function createProductRpcMethods({ bootstrapService, privateSpace = null, historyService = null, linkService = null, media = null, capture = null, remotePairing = null, remoteNodes = null, remoteTasks = null, diagnostics = null, driver = null, operations = null, eventBus = null } = {}) {
  if (!bootstrapService) throw new Error('product RPC bootstrapService is required');
  const methods = new Map([
    ['leifeng.ui.v2.bootstrap', (_params, ctx) => bootstrapService.getSnapshot(ctx)],
  ]);
  for (const map of [
    privateSpace ? createPrivateSpaceMethods({ privateSpace }) : null,
    (historyService || linkService) ? createHistoryLinkMethods({ historyService, linkService }) : null,
    createSystemMethods({ systemIntegration: null, media, driver, operations, eventBus }),
    capture ? createCaptureMethods({ capture }) : null,
    (remotePairing || remoteNodes || remoteTasks) ? createRemoteMethods({ pairing: remotePairing, nodes: remoteNodes, tasks: remoteTasks }) : null,
    diagnostics ? createDiagnosticsMethods({ diagnostics }) : null,
  ]) {
    if (map) for (const [name, handler] of map) methods.set(name, handler);
  }
  return methods;
}

module.exports = { createProductRpcMethods };
