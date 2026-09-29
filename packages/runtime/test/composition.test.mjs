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
    'runtime-config': ['config', 'uiRegistry'], repositories: ['repositories'],
    'kernel-hub': ['kernelHub'], 'rpc-registry': ['rpcRegistry'], 'request-policy': ['policy'],
    'control-transport': ['transport'], 'rpc-host': ['rpc'],
    'kernel-thunder': ['kernel:thunder'], 'kernel-qbit': ['kernel:qbit'],
    'task-shell': ['tasks'],
    'private-space': ['privateSpace'], 'history-links': ['historyLinks'],
    'media-capture': ['mediaCapture'], 'remote-access': ['remoteAccess'],
    'product-core': ['products'],
    'plugin-admin': ['pluginAdmin'], 'daemon-admin': ['daemonAdmin'], 'web-api-process': ['webApi'],
    'gateway-config': ['gatewayConfig'], 'daemon-connection': ['gatewayDaemon'],
    'gateway-routes': ['gatewayRoutes'], 'http-server': ['gatewayHttp'], 'remote-mtls': ['gatewayRemote'],
    'bridge-daemon-client': ['daemonClient'],
    'recipient-qbit': ['recipient'], 'bridge-seed-http': ['seedHttp'],
    'bridge-orchestrator': ['bridge'],
  };
  const requires = {
    repositories: ['config'], 'kernel-hub': ['config'],
    'rpc-registry': ['config'], 'request-policy': ['config'],
    'control-transport': ['config', 'rpcRegistry', 'policy'], 'rpc-host': ['rpcRegistry', 'policy', 'transport'],
    'kernel-thunder': ['repositories', 'rpc', 'kernelHub'], 'kernel-qbit': ['config', 'kernelHub'],
    'task-shell': ['kernelHub', 'rpc'],
    'private-space': ['config', 'repositories', 'kernelHub', 'tasks', 'rpc', 'uiRegistry'],
    'history-links': ['config', 'repositories', 'kernelHub', 'tasks', 'rpc', 'uiRegistry'],
    'media-capture': ['config', 'repositories', 'kernelHub', 'tasks', 'rpc', 'policy', 'uiRegistry'],
    'remote-access': ['config', 'repositories', 'tasks', 'rpc', 'policy', 'uiRegistry'],
    'product-core': ['config', 'repositories', 'kernelHub', 'tasks', 'rpc', 'policy', 'uiRegistry'],
    'plugin-admin': ['config', 'rpc'], 'daemon-admin': ['config', 'kernelHub', 'rpc', 'uiRegistry'], 'web-api-process': ['rpc'],
    'gateway-config': [], 'daemon-connection': ['gatewayConfig'],
    'gateway-routes': ['gatewayConfig', 'gatewayDaemon'], 'http-server': ['gatewayConfig', 'gatewayDaemon', 'gatewayRoutes'],
    'remote-mtls': ['gatewayConfig', 'gatewayDaemon'],
    'bridge-daemon-client': ['config'], 'recipient-qbit': ['config'],
    'bridge-seed-http': ['config'],
    'bridge-orchestrator': ['config', 'recipient', 'seedHttp'],
  };
  return Object.fromEntries(Object.keys(providers).map(id => [id, {
    provides: providers[id], requires: requires[id] ?? [],
    ...(id === 'kernel-qbit' ? { defaultEnabled: false } : {}),
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
    const registry = makeRegistry(events);
    const instance = await bootProfile({ profile, registry });
    // defaultEnabled:false 的成员（kernel-qbit）默认不启动：期望序 = profile 序减默认关闭者
    const expected = PROFILES[profile].filter(id => registry[id].defaultEnabled !== false);
    assert.deepEqual(events.map(item => item.split(':')[1]), expected);
    assert.equal(instance.config.profile, profile);
    await instance.dispose();
    await instance.dispose();
    assert.deepEqual(events.slice(expected.length), [...expected].reverse().map(id => `stop:${id}`));
  });
}

test('配置叠层、重复 ID、未知字段和 provider 约束', () => {
  const registry = makeRegistry([]);
  registry['kernel-qbit'] = { provides: ['kernel:qbit'], requires: ['config'], defaults: {}, plugin: async () => async () => {} };
  const composed = composeProfile({
    profile: 'thunderd-core', registry,
    profilePatch: [{ id: 'rpc-host', config: { port: 1 } }],
    userPatch: [{ id: 'rpc-host', config: { port: 2 } }],
  });
  assert.equal(composed.plugins.find((p) => p.id === "rpc-host").config.port, 2);
  assert.throws(() => composeProfile({ profile: 'bad', registry }), /unknown profile/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'rpc-host', typo: true }] }), /unknown field/);
  registry['rpc-host'].configKeys = ['port'];
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'rpc-host', config: { typo: true } }] }), /unknown field/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'rpc-host' }, { id: 'rpc-host' }] }), /duplicate plugin ID/);
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'repositories', enabled: false }] }), /missing provider/);
  registry['rpc-host'].provides.push('products');
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry }), /multiple providers/);
});

