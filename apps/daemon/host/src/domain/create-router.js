'use strict';

/**
 * 协议路由表（P3 能力化）：内核 ID → 协议 kind 集合的**能力声明序**。
 *
 * 语义拆分（P2 的常量表正名）：
 *  - 各内核的**真能力声明**住内核自身（driver.getSupportedProtocols），
 *    单测钉死本表条目 ⊆ 驱动声明（两视图不漂移）；
 *  - 本表只承担两件事：① 默认内核解析序（hub.default 无显式 defaultKernelId
 *    时按表序取第一个已注册内核）；② create 兜底路由（CreateTaskService
 *    未显式传 defaultKernelId 时的 resolveCreateKernel()）。
 *  - bootstrap 的能力上报不走本表（P2 起由 KernelPort.getSupportedProtocols
 *    声明，见 bootstrap-service）。
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
 * @param {string} kind 协议 kind（http/https/ftp/magnet/bt/ed2k/thunder）；
 *   无参调用（undefined）取表序首内核（CreateTaskService 的 defaultKernelId 兜底）；
 *   非字符串/未知 kind 返回 null（非法输入不兜底）
 * @returns {string|null} 内核 ID；无内核声明该协议时 null
 */
function resolveCreateKernel(kind) {
  if (kind === undefined) return Object.keys(KERNEL_PROTOCOL_ROUTES)[0] ?? null;
  if (!kind || typeof kind !== 'string') return null;
  for (const [kernelId, protocols] of Object.entries(KERNEL_PROTOCOL_ROUTES)) {
    if (protocols.includes(kind)) return kernelId;
  }
  return null;
}

module.exports = { KERNEL_PROTOCOL_ROUTES, supportedProtocols, resolveCreateKernel };
