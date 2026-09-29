import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgv, runCli } from '../../../../packages/runtime/src/index.mjs';

const require = createRequire(import.meta.url);
const { daemonRegistry } = require('../plugins/index.cjs');

export async function main(argv = process.argv.slice(2)) {
  const profile = parseArgv(argv).profile;
  let registry = daemonRegistry();
  let parseProfileArgs;
  let profilePatch;
  // plugin-admin 的 enabled 持久化（plugin-state.json）→ userPatch（重启生效）。
  // 仅 daemon 侧 profile 读取；bridge-host 无此插件面。
  let statePatch;
  if (profile === 'thunderd' || profile === 'thunderd-core') {
    const { readEnabledState } = require('../plugins/plugin-admin.cjs');
    const runtimeDir = process.env.THUNDERD_RUNTIME_DIR
      ? require('node:path').resolve(process.env.THUNDERD_RUNTIME_DIR)
      : null;
    if (runtimeDir) {
      // 旧插件 id 迁移：control-rpc → rpc-host（rpc-plugin-registration）；
      // tlei- → leifeng- 前缀（leifeng 改名，2026-09-29）。旧 disabled 集合里的
      // id 映射到新 id，保证升级后禁用意图不丢失。
      const migrated = {
        'control-rpc': 'rpc-host', 'rpc-host': 'control-transport',
        // P4 拆分迁移：product-services 的禁用意图映射到聚合核 product-core
        //（域插件是新面，旧意图保守落在核上——用户可再细调各域）。
        'product-services': 'product-core',
        'tlei-runtime-config': 'leifeng-runtime-config', 'tlei-repositories': 'leifeng-repositories',
        'tlei-kernel-hub': 'leifeng-kernel-hub', 'tlei-rpc-host': 'leifeng-rpc-host',
        'tlei-kernel-thunder': 'leifeng-kernel-thunder', 'tlei-kernel-qbit': 'leifeng-kernel-qbit',
        'tlei-task-shell': 'leifeng-task-shell', 'tlei-product-services': 'leifeng-product-services',
        'tlei-plugin-admin': 'leifeng-plugin-admin', 'tlei-web-api-process': 'leifeng-web-api-process',
      };
      statePatch = Object.entries(readEnabledState(runtimeDir))
        .map(([id, enabled]) => ({ id: migrated[id] || id, enabled }));
    }
  }
  if (profile === 'bridge-host') {
    const { createBridgePluginRegistry } = require('../../../../apps/bridge/src/profile-plugins.cjs');
    const { bridgePatch } = require('../../../../apps/bridge/src/main.js');
    registry = createBridgePluginRegistry();
    parseProfileArgs = bridgePatch;
    profilePatch = [{ id: 'runtime-config', config: {
      bearerToken: process.env.THUNDERD_RPC_SECRET || '', csrfToken: process.env.THUNDERD_CSRF_TOKEN || '',
      qbitUsername: process.env.QBIT_USERNAME || '', qbitPassword: process.env.QBIT_PASSWORD || '',
      qbitPort: Number(process.env.QBIT_PORT) || 8085,
    } }];
  }
  const original = Object.fromEntries(['log', 'warn', 'error'].map(level => [level, console[level]]));
  for (const level of Object.keys(original)) {
    const output = original[level].bind(console);
    console[level] = (...args) => output(new Date().toISOString(), ...args);
  }
  const onUnhandled = (reason) => console.error('[thunderd] unhandled rejection:', reason?.code || reason?.name || 'unknown');
  process.on('unhandledRejection', onUnhandled);
  try {
    const userPatch = statePatch ?? undefined;
    const code = await runCli({ registry, argv, parseProfileArgs, profilePatch, userPatch });
    process.exitCode = code;
    return code;
  } finally {
    process.off('unhandledRejection', onUnhandled);
    for (const level of Object.keys(original)) console[level] = original[level];
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error('[thunderd] profile launcher failed:', error.message);
    process.exitCode = 1;
  });
}
