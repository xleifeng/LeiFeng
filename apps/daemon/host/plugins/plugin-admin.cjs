'use strict';
// plugin-admin：官方插件管理面——装配查询 + enabled 持久化 + 运行期 UI 能力注入。
// RPC 经 leifengRpc（RpcRegistry）注册，与插件生命周期绑定（rpc-plugin-registration）。
const fs = require('fs');
const path = require('path');
const { plugin } = require('./shared.cjs');

// 惰性取 daemonRegistry：index.cjs 顶部 require 本文件，顶层互引会循环依赖
// （module.exports 尚未填充，definitions 里拿到 undefined 崩 inject 读取）
function registrySnapshot() {
  // eslint-disable-next-line global-require
  const { daemonRegistry } = require('./index.cjs');
  return daemonRegistry();
}

const STATE_FILE = 'plugin-state.json';

// 持久化形状 v2：{ enabled: { <pluginId>: true|false } }——显式三态。
// v1（{ disabled: [...] }）兼容读：仅表达「显式禁用」，显式启用语义留给 v2
// （v1 时代无 defaultEnabled:false 插件，无损）。缺省键 = 跟随 registry 默认。
function readEnabledState(runtimeDir) {
  const file = path.join(runtimeDir, STATE_FILE);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  const enabled = {};
  if (data && typeof data === 'object' && Array.isArray(data.disabled)) {
    for (const id of data.disabled) if (typeof id === 'string' && id) enabled[id] = false;
  }
  if (data && typeof data === 'object' && data.enabled && typeof data.enabled === 'object') {
    for (const [id, value] of Object.entries(data.enabled)) {
      if (typeof value === 'boolean') enabled[id] = value;
    }
  }
  return enabled;
}

function writeEnabledState(runtimeDir, enabled) {
  const file = path.join(runtimeDir, STATE_FILE);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ enabled: { ...enabled } }, null, 2)}\n`, { mode: 0o600 });
}

// 旧 API 名保留导出（避免外部引用断）——语义改为读/写显式启用表。
function readDisabledState(runtimeDir) {
  return Object.entries(readEnabledState(runtimeDir)).filter(([, v]) => v === false).map(([id]) => id);
}

function writeDisabledState(runtimeDir, disabled) {
  const enabled = readEnabledState(runtimeDir);
  const next = { ...enabled };
  for (const id of disabled) next[id] = false;
  for (const [id, v] of Object.entries(next)) {
    if (v === true && disabled.includes(id)) delete next[id];
  }
  writeEnabledState(runtimeDir, next);
}

const pluginAdmin = plugin('leifeng-plugin-admin', ['leifengConfig', 'leifengUiRegistry', 'leifengRpc'], (ctx) => {
  const { runtimeDir } = ctx.leifengConfig;
  const registry = ctx.leifengUiRegistry;
  const { registry: rpcRegistry } = ctx.leifengRpc;

  // 启动时读显式状态表——launcher 已消费（entry.mjs 读同文件组 userPatch），
  // 这里暴露 RPC 面供 WebUI/CLI 查询与改写（重启生效）。
  const withdraw = rpcRegistry.register('plugin-admin', new Map([
    ['leifeng.ui.v2.plugins.list', () => {
      const definitions = registrySnapshot();
      const state = readEnabledState(runtimeDir);
      return Object.entries(definitions).map(([id, def]) => {
        const explicit = state[id];
        const defaultEnabled = def.defaultEnabled !== false;
        // effectiveEnabled = 显式状态 > registry 默认（defaultEnabled:false 的
        // kernel-qbit 不再被误显示为 enabled——P0 事实修正）
        const enabled = typeof explicit === 'boolean' ? explicit : defaultEnabled;
        return {
          id,
          provides: def.provides,
          requires: def.requires,
          ui: { capabilities: def.ui?.capabilities ?? [] },
          enabled,
          ...(typeof explicit === 'boolean' ? { explicit } : {}),
          ...(defaultEnabled === false ? { defaultEnabled: false } : {}),
        };
      });
    }],
    ['leifeng.ui.v2.plugins.setEnabled', (params) => {
      const input = params && params[0] || {};
      if (typeof input.id !== 'string' || !input.id) throw new Error('plugins.setEnabled: id 必填');
      if (typeof input.enabled !== 'boolean') throw new Error('plugins.setEnabled: enabled 必须为布尔');
      const definitions = registrySnapshot();
      if (!definitions[input.id]) throw new Error(`plugins.setEnabled: 未知插件 ${input.id}`);
      // runtime-config 是 BASE：禁了它 profile 无法启动，直接拒绝
      if (input.id === 'runtime-config' && input.enabled === false) {
        throw new Error('plugins.setEnabled: runtime-config 是基础插件，不可禁用');
      }
      const state = readEnabledState(runtimeDir);
      state[input.id] = input.enabled;
      writeEnabledState(runtimeDir, state);
      return { id: input.id, enabled: input.enabled, restartRequired: true };
    }],
    ['leifeng.ui.v2.plugins.uiCapabilities', () => registry.snapshot()],
  ]));

  return () => withdraw();
});

module.exports = { pluginAdmin, readEnabledState, writeEnabledState, readDisabledState, writeDisabledState, STATE_FILE };
