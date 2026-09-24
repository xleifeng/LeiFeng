'use strict';

const path = require('path');
const { OperationLock } = require('./operation-lock');
const { TASK_COMMANDS, isTaskCommand } = require('../domain/task-commands');
const { mapNativeError } = require('../domain/task-errors');

function operationError(code, message, details, { uncertain = false } = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.uncertain = uncertain;
  return error;
}

function nowMs(clock) { return Number(clock && typeof clock.now === 'function' ? clock.now() : Date.now()); }

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function nativeAvailable(driver, capability, method) {
  if (!driver || typeof driver[method] !== 'function') return false;
  const flat = driver.nativeCapabilities && driver.nativeCapabilities.flat;
  if (flat && Object.prototype.hasOwnProperty.call(flat, capability)) return flat[capability] === true || flat[capability] === 'present' || flat[capability] === 'verified';
  return true;
}

function stableError(error) {
  const code = error && error.code ? String(error.code) : 'TASK_OPERATION_FAILED';
  const message = error && error.message ? String(error.message).slice(0, 240) : '任务操作失败';
  const details = error && error.details && typeof error.details === 'object'
    ? Object.fromEntries(Object.entries(error.details).filter(([key]) => ['taskId', 'currentRevision', 'replacementTaskId', 'identityPreserved', 'command'].includes(key)))
    : undefined;
  return { code, message, ...(details && Object.keys(details).length ? { details } : {}) };
}

class TaskOperationService {
  constructor({ tasks, driver, taskService, createTaskService = null, pathService = null, fileOperations = null, operations, seedStore = null, ftpSecrets = null, systemIntegration = null, operationLock = new OperationLock(), clock = Date, nativeGeneration = () => 0, eventBus = null } = {}) {
    if (!tasks || !driver || !taskService || !operations) throw new Error('TaskOperationService dependencies are incomplete');
    this.tasks = tasks;
    this.driver = driver;
    this.taskService = taskService;
    this.createTaskService = createTaskService;
    this.pathService = pathService;
    this.fileOperations = fileOperations;
    this.operations = operations;
    this.seedStore = seedStore;
    this.ftpSecrets = ftpSecrets;
    this.systemIntegration = systemIntegration;
    this.operationLock = operationLock;
    this.clock = clock;
    this.nativeGeneration = nativeGeneration;
    this.eventBus = eventBus;
  }

