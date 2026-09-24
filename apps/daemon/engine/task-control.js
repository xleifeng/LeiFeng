'use strict';

function engineProblem(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requireEngineId(engineId) {
  const value = Number(engineId);
  if (!Number.isSafeInteger(value) || value <= 0) throw engineProblem('INVALID_ENGINE_TASK_ID', 'invalid engine id');
  return value;
}

function requireHandle(tm, engineId) {
  const id = requireEngineId(engineId);
  if (!tm || typeof tm.findTaskById !== 'function') throw engineProblem('TASK_HANDLE_NOT_FOUND', 'task handle lookup unavailable');
  let found;
  try { found = tm.findTaskById(id); } catch { found = null; }
  if (!found || !found.t) throw engineProblem('TASK_HANDLE_NOT_FOUND', 'task handle not found');
  return { id, task: found.t };
}

function capabilityPresent(capabilities, name) {
  const value = capabilities && capabilities.flat && capabilities.flat[name];
  return value === true || value === 'present' || value === 'verified';
}

function requireCapability(capabilities, name) {
  if (!capabilityPresent(capabilities, name)) throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', `native capability unavailable: ${name}`);
}

function safeNativeError(error) {
  const raw = String(error && error.message || error || 'native task operation failed');
  return raw.replace(/[A-Za-z]:\\[^\s]+/g, '<path>').replace(/(?:^|\s)(\/[^\s]+)/g, ' <path>').slice(0, 200);
}

function invoke(tm, method, args) {
  if (!tm || typeof tm[method] !== 'function') throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', `native capability unavailable: ${method}`);
  try { return tm[method](...args); }
  catch (cause) { throw engineProblem('NATIVE_TASK_OPERATION_FAILED', safeNativeError(cause)); }
}

function createTaskControlHandlers({ tm, capabilities } = {}) {
  return {
    recycleTask: ({ engineId }) => {
      const id = requireEngineId(engineId);
      requireCapability(capabilities, 'recycle');
      invoke(tm, 'batchRecycleTasks', [[id]]);
      return { accepted: true, engineId: id };
    },
    recoverTask: ({ engineId }) => {
      const id = requireEngineId(engineId);
      requireCapability(capabilities, 'recover');
      invoke(tm, 'batchRecoverTasks', [[id]]);
      return { accepted: true, engineId: id };
    },
    redownloadTask: ({ engineId, deleteLocal = false }) => {
      const { id, task } = requireHandle(tm, engineId);
      requireCapability(capabilities, 'redownload');
      invoke(tm, 'reDownload', [task, deleteLocal === true]);
      return { accepted: true, engineId: id, deleteLocal: deleteLocal === true };
    },
    renameTask: ({ engineId, displayName }) => {
      const { id, task } = requireHandle(tm, engineId);
      if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 255 || displayName.includes('\0') || displayName.includes('/') || displayName.includes('\\')) throw engineProblem('INVALID_TASK_NAME', 'invalid task display name');
      requireCapability(capabilities, 'rename');
      invoke(tm, 'renameTask', [task, displayName]);
      return { accepted: true, engineId: id, displayName };
    },
    moveTask: ({ engineId, wineTargetPath }) => {
      const { id, task } = requireHandle(tm, engineId);
      if (typeof wineTargetPath !== 'string' || !wineTargetPath.trim() || wineTargetPath.length > 32768) throw engineProblem('INVALID_TASK_PATH', 'invalid task target path');
      requireCapability(capabilities, 'move');
      invoke(tm, 'moveTask', [task, wineTargetPath]);
      return { accepted: true, engineId: id };
    },
    setTaskSpeedLimit: ({ engineId, bytesPerSecond }) => {
      const { id, task } = requireHandle(tm, engineId);
      const limit = bytesPerSecond === null || bytesPerSecond === undefined ? 0 : Number(bytesPerSecond);
      if (!Number.isSafeInteger(limit) || limit < 0) throw engineProblem('INVALID_SPEED_LIMIT', 'invalid task speed limit');
      requireCapability(capabilities, 'perTaskRateLimit');
      invoke(tm, 'setTaskDownloadSpeedLimit', [task, limit]);
      return { accepted: true, engineId: id, bytesPerSecond: limit };
    },
    inspectTaskHandle: ({ engineId }) => {
      const { id } = requireHandle(tm, engineId);
      return { found: true, engineId: id };
    },
  };
}

module.exports = { createTaskControlHandlers, requireEngineId, requireHandle, engineProblem, capabilityPresent, safeNativeError };
