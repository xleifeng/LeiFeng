'use strict';

const fs = require('node:fs');
const { DaemonClient } = require('../../packages/daemon-client');
const { loadWebApiConfig } = require('./config');
const { createWebApiServer } = require('./server');
const { createTorrentUploadRoute } = require('./routes/torrent-upload');
const { createTaskExportRoute } = require('./routes/task-export');
const { createTaskMediaRoutes } = require('./routes/task-media');
const { createBrowserCaptureRoute } = require('./routes/browser-capture');
const { createDiagnosticExportRoute } = require('./routes/diagnostic-export');
const { MtlsServer } = require('./remote/mtls-server');
const { createRemotePairingRoute } = require('./remote/pairing-route');
const { createRemoteHandler } = require('./remote/handler');

async function waitForDaemon(client, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs; let lastError;
  while (Date.now() < deadline) {
    try { return await client.health(); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw lastError || new Error('daemon control socket did not become ready');
}

async function main() {
  // 进程级兜底：单请求异常绝不打挂 Web API（systemd Restart 循环风险）。
  process.on('unhandledRejection', (reason) => {
    console.error('[thunder-web-api] unhandled rejection:', reason && reason.stack ? reason.stack : reason);
  });
  const config = loadWebApiConfig();
  const client = new DaemonClient({ socketPath: config.controlSocketPath });
  const health = await waitForDaemon(client, Number(process.env.THUNDER_WEB_API_DAEMON_WAIT_MS) || 60000);
  const routes = [
    createTorrentUploadRoute({ client, tempRoot: config.uploadsDir, maxBytes: config.maxTorrentUploadBytes }),
    createTaskExportRoute({ client }),
    createTaskMediaRoutes({ client }),
    createBrowserCaptureRoute({ client, maxBodyBytes: config.maxCaptureBodyBytes, maxTorrentBytes: config.maxTorrentUploadBytes, tempRoot: config.uploadsDir, allowRemote: config.captureRemote }),
    createDiagnosticExportRoute({ client }),
  ];
  const staticDir = fs.existsSync(config.webUiDir) ? config.webUiDir : null;
  const server = createWebApiServer({ client, host: config.host, port: config.port, maxBodyBytes: config.maxBodyBytes, staticDir, routes });
  let remoteServer = null;
  const remoteReady = config.remoteListen && config.remoteCertDir && [config.remoteKeyPath, config.remoteCertPath, config.remoteCaPath].every((file) => fs.existsSync(file));
  if (remoteReady) {
    remoteServer = new MtlsServer({ key: config.remoteKeyPath, cert: config.remoteCertPath, ca: config.remoteCaPath, host: config.remoteListen.host, port: config.remoteListen.port, pairingRoute: createRemotePairingRoute({ client }), handler: createRemoteHandler({ client, nodeId: config.remoteNodeId }) });
    remoteServer.start();
  } else if (config.remoteListen || config.remoteCertDir) console.warn('[thunder-web-api] remote listener disabled: certificate/key/CA files are incomplete');
  server.on('error', (error) => { console.error('[thunder-web-api] listener failed:', error.message); process.exitCode = 1; shutdown(); });
  server.listen(config.port, config.host, () => {
    console.log(`[thunder-web-api] HTTP/JSON-RPC on http://${config.host}:${config.port}/  daemon_pid=${health.pid}  control=${config.controlSocketPath}`);
    if (staticDir) console.log(`[thunder-web-api] Web UI source=${staticDir}`);
    if (remoteServer) console.log(`[thunder-web-api] remote mTLS on ${config.remoteListen.host}:${config.remoteListen.port}`);
  });

  let stopping = false;
  async function shutdown() {
    if (stopping) return; stopping = true;
    await new Promise((resolve) => server.close(resolve));
    if (remoteServer) await remoteServer.stop();
    client.close();
  }
  process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
}

if (require.main === module) main().catch((error) => { console.error('[thunder-web-api] startup failed:', error.message); process.exit(1); });

module.exports = { main, waitForDaemon };