  _now() { return nowMs(this.clock); }
  _operationId() { return `${this._now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
  _requireTask(taskId) { return this.tasks.require(String(taskId)); }

  _params(command, options) {
    const input = options && typeof options === 'object' ? options : {};
    const allowed = {
      deleteLocalFiles: input.deleteLocalFiles === true,
      // 仅由 emptyTrash 内部使用：路径不安全时跳过本地文件，不扩大删除范围。
      skipUnsafeLocalFiles: input.skipUnsafeLocalFiles === true,
      allowRecreateFallback: input.allowRecreateFallback === true,
      displayName: typeof input.displayName === 'string' ? input.displayName : undefined,
      targetDirectory: typeof input.targetDirectory === 'string' ? input.targetDirectory : undefined,
      speedLimitBytesPerSecond: input.speedLimitBytesPerSecond === null ? null : Number.isSafeInteger(Number(input.speedLimitBytesPerSecond)) ? Number(input.speedLimitBytesPerSecond) : undefined,
      selectedFileIndices: Array.isArray(input.selectedFileIndices) ? input.selectedFileIndices.map(Number).filter((item) => Number.isSafeInteger(item) && item >= 0).slice(0, 10000) : undefined,
      btScheduler: ['normal', 'sequential'].includes(input.btScheduler) ? input.btScheduler : undefined,
      fileIndex: Number.isSafeInteger(Number(input.fileIndex)) && Number(input.fileIndex) >= 0 ? Number(input.fileIndex) : undefined,
      start: input.start === true,
    };
    return Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
  }

  _hasNative(capability, method) { return nativeAvailable(this.driver, capability, method); }

  _markNative(operationId, evidence) { return this.operations.markNativeCalled(operationId, clone(evidence || {})); }
  _markFilesystem(operationId, evidence) { return this.operations.markFilesystem(operationId, clone(evidence || {})); }

  _announceReplacement(taskId, from = 'preparing') {
    if (!this.eventBus || !taskId) return;
    const replacement = this.tasks.get(taskId);
    if (!replacement || replacement.lifecycle !== 'queued') return;
    // Recreate paths create the replacement in the repository directly.  Tell
    // the scheduler about the queued row so a retry does not sit forever when
    // no unrelated task transition happens afterward.
    this.eventBus.emit('task.transition', {
      taskId: replacement.id,
      from,
      to: replacement.lifecycle,
      revision: replacement.revision,
      task: replacement,
    });
  }

  async execute({ taskIds, command, expectedRevisions = {}, options = {}, idempotencyKey } = {}) {
    if (!Array.isArray(taskIds) || !taskIds.length) throw operationError('INVALID_ARGUMENT', 'taskIds 不能为空');
    if (!isTaskCommand(command)) throw operationError('UNSUPPORTED_COMMAND', `不支持任务命令: ${command}`, { command });
    const ids = [...new Set(taskIds.map(String))].filter(Boolean).slice(0, 200);
    const params = this._params(command, options);
    if (idempotencyKey) {
      const previous = this.operations.findByIdempotencyKey(String(idempotencyKey));
      if (previous && previous.result && previous.result.results) return clone(previous.result);
      if (previous && !['committed', 'failed'].includes(previous.state)) throw operationError('OPERATION_PENDING', '相同幂等请求仍在处理中', { operationId: previous.operationId });
    }
    const operationId = this._operationId();
    const acceptedAt = this._now();
    const results = [];
    const journalIds = [];
    for (const taskId of ids) {
      const journalId = `${operationId}:${taskId}`;
      journalIds.push(journalId);
      let task;
      try {
        task = this._requireTask(taskId);
        const expectedRevision = expectedRevisions && expectedRevisions[taskId];
        this.operations.prepare({ operationId: journalId, idempotencyKey: idempotencyKey ? String(idempotencyKey) : '', taskId, command, beforeRevision: task.revision, params, nativeGeneration: this.nativeGeneration() });
        const result = await this._executeOne({ task, command, options: params, expectedRevision, operationId: journalId });
        const current = this.tasks.get(taskId);
        if (this.eventBus && current && current.lifecycle !== task.lifecycle) this.eventBus.emit('task.transition', { taskId, from: task.lifecycle, to: current.lifecycle, revision: current.revision, task: current });
        const item = { taskId, ok: true, revision: current ? current.revision : result && result.revision, ...clone(result || {}) };
        this.operations.commit(journalId, { afterRevision: current ? current.revision : null, result: item });
        results.push(item);
      } catch (error) {
        const problem = stableError(error);
        try { if (this.operations.get(journalId)) (error.uncertain ? this.operations.uncertain(journalId, problem) : this.operations.fail(journalId, problem)); } catch {}
        results.push({ taskId, ok: false, error: problem });
      }
    }
    const response = { operationId, acceptedAt, results };
    if (idempotencyKey) for (const journalId of journalIds) { try { this.operations.update(journalId, { result: response }); } catch {} }
    return response;
  }

  async _executeOne({ task, command, options, expectedRevision, operationId }) {
    if (expectedRevision !== undefined && Number(expectedRevision) !== Number(task.revision)) throw operationError('REVISION_CONFLICT', '任务状态已变化，请刷新后重试', { taskId: task.id, currentRevision: task.revision });
    if (command === 'start') {
      this._markNative(operationId, { delegated: 'taskService.startOne' });
      const started = await this.taskService.startOne(task, { ...options, expectedRevision });
      const next = this.tasks.mutate(task.id, { expectedRevision: started.revision, reason: 'user-start' }, { userPaused: false, schedulerPaused: false });
      return { task: next };
    }
    if (command === 'pause') {
      this._markNative(operationId, { delegated: 'taskService.pauseOne' });
      const paused = await this.taskService.pauseOne(task, { ...options, expectedRevision });
      const next = this.tasks.mutate(task.id, { expectedRevision: paused.revision, reason: 'user-pause' }, { userPaused: true, schedulerPaused: false });
      return { task: next };
    }
    if (command === 'remove-record') {
      this._markNative(operationId, { delegated: 'taskService.removeRecordCompat' });
      return { task: await this.taskService.removeRecordCompat(task, { ...options, expectedRevision }) };
    }
    return this.operationLock.run(`task:${task.id}`, async () => {
      switch (command) {
        case 'recycle': return this._recycle(task, options, expectedRevision, operationId);
        case 'recover': return this._recover(task, options, expectedRevision, operationId);
        case 'delete-permanently': return this._deletePermanently(task, options, expectedRevision, operationId);
        case 'redownload': return this._redownload(task, options, expectedRevision, operationId);
        case 'rename': return this._rename(task, options, expectedRevision, operationId);
        case 'move': return this._move(task, options, expectedRevision, operationId);
        case 'set-speed-limit': return this._setSpeedLimit(task, options, expectedRevision, operationId);
        case 'update-bt-selection': return this._updateBtSelection(task, options, expectedRevision, operationId);
        case 'set-bt-scheduler': return this._setBtScheduler(task, options, expectedRevision, operationId);
        case 'open': return this._open(task, options, operationId, false);
        case 'show-in-folder': return this._open(task, options, operationId, true);
        case 'copy-info': return this._copyInfo(task);
        default: throw operationError('UNSUPPORTED_COMMAND', `不支持任务命令: ${command}`);
      }
    });
  }

  async _deleteFiles(task) {
    if (!this.fileOperations) throw operationError('FILE_OPERATION_UNAVAILABLE', '文件操作服务不可用');
    const before = this.fileOperations.snapshotTaskFiles(task);
    return this.fileOperations.deleteTaskFiles(task, { before });
  }

  async _recycle(task, options, expectedRevision, operationId) {
    if (task.lifecycle === 'recycled') return { task };
    await this.taskService.vip.disableTask(task.id, { reason: 'recycle' }).catch(() => {});
    if (['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle) && Number.isSafeInteger(task.engineId) && task.engineId > 0) await this.driver.stopTasks([task.engineId]);
    let identityPreserved = false;
    if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && this._hasNative('recycle', 'recycleTask')) {
      await this.driver.recycleTask(task.engineId);
      this._markNative(operationId, { engineId: task.engineId, capability: 'recycle' });
      identityPreserved = true;
    } else {
      if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && typeof this.driver.deleteTasks === 'function') await this.driver.deleteTasks([task.engineId]);
      else if (Number.isSafeInteger(task.engineId) && task.engineId > 0) throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', '任务删除 native 能力不可用');
      this._markNative(operationId, { fallback: 'logical-recycle', engineId: task.engineId || null });
    }
    let fileResult = null;
    if (options.deleteLocalFiles === true) { fileResult = await this._deleteFiles(task); this._markFilesystem(operationId, fileResult); }
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'recycle' }, { lifecycle: 'recycled', recycledAt: this._now(), downloadBytesPerSecond: 0, ...(identityPreserved ? {} : { engineId: null }) });
    if (task.seedRef && !identityPreserved) this.seedStore?.release?.(task.seedRef, `task:${task.id}`);
    return { revision: next.revision, identityPreserved, deletedLocal: !!(fileResult && fileResult.deleted) };
  }

  async _recreate(task, options, { allowExistingTarget = false } = {}) {
    if (!this.createTaskService) throw operationError('CREATE_SERVICE_UNAVAILABLE', '任务重建服务不可用');
    const createOptions = { startMode: options.start === true ? undefined : 'queued', allowExistingTarget, ...(task.btScheduler ? { btScheduler: task.btScheduler } : {}), ...(task.legacy && task.legacy.ftpSecretRef ? { ftpSecretRef: task.legacy.ftpSecretRef } : {}) };
    if (task.kind === 'bt' || (task.kind === 'magnet' && task.seedRef && task.files && task.files.length)) {
      if (!this.seedStore && /^sha256:/i.test(String(task.seedRef || ''))) throw operationError('SEED_STORE_UNAVAILABLE', 'BT 种子存储不可用');
      const torrentInput = this.seedStore && /^sha256:/i.test(String(task.seedRef || '')) ? this.seedStore.resolve(task.seedRef) : task.seedRef;
      return this.createTaskService.createTorrentCompat({ torrentInput, savePath: task.savePath, displayName: task.displayName, selectedFileIndices: task.selectedFileIndices, options: createOptions, allowDuplicate: true, source: task.source, sourceFingerprintOverride: task.sourceFingerprint, taskKindOverride: task.kind });
    }
    if (task.kind === 'magnet') return this.createTaskService.createMagnetCompat({ source: task.source, savePath: task.savePath, displayName: task.displayName, selectedFileIndices: task.selectedFileIndices, options: createOptions, allowDuplicate: true });
    if (!task.source) throw operationError('SOURCE_UNAVAILABLE', '任务没有可重建的来源');
    return this.createTaskService.createUriCompat({ source: task.source, savePath: task.savePath, displayName: task.displayName, selectedFileIndices: task.selectedFileIndices, options: createOptions, allowDuplicate: true, sourceFingerprintOverride: task.sourceFingerprint, taskKindOverride: task.kind });
  }

  async _replaceBtNativeTask(task, replacementInput, options, expectedRevision, operationId) {
    await this.taskService.vip.disableTask(task.id, { reason: 'bt-recreate' }).catch(() => {});
    await this.driver.stopTasks([task.engineId]);
    if (typeof this.driver.deleteTasks !== 'function') throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', 'BT 重建需要 native 删除任务能力');
    await this.driver.deleteTasks([task.engineId]);
    this._markNative(operationId, { fallback: 'remove-and-recreate', removedEngineId: task.engineId });
    const start = !['queued', 'paused'].includes(task.lifecycle);
    let replacementTaskId;
    try {
      replacementTaskId = await this._recreate(replacementInput, { ...options, start }, { allowExistingTarget: true });
    } catch (error) {
      const current = this.tasks.get(task.id);
      if (current && current.revision === task.revision) this.tasks.mutate(task.id, { expectedRevision, reason: 'bt-recreate-failed' }, { lifecycle: 'failed', engineId: null, downloadBytesPerSecond: 0, error: mapNativeError(error.message, { code: 'BT_RECREATE_FAILED', category: 'engine', retryable: true, actions: ['retry', 'diagnose'] }) });
      throw operationError('BT_RECREATE_FAILED', `BT 任务重建失败: ${error.message}`, { taskId: task.id });
    }
    const replacement = this.tasks.get(String(replacementTaskId));
    if (replacement && task.lifecycle === 'paused') this.tasks.mutate(replacement.id, { expectedRevision: replacement.revision, reason: 'preserve-user-pause' }, { lifecycle: 'paused', userPaused: true, schedulerPaused: false });
    else if (!start) this._announceReplacement(String(replacementTaskId));
    return String(replacementTaskId);
  }

  async _recover(task, options, expectedRevision, operationId) {
    if (task.lifecycle !== 'recycled') throw operationError('INVALID_TASK_STATE', '只有回收站任务可以恢复');
    if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && this._hasNative('recover', 'recoverTask')) {
      await this.driver.recoverTask(task.engineId);
      this._markNative(operationId, { engineId: task.engineId, capability: 'recover' });
      const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'recover' }, { lifecycle: options.start === true ? 'queued' : 'paused', recycledAt: null, error: null });
      if (options.start === true) await this.driver.startTasks([task.engineId]);
      return { revision: next.revision, identityPreserved: true };
    }
    if (options.allowRecreateFallback !== true) throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', '恢复需要 native recover 能力或显式允许来源重建');
    const replacementTaskId = await this._recreate(task, options, { allowExistingTarget: true });
    this._markNative(operationId, { fallback: 'recreate', replacementTaskId });
    if (options.start !== true) this._announceReplacement(replacementTaskId);
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'recover-fallback' }, { legacy: { ...(task.legacy || {}), supersededBy: String(replacementTaskId) } });
    return { revision: next.revision, replacementTaskId: String(replacementTaskId), identityPreserved: false };
  }

  async _deletePermanently(task, options, expectedRevision, operationId) {
    // C1（产品化 2026-09-23）：failed 任务（如 208/引擎失败残留）此前必须先 recycle
    // 再 delete 两步，直接 delete 返回 ok 但行不消失。failed 行同样允许彻底删除——
    // 与 recycled 共用同一删除路径（native deleteTasks + 行删除）。
    if (!['recycled', 'failed'].includes(task.lifecycle)) throw operationError('INVALID_TASK_STATE', '只有回收站或失败任务可以彻底删除');
    if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && typeof this.driver.deleteTasks === 'function') { await this.driver.deleteTasks([task.engineId]); this._markNative(operationId, { engineId: task.engineId, capability: 'delete' }); }
    let fileResult = null;
    let localFileError = null;
    if (options.deleteLocalFiles === true) {
      try {
        fileResult = await this._deleteFiles(task);
        this._markFilesystem(operationId, fileResult);
      } catch (error) {
        // 旧任务可能保存了当前安全下载根目录之外的路径。SafePathResolver
        // 仍然拒绝删除该路径，但清空回收站不能被单条旧记录阻塞。
        if (!(options.skipUnsafeLocalFiles === true && error && error.code === 'UNSAFE_PATH')) throw error;
        localFileError = stableError(error);
        this._markFilesystem(operationId, { skipped: true, reason: localFileError });
      }
    }
    const deleted = this.tasks.deletePermanently(task.id, { expectedRevision });
    if (!deleted) throw operationError('TASK_NOT_FOUND', '任务不存在或已被删除');
    if (this.eventBus) this.eventBus.emit('task.deleted', { taskId: task.id, from: task.lifecycle, to: 'deleted', revision: task.revision + 1, task: { ...task, lifecycle: 'recycled', revision: task.revision + 1 } });
    if (task.seedRef) this.seedStore?.release?.(task.seedRef, `task:${task.id}`);
    const ftpSecretRef = task.legacy && task.legacy.ftpSecretRef;
    if (ftpSecretRef && !this.tasks.list().some((item) => item.legacy && item.legacy.ftpSecretRef === ftpSecretRef)) this.ftpSecrets?.delete?.(ftpSecretRef);
    return { deleted: true, deletedLocal: !!(fileResult && fileResult.deleted), ...(localFileError ? { localFileError } : {}) };
  }

  async _redownload(task, options, expectedRevision, operationId) {
    if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle)) await this.driver.stopTasks([task.engineId]);
    if (options.deleteLocalFiles === true) { const fileResult = await this._deleteFiles(task); this._markFilesystem(operationId, fileResult); }
    if (Number.isSafeInteger(task.engineId) && task.engineId > 0 && this._hasNative('redownload', 'redownloadTask')) {
      const accepted = await this.driver.redownloadTask(task.engineId, { deleteLocal: options.deleteLocalFiles === true });
      this._markNative(operationId, { engineId: task.engineId, capability: 'redownload' });
      const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'redownload' }, { lifecycle: 'queued', error: null, completedBytes: 0, completedAt: null, recycledAt: null });
      return { revision: next.revision, identityPreserved: accepted && accepted.accepted !== false };
    }
    const replacementTaskId = await this._recreate(task, options, { allowExistingTarget: options.deleteLocalFiles === true });
    this._markNative(operationId, { fallback: 'recreate', replacementTaskId });
    if (options.start !== true) this._announceReplacement(replacementTaskId);
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'redownload-fallback' }, { lifecycle: 'recycled', recycledAt: this._now(), engineId: null, legacy: { ...(task.legacy || {}), supersededBy: String(replacementTaskId) } });
    return { revision: next.revision, replacementTaskId: String(replacementTaskId), identityPreserved: false };
  }

  async _pauseForFileOperation(task, expectedRevision) {
    if (task.lifecycle !== 'downloading') return { task, resume: false };
    const paused = await this.taskService.pauseOne(task, { expectedRevision });
    return { task: paused, resume: true };
  }

  async _resumeFileOperation(state) {
    if (!state.resume || !Number.isSafeInteger(state.task.engineId) || state.task.engineId <= 0) return state.task;
    await this.driver.startTasks([state.task.engineId]);
    return this.tasks.mutate(state.task.id, { expectedRevision: state.task.revision, reason: 'operation-resume' }, { lifecycle: 'queued' });
  }

  async _rename(task, options, expectedRevision, operationId) {
    if (task.lifecycle === 'recycled') throw operationError('INVALID_TASK_STATE', '回收站任务不能重命名');
    const displayName = this.pathService ? this.pathService.validateDisplayName(options.displayName) : String(options.displayName || '').trim();
    if (!displayName) throw operationError('INVALID_NAME', '文件名无效');
    if (displayName === task.displayName) return { revision: task.revision };
    const state = await this._pauseForFileOperation(task, expectedRevision);
    try {
      const before = this.fileOperations.snapshotTaskFiles(state.task);
      const fileResult = this.fileOperations.renameTaskFile(state.task, displayName, { before });
      this._markFilesystem(operationId, fileResult);
      const renamed = this.tasks.mutate(task.id, { expectedRevision: state.task.revision, reason: 'rename' }, { displayName });
      const resumed = await this._resumeFileOperation({ task: renamed, resume: state.resume });
      return { revision: resumed.revision, displayName };
    } catch (error) {
      if (state.resume) await this._resumeFileOperation(state).catch(() => {});
      throw error;
    }
  }

  async _move(task, options, expectedRevision, operationId) {
    if (task.lifecycle === 'recycled') throw operationError('INVALID_TASK_STATE', '回收站任务不能移动');
    if (!this.fileOperations || !this.pathService) throw operationError('FILE_OPERATION_UNAVAILABLE', '文件操作服务不可用');
    const targetDirectory = this.pathService.normalizeDownloadPath(options.targetDirectory);
    const validation = this.pathService.validateDownloadTarget({ path: targetDirectory });
    if (!validation.writable) throw operationError('INVALID_PATH', '目标目录不可写');
    const state = await this._pauseForFileOperation(task, expectedRevision);
    try {
      const before = this.fileOperations.snapshotTaskFiles(state.task);
      const fileResult = this.fileOperations.moveTaskFiles(state.task, targetDirectory, { before });
      this._markFilesystem(operationId, fileResult);
      const moved = this.tasks.mutate(task.id, { expectedRevision: state.task.revision, reason: 'move' }, { savePath: targetDirectory });
      const resumed = await this._resumeFileOperation({ task: moved, resume: state.resume });
      return { revision: resumed.revision, savePath: targetDirectory };
    } catch (error) {
      if (state.resume) await this._resumeFileOperation(state).catch(() => {});
      throw error;
    }
  }

  async _setSpeedLimit(task, options, expectedRevision, operationId) {
    const value = options.speedLimitBytesPerSecond === null || options.speedLimitBytesPerSecond === undefined ? 0 : Number(options.speedLimitBytesPerSecond);
    if (!Number.isSafeInteger(value) || value < 0) throw operationError('INVALID_SPEED_LIMIT', '限速必须是非负整数');
    if (!Number.isSafeInteger(task.engineId) || task.engineId <= 0 || !this._hasNative('perTaskRateLimit', 'setTaskSpeedLimit')) throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', '单任务限速 native 能力不可用');
    await this.driver.setTaskSpeedLimit(task.engineId, value);
    this._markNative(operationId, { engineId: task.engineId, bytesPerSecond: value });
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'set-speed-limit' }, { taskSpeedLimit: value || null });
    return { revision: next.revision, speedLimitBytesPerSecond: value || null };
  }

  _assertBtTask(task) {
    if (!['bt', 'magnet'].includes(task.kind)) throw operationError('INVALID_TASK_KIND', '只有 BT 任务支持该操作');
  }

  async _updateBtSelection(task, options, expectedRevision, operationId) {
    this._assertBtTask(task);
    const selected = Array.isArray(options.selectedFileIndices) ? [...new Set(options.selectedFileIndices)].sort((a, b) => a - b) : [];
    const known = new Set((task.files || []).map((file) => Number(file.index)));
    if (!selected.length || selected.some((index) => !known.has(index))) throw operationError('INVALID_BT_SELECTION', 'BT 文件选择无效');
    if (!Number.isSafeInteger(task.engineId) || task.engineId <= 0) throw operationError('ENGINE_TASK_MISSING', 'BT 引擎任务不存在');
    if (!this._hasNative('bt.updateSelection', 'updateBtSelection')) {
      if (options.allowRecreateFallback !== true) throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', 'BT 文件选择 native 能力不可用；如需停止并复用现有文件，请显式允许重建');
      const replacementTaskId = await this._replaceBtNativeTask(task, { ...task, selectedFileIndices: selected }, options, expectedRevision, operationId);
      this._markNative(operationId, { fallback: 'recreate-reuse-files', replacementTaskId, selectedFileIndices: selected });
      const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'update-bt-selection-fallback' }, { lifecycle: 'recycled', recycledAt: this._now(), engineId: null, selectedFileIndices: selected, legacy: { ...(task.legacy || {}), supersededBy: String(replacementTaskId), reusedFiles: true } });
      if (task.seedRef) this.seedStore?.release?.(task.seedRef, `task:${task.id}`);
      return { revision: next.revision, replacementTaskId: String(replacementTaskId), identityPreserved: false, selectedFileIndices: selected };
    }
    await this.driver.updateBtSelection(task.engineId, selected);
    this._markNative(operationId, { engineId: task.engineId, selectedFileIndices: selected });
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'update-bt-selection' }, { selectedFileIndices: selected });
    return { revision: next.revision, selectedFileIndices: selected };
  }

  async _setBtScheduler(task, options, expectedRevision, operationId) {
    this._assertBtTask(task);
    if (!['normal', 'sequential'].includes(options.btScheduler)) throw operationError('INVALID_BT_SCHEDULER', 'BT 调度策略无效');
    if (!Number.isSafeInteger(task.engineId) || task.engineId <= 0) throw operationError('ENGINE_TASK_MISSING', 'BT 引擎任务不存在');
    if (!this._hasNative('bt.sequential', 'setBtScheduler')) {
      if (options.allowRecreateFallback !== true) throw operationError('NATIVE_CAPABILITY_UNAVAILABLE', 'BT 调度策略 native 能力不可用；如需停止并重建，请显式允许重建');
      const replacementTaskId = await this._replaceBtNativeTask(task, { ...task, btScheduler: options.btScheduler }, options, expectedRevision, operationId);
      this._markNative(operationId, { fallback: 'recreate-reuse-files', replacementTaskId, btScheduler: options.btScheduler });
      const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'set-bt-scheduler-fallback' }, { lifecycle: 'recycled', recycledAt: this._now(), engineId: null, btScheduler: options.btScheduler, legacy: { ...(task.legacy || {}), supersededBy: String(replacementTaskId), reusedFiles: true } });
      if (task.seedRef) this.seedStore?.release?.(task.seedRef, `task:${task.id}`);
      return { revision: next.revision, replacementTaskId: String(replacementTaskId), identityPreserved: false, btScheduler: options.btScheduler };
    }
    await this.driver.setBtScheduler(task.engineId, options.btScheduler);
    this._markNative(operationId, { engineId: task.engineId, scheduler: options.btScheduler });
    const next = this.tasks.mutate(task.id, { expectedRevision, reason: 'set-bt-scheduler' }, { btScheduler: options.btScheduler });
    return { revision: next.revision, btScheduler: options.btScheduler };
  }

  async _open(task, options, operationId, showFolder) {
    if (!this.systemIntegration) throw operationError('SYSTEM_INTEGRATION_UNAVAILABLE', '系统集成服务不可用');
    const method = showFolder ? 'showInFolder' : 'open';
    const result = await this.systemIntegration[method](task, { fileIndex: options.fileIndex });
    this._markNative(operationId, { system: method });
    return { opened: true, ...clone(result || {}) };
  }

  _copyInfo(task) {
    return { taskId: task.id, source: task.source, displayName: task.displayName, savePath: task.savePath, kind: task.kind, infoHash: task.infoHash || task.legacy && task.legacy.infoHash || null };
  }

  getOperation(operationId) { return this.operations.get(operationId); }
  listRecoverableOperations() { return this.operations.listRecoverable(); }
  recoverPendingOperations() { return this.listRecoverableOperations(); }

  async emptyTrash({ taskIds = null, deleteLocalFiles = false, idempotencyKey } = {}) {
    const ids = Array.isArray(taskIds) && taskIds.length
      ? [...new Set(taskIds.map(String).filter(Boolean))]
      : this.tasks.list().filter((task) => task.lifecycle === 'recycled').map((task) => task.id);
    if (!ids.length) return { operationId: this._operationId(), acceptedAt: this._now(), results: [] };
    const responses = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const chunk = ids.slice(offset, offset + 200);
      const chunkKey = idempotencyKey
        ? ids.length <= 200 ? String(idempotencyKey) : `${String(idempotencyKey)}:part:${Math.floor(offset / 200) + 1}`
        : undefined;
      responses.push(await this.execute({ taskIds: chunk, command: 'delete-permanently', options: { deleteLocalFiles: deleteLocalFiles === true, skipUnsafeLocalFiles: deleteLocalFiles === true }, idempotencyKey: chunkKey }));
    }
    return {
      operationId: responses.map((response) => response.operationId).join(','),
      acceptedAt: responses[0].acceptedAt,
      results: responses.flatMap((response) => response.results),
    };
  }
}

module.exports = { TaskOperationService, TASK_COMMANDS, operationError, stableError };
