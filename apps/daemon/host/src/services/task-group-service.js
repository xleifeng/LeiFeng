'use strict';

const { aggregate } = require('../domain/task-group');

function groupError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

class TaskGroupService {
  constructor({ tasks, taskService = null, operationService = null, clock = Date } = {}) {
    if (!tasks) throw new Error('TaskGroupService tasks is required');
    this.tasks = tasks; this.taskService = taskService; this.operationService = operationService; this.clock = clock;
  }

  _children(parentTaskId) { return this.tasks.list().filter((task) => task.parentId === String(parentTaskId)); }

  create({ label = '任务组', taskIds = [] } = {}) {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String))].filter(Boolean);
    if (!ids.length) throw groupError('INVALID_ARGUMENT', '任务组至少需要一个子任务');
    const missing = ids.filter((id) => !this.tasks.get(id));
    if (missing.length) throw groupError('TASK_NOT_FOUND', '任务组子任务不存在', { taskIds: missing });
    const parent = this.tasks.create({ kind: 'group', lifecycle: 'queued', displayName: String(label || '任务组'), source: null, group: { id: 'pending', label: String(label || '任务组') } });
    const group = { id: parent.id, label: String(label || '任务组') };
    for (const taskId of ids) this.tasks.mutate(taskId, { reason: 'group-attach' }, { parentId: parent.id, group });
    return this.recompute(parent.id);
  }

  recompute(parentTaskId) {
    const parent = this.tasks.require(parentTaskId);
    if (parent.kind !== 'group') throw groupError('INVALID_GROUP', '目标任务不是任务组');
    const children = this._children(parent.id);
    const summary = aggregate(children);
    const label = parent.group && parent.group.label || parent.displayName;
    if (parent.lifecycle === summary.lifecycle && Number(parent.totalBytes) === summary.totalBytes && Number(parent.completedBytes) === summary.completedBytes && Number(parent.downloadBytesPerSecond) === summary.downloadBytesPerSecond && parent.groupResult === summary.groupResult && parent.childCount === summary.childCount && parent.group && parent.group.id === parent.id) return parent;
    return this.tasks.mutate(parent.id, { reason: 'group-recompute' }, { lifecycle: summary.lifecycle, totalBytes: summary.totalBytes, completedBytes: summary.completedBytes, downloadBytesPerSecond: summary.downloadBytesPerSecond, groupResult: summary.groupResult, childCount: summary.childCount, group: { id: parent.id, label } });
  }

  async command({ parentTaskId, command, expectedRevisions = {}, options = {}, idempotencyKey } = {}) {
    if (!this.taskService && !this.operationService) throw groupError('GROUP_COMMAND_UNAVAILABLE', '任务组命令服务不可用');
    const children = this._children(parentTaskId);
    if (!children.length) throw groupError('INVALID_GROUP', '任务组没有子任务');
    const response = this.operationService
      ? await this.operationService.execute({ taskIds: children.map((task) => task.id), command, expectedRevisions, options, idempotencyKey })
      : await this.taskService.command({ taskIds: children.map((task) => task.id), command, expectedRevisions, options, idempotencyKey });
    this.recompute(parentTaskId);
    return { ...response, parentTaskId: String(parentTaskId) };
  }
}

module.exports = { TaskGroupService, groupError };
