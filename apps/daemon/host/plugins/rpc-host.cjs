'use strict';
// rpc-host（cordis-arch P1 起为兼容聚合壳）：原单插件已拆三——
//   rpc-registry    纯注册机制（RpcRegistry + handler，无监听）
//   request-policy  鉴权/限流策略（先于传输就绪，attachAuth 空窗关闭）
//   control-transport  control socket 监听 + dispatcher
// 本文件保留 leifengRpc 兼容服务面（registry/controlServer/controlDispatcher/
// handle/attachAuth）供既有消费方（product-services、web-api-process、tests）
// 平移迁移；profile 已改用三拆插件，本聚合壳在消费方全部迁移后退役。
const { plugin } = require('./shared.cjs');

const rpcHost = plugin('leifeng-rpc-host', ['leifengRpcRegistry', 'leifengRequestPolicy', 'leifengControlTransport'], (ctx) => {
  const { registry, handle } = ctx.leifengRpcRegistry;
  const { controlServer, controlDispatcher } = ctx.leifengControlTransport;
  ctx.provide('leifengRpc', {
    registry, handle, controlServer, controlDispatcher,
    // 兼容旧签名：policy 已在 transport 构造时注入，此处只做幂等校验。
    attachAuth: ({ requestAuth = null, rateLimiter = null } = {}) => {
      if (requestAuth) controlDispatcher.requestAuth = requestAuth;
      if (rateLimiter) controlDispatcher.rateLimiter = rateLimiter;
    },
  });
});

module.exports = { rpcHost };
