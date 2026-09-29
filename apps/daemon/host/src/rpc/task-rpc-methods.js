'use strict';
// task 域 RPC 注册工厂（rpc-plugin-registration：task-shell 消费）。
// 方法面 = 原 leifeng-ui-v2-methods.js 里服务主人是 task-shell 的条目，
// 迁移零逻辑改动；systemIntegration 的 system.* 三方法也在此（该服务由
// task-shell 构造）。

const validators = require('./validators');
const { createSystemMethods } = require('./system-methods');

function createTaskRpcMethods({ taskService, taskQueryService, operationService = null, createTaskService = null, createDraftService = null, groupService = null, settingsService, policyService = null, scheduler = null, scheduleService = null, completionActions = null, systemIntegration = null, operations = null, eventBus = null } = {}) {
  if (!taskService || !taskQueryService || !settingsService) throw new Error('task RPC services are incomplete');
  const methods = new Map([
    ['leifeng.ui.v2.tasks.query', (params) => taskQueryService.query(validators.query(params && params[0]))],
    ['leifeng.ui.v2.tasks.get', (params) => taskQueryService.get(validators.taskGet(params && params[0]))],
    ['leifeng.ui.v2.tasks.counts', (params) => taskQueryService.counts(validators.query(params && params[0] || {}))],
    ['leifeng.ui.v2.tasks.command', (params) => {
      const input = validators.mutation(params && params[0]);
      return operationService ? operationService.execute(input) : taskService.command(input);
    }],
    ...(operationService ? [
      ['leifeng.ui.v2.tasks.operations.get', (params) => operationService.getOperation(validators.operationGet(params && params[0] || {}))],
      ['leifeng.ui.v2.trash.query', (params) => taskQueryService.query({ ...validators.query(params && params[0] || {}), view: 'trash' })],
      ['leifeng.ui.v2.trash.empty', (params) => operationService.emptyTrash(validators.trashEmpty(params && params[0] || {}))],
    ] : []),
    ...(groupService ? [['leifeng.ui.v2.taskGroups.command', (params) => groupService.command(validators.groupCommand(params && params[0]))]] : []),
    ...(createDraftService ? [
      ['leifeng.ui.v2.create.preflight', (params) => createDraftService.preflight(validators.createPreflight(params && params[0] || {}))],
      ['leifeng.ui.v2.create.getDraft', (params) => createDraftService.getDraft(validators.draftGet(params && params[0] || {}))],
      ['leifeng.ui.v2.create.updateDraft', (params) => createDraftService.updateDraft(validators.draftUpdate(params && params[0] || {}))],
      ['leifeng.ui.v2.create.commit', (params) => createDraftService.commit(validators.draftCommit(params && params[0] || {}))],
      ['leifeng.ui.v2.create.cancel', (params) => createDraftService.cancel(validators.draftCancel(params && params[0] || {}))],
      ['leifeng.ui.v2.paths.listRecent', () => createDraftService.listRecentPaths()],
      ['leifeng.ui.v2.paths.removeRecent', (params) => createDraftService.removeRecentPath(validators.recentPath(params && params[0] || {}))],
      ['leifeng.ui.v2.paths.clearRecent', () => createDraftService.clearRecentPaths()],
      ['leifeng.ui.v2.paths.validate', (params) => createDraftService.validatePath(validators.pathValidate(params && params[0] || {}))],
    ] : []),
    ['leifeng.ui.v2.settings.get', () => settingsService.get()],
    ['leifeng.ui.v2.settings.update', (params) => {
      const input = validators.settingsUpdate(params && params[0]);
      return settingsService.update(input.patch, { expectedRevision: input.expectedRevision });
    }],
    ...(policyService ? [
      ['leifeng.ui.v2.policies.get', () => policyService.get()],
      ['leifeng.ui.v2.policies.update', (params) => policyService.update(validators.policyUpdate(params && params[0]))],
      ['leifeng.ui.v2.policies.enableFullSpeed', () => policyService.enableFullSpeed()],
      ['leifeng.ui.v2.policies.restoreLimits', () => policyService.restoreLimits()],
      ['leifeng.ui.v2.policies.proxy.test', (params) => policyService.testProxy(validators.proxyTest(params && params[0] || {}))],
    ] : []),
    ...(scheduler ? [['leifeng.ui.v2.queue.move', (params) => scheduler.move(validators.queueMove(params && params[0]))]] : []),
    ...(scheduleService ? [
      ['leifeng.ui.v2.schedules.query', () => scheduleService.query()],
      ['leifeng.ui.v2.schedules.save', (params) => scheduleService.save(validators.scheduleSave(params && params[0] || {}))],
      ['leifeng.ui.v2.schedules.delete', (params) => scheduleService.delete(validators.scheduleDelete(params && params[0] || {}))],
      ['leifeng.ui.v2.schedules.getDownloadLimitWindow', () => scheduleService.getDownloadLimitWindow()],
      ['leifeng.ui.v2.schedules.setDownloadLimitWindow', (params) => scheduleService.setDownloadLimitWindow(validators.downloadLimitWindow(params && params[0] || {}))],
    ] : []),
    ...(completionActions ? [
      ['leifeng.ui.v2.system.completion.get', () => completionActions.getPending()],
      ['leifeng.ui.v2.system.cancelCompletionAction', (params) => ({ cancelled: completionActions.cancel(validators.completionCancel(params && params[0] || {}).operationId) })],
    ] : []),
  ]);
  for (const [name, handler] of createSystemMethods({ systemIntegration, media: null, driver: null, operations, eventBus })) methods.set(name, handler);
  return methods;
}

module.exports = { createTaskRpcMethods };
