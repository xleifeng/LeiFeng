// 稳定 ID 同时用于配置覆写、依赖检查和可审计的 tree dump。
export const BASE = Object.freeze(['runtime-config']);
export const DAEMON_CORE = Object.freeze([
  'repositories',
  'engine-driver',
  'event-observation',
  'auth-vip',
  'task-core',
  'product-services',
  'control-rpc',
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
