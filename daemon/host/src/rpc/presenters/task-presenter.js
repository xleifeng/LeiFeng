'use strict';

const { computeTaskCapabilities } = require('../../domain/task-capabilities');

const LIST_CAPABILITIES = Object.freeze([
  'start', 'pause', 'removeRecord', 'recycle', 'recover', 'retry', 'rename', 'move',
  'redownload', 'deletePermanently', 'setSpeedLimit', 'updateBtSelection', 'setBtScheduler', 'open', 'showInFolder', 'copyInfo', 'perTaskRateLimit', 'btSelection', 'btSequential',
]);

function etaSeconds(totalBytes, completedBytes, bytesPerSecond) {
  if (bytesPerSecond <= 0 || totalBytes <= completedBytes) return null;
  return Math.ceil((totalBytes - completedBytes) / bytesPerSecond);
}

function presentBadges(task) {
  const badges = [];
  if (task.vip && ['active', 'injected', 'effective'].includes(task.vip.state)) badges.push('vip');
  if (task.privateSpace === true) badges.push('private');
  if (task.remote === true || task.remoteNodeId) badges.push('remote');
  if (task.kind === 'bt' || task.kind === 'magnet') badges.push('bt');
  return badges;
}

function presentTask(task, { includeFiles = false, runtime = {} } = {}) {
  const totalBytes = Math.max(0, Number(task.totalBytes) || 0);
  const observedCompletedBytes = Math.max(0, Number(task.completedBytes) || 0);
  const completedBytes = totalBytes > 0 ? Math.min(totalBytes, observedCompletedBytes) : observedCompletedBytes;
  const dto = {
    taskId: task.id,
    parentId: task.parentId,
    kind: task.kind,
    lifecycle: task.lifecycle,
    source: task.source,
    sourceFingerprint: task.sourceFingerprint,
    displayName: task.displayName,
    savePath: task.savePath,
    totalBytes,
    completedBytes,
    downloadBytesPerSecond: Math.max(0, Number(task.downloadBytesPerSecond) || 0),
    uploadBytesPerSecond: Math.max(0, Number(task.uploadBytesPerSecond) || 0),
    progress: totalBytes > 0 ? Math.min(1, completedBytes / totalBytes) : 0,
    queuePosition: Number(task.queuePosition) || 0,
    taskSpeedLimit: task.taskSpeedLimit === null ? null : Math.max(0, Number(task.taskSpeedLimit) || 0),
    btScheduler: task.btScheduler === 'sequential' ? 'sequential' : 'normal',
    privateSpace: task.privateSpace === true,
    createdAt: Number(task.createdAt) || 0,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    recycledAt: task.recycledAt,
    updatedAt: Number(task.updatedAt) || 0,
    error: task.error || null,
    vip: task.vip || null,
    seedAvailable: typeof task.seedRef === 'string' && task.seedRef.length > 0,
    revision: Number(task.revision) || 1,
    observationRevision: Number(task.observationRevision) || 1,
    fileRevision: Number(task.fileRevision) || 1,
    capabilities: computeTaskCapabilities(task, runtime),
  };
  if (includeFiles) {
    dto.files = (task.files || []).map((file) => ({
      index: Number(file.index) || 0,
      name: file.name || '',
      path: file.path || '',
      size: Math.max(0, Number(file.size) || 0),
      offset: Math.max(0, Number(file.offset) || 0),
      selected: !task.selectedFileIndices.length || task.selectedFileIndices.includes(Number(file.index)),
    }));
  }
  return dto;
}

function presentTaskListItem(task, { runtime = {} } = {}) {
  const totalBytes = Math.max(0, Number(task.totalBytes) || 0);
  const observedCompletedBytes = Math.max(0, Number(task.completedBytes) || 0);
  const completedBytes = totalBytes > 0 ? Math.min(totalBytes, observedCompletedBytes) : observedCompletedBytes;
  const bytesPerSecond = Math.max(0, Number(task.downloadBytesPerSecond) || 0);
  const capabilities = computeTaskCapabilities(task, runtime);
  const group = task.group && typeof task.group === 'object'
    ? { id: String(task.group.id || task.parentId || ''), label: String(task.group.label || task.group.name || '任务组') }
    : task.parentId ? { id: String(task.parentId), label: String(task.groupLabel || '任务组') } : null;
  return {
    taskId: task.id,
    parentTaskId: task.parentId || null,
    kind: ['http', 'https', 'ftp', 'bt', 'magnet', 'ed2k', 'thunder', 'group'].includes(task.kind) ? task.kind : 'http',
    lifecycle: task.lifecycle,
    displayName: String(task.displayName || '未命名任务'),
    totalBytes,
    completedBytes,
    downloadBytesPerSecond: bytesPerSecond,
    uploadBytesPerSecond: Math.max(0, Number(task.uploadBytesPerSecond) || 0),
    progress: totalBytes > 0 ? Math.min(1, completedBytes / totalBytes) : 0,
    etaSeconds: etaSeconds(totalBytes, completedBytes, bytesPerSecond),
    createdAt: Number(task.createdAt) || 0,
    completedAt: task.completedAt === null || task.completedAt === undefined ? null : Number(task.completedAt) || null,
    error: task.error || null,
    group,
    groupResult: task.groupResult || null,
    badges: presentBadges(task),
    capabilities: LIST_CAPABILITIES.filter((name) => capabilities[name]),
    pendingOperation: task.pendingOperation && typeof task.pendingOperation === 'object'
      ? { operationId: String(task.pendingOperation.operationId || ''), command: String(task.pendingOperation.command || '') }
      : null,
    revision: Math.max(1, Number(task.revision) || 1),
    observationRevision: Math.max(1, Number(task.observationRevision) || 1),
  };
}

module.exports = { presentTask, presentTaskListItem, presentBadges, etaSeconds };
