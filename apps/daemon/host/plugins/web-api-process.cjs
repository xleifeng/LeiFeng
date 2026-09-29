'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { plugin } = require('./shared.cjs');

const webApiProcess = plugin('leifeng-web-api-process', ['leifengConfig', 'leifengRpc'], (ctx) => {
  const { repoRoot, env } = ctx.leifengConfig;
  const entry = path.join(repoRoot, 'apps', 'web-api', 'src', 'main.js');
  let child = null;
  let timer = null;
  let stopping = false;
  // 控制通道路径必须显式下发：win32 的 named pipe 由 appConfig 推导（THUNDERD_CONTROL_SOCKET
  // 常未设置），不传则子进程回退拼 runtime 下的 .sock 文件路径，永远连不上 daemon。
  const childEnv = { ...env, THUNDERD_CONTROL_SOCKET: ctx.leifengConfig.appConfig.controlSocketPath };
  function start() {
    if (stopping) return;
    child = spawn(process.execPath, [entry], { cwd: repoRoot, env: childEnv, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return;
      console.error(`[thunderd] web-api exited (${signal || code}); restarting gateway`);
      timer = setTimeout(start, 1000);
      timer.unref?.();
    });
  }
  start();
  ctx.provide('leifengWebApi', { current: () => child });
  return async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (!child) return;
    const running = child;
    running.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => running.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
    if (running.exitCode === null && !running.signalCode) running.kill('SIGKILL');
  };
});

module.exports = { webApiProcess };