test('defaultEnabled:false：常驻序内默认不启动，patch 启用（kernel-any-only kernel-qbit 模式）', () => {
  const registry = makeRegistry([]);
  // 默认树：kernel-qbit 在 profile 序里但 enabled=false，不装配
  const composed = composeProfile({ profile: 'thunderd-core', registry });
  assert.ok(!composed.plugins.some((p) => p.id === 'kernel-qbit'), 'kernel-qbit defaultEnabled:false 不启动');
  assert.ok(composed.plugins.some((p) => p.id === 'kernel-hub'), 'kernel-hub 默认启动');
  // patch enabled:true → 装配（时序位次保持在 kernel-thunder 之后、task-shell 之前）
  const withQbit = composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'kernel-qbit', enabled: true }] });
  const ids = withQbit.plugins.map((p) => p.id);
  assert.ok(ids.includes('kernel-qbit'));
  assert.ok(ids.indexOf('kernel-qbit') > ids.indexOf('rpc-host'), '启动位次在 rpc-host 后');
  // qbit-only：禁 thunder + 启 qbit，provider 冲突消失（服务面互异）
  const qbitOnly = composeProfile({ profile: 'thunderd-core', registry, userPatch: [
    { id: 'kernel-thunder', enabled: false }, { id: 'kernel-qbit', enabled: true },
  ] });
  assert.ok(!qbitOnly.plugins.some((p) => p.id === 'kernel-thunder'));
  assert.ok(qbitOnly.plugins.some((p) => p.id === 'kernel-qbit'));
  // 未知 ID 仍拒绝
  assert.throws(() => composeProfile({ profile: 'thunderd-core', registry, userPatch: [{ id: 'no-such-plugin' }] }), /unknown plugin ID/);
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

test('启动失败清理已装插件，rpc-host 先启动也随失败回收', async () => {
  // rpc-plugin-registration 后 rpc-host 在 task-shell 之前启动（注册面先于注册者），
  // 下游装配失败时它已监听——断言语义从「未启动」改为「已被逆序回收」。
  const events = [];
  const registry = makeRegistry(events);
  registry['task-shell'].plugin = () => { throw new Error('setup failed'); };
  await assert.rejects(bootProfile({ profile: 'thunderd-core', registry }), /setup failed/);
  assert.ok(events.some(event => event.startsWith('start:rpc-host:')));
  assert.ok(events.includes('stop:rpc-host'), 'rpc-host 须随失败回收');
  assert.ok(events.includes('stop:repositories'));
});

test('真实监听端口冲突会拒绝第二个 profile 并回收已启动资源', async () => {
  const events = [];
  const registry = makeRegistry(events);
  registry['rpc-host'].plugin = async () => {
    const server = createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    events.push(`port:${server.address().port}`);
    return () => new Promise(resolve => server.close(resolve));
  };
  const first = await bootProfile({ profile: 'thunderd-core', registry });
  const occupiedPort = Number(events.find(item => item.startsWith('port:')).slice(5));
  const secondRegistry = makeRegistry(events);
  secondRegistry['rpc-host'].plugin = async () => {
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
  const dir = await mkdtemp(join(tmpdir(), 'leifeng-runtime-'));
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
