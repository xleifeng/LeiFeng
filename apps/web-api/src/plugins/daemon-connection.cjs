'use strict';
// daemon-connection：control socket 客户端 + daemon 健康等待（超时拒绝启动）。
const { DaemonClient } = require('@leifeng/daemon-client');

async function waitForDaemon(client, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs; let lastError;
  while (Date.now() < deadline) {
    try { return await client.health(); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw lastError || new Error('daemon control socket did not become ready');
}

const daemonConnection = {
  inject: ['gatewayConfig'],
  async apply(ctx) {
    const config = ctx.gatewayConfig;
    const client = new DaemonClient({ socketPath: config.controlSocketPath });
    const health = await waitForDaemon(client, Number(process.env.THUNDER_WEB_API_DAEMON_WAIT_MS) || 60000);
    ctx.provide('gatewayDaemon', { client, health });
    return () => client.close();
  },
};

module.exports = { daemonConnection, waitForDaemon };
