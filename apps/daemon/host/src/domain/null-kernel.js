'use strict';

/**
 * NullKernel：零内核装配时的 KernelPort 占位实现（kernel-any-only 语义收口）。
 *
 * 「软件与内核不强相关」——全部内核插件被禁用时 daemon 仍要成在：任务仓库、
 * 设置、历史、链接库、插件管理、daemon 管理面照常服务；只有下载类操作诚实
 * 报 NOT_SUPPORTED（内核能力缺席，不伪装可用）。
 *
 * 形状对 KernelPort 核心契约全合规（assertKernel 可过）：核心方法齐备（全部
 * 显式 NOT_SUPPORTED）、核心属性真实（sdkReady=false、nativeCapabilities 空、
 * 零协议）；事件总线为真 EventEmitter（订阅无副作用，永不触发 up/down）。
 * kernel-hub.default() 在零注册时返回包着 NullKernel 的 slot，下游
 * task-shell / product-core 无需感知「无内核」分支。
 */
const { EventEmitter } = require('events');

function notSupported(method) {
  const error = new Error(`kernel-port: 无下载内核装配，不支持 ${method}（请在插件管理启用一个内核插件）`);
  error.code = 'NOT_SUPPORTED';
  error.kernelId = 'null';
  return error;
}

class NullKernel extends EventEmitter {
  constructor() {
    super();
    this.engineMode = 'null';
    this.bootedAt = 0;
    this.restarts = 0;
    this.nativeCapabilities = Object.freeze({});
    this.sdkReady = false;
    this._generation = 0;
    this.taskDbPath = null; // 可选属性缺席语义（与 qbit 同型）
  }

  // 生命周期：noop（无进程可管；restart 报错——无内核无从重启，提示先启用内核）
  async start() {}
  async shutdown() {}
  async restart() { throw notSupported('restart'); }

  // 能力与状态：诚实形态
  isHealthy() { return false; }
  enginePid() { return null; }
  getNativeCapabilities() { return {}; }
  async getSupportedProtocols() { return []; }
  async getChannelSwitches() { throw notSupported('getChannelSwitches'); }
  async getQueueCount() { return 0; }
  async getDhtNodeCount() { return 0; }

  // 其余契约方法：显式拒绝
  async startTasks() { throw notSupported('startTasks'); }
  async stopTasks() { throw notSupported('stopTasks'); }
  async deleteTasks() { throw notSupported('deleteTasks'); }
  async recycleTask() { throw notSupported('recycleTask'); }
  async recoverTask() { throw notSupported('recoverTask'); }
  async redownloadTask() { throw notSupported('redownloadTask'); }
  async renameTask() { throw notSupported('renameTask'); }
  async moveTask() { throw notSupported('moveTask'); }
  async createTask() { throw notSupported('createTask'); }
  async getTaskSnapshots() { return new Map(); }
  async parseTaskInfo() { throw notSupported('parseTaskInfo'); }
  async normalizeTorrentHash() { throw notSupported('normalizeTorrentHash'); }
  async resolveThunderUrl() { throw notSupported('resolveThunderUrl'); }
  async setGlobalLimits() { throw notSupported('setGlobalLimits'); }
  async getGlobalLimits() { throw notSupported('getGlobalLimits'); }
  async setChannelSwitches() { throw notSupported('setChannelSwitches'); }
  async verifyProxy() { throw notSupported('verifyProxy'); }
  async setProxy() { throw notSupported('setProxy'); }
  async setTaskSpeedLimit() { throw notSupported('setTaskSpeedLimit'); }
  async setBtScheduler() { throw notSupported('setBtScheduler'); }
  async updateBtSelection() { throw notSupported('updateBtSelection'); }
  async setAutoMoveLowSpeed() { throw notSupported('setAutoMoveLowSpeed'); }
}

/** kernel-hub 零注册时的 slot 形状（对齐 kernel-thunder 注册件——无迅雷富件） */
function createNullKernelSlot() {
  const kernel = new NullKernel();
  const eventBus = new EventEmitter();
  return {
    kernelId: 'null',
    kernel,
    eventBus,
    diagnosticEvents: { emit() {}, query: () => [], recent: () => [] },
    nativeBtLookup: null,
    account: null,
    start: async () => {},
  };
}

module.exports = { NullKernel, createNullKernelSlot };
