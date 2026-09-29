'use strict';
const path = require('path');
const fs = require('fs');
const { hasSqlite } = require('../kernels/thunder/taskdb-reader');
const { acquireLock, releaseLock } = require('../src/lockfile');
const { loadConfig } = require('../src/config');
const { createUiCapabilityRegistry } = require('../src/domain/ui-capabilities');
const { plugin, repoRoot } = require('./shared.cjs');

const runtimeConfig = plugin('leifeng-runtime-config', [], (ctx, options = {}) => {
  const env = { ...process.env, ...(options.env || {}) };
  const appConfig = loadConfig({ env, repoRoot });
  const runtimeDir = appConfig.runtimeDir;
  const downloadDir = appConfig.downloadDir;
  for (const d of ['data', 'secrets', 'seeds', 'uploads', 'profile/dkcfg', 'profile/Torrents', 'profile/temp', 'log']) {
    fs.mkdirSync(path.join(runtimeDir, d), { recursive: true });
  }
  fs.mkdirSync(downloadDir, { recursive: true });
  const lockPath = path.join(runtimeDir, 'thunderd.lock');
  if (!acquireLock(lockPath, process.pid)) {
    throw new Error(`another thunderd instance is running for runtime ${runtimeDir}`);
  }
  if (appConfig.engineMode === 'wine' && !hasSqlite) {
    console.error('[thunderd] WARN: sqlite3 CLI not found; observation degrades to filesystem-only');
  }
  ctx.provide('leifengConfig', { appConfig, runtimeDir, downloadDir, repoRoot, env });
  ctx.provide('leifengUiRegistry', createUiCapabilityRegistry());
  return () => releaseLock(lockPath, process.pid);
});

module.exports = { runtimeConfig };
