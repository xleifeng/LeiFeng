import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = {
  core: readFileSync(resolve(root, 'apps/daemon/host/src/main.js'), 'utf8'),
  stack: readFileSync(resolve(root, 'apps/daemon/host/src/stack.js'), 'utf8'),
  daemon: readFileSync(resolve(root, 'apps/daemon/host/src/entry.mjs'), 'utf8'),
  bridge: readFileSync(resolve(root, 'apps/bridge/src/main.js'), 'utf8'),
  webapi: readFileSync(resolve(root, 'apps/web-api/src/main.js'), 'utf8'),
  webapiProcess: readFileSync(resolve(root, 'apps/daemon/host/plugins/web-api-process.cjs'), 'utf8'),
  run: readFileSync(resolve(root, 'apps/daemon/run.sh'), 'utf8'),
};
const checks = [
  ['core compatibility entry', sources.core.includes('entry.mjs') && sources.core.includes('thunderd-core')],
  ['stack compatibility entry', sources.stack.includes('entry.mjs') && sources.stack.includes('thunderd')],
  ['daemon profile launcher', sources.daemon.includes('runCli') && sources.daemon.includes('daemonRegistry')],
  ['bridge profile launcher', sources.bridge.includes('runCli') && sources.bridge.includes('createBridgePluginRegistry')],
  ['run.sh profile launcher', sources.run.includes('entry.mjs --profile thunderd')],
  // cordis-arch P0：Web API 是数据面子进程，装配只许经由 daemon 的 web-api-process
  // 插件 spawn；其入口保持数据面（client+server），不得反向装配 daemon 域对象。
  // P5（cordis-arch）：main.js 是 gateway 插件树薄壳——数据面符号在 plugins/ 树内，
  // 守卫改为钉死「薄壳只组 registry 走 launcher，不内联路由/监听实现」。
  ['web-api entry is gateway plugin-tree launcher', sources.webapi.includes('createGatewayPluginRegistry') && sources.webapi.includes('runCli') && !/require\('.\/server'\)/.test(sources.webapi) && !/require\('.\/routes\//.test(sources.webapi)],
  ['web-api plugin tree holds data-plane symbols', readFileSync(resolve(root, 'apps/web-api/src/plugins/daemon-connection.cjs'), 'utf8').includes('DaemonClient') && readFileSync(resolve(root, 'apps/web-api/src/plugins/http-server.cjs'), 'utf8').includes('createWebApiServer')],
  ['web-api spawned only by daemon plugin', sources.webapiProcess.includes("join(repoRoot, 'apps', 'web-api', 'src', 'main.js')") && !/require\('\.\.\/src\/(registry|poller|driver)/.test(sources.webapiProcess)],
  ['no legacy daemon assembly entry', !/new\s+(?:TaskRepository|WineNodeDriver|DaemonControlServer)\s*\(/.test(sources.core + sources.stack)],
  ['no legacy bridge assembly entry', !/createOrchestrator\s*\(/.test(sources.bridge)],
];
for (const [name, valid] of checks) {
  if (!valid) throw new Error(`application entrypoint bypasses profile launcher: ${name}`);
}
console.log(`application entrypoints verified (${checks.length})`);
