'use strict';
// gateway-routes：HTTP 路由面（上传/导出/媒体/接管/诊断导出），全走 daemon control 面。
const fs = require('node:fs');
const { createTorrentUploadRoute } = require('../routes/torrent-upload');
const { createTaskExportRoute } = require('../routes/task-export');
const { createTaskMediaRoutes } = require('../routes/task-media');
const { createBrowserCaptureRoute } = require('../routes/browser-capture');
const { createDiagnosticExportRoute } = require('../routes/diagnostic-export');

const gatewayRoutes = {
  inject: ['gatewayConfig', 'gatewayDaemon'],
  apply(ctx) {
    const config = ctx.gatewayConfig;
    const { client } = ctx.gatewayDaemon;
    const routes = [
      createTorrentUploadRoute({ client, tempRoot: config.uploadsDir, maxBytes: config.maxTorrentUploadBytes }),
      createTaskExportRoute({ client }),
      createTaskMediaRoutes({ client }),
      createBrowserCaptureRoute({ client, maxBodyBytes: config.maxCaptureBodyBytes, maxTorrentBytes: config.maxTorrentUploadBytes, tempRoot: config.uploadsDir, allowRemote: config.captureRemote }),
      createDiagnosticExportRoute({ client }),
    ];
    const staticDir = fs.existsSync(config.webUiDir) ? config.webUiDir : null;
    const frontendPluginsDir = config.frontendPluginsDir && fs.existsSync(config.frontendPluginsDir) ? config.frontendPluginsDir : null;
    ctx.provide('gatewayRoutes', { routes, staticDir, frontendPluginsDir });
  },
};

module.exports = { gatewayRoutes };
