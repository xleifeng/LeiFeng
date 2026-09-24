import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { composeProfile, dumpConfig, PROFILES, bootProfile, runCli } from '../src/index.mjs';

function makeRegistry(events) {
  const providers = {
    'runtime-config': ['config'], repositories: ['repositories'],
    'engine-driver': ['engine'], 'event-observation': ['events'],
    'auth-vip': ['auth'], 'task-core': ['tasks'],
    'product-services': ['products'], 'control-rpc': ['rpc'],
    'web-api-process': ['webApi'], 'bridge-daemon-client': ['daemonClient'],
    'recipient-qbit': ['recipient'], 'bridge-seed-http': ['seedHttp'],
    'bridge-orchestrator': ['bridge'],
  };
  const requires = {
    repositories: ['config'], 'engine-driver': ['repositories'],
    'event-observation': ['engine'], 'auth-vip': ['events'],
    'task-core': ['auth'], 'product-services': ['tasks'],
    'control-rpc': ['products'], 'web-api-process': ['rpc'],
    'bridge-daemon-client': ['config'], 'recipient-qbit': ['config'],
    'bridge-seed-http': ['daemonClient'],
    'bridge-orchestrator': ['recipient', 'seedHttp'],
  };
  return Object.fromEntries(Object.keys(providers).map(id => [id, {
    provides: providers[id], requires: requires[id] ?? [],
    defaults: { port: 0 },
    plugin: async (_ctx, config) => {
      events.push(`start:${id}:${config.port}`);
      return async () => { events.push(`stop:${id}`); };
    },
  }]));
}

for (const profile of Object.keys(PROFILES)) {
  test(`${profile}: profile 文件实际启动和逆序关闭`, async () => {
    const events = [];
    const instance = await bootProfile({ profile, registry: makeRegistry(events) });
    assert.deepEqual(events.map(item => item.split(':')[1]), PROFILES[profile]);
    assert.equal(instance.config.profile, profile);
    await instance.dispose();
    await instance.dispose();
    assert.deepEqual(events.slice(PROFILES[profile].length), [...PROFILES[profile]].reverse().map(id => `stop:${id}`));
  });
}

test('配置叠层、重复 ID、未知字段和 provider 约束', () => {
  const registry = makeRegistry([]);
  const composed = composeProfile({
    profile: 'thunderd-core', registry,
    profilePatch: [{ id: 'control-rpc', config: { port: 1 } }],
    userPatch: [{ id: 'control-rpc', config: { port: 2 } }],
  });
  assert.equal(composed.plugins.at(-1).config.port, 2);
  assert.throws(() => composeProfile({ profile: 'bad', registry }), /unknown profile/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'control-rpc', typo: true }] }), /unknown field/);
  registry['control-rpc'].configKeys = ['port'];
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'control-rpc', config: { typo: true } }] }), /unknown field/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'control-rpc' }, { id: 'control-rpc' }] }), /duplicate plugin ID/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'repositories', enabled: false }] }), /missing provider/);
  registry['control-rpc'].provides.push('products');
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry }), /multiple providers/);
});

test('dump 脱敏且不启动插件', () => {
  const events = [];
  const config = composeProfile({ profile: 'bridge-host', registry: makeRegistry(events), userPatch: [{
    id: 'recipient-qbit', config: { password: 'hidden', magnet: 'magnet:?xt=urn:btih:test', nested: { refreshToken: 'hidden' } },
  }] });
  const dump = dumpConfig(config);
  assert.equal(events.length, 0);
  assert.ok(!dump.includes('hidden'));
  assert.ok(!dump.includes('btih:test'));
  assert.match(dump, /REDACTED/);
});

test('启动失败清理已装插件，控制面不会激活', async () => {
  const events = [];
  const registry = makeRegistry(events);
  registry['task-core'].plugin = () => { throw new Error('setup failed'); };
  await assert.rejects(bootProfile({ profile: 'thunderd-core', registry }), /setup failed/);
  assert.ok(!events.some(event => event.startsWith('start:control-rpc')));
  assert.ok(events.includes('stop:repositories'));
});

test('真实监听端口冲突会拒绝第二个 profile 并回收已启动资源', async () => {
  const events = [];
  const registry = makeRegistry(events);
  registry['control-rpc'].plugin = async () => {
    const server = createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    events.push(`port:${server.address().port}`);
    return () => new Promise(resolve => server.close(resolve));
  };
  const first = await bootProfile({ profile: 'thunderd-core', registry });
  const occupiedPort = Number(events.find(item => item.startsWith('port:')).slice(5));
  const secondRegistry = makeRegistry(events);
  secondRegistry['control-rpc'].plugin = async () => {
    const server = createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(occupiedPort, '127.0.0.1', resolve));
    return () => new Promise(resolve => server.close(resolve));
  };
  await assert.rejects(bootProfile({ profile: 'thunderd-core', registry: secondRegistry }), /EADDRINUSE/);
  await first.dispose();
});

test('CLI 文件覆写、dump 和 SIGTERM 退出', async () => {
  const events = [];
  const registry = makeRegistry(events);
  const dir = await mkdtemp(join(tmpdir(), 'tlei-runtime-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ plugins: [{ id: 'runtime-config', config: { accessToken: 'hidden' } }] }));
  let output = '';
  const code = await runCli({ registry, argv: ['--profile', 'bridge-host', '--config', path, '--dump-config'], output: { write: chunk => { output += chunk; } } });
  assert.equal(code, 0);
  assert.equal(events.length, 0);
  assert.ok(!output.includes('hidden'));
  const signals = new EventEmitter();
  const running = runCli({ registry, argv: ['--profile', 'bridge-host'], signals });
  await new Promise(resolve => setTimeout(resolve, 20));
  signals.emit('SIGTERM');
  assert.equal(await running, 0);
  assert.ok(events.includes('stop:bridge-orchestrator'));
  assert.equal(await runCli({ registry, argv: ['--profile', 'bridge-host', '--unknown'], errorOutput: { write() {} } }), 1);
});
