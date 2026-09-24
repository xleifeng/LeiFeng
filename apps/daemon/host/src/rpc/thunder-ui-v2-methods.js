'use strict';

const validators = require('./validators');
const { createAccountMethods } = require('./account-methods');
const { createVipMethods } = require('./vip-methods');
const { createPrivateSpaceMethods } = require('./private-space-methods');
const { createHistoryLinkMethods } = require('./history-link-methods');
const { createSystemMethods } = require('./system-methods');
const { createCaptureMethods } = require('./capture-methods');
const { createRemoteMethods } = require('./remote-methods');
const { createDiagnosticsMethods } = require('./diagnostics-methods');

function createThunderUiV2Methods({ taskService, taskQueryService, operationService = null, createTaskService = null, createDraftService = null, groupService = null, settingsService, bootstrapService, policyService = null, scheduler = null, scheduleService = null, completionActions = null, accountService = null, vipService = null, taskRepository = null, privateSpace = null, historyService = null, linkService = null, systemIntegration = null, media = null, capture = null, remotePairing = null, remoteNodes = null, remoteTasks = null, diagnostics = null, driver = null, operations = null, eventBus = null } = {}) {
  if (!taskService || !taskQueryService || !settingsService || !bootstrapService) throw new Error('V2 RPC services are incomplete');
  const methods = new Map([
    ['thunder.ui.v2.bootstrap', (_params, ctx) => bootstrapService.getSnapshot(ctx)],
    ['thunder.ui.v2.tasks.query', (params) => taskQueryService.query(validators.query(params && params[0]))],
    ['thunder.ui.v2.tasks.get', (params) => taskQueryService.get(validators.taskGet(params && params[0]))],
    ['thunder.ui.v2.tasks.counts', (params) => taskQueryService.counts(validators.query(params && params[0] || {}))],
    ['thunder.ui.v2.tasks.command', (params) => {
      const input = validators.mutation(params && params[0]);
      return operationService ? operationService.execute(input) : taskService.command(input);
    }],
    ...(operationService ? [
      ['thunder.ui.v2.tasks.operations.get', (params) => operationService.getOperation(validators.operationGet(params && params[0] || {}))],
      ['thunder.ui.v2.trash.query', (params) => taskQueryService.query({ ...validators.query(params && params[0] || {}), view: 'trash' })],
      ['thunder.ui.v2.trash.empty', (params) => operationService.emptyTrash(validators.trashEmpty(params && params[0] || {}))],
    ] : []),
    ...(groupService ? [['thunder.ui.v2.taskGroups.command', (params) => groupService.command(validators.groupCommand(params && params[0] || {}))]] : []),
    ...(createDraftService ? [
      ['thunder.ui.v2.create.preflight', (params) => createDraftService.preflight(validators.createPreflight(params && params[0] || {}))],
      ['thunder.ui.v2.create.getDraft', (params) => createDraftService.getDraft(validators.draftGet(params && params[0] || {}))],
      ['thunder.ui.v2.create.updateDraft', (params) => createDraftService.updateDraft(validators.draftUpdate(params && params[0] || {}))],
      ['thunder.ui.v2.create.commit', (params) => createDraftService.commit(validators.draftCommit(params && params[0] || {}))],
      ['thunder.ui.v2.create.cancel', (params) => createDraftService.cancel(validators.draftCancel(params && params[0] || {}))],
      ['thunder.ui.v2.paths.listRecent', () => createDraftService.listRecentPaths()],
      ['thunder.ui.v2.paths.removeRecent', (params) => createDraftService.removeRecentPath(validators.recentPath(params && params[0] || {}))],
      ['thunder.ui.v2.paths.clearRecent', () => createDraftService.clearRecentPaths()],
      ['thunder.ui.v2.paths.validate', (params) => createDraftService.validatePath(validators.pathValidate(params && params[0] || {}))],
    ] : []),
    ['thunder.ui.v2.settings.get', () => settingsService.get()],
    ['thunder.ui.v2.settings.update', (params) => {
      const input = validators.settingsUpdate(params && params[0]);
      return settingsService.update(input.patch, { expectedRevision: input.expectedRevision });
    }],
    ...(policyService ? [
      ['thunder.ui.v2.policies.get', () => policyService.get()],
      ['thunder.ui.v2.policies.update', (params) => policyService.update(validators.policyUpdate(params && params[0]))],
      ['thunder.ui.v2.policies.enableFullSpeed', () => policyService.enableFullSpeed()],
      ['thunder.ui.v2.policies.restoreLimits', () => policyService.restoreLimits()],
      ['thunder.ui.v2.proxy.test', (params) => policyService.testProxy(validators.proxyTest(params && params[0] || {}))],
    ] : []),
    ...(scheduler ? [['thunder.ui.v2.queue.move', (params) => scheduler.move(validators.queueMove(params && params[0] || {}))]] : []),
    ...(scheduleService ? [
      ['thunder.ui.v2.schedules.query', () => scheduleService.query()],
      ['thunder.ui.v2.schedules.save', (params) => scheduleService.save(validators.scheduleSave(params && params[0] || {}))],
      ['thunder.ui.v2.schedules.delete', (params) => scheduleService.delete(validators.scheduleDelete(params && params[0] || {}))],
      ['thunder.ui.v2.schedules.getDownloadLimitWindow', () => scheduleService.getDownloadLimitWindow()],
      ['thunder.ui.v2.schedules.setDownloadLimitWindow', (params) => scheduleService.setDownloadLimitWindow(validators.downloadLimitWindow(params && params[0] || {}))],
    ] : []),
    ...(completionActions ? [
      ['thunder.ui.v2.system.completion.get', () => completionActions.getPending()],
      ['thunder.ui.v2.system.cancelCompletionAction', (params) => ({ cancelled: completionActions.cancel(validators.completionCancel(params && params[0] || {}).operationId) })],
    ] : []),
  ]);
  for (const map of [accountService ? createAccountMethods({ accountService }) : null, vipService ? createVipMethods({ vipService, taskRepository }) : null, privateSpace ? createPrivateSpaceMethods({ privateSpace }) : null, (historyService || linkService) ? createHistoryLinkMethods({ historyService, linkService }) : null, (systemIntegration || media || driver) ? createSystemMethods({ systemIntegration, media, driver, operations, eventBus }) : null, capture ? createCaptureMethods({ capture }) : null, (remotePairing || remoteNodes || remoteTasks) ? createRemoteMethods({ pairing: remotePairing, nodes: remoteNodes, tasks: remoteTasks }) : null, diagnostics ? createDiagnosticsMethods({ diagnostics }) : null]) {
    if (map) for (const [name, handler] of map) methods.set(name, handler);
  }
  return methods;
}

module.exports = { createThunderUiV2Methods };
