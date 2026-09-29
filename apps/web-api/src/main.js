'use strict';
// Web API 子进程入口（P5，cordis-arch）：gateway 插件树薄壳 launcher——
// 配置装载、daemon 连接、路由、HTTP 监听、remote mTLS 全在 plugins/ 树内
// （gateway profile）。进程级兜底保持：单请求异常绝不打挂 Web API。
const { createGatewayPluginRegistry } = require('./plugins/index.cjs');

async function main(argv = ['--profile', 'gateway']) {
  // 进程级兜底：单请求异常绝不打挂 Web API（systemd Restart 循环风险）。
  process.on('unhandledRejection', (reason) => {
    console.error('[thunder-web-api] unhandled rejection:', reason && reason.stack ? reason.stack : reason);
  });
  const { runCli } = await import('../../../packages/runtime/src/index.mjs');
  return runCli({ registry: createGatewayPluginRegistry(), argv });
}

if (require.main === module) main().catch((error) => { console.error('[thunder-web-api] startup failed:', error.message); process.exit(1); });

module.exports = { main, createGatewayPluginRegistry };
