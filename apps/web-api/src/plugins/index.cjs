'use strict';
// web-api gateway 插件树（P5，cordis-arch）：子进程内部装配插件化。
// 四插件依赖单向：gateway-config → daemon-connection → gateway-routes →
// http-server。原 main.js 的过程式装配逐段搬入（监听日志、waitForDaemon
// 时限、进程级 unhandledRejection 兜底）。remote-mtls 监听已随远程下载功能
// 整层删除（2026-09-29，docs/specs/2026-09-29-remove-remote-capture.md）。

const { gatewayConfig } = require('./gateway-config.cjs');
const { daemonConnection } = require('./daemon-connection.cjs');
const { gatewayRoutes } = require('./gateway-routes.cjs');
const { httpServer } = require('./http-server.cjs');

function createGatewayPluginRegistry() {
  const definitions = [
    ['gateway-config', gatewayConfig, 'gatewayConfig'],
    ['daemon-connection', daemonConnection, 'gatewayDaemon'],
    ['gateway-routes', gatewayRoutes, 'gatewayRoutes'],
    ['http-server', httpServer, 'gatewayHttp'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided]) => [id, {
    plugin: definition, provides: [provided], requires: definition.inject,
  }]));
}

module.exports = { createGatewayPluginRegistry };
