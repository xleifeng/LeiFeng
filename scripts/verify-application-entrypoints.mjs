import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = {
  core: readFileSync(resolve(root, 'daemon/host/src/main.js'), 'utf8'),
  stack: readFileSync(resolve(root, 'daemon/host/src/stack.js'), 'utf8'),
  daemon: readFileSync(resolve(root, 'daemon/host/src/entry.mjs'), 'utf8'),
  bridge: readFileSync(resolve(root, 'packages/webseed-bridge/src/main.js'), 'utf8'),
  run: readFileSync(resolve(root, 'daemon/run.sh'), 'utf8'),
};
const checks = [
  ['core compatibility entry', sources.core.includes('entry.mjs') && sources.core.includes('thunderd-core')],
  ['stack compatibility entry', sources.stack.includes('entry.mjs') && sources.stack.includes('thunderd')],
  ['daemon profile launcher', sources.daemon.includes('runCli') && sources.daemon.includes('daemonRegistry')],
  ['bridge profile launcher', sources.bridge.includes('runCli') && sources.bridge.includes('createBridgePluginRegistry')],
  ['run.sh profile launcher', sources.run.includes('entry.mjs --profile thunderd')],
  ['no legacy daemon assembly entry', !/new\s+(?:TaskRepository|WineNodeDriver|DaemonControlServer)\s*\(/.test(sources.core + sources.stack)],
  ['no legacy bridge assembly entry', !/createOrchestrator\s*\(/.test(sources.bridge)],
];
for (const [name, valid] of checks) {
  if (!valid) throw new Error(`application entrypoint bypasses profile launcher: ${name}`);
}
console.log(`application entrypoints verified (${checks.length})`);
