'use strict';

const DEFAULT_MESSAGES = Object.freeze({
  INVALID_ARGUMENT: '请求参数无效',
  TASK_NOT_FOUND: '任务不存在或已被删除',
  REVISION_CONFLICT: '任务状态已变化，请刷新后重试',
  IDEMPOTENCY_KEY_REUSED: '请求幂等键已用于其他参数',
  REPOSITORY_READ_ONLY: '任务数据当前只能读取，请检查 daemon 诊断信息',
  OUTBOX_FULL: '任务审计队列已满，暂时不能永久删除',
  UNSUPPORTED_COMMAND: '不支持该任务操作',
});

function toRpcProblem(error, { exposeDetails = true } = {}) {
  const code = String(error && error.code || 'INTERNAL_ERROR');
  return {
    code,
    message: DEFAULT_MESSAGES[code] || String(error && error.message || '请求失败'),
    ...(exposeDetails && error && error.details ? { details: error.details } : {}),
  };
}

function toRpcError(error) {
  const problem = toRpcProblem(error);
  const result = new Error(problem.message);
  result.code = problem.code;
  result.details = problem.details;
  return result;
}

module.exports = { toRpcProblem, toRpcError, DEFAULT_MESSAGES };
