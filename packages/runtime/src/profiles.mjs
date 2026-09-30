// 稳定 ID 同时用于配置覆写、依赖检查和可审计的 tree dump。
export const BASE = Object.freeze(['runtime-config']);
export const DAEMON_CORE = Object.freeze([
  'repositories',
  'kernel-hub',
  'rpc-registry', // P1（cordis-arch）：注册机制（无监听）先于注册者
  'request-policy', // 鉴权/限流策略先于传输（attachAuth 空窗关闭）
  'control-transport',
  'rpc-host', // 兼容聚合壳：提供 leifengRpc 面，消费方迁移后退役
  'kernel-thunder',
  'kernel-qbit', // defaultEnabled:false（registry 声明）：常驻序内、默认不启动；patch 启用
  'task-shell',
  // P4（cordis-arch）product-services 拆分：history-links 在 outbox 消费者
  // 语义（保留窗口/重同步）完成前保持必需——其余域插件结构独立、默认全启。
  'private-space',
  'history-links',
  'media-capture',
  'product-core',
  'plugin-admin',
  'daemon-admin', // P5 后追加（daemon 管理面）：状态查询 + 标记文件重启协议
  'bridge-status', // kernel-detail-panels：桥会话实时快照内存库（bridge.report/sessions RPC）
]);
// P5（cordis-arch）：Web API 子进程内部装配插件树（gateway profile）。
export const GATEWAY = Object.freeze([
  'gateway-config',
  'daemon-connection',
  'gateway-routes',
  'http-server',
]);
export const BRIDGE_HOST = Object.freeze([
  'bridge-daemon-client',
  'recipient-qbit',
  'bridge-seed-http',
  'bridge-orchestrator',
]);
// P5（cordis-arch）：serve 模式依赖分化——serve 不触 daemon（webseed 输血单 torrent 闭环），
// hybrid 才需要 bridge-daemon-client（P2SP 输血 + 登录验收）。http/orchestrator 对
// bridgeDaemon 的依赖改为可选（缺席即 null），两 profile 共用同一插件实现。
export const BRIDGE_SERVE = Object.freeze([
  'recipient-qbit',
  'bridge-seed-http',
  'bridge-orchestrator',
]);

export const PROFILES = Object.freeze({
  gateway: Object.freeze(GATEWAY),
  thunderd: Object.freeze([...BASE, ...DAEMON_CORE, 'web-api-process']),
  'thunderd-core': Object.freeze([...BASE, ...DAEMON_CORE]),
  'bridge-host': Object.freeze([...BASE, ...BRIDGE_HOST]),
  'bridge-serve': Object.freeze([...BASE, ...BRIDGE_SERVE]),
});
