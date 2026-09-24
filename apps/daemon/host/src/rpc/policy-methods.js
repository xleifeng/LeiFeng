'use strict';

const validators = require('./validators');

function createPolicyMethods({ policyService, scheduler = null, scheduleService = null, completionActions = null } = {}) {
  if (!policyService) throw new Error('policyService is required');
  return new Map([
    ['thunder.ui.v2.policies.get', () => policyService.get()],
    ['thunder.ui.v2.policies.update', (params) => policyService.update(validators.policyUpdate(params && params[0]))],
    ['thunder.ui.v2.policies.enableFullSpeed', () => policyService.enableFullSpeed()],
    ['thunder.ui.v2.policies.restoreLimits', () => policyService.restoreLimits()],
    ['thunder.ui.v2.proxy.test', (params) => policyService.testProxy(validators.proxyTest(params && params[0] || {}))],
    ...(scheduler ? [['thunder.ui.v2.queue.move', (params) => scheduler.move(validators.queueMove(params && params[0] || {}))]] : []),
    ...(scheduleService ? [['thunder.ui.v2.schedules.query', () => scheduleService.query()], ['thunder.ui.v2.schedules.save', (params) => scheduleService.save(validators.scheduleSave(params && params[0] || {}))], ['thunder.ui.v2.schedules.delete', (params) => scheduleService.delete(validators.scheduleDelete(params && params[0] || {}))], ['thunder.ui.v2.schedules.getDownloadLimitWindow', () => scheduleService.getDownloadLimitWindow()], ['thunder.ui.v2.schedules.setDownloadLimitWindow', (params) => scheduleService.setDownloadLimitWindow(validators.downloadLimitWindow(params && params[0] || {}))]] : []),
    ...(completionActions ? [['thunder.ui.v2.system.completion.get', () => completionActions.getPending()], ['thunder.ui.v2.system.cancelCompletionAction', (params) => ({ cancelled: completionActions.cancel(validators.completionCancel(params && params[0] || {}).operationId) })]] : []),
  ]);
}

module.exports = { createPolicyMethods };
