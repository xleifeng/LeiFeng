'use strict';

const validators = require('./validators');

function createVipMethods({ vipService, taskRepository = null } = {}) {
  if (!vipService) throw new Error('vipService is required');
  return new Map([
    ['thunder.ui.v2.vip.getGlobalState', () => vipService.getGlobalUiState()],
    ['thunder.ui.v2.vip.getTaskState', (params) => {
      const input = validators.taskGet(params && params[0]);
      return vipService.getTaskUiState(input.taskId);
    }],
    ['thunder.ui.v2.vip.setTaskEnabled', async (params) => {
      const input = validators.object(params && params[0]);
      if (typeof input.taskId !== 'string' || !input.taskId) throw validators.invalid('taskId 必填');
      if (typeof input.enabled !== 'boolean') throw validators.invalid('enabled 必须是布尔值');
      const task = taskRepository?.require(input.taskId);
      if (input.expectedRevision !== undefined && task && Number(input.expectedRevision) !== Number(task.revision)) throw Object.assign(new Error('任务状态已变化，请刷新后重试'), { code: 'REVISION_CONFLICT' });
      await vipService.setEnabled({ gid: input.taskId, enabled: input.enabled });
      return vipService.getTaskUiState(input.taskId);
    }],
    ['thunder.ui.v2.vip.retryTask', async (params) => {
      const input = validators.taskGet(params && params[0]);
      return vipService.retry(input.taskId);
    }],
  ]);
}

module.exports = { createVipMethods };
