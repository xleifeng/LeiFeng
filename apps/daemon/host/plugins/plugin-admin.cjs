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

function readDisabledState(runtimeDir) {
  const file = path.join(runtimeDir, STATE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.disabled)) return [];
    return data.disabled.filter((id) => typeof id === 'string' && id);
  } catch { return []; }
}

function writeDisabledState(runtimeDir, disabled) {
  const file = path.join(runtimeDir, STATE_FILE);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ disabled: [...new Set(disabled)] }, null, 2)}\n`, { mode: 0o600 });
}

const pluginAdmin = plugin('leifeng-plugin-admin', ['leifengConfig', 'leifengUiRegistry', 'leifengRpc'], (ctx) => {
  const { runtimeDir } = ctx.leifengConfig;
  const registry = ctx.leifengUiRegistry;
  const { registry: rpcRegistry } = ctx.leifengRpc;

  // 启动时读 disabled 集合——launcher 已消费（entry.mjs 读同文件组 userPatch），
  // 这里暴露 RPC 面供 WebUI/CLI 查询与改写（重启生效）。
  const withdraw = rpcRegistry.register('plugin-admin', new Map([
    ['leifeng.ui.v2.plugins.list', () => {
      const definitions = registrySnapshot();
      const disabled = new Set(readDisabledState(runtimeDir));
      return Object.entries(definitions).map(([id, def]) => ({
        id,
        provides: def.provides,
        requires: def.requires,
        ui: { capabilities: def.ui?.capabilities ?? [] },
        enabled: !disabled.has(id),
      }));
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
      const disabled = new Set(readDisabledState(runtimeDir));
      if (input.enabled) disabled.delete(input.id);
      else disabled.add(input.id);
      writeDisabledState(runtimeDir, [...disabled]);
      return { id: input.id, enabled: input.enabled, restartRequired: true };
    }],
    ['leifeng.ui.v2.plugins.uiCapabilities', () => registry.snapshot()],
  ]));

  return () => withdraw();
});

module.exports = { pluginAdmin, readDisabledState, writeDisabledState, STATE_FILE };
