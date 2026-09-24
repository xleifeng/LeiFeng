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
    const code = await runCli({ registry, argv, parseProfileArgs, profilePatch });
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
