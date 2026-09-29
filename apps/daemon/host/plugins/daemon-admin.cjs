'use strict';
// daemon-admin：daemon 进程级管理面——状态查询 + 整体重启请求。
// 重启协议 = 标记文件（${runtimeDir}/restart-requested）：restart RPC 写标记 →
// 诊断事件 → 缓冲后 SIGTERM 自杀；runCli 优雅 dispose 链完整回收 web-api 子进程
// 与引擎。守护脚本（部署 start.sh 的 while 循环）见进程退出且标记存在 → 删标记
// 重新拉起；无标记的退出（SSH kill / 崩溃）不拉起，停机语义不变。
// 不改 launcher/entry 一行——重启编排全部在插件 + 部署脚本层。
const fs = require('fs');
const path = require('path');
const { plugin } = require('./shared.cjs');

const RESTART_MARKER = 'restart-requested';

const daemonAdmin = plugin('leifeng-daemon-admin', ['leifengConfig', 'leifengKernelHub', 'leifengRpc', 'leifengUiRegistry'], (ctx) => {
  const { appConfig, runtimeDir, env } = ctx.leifengConfig;
  const withdrawUi = ctx.leifengUiRegistry.contribute('daemon-admin', ['daemon-admin']);
  const { registry } = ctx.leifengRpc;
  const startedAt = Date.now();
  let restartPending = false;

  const withdraw = registry.register('daemon-admin', new Map([
    // 进程状态快照：engine 段经 kernelHub 可选消费（无内核时 null，不伪装）
    ['leifeng.ui.v2.daemon.status', () => {
      const usage = process.memoryUsage();
      const kernelSlot = ctx.leifengKernelHub?.default?.();
      const driver = kernelSlot?.kernel ?? null;
      return {
        pid: process.pid,
        ppid: process.ppid,
        version: appConfig.version || '0.0.0',
        profile: env.LEIFENG_PROFILE
          || (process.argv.includes('--profile') ? (process.argv[process.argv.indexOf('--profile') + 1] || '') : ''),
        uptimeMs: Date.now() - startedAt,
        restartPending,
        memory: { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed },
        engine: driver ? {
          sdkReady: driver.sdkReady === true,
          enginePid: typeof driver.enginePid === 'function' ? driver.enginePid() : null,
          restarts: Number(driver.restarts) || 0,
          generation: Number(driver._generation) || 0,
        } : null,
      };
    }],
    // 整体重启：写标记 + 事件 + 500ms 缓冲（响应先回 WebUI）后 SIGTERM。
    // 幂等：已 pending 时直接返回（第二次点击不叠加信号）。
    ['leifeng.ui.v2.daemon.restart', () => {
      if (restartPending) return { restarting: true, pid: process.pid };
      restartPending = true;
      const marker = path.join(runtimeDir, RESTART_MARKER);
      fs.writeFileSync(marker, `${Date.now()}\n`, { mode: 0o600 });
      console.log('[daemon-admin] restart requested; supervisor should relaunch (marker written)');
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref?.();
      return { restarting: true, pid: process.pid };
    }],
  ]));

  return () => { withdraw(); withdrawUi(); };
});

module.exports = { daemonAdmin, RESTART_MARKER };
