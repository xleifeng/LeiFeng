'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { CompletionActionService } = require('../../host/src/services/completion-action-service');

test('completion action schedules a cancellable countdown only after a completed transition', async () => {
  const tasks = { list: () => [{ id: 't1', lifecycle: 'completed', privateSpace: false }] }; const service = new CompletionActionService({ tasks, policyProvider: () => ({ completionAction: 'pause-all' }), taskService: { command: async () => {} }, countdownMs: 1000 });
  service.onTaskTransition({ from: 'downloading', to: 'completed' }); const pending = service.getPending(); assert.equal(pending.action, 'pause-all'); assert.equal(service.cancel(pending.operationId), true); assert.equal(service.getPending(), null); service.stop();
});
