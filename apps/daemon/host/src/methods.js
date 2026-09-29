'use strict';

class RpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// v1 兼容面（aria2.* / thunder.* / system.multicall）已于 2026-09-28 整体移除；
// 2026-09-28 起方法本体也不再由壳持有——leifeng.ui.v2.* 全部经 RpcRegistry 由
// 服务主人插件注册（docs/specs/2026-09-28-rpc-plugin-registration.md）。本文件
// 只剩传输机制：前缀守卫、bearer 鉴权、错误包装。
function createMethodHandler({ config, registry = null }) {
  const rpcSecret = config.rpcSecret; // 可空：未配 THUNDERD_RPC_SECRET 时不鉴权
  const handler = async function handle(method, params, ctx = {}) {
    if (!method.startsWith('leifeng.ui.v2.'))
      throw new RpcError(-32601, `Method not found: ${method}`);
    if (!registry || !registry.has(method)) throw new RpcError(-32601, `Method not found: ${method}`);
    // V2 never accepts the legacy token:<secret> parameter shape. When a
    // secret is configured it must arrive through Authorization: Bearer.
    if (rpcSecret && (ctx.rpcSecret !== undefined || ctx.bearerToken !== rpcSecret))
      throw new RpcError(1, 'unauthorized: V2 requires Authorization bearer header');
    try { return await registry.get(method)(params || [], ctx); }
    catch (error) {
      if (error instanceof RpcError) throw error;
      const wrapped = new RpcError(error.code || 1, error.message || String(error));
      wrapped.details = error.details;
      throw wrapped;
    }
  };
  return handler;
}

module.exports = { createMethodHandler, RpcError };
