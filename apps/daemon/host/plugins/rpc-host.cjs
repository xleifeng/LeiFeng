'use strict';
// rpc-host：壳层 RPC 传输与注册机制宿主（rpc-plugin-registration，2026-09-28）。
// 不持有任何业务方法——leifeng.ui.v2.* / daemon.v1.* 全部由服务主人插件经
// leifengRpc（RpcRegistry）注册。本插件只做三件事：
//   1. RpcRegistry 实例 + control socket 监听（DaemonControlServer）
//   2. daemon.v1 三机制方法（health / web.invoke / lease.release）——传输层
//      自身，无业务语义，豁免「壳不持有 RPC」
//   3. 把 registry 发进 ctx 供注册者使用
// 启动顺序：本插件必须先于一切注册者（profile 顺序 + requires 双保险）。
const { createMethodHandler } = require('../src/methods');
const { RpcRegistry } = require('../src/rpc/registry');
const { DaemonControlServer } = require('../src/control/server');
const { DaemonControlDispatcher } = require('../src/control/dispatcher');
const { plugin } = require('./shared.cjs');

const rpcHost = plugin('leifeng-rpc-host', ['leifengConfig'], async (ctx) => {
  const { appConfig, runtimeDir, downloadDir } = ctx.leifengConfig;
  const registry = new RpcRegistry();
  const handle = createMethodHandler({ config: appConfig, registry });
  // requestAuth / rateLimiter 属产品域状态（product-services 构造），经
  // leifengRpc.attachAuth 晚注入 dispatcher——kernel/task/product 三个注册者
  // 启动时 dispatcher 已在监听，注入前 CSRF/限流守卫为直通（loopback 场景
  // 与原时序等价：原实现里它们也在 control-rpc 装配期才接上）。
  const controlDispatcher = new DaemonControlDispatcher({ config: appConfig, handle, registry,
    requestAuth: null, rateLimiter: null });
  const controlServer = new DaemonControlServer({ socketPath: appConfig.controlSocketPath,
    dispatch: (method, params, connection) => controlDispatcher.dispatch(method, params, connection),
    onDisconnect: (connection) => controlDispatcher.releaseConnection(connection) });
  const listener = controlServer.start();
  await new Promise((resolve, reject) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  ctx.provide('leifengRpc', {
    registry, controlServer, controlDispatcher, handle,
    attachAuth: ({ requestAuth = null, rateLimiter = null } = {}) => {
      controlDispatcher.requestAuth = requestAuth;
      controlDispatcher.rateLimiter = rateLimiter;
    },
  });
  console.log(`[thunderd] core control socket=${appConfig.controlSocketPath}  runtime=${runtimeDir}  downloads=${downloadDir}`);
  return async () => controlServer.stop();
});

module.exports = { rpcHost };
