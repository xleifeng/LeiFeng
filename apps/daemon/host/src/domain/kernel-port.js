'use strict';

/**
 * KernelPort 契约：壳层与下载内核之间的冻结接口。
 *
 * 壳层（services/rpc/methods/control）只允许经此契约消费内核——
 * 不直接 require driver / taskdb-reader 等迅雷专属模块（architecture
 * test 守卫）。方法清单来自 2026-09-28 对壳层调用面的全量审计，
 * 多内核时代 kernel-qbit / kernel-emule 实现同一契约即可替换。
 *
 * P3（cordis-arch）契约分层：
 *  - 核心（KERNEL_CORE_METHODS / KERNEL_CORE_PROPERTIES）：任意内核必须
 *    实现，assertKernel 强校验（缺失即拒）；
 *  - 可选（KERNEL_OPTIONAL_METHODS / KERNEL_OPTIONAL_PROPERTIES）：迅雷
 *    富件（账号通知 / BT 运行时 / TaskDb 直读路径），允许缺席；实现时
 *    必须满足契约形态（方法为 function），调用方各自做缺席降级。
 *    壳层对可选成员的消费点须显式可选链（如 kernelSlot.nativeBtLookup）。
 *
 * 校验模式借鉴 bridge 的 assertRecipient（方法级 typeof 检查）。
 */

const KERNEL_CORE_METHODS = Object.freeze([
  // 任务生命周期
  'startTasks', 'stopTasks', 'deleteTasks', 'recycleTask', 'recoverTask', 'redownloadTask',
  'renameTask', 'moveTask', 'createTask',
  // 进度观察
  'getTaskSnapshots', 'getQueueCount', 'getDhtNodeCount',
  // 能力与状态
  'isHealthy', 'enginePid', 'getNativeCapabilities', 'getChannelSwitches',
  'parseTaskInfo', 'normalizeTorrentHash', 'resolveThunderUrl', 'getSupportedProtocols',
  // 网络与策略
  'setGlobalLimits', 'getGlobalLimits', 'setChannelSwitches', 'verifyProxy', 'setProxy',
  'setTaskSpeedLimit', 'setBtScheduler', 'updateBtSelection', 'setAutoMoveLowSpeed',
  // 内核生命周期管理
  'restart', 'shutdown', 'start',
]);

/** 迅雷账号/BT 扩展：可选能力，缺席方（qbit 等）不实现即缺席。
 *  2026-09-30 增任务详情面板三方法（kernel-detail-panels）：
 *  - getTaskDetailExtras(task)：详情富化（文件级 completedBytes + 通道归因等），
 *    入参为壳层任务记录（id/engineId/infoHash/kind），返回 null 表示无富化数据；
 *  - getTaskPeers(task) / getSeedingStats(task)：peers 列表与做种统计，
 *    thunder 侧 SDK 无数据源不实现（前端无入口），qbit 实现。 */
const KERNEL_OPTIONAL_METHODS = Object.freeze([
  'notifyAuth', 'notifyLogout', 'getBtFileRuntime', 'getSeedDescriptor',
  'getTaskDetailExtras', 'getTaskPeers', 'getSeedingStats',
]);

const KERNEL_METHODS = Object.freeze([...KERNEL_CORE_METHODS, ...KERNEL_OPTIONAL_METHODS]);

/** 实例属性（核心）：可读即可（getter 或普通字段），两内核通用语义 */
const KERNEL_CORE_PROPERTIES = Object.freeze([
  'engineMode', 'bootedAt', 'restarts', 'nativeCapabilities', 'sdkReady', '_generation',
]);

/** 实例属性（可选）：迅雷 TaskDb 直读路径，壳层装配面不消费（经 slot 富件取用） */
const KERNEL_OPTIONAL_PROPERTIES = Object.freeze(['taskDbPath']);

const KERNEL_PROPERTIES = Object.freeze([...KERNEL_CORE_PROPERTIES, ...KERNEL_OPTIONAL_PROPERTIES]);

/** 内核进程事件词汇（EventEmitter 形态） */
const KERNEL_EVENTS = Object.freeze(['up', 'down', 'bootError']);

function assertKernel(value) {
  if (!value || typeof value !== 'object') throw new Error('kernel-port: 内核实例缺失');
  const missingMethods = KERNEL_CORE_METHODS.filter((name) => typeof value[name] !== 'function');
  if (missingMethods.length) throw new Error(`kernel-port: 内核缺失方法: ${missingMethods.join(', ')}`);
  // 可选方法：实现了就必须是函数（形态校验），缺失放行
  const malformedOptional = KERNEL_OPTIONAL_METHODS.filter((name) => value[name] !== undefined && typeof value[name] !== 'function');
  if (malformedOptional.length) throw new Error(`kernel-port: 可选方法形态错误（非函数）: ${malformedOptional.join(', ')}`);
  const missingProperties = KERNEL_CORE_PROPERTIES.filter((name) => value[name] === undefined);
  if (missingProperties.length) throw new Error(`kernel-port: 内核缺失属性: ${missingProperties.join(', ')}`);
  if (typeof value.on !== 'function' || typeof value.off !== 'function') {
    throw new Error('kernel-port: 内核未实现事件接口（on/off）');
  }
  return value;
}

module.exports = {
  KERNEL_METHODS, KERNEL_PROPERTIES, KERNEL_EVENTS, assertKernel,
  KERNEL_CORE_METHODS, KERNEL_OPTIONAL_METHODS, KERNEL_CORE_PROPERTIES, KERNEL_OPTIONAL_PROPERTIES,
};
