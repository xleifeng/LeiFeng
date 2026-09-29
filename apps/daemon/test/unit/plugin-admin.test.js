'use strict';
// plugin-admin 持久化语义：readDisabledState 容错 + writeDisabledState 去重与
// 0600 权限 + setEnabled RPC 校验（未知插件 / runtime-config 保护）。
// P0（cordis-arch）：状态文件升 v2 显式三态（{enabled:{id:bool}}），v1 disabled
// 兼容读；kernel-qbit（defaultEnabled:false）不再被误显示为 enabled。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readDisabledState, writeDisabledState, readEnabledState, writeEnabledState, STATE_FILE, pluginAdmin } = require('../../host/plugins/plugin-admin.cjs');
const { RpcRegistry } = require('../../host/src/rpc/registry');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.homedir(), 'tmp/leifeng-plugin-admin-test-'));
}

test('readDisabledState：文件缺失 / 坏 JSON / 非数组结构均回退 []', () => {
  const dir = makeTempDir();
  try {
    assert.deepEqual(readDisabledState(dir), []);
    fs.writeFileSync(path.join(dir, STATE_FILE), '{ not json');
    assert.deepEqual(readDisabledState(dir), []);
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ disabled: 'not-array' }));
    assert.deepEqual(readDisabledState(dir), []);
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ disabled: ['a', 42, null, '', 'b'] }));
    assert.deepEqual(readDisabledState(dir), ['a', 'b']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeDisabledState：去重落盘 + 0600 权限 + roundtrip', () => {
  const dir = makeTempDir();
  try {
    writeDisabledState(dir, ['x', 'x', 'y']);
    assert.deepEqual(readDisabledState(dir), ['x', 'y']);
    const stat = fs.statSync(path.join(dir, STATE_FILE));
    assert.equal(stat.mode & 0o777, 0o600);
    // 目录不存在时可建（嵌套 runtime 场景）
    const nested = path.join(dir, 'sub', 'runtime');
    writeDisabledState(nested, ['z']);
    assert.deepEqual(readDisabledState(nested), ['z']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setEnabled RPC：参数校验与 runtime-config 保护（fake ctx 直驱 apply）', async () => {
  const dir = makeTempDir();
  const rpcRegistry = new RpcRegistry();
  const ctx = {
    leifengConfig: { runtimeDir: dir },
    leifengUiRegistry: { snapshot: () => ['tasks'] },
    leifengRpc: { registry: rpcRegistry },
  };
  const cleanup = pluginAdmin.apply(ctx);
  try {
    const setEnabled = rpcRegistry.get('leifeng.ui.v2.plugins.setEnabled');
    const list = rpcRegistry.get('leifeng.ui.v2.plugins.list');
    assert.ok(setEnabled && list);
    // 缺 id / enabled 非布尔 → 拒
    assert.throws(() => setEnabled([{ enabled: true }]), /id 必填/);
    assert.throws(() => setEnabled([{ id: 'web-api-process', enabled: 'yes' }]), /enabled/);
    // 未知插件 → 拒
    assert.throws(() => setEnabled([{ id: 'no-such-plugin', enabled: false }]), /未知插件/);
    // runtime-config 禁用 → 拒（BASE 保护）
    assert.throws(() => setEnabled([{ id: 'runtime-config', enabled: false }]), /不可禁用/);
    // 合法禁用 → 落盘 + restartRequired；list 反映 enabled 状态
    const result = setEnabled([{ id: 'web-api-process', enabled: false }]);
    assert.equal(result.restartRequired, true);
    const listed = list();
    const webApi = listed.find((p) => p.id === 'web-api-process');
    assert.equal(webApi.enabled, false);
    // 重复写幂等（去重后仍单条）
    setEnabled([{ id: 'web-api-process', enabled: false }]);
    assert.deepEqual(readDisabledState(dir), ['web-api-process']);
    // 重新启用 → 从 disabled 移除
    setEnabled([{ id: 'web-api-process', enabled: true }]);
    assert.deepEqual(readDisabledState(dir), []);
  } finally {
    cleanup();
    assert.equal(rpcRegistry.size, 0, '清理函数应注销全部 RPC 方法');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('uiCapabilities RPC：透传 registry snapshot', () => {
  const dir = makeTempDir();
  const rpcRegistry = new RpcRegistry();
  const ctx = {
    leifengConfig: { runtimeDir: dir },
    leifengUiRegistry: { snapshot: () => ['tasks', 'history'] },
    leifengRpc: { registry: rpcRegistry },
  };
  const cleanup = pluginAdmin.apply(ctx);
  try {
    assert.deepEqual(rpcRegistry.get('leifeng.ui.v2.plugins.uiCapabilities')(), ['tasks', 'history']);
  } finally { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v2 显式三态：enabled map 落盘 + v1 disabled 兼容读 + 显式 true 保留', () => {
  const dir = makeTempDir();
  try {
    // v1 文件（disabled 数组）→ 读为显式 false
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ disabled: ['web-api-process'] }));
    assert.deepEqual(readEnabledState(dir), { 'web-api-process': false });
    // v2 写：显式启用 defaultEnabled:false 的 kernel-qbit + 保留 v1 禁用
    const state = readEnabledState(dir);
    state['kernel-qbit'] = true;
    writeEnabledState(dir, state);
    assert.deepEqual(readEnabledState(dir), { 'web-api-process': false, 'kernel-qbit': true });
    // 坏 JSON / 非对象 → 回退 {}
    fs.writeFileSync(path.join(dir, STATE_FILE), '{ not json');
    assert.deepEqual(readEnabledState(dir), {});
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ enabled: 'not-object' }));
    assert.deepEqual(readEnabledState(dir), {});
    // enabled 对象内非布尔值被忽略
    fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ enabled: { a: true, b: 'yes', c: false } }));
    assert.deepEqual(readEnabledState(dir), { a: true, c: false });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plugins.list 三态显示：kernel-qbit 默认关不误显 enabled（P0 事实修正）', () => {
  const dir = makeTempDir();
  const rpcRegistry = new RpcRegistry();
  const ctx = {
    leifengConfig: { runtimeDir: dir },
    leifengUiRegistry: { snapshot: () => [] },
    leifengRpc: { registry: rpcRegistry },
  };
  const cleanup = pluginAdmin.apply(ctx);
  try {
    const list = rpcRegistry.get('leifeng.ui.v2.plugins.list');
    const setEnabled = rpcRegistry.get('leifeng.ui.v2.plugins.setEnabled');
    // 默认：kernel-qbit enabled=false + defaultEnabled:false 标记；kernel-thunder enabled=true 无标记
    let listed = list();
    const qbit = listed.find((p) => p.id === 'kernel-qbit');
    const thunder = listed.find((p) => p.id === 'kernel-thunder');
    assert.equal(qbit.enabled, false, 'defaultEnabled:false 不再被误显示为 enabled');
    assert.equal(qbit.defaultEnabled, false);
    assert.equal(qbit.explicit, undefined, '无显式状态时不带 explicit 字段');
    assert.equal(thunder.enabled, true);
    assert.equal(thunder.defaultEnabled, undefined);
    // 显式启用 kernel-qbit → enabled=true + explicit:true，且落盘 v2
    setEnabled([{ id: 'kernel-qbit', enabled: true }]);
    listed = list();
    const qbitAfter = listed.find((p) => p.id === 'kernel-qbit');
    assert.equal(qbitAfter.enabled, true);
    assert.equal(qbitAfter.explicit, true);
    assert.deepEqual(readEnabledState(dir), { 'kernel-qbit': true });
  } finally {
    cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
