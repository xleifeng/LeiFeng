'use strict';
// http-server：主 HTTP 监听（JSON-RPC 代理 + 静态 WebUI + 路由面）。
const { createWebApiServer } = require('../server');

const httpServer = {
  inject: ['gatewayConfig', 'gatewayDaemon', 'gatewayRoutes'],
  apply(ctx) {
    const config = ctx.gatewayConfig;
    const { client, health } = ctx.gatewayDaemon;
    const { routes, staticDir, frontendPluginsDir } = ctx.gatewayRoutes;
    const server = createWebApiServer({ client, host: config.host, port: config.port, maxBodyBytes: config.maxBodyBytes, staticDir, routes, frontendPluginsDir });
    // 监听失败：进程退出码置 1 并触发 profile dispose（原 main.js 行为）
    server.on('error', (error) => { console.error('[thunder-web-api] listener failed:', error.message); process.exitCode = 1; process.emit('SIGTERM', 'SIGTERM'); });
    const listening = new Promise((resolve) => server.listen(config.port, config.host, () => {
      console.log(`[thunder-web-api] HTTP/JSON-RPC on http://${config.host}:${config.port}/  daemon_pid=${health.pid}  control=${config.controlSocketPath}`);
      if (staticDir) console.log(`[thunder-web-api] Web UI source=${staticDir}`);
      if (frontendPluginsDir) console.log(`[thunder-web-api] frontend plugins source=${frontendPluginsDir}`);
      resolve();
    }));
    ctx.provide('gatewayHttp', { server, listening });
    return () => new Promise((resolve) => server.close(resolve));
  },
};

module.exports = { httpServer };
