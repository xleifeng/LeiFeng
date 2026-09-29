'use strict';

/**
 * create 路由表（P2）：协议 kind → 下载内核的映射。
 *
 * 单一来源是 KERNEL_PROTOCOL_ROUTES 常量——内核侧能力声明
 * （driver.getSupportedProtocols）与壳侧创建路由（resolveCreateKernel）
 * 是同一张表的两个视图，一致性由单测钉死。P3 第二内核接入时只改此表
 * 与 registry 查询，壳层装配面不动。
 */

const KERNEL_PROTOCOL_ROUTES = Object.freeze({
  thunder: Object.freeze(['http', 'https', 'ftp', 'magnet', 'bt', 'ed2k', 'thunder']),
  qbit: Object.freeze(['bt', 'magnet']), // P3 参照内核：多内核路由表就位，默认路由不变（thunder 首命中）
});

/** 支持的协议全集（路由表展平，供能力上报比对） */
function supportedProtocols() {
  return Object.values(KERNEL_PROTOCOL_ROUTES).flat();
}

/**
 * 按 kind 解析创建路由的内核 ID。
 * @param {string} kind 协议 kind（http/https/ftp/magnet/bt/ed2k/thunder）
 * @returns {string|null} 内核 ID；无内核声明该协议时 null
 */
function resolveCreateKernel(kind) {
  if (!kind || typeof kind !== 'string') return null;
  for (const [kernelId, protocols] of Object.entries(KERNEL_PROTOCOL_ROUTES)) {
    if (protocols.includes(kind)) return kernelId;
  }
  return null;
}

module.exports = { KERNEL_PROTOCOL_ROUTES, supportedProtocols, resolveCreateKernel };
