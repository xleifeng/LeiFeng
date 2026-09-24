'use strict';

const { engineProblem, requireHandle, requireEngineId, capabilityPresent, safeNativeError } = require('./task-control');

function requireCapability(capabilities, name) {
  if (!capabilityPresent(capabilities, name)) throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', `native capability unavailable: ${name}`);
}

function indices(value) {
  if (!Array.isArray(value) || !value.length || value.length > 10000) throw engineProblem('INVALID_BT_SELECTION', 'invalid BT file selection');
  const result = [...new Set(value.map(Number))];
  if (result.some((item) => !Number.isSafeInteger(item) || item < 0)) throw engineProblem('INVALID_BT_SELECTION', 'invalid BT file index');
  return result.sort((a, b) => a - b);
}

function readBtFileInfos(extra, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, files) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Array.isArray(files) ? files : []);
    };
    const timer = setTimeout(() => finish(engineProblem('NATIVE_BT_OPERATION_FAILED', 'native BT file metadata callback timed out')), timeoutMs);
    const read = () => {
      try { extra.getBtFileInfos((files) => finish(null, files)); }
      catch (cause) { finish(engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause))); }
    };
    try {
      if (typeof extra.waitLoadBtFileFinish === 'function') extra.waitLoadBtFileFinish(read);
      else read();
    } catch (cause) { finish(engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause))); }
  });
}

function createBtControlHandlers({ tm, NativeTaskInterface, capabilities, runtimeTimeoutMs = 4000 } = {}) {
  return {
    updateBtSelection: ({ engineId, selectedFileIndices }) => {
      const { id, task } = requireHandle(tm, engineId);
      const selected = indices(selectedFileIndices);
      requireCapability(capabilities, 'bt.updateSelection');
      try { tm.updateBtSubFileDownload(task, selected); }
      catch (cause) {
        if (cause && typeof cause.code === 'string') throw cause;
        throw engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause));
      }
      return { accepted: true, engineId: id, selectedFileIndices: selected };
    },
    setBtScheduler: ({ engineId, scheduler }) => {
      const { id, task } = requireHandle(tm, engineId);
      if (!['normal', 'sequential'].includes(scheduler)) throw engineProblem('INVALID_BT_SCHEDULER', 'invalid BT scheduler');
      requireCapability(capabilities, 'bt.sequential');
      try { tm.updateBtSubFileScheduler(task, scheduler === 'sequential' ? 1 : 0); }
      catch (cause) { throw engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause)); }
      return { accepted: true, engineId: id, scheduler };
    },
    getBtFileRuntime: async ({ engineId }) => {
      const { id, task } = requireHandle(tm, engineId);
      requireCapability(capabilities, 'bt.getFileRuntime');
      if (!NativeTaskInterface || typeof NativeTaskInterface.toTaskExtra !== 'function')
        throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', 'native capability unavailable: bt.getFileRuntime');
      try {
        const extra = NativeTaskInterface.toTaskExtra(task);
        if (!extra || typeof extra.getBtFileInfos !== 'function')
          throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', 'native capability unavailable: bt.getFileRuntime');
        return { engineId: id, files: await readBtFileInfos(extra, Math.min(8000, Math.max(100, Number(runtimeTimeoutMs) || 4000))) };
      }
      catch (cause) {
        if (cause && typeof cause.code === 'string') throw cause;
        throw engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause));
      }
    },
    getSeedDescriptor: ({ engineId }) => {
      const id = requireEngineId(engineId);
      requireCapability(capabilities, 'bt.getSeed');
      if (typeof tm.getTaskSeedFile !== 'function') throw engineProblem('NATIVE_CAPABILITY_UNAVAILABLE', 'native capability unavailable: bt.getSeed');
      const { task } = requireHandle(tm, id);
      try { return { engineId: id, seed: String(tm.getTaskSeedFile(task) || '') }; }
      catch (cause) { throw engineProblem('NATIVE_BT_OPERATION_FAILED', safeNativeError(cause)); }
    },
  };
}

module.exports = { createBtControlHandlers, indices, readBtFileInfos };
