'use strict';
// control-transport（cordis-arch P1）：控制 socket 传输监听——DaemonControlServer
// + dispatcher。依赖 rpc-registry（方法面）与 request-policy（鉴权/限流），
// 构造即持完整 policy：dispatcher 的 requestAuth/rateLimiter 不再是可空晚注入，
// 产品插件装配前的空窗关闭（原 attachAuth 时序见 rpc-host.cjs 历史）。
const { DaemonControlServer } = require('../src/control/server');
const { DaemonControlDispatcher } = require('../src/control/dispatcher');
const { plugin } = require('./shared.cjs');

const controlTransport = plugin('leifeng-control-transport', ['leifengConfig', 'leifengRpcRegistry', 'leifengRequestPolicy'], async (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.leifengConfig;
  const { registry, handle } = ctx.leifengRpcRegistry;
  const { requestAuth, rateLimiter } = ctx.leifengRequestPolicy;
  const controlDispatcher = new DaemonControlDispatcher({ config: appConfig, handle, registry, requestAuth, rateLimiter });
  const controlServer = new DaemonControlServer({ socketPath: appConfig.controlSocketPath,
    dispatch: (method, params, connection) => controlDispatcher.dispatch(method, params, connection),
    onDisconnect: (connection) => controlDispatcher.releaseConnection(connection) });
  const listener = controlServer.start();
  await new Promise((resolve, reject) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  ctx.provide('leifengControlTransport', { controlServer, controlDispatcher });
  console.log(`[thunderd] core control socket=${appConfig.controlSocketPath}  runtime=${runtimeDir}  downloads=${downloadDir}`);
  return async () => controlServer.stop();
});

module.exports = { controlTransport };
