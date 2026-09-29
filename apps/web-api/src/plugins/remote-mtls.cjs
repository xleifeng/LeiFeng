'use strict';
// remote-mtls：远程 mTLS 监听（凭据缺席即诚实降级——只警告不启动）。
const fs = require('node:fs');
const { MtlsServer } = require('../remote/mtls-server');
const { createRemotePairingRoute } = require('../remote/pairing-route');
const { createRemoteHandler } = require('../remote/handler');

const remoteMtls = {
  inject: ['gatewayConfig', 'gatewayDaemon'],
  apply(ctx) {
    const config = ctx.gatewayConfig;
    const { client } = ctx.gatewayDaemon;
    const remoteReady = config.remoteListen && config.remoteCertDir && [config.remoteKeyPath, config.remoteCertPath, config.remoteCaPath].every((file) => fs.existsSync(file));
    if (!remoteReady) {
      if (config.remoteListen || config.remoteCertDir) console.warn('[thunder-web-api] remote listener disabled: certificate/key/CA files are incomplete');
      ctx.provide('gatewayRemote', { server: null });
      return;
    }
    const server = new MtlsServer({ key: config.remoteKeyPath, cert: config.remoteCertPath, ca: config.remoteCaPath, host: config.remoteListen.host, port: config.remoteListen.port, pairingRoute: createRemotePairingRoute({ client }), handler: createRemoteHandler({ client, nodeId: config.remoteNodeId }) });
    server.start();
    console.log(`[thunder-web-api] remote mTLS on ${config.remoteListen.host}:${config.remoteListen.port}`);
    ctx.provide('gatewayRemote', { server });
    return () => server.stop();
  },
};

module.exports = { remoteMtls };
