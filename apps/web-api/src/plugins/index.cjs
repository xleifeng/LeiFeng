'use strict';
// web-api gateway 插件树（P5，cordis-arch）：子进程内部装配插件化。
// 五插件依赖单向：gateway-config → daemon-connection → gateway-routes →
// http-server → remote-mtls。原 main.js 的过程式装配逐段搬入，行为不变
// （监听日志、waitForDaemon 时限、remote 凭据缺席降级、进程级 unhandledRejection 兜底）。

const { gatewayConfig } = require('./gateway-config.cjs');
const { daemonConnection } = require('./daemon-connection.cjs');
const { gatewayRoutes } = require('./gateway-routes.cjs');
const { httpServer } = require('./http-server.cjs');
const { remoteMtls } = require('./remote-mtls.cjs');

function createGatewayPluginRegistry() {
  const definitions = [
    ['gateway-config', gatewayConfig, 'gatewayConfig'],
    ['daemon-connection', daemonConnection, 'gatewayDaemon'],
    ['gateway-routes', gatewayRoutes, 'gatewayRoutes'],
    ['http-server', httpServer, 'gatewayHttp'],
    ['remote-mtls', remoteMtls, 'gatewayRemote'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided]) => [id, {
    plugin: definition, provides: [provided], requires: definition.inject,
  }]));
}

module.exports = { createGatewayPluginRegistry };
