'use strict';

// UI 能力注册表：daemon 插件 apply 时注册 UI 贡献，清理函数撤销。
// 插件禁用 = 不 apply = 贡献自动消失（DSH whileServed 规则的 daemon 侧对应物）。

/** 恒真能力：由核心插件链保证，不挂可禁用插件。 */
const ALWAYS = Object.freeze(['tasks', 'settings', 'diagnostics']);

/** 已知能力 ID 全集（声明处校验，防拼写漂移）。 */
const KNOWN = Object.freeze(new Set([
  ...ALWAYS,
  'history',          // 下载记录（history-links 插件）
  'link-library',     // 链接库（history-links 插件）
  'private-space',    // 私人空间（private-space 插件）
  'media',            // 媒体播放（media-capture 插件）
  'daemon-admin',     // daemon 管理面（daemon-admin 插件：状态查询 + 整体重启）
]));

function createUiCapabilityRegistry() {
  const contributions = new Map(); // pluginId -> Set<capability>
  function contribute(pluginId, capabilities) {
    if (typeof pluginId !== 'string' || !pluginId) throw new TypeError(`ui contribution: invalid plugin id`);
    if (contributions.has(pluginId)) throw new TypeError(`ui contribution: duplicate plugin id ${pluginId}`);
    if (!Array.isArray(capabilities)) throw new TypeError(`ui contribution from ${pluginId}: capabilities must be an array`);
    for (const id of capabilities) {
      if (!KNOWN.has(id)) throw new TypeError(`ui contribution from ${pluginId}: unknown capability ${id}`);
    }
    contributions.set(pluginId, new Set(capabilities));
    return () => contributions.delete(pluginId);
  }
  function snapshot() {
    const merged = new Set(ALWAYS);
    for (const set of contributions.values()) for (const id of set) merged.add(id);
    return [...merged];
  }
  return { contribute, snapshot };
}

module.exports = { ALWAYS, KNOWN, createUiCapabilityRegistry };
