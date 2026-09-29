'use strict';
// history-links（P4 拆分自 product-services）：下载历史 + 链接库——outbox 的
// 两个持久消费者。消费者语义未完成（母文档 §7.2：永久禁用的保留窗口与重同步
// 策略）前 profile 保持必需（本插件不可禁用），但结构上已是独立插件。
// eventConsumers 注册：经 repositories 装配面声明（task 仓库不写死名单）。
const { HistoryService } = require('../src/services/history-service');
const { LinkLibraryService } = require('../src/services/link-library-service');
const { createHistoryLinkMethods } = require('../src/rpc/history-link-methods');
const { plugin } = require('./shared.cjs');

const historyLinks = plugin('leifeng-history-links', ['leifengConfig', 'leifengRepositories', 'leifengKernelHub', 'leifengTasks', 'leifengRpc', 'leifengPrivateSpace', 'leifengUiRegistry'], (ctx) => {
  const { taskRepository, historyRepository, linkRepository } = ctx.leifengRepositories;
  const kernelSlot = ctx.leifengKernelHub.default();
  const { eventBus } = kernelSlot;
  const { createDraftService } = ctx.leifengTasks;
  const { privateSpace } = ctx.leifengPrivateSpace;
  const withdrawUiCapabilities = ctx.leifengUiRegistry.contribute('history-links', ['history', 'link-library']);

  const historyService = new HistoryService({
    repository: historyRepository, tasks: taskRepository, eventBus,
    privateSpace, createDraftService,
  });
  const linkService = new LinkLibraryService({
    repository: linkRepository, tasks: taskRepository, privateSpace,
    createDraftService, eventBus,
  });

  ctx.provide('leifengHistoryLinks', { historyService, linkService });
  const withdrawV2 = ctx.leifengRpc.registry.register('history-links', createHistoryLinkMethods({ historyService, linkService }));
  ctx.effect(() => () => {
    withdrawV2(); withdrawUiCapabilities();
    historyService.stop();
    linkService.stop();
  });
  // history/link 消费 outbox 之前先做投影一致性断言（spec §7）：
  // 未确认窗口内的事件快照与 repository 现状矛盾时记脱敏诊断，不阻塞启动。
  try {
    const { replayProjection, compareWithRepository } = require('../src/repositories/projection-replay');
    const pending = taskRepository.listUnacknowledgedEvents('history');
    const { replayed, unsupported } = replayProjection(pending);
    const { inconsistencies } = compareWithRepository({ replayed, tasks: taskRepository.list() });
    if (inconsistencies.length || unsupported.length) {
      console.error('[thunderd] projection consistency:', JSON.stringify({
        inconsistencies: inconsistencies.slice(0, 20), unsupportedEvents: unsupported.length,
      }));
    }
  } catch (error) {
    console.error('[thunderd] projection consistency check failed:', error.code || error.name);
  }
  historyService.start();
  linkService.start();
});

module.exports = { historyLinks };
