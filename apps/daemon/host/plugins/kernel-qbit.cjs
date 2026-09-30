'use strict';
// kernel-qbit：qBittorrent 参照内核插件（P3）——KernelPort 完备性验证用第二内核。
// kernel-any-only 后升级为常驻 profile 成员（defaultEnabled:false）：patch
// { id: 'kernel-qbit', enabled: true } 启用。slot 标准形状注册进 kernel-hub
// （kernel + 事件桥 + diagnosticEvents + start）；poller/account/nativeBtLookup
// 是迅雷槽富件，qbit 不提供（缺席语义，消费方可选链）。account 槽不 provide
// ——qbit-only 下 account.*/vip.* 整体 -32601（rpc 注册点在 kernel-thunder）。
const { QbitDriver } = require('../kernels/qbit/qbit-driver');
const { assertKernel } = require('../src/domain/kernel-port');
const { DomainEventBus } = require('../src/services/domain-event-bus');
const { DiagnosticEventBuffer } = require('../src/domain/diagnostic-events');
const { plugin } = require('./shared.cjs');

const kernelQbit = plugin('leifeng-kernel-qbit', ['leifengConfig', 'leifengKernelHub', 'leifengRepositories', 'leifengRpc'], (ctx) => {
  const { env } = ctx.leifengConfig;
  const driver = new QbitDriver({
    origin: env.THUNDERD_QBIT_ORIGIN || 'http://127.0.0.1:8085',
    username: env.THUNDERD_QBIT_USERNAME || '',
    password: env.THUNDERD_QBIT_PASSWORD || '',
  });
  const kernel = assertKernel(driver);
  const eventBus = new DomainEventBus();
  const diagnosticEvents = new DiagnosticEventBuffer();
  // 事件桥接与 kernel-thunder 同词汇：壳层订阅 kernel.* 域事件
  const onUp = (payload) => eventBus.emit('kernel.up', { ...payload, kernelId: 'qbit' });
  const onDown = (payload) => eventBus.emit('kernel.down', { ...payload, kernelId: 'qbit' });
  const onBootError = (payload) => eventBus.emit('kernel.bootError', { ...payload, kernelId: 'qbit' });
  driver.on('up', onUp);
  driver.on('down', onDown);
  driver.on('bootError', onBootError);

  // peers/做种统计 RPC 面（kernel-detail-panels）：仅 qbit 内核有能力，thunder-only
  // 装配下方法缺席（-32601）——前端 peers/做种面板只挂在 kernelId==='qbit' 的任务上。
  const requireTask = (params) => {
    const taskId = String((params && params[0] && params[0].taskId) || '');
    if (!taskId) { const e = new Error('taskId is required'); e.code = 'INVALID_PARAMS'; throw e; }
    return ctx.leifengRepositories.taskRepository.require(taskId);
  };
  const withdrawRpc = ctx.leifengRpc.registry.register('kernel-qbit', [
    ['leifeng.ui.v2.tasks.peers', async (params) => kernel.getTaskPeers(requireTask(params))],
    ['leifeng.ui.v2.tasks.seeding', async (params) => kernel.getSeedingStats(requireTask(params))],
  ]);

  const qbitSlot = {
    kernelId: 'qbit',
    kernel,
    eventBus,
    diagnosticEvents,
    start: () => driver.start(),
  };
  const withdrawHub = ctx.leifengKernelHub.register(qbitSlot);
  ctx.provide('leifengKernel:qbit', qbitSlot);
  return async () => {
    withdrawHub();
    withdrawRpc();
    driver.off('up', onUp); driver.off('down', onDown); driver.off('bootError', onBootError);
    eventBus.close();
    await driver.shutdown();
  };
});

module.exports = { kernelQbit };
