'use strict';

/**
 * KernelPort 契约：壳层与下载内核之间的冻结接口。
 *
 * 壳层（services/rpc/methods/control）只允许经此契约消费内核——
 * 不直接 require driver / taskdb-reader 等迅雷专属模块（architecture
 * test 守卫）。方法清单来自 2026-09-28 对壳层调用面的全量审计
 * （40 方法 + 7 属性 + 3 事件），多内核时代 kernel-qbit / kernel-emule
 * 实现同一契约即可替换。
 *
 * 校验模式借鉴 bridge 的 assertRecipient（方法级 typeof 检查）。
 */

const KERNEL_METHODS = Object.freeze([
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
  // 迅雷专属扩展（多内核时代将由 accountProvider 扩展点吸收，P1+）
  'notifyAuth', 'notifyLogout', 'getBtFileRuntime', 'getSeedDescriptor',
]);

/** 实例属性：可读即可（getter 或普通字段） */
const KERNEL_PROPERTIES = Object.freeze([
  'taskDbPath', 'sdkReady', '_generation', 'nativeCapabilities', 'bootedAt', 'restarts', 'engineMode',
]);

/** 内核进程事件词汇（EventEmitter 形态） */
const KERNEL_EVENTS = Object.freeze(['up', 'down', 'bootError']);

function assertKernel(value) {
  if (!value || typeof value !== 'object') throw new Error('kernel-port: 内核实例缺失');
  const missingMethods = KERNEL_METHODS.filter((name) => typeof value[name] !== 'function');
  if (missingMethods.length) throw new Error(`kernel-port: 内核缺失方法: ${missingMethods.join(', ')}`);
  const missingProperties = KERNEL_PROPERTIES.filter((name) => value[name] === undefined);
  if (missingProperties.length) throw new Error(`kernel-port: 内核缺失属性: ${missingProperties.join(', ')}`);
  if (typeof value.on !== 'function' || typeof value.off !== 'function') {
    throw new Error('kernel-port: 内核未实现事件接口（on/off）');
  }
  return value;
}

module.exports = { KERNEL_METHODS, KERNEL_PROPERTIES, KERNEL_EVENTS, assertKernel };
