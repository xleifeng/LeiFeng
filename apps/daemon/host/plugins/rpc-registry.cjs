'use strict';
// rpc-registry（cordis-arch P1）：纯 RPC 注册机制宿主——RpcRegistry 实例 +
// 方法分发 handler。不监听任何 socket、不构造鉴权——「必须先监听才能注册」的
// 依赖倒置点：注册者只依赖本服务即可完成装配期注册。传输监听在
// control-transport，请求策略在 request-policy（transport 的必需依赖）。
const { createMethodHandler } = require('../src/methods');
const { RpcRegistry } = require('../src/rpc/registry');
const { plugin } = require('./shared.cjs');

const rpcRegistryPlugin = plugin('leifeng-rpc-registry', ['leifengConfig'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const registry = new RpcRegistry();
  const handle = createMethodHandler({ config: appConfig, registry });
  ctx.provide('leifengRpcRegistry', { registry, handle });
});

module.exports = { rpcRegistryPlugin };
