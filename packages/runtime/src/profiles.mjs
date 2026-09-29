// 稳定 ID 同时用于配置覆写、依赖检查和可审计的 tree dump。
export const BASE = Object.freeze(['runtime-config']);
export const DAEMON_CORE = Object.freeze([
  'repositories',
  'kernel-hub',
  'rpc-host',
  'kernel-thunder',
  'kernel-qbit', // defaultEnabled:false（registry 声明）：常驻序内、默认不启动；patch 启用
  'task-shell',
  'product-services',
  'plugin-admin',
]);
export const BRIDGE_HOST = Object.freeze([
  'bridge-daemon-client',
  'recipient-qbit',
  'bridge-seed-http',
  'bridge-orchestrator',
]);

export const PROFILES = Object.freeze({
  thunderd: Object.freeze([...BASE, ...DAEMON_CORE, 'web-api-process']),
  'thunderd-core': Object.freeze([...BASE, ...DAEMON_CORE]),
  'bridge-host': Object.freeze([...BASE, ...BRIDGE_HOST]),
});
