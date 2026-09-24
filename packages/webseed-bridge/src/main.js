// Compatibility entrypoint. The bridge-host profile owns all runtime resources.
'use strict';

const { parseBridgeInputs } = require('./inputs');
const { createBridgePluginRegistry } = require('./profile-plugins.cjs');

function bridgePatch(argv) {
  if (!argv.length) return undefined; // --config may supply every required field.
  const args = parseBridgeInputs(argv);
  if (!['serve', 'hybrid'].includes(args.command)) throw new Error('用法: hybrid|serve --magnet <URI> 或 --torrent <file> --data <savePath>');
  if (!args.data) throw new Error('缺少 --data');
  if (!args.inputs.length) throw new Error('缺少输入项');
  if (args.command === 'serve' && (args.inputs.length !== 1 || args.inputs[0].kind !== 'torrent')) {
    throw new Error('serve 模式只接受一个 --torrent');
  }
  return [{ id: 'runtime-config', config: {
    mode: args.command, host: args.host, port: args.port, daemonPort: args.daemonPort,
    savePath: args.data, inputs: args.inputs, ...(args.out ? { out: args.out } : {}),
  } }];
}

async function main(argv = process.argv.slice(2), options = {}) {
  const { runCli } = await import('../../runtime/src/index.mjs');
  const registry = createBridgePluginRegistry();
  const profileArgv = argv.includes('--profile') ? argv : ['--profile', 'bridge-host', ...argv];
  return runCli({ registry, argv: profileArgv, parseProfileArgs: (rest, profile) => {
    if (profile !== 'bridge-host') throw new Error('桥入口仅支持 bridge-host profile');
    return bridgePatch(rest);
  }, profilePatch: [{ id: 'runtime-config', config: {
    bearerToken: process.env.THUNDERD_RPC_SECRET || '',
    csrfToken: process.env.THUNDERD_CSRF_TOKEN || '',
    qbitUsername: process.env.QBIT_USERNAME || '',
    qbitPassword: process.env.QBIT_PASSWORD || '',
    qbitPort: Number(process.env.QBIT_PORT) || 8085,
  } }], ...options });
}

if (require.main === module) main().then((code) => { process.exitCode = code; })
  .catch((error) => { process.stderr.write(`[bridge] ${error.message}\n`); process.exitCode = 1; });

module.exports = { bridgePatch, main };
