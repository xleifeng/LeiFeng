'use strict';

const LIFECYCLES = Object.freeze([
  'preparing',
  'metadata',
  'queued',
  'downloading',
  'paused',
  'completed',
  'failed',
  'recycled',
  'missing',
]);

const LIFECYCLE_SET = new Set(LIFECYCLES);
const TERMINAL_LIFECYCLES = new Set(['completed', 'failed', 'recycled', 'missing']);

const LEGACY_TO_V2 = Object.freeze({
  active: 'downloading',
  waiting: 'queued',
  paused: 'paused',
  complete: 'completed',
  completed: 'completed',
  error: 'failed',
  failed: 'failed',
  removed: 'recycled',
  recycled: 'recycled',
  preparing: 'preparing',
  metadata: 'metadata',
  queued: 'queued',
  downloading: 'downloading',
  missing: 'missing',
});

// 官方 TaskStatus 全枚举（C-asar main-renderer bundle 还原，TS enum 双向映射）：
// 0 Unkown / 1 StandBy / 2 PreDownloading / 3 StartWaiting / 4 StartPending / 5 Started /
// 6 StopPending / 7 Stopped / 8 Succeeded / 9 Failed / 10 Seeding / 11 DestroyPending / 12 End。
// daemon 已实证：5=downloading/paused 共享（stop_probe）、7=Stopped/初始态、8=完成、9=失败（engine-semantics）。
// 4=StartPending：BT 任务数据面已在飞、引擎状态标签滞后的活跃前置态（真机 5 例 unknown Status:4 全为 BT）。
// 10=Seeding：下载完成转做种，完成事实优先（与 resourceSize≥receivedSize 分支同结论）。
const NATIVE_STATUS = Object.freeze({
  queued: 7,
  downloading: 5,
  startPending: 4,
  completed: 8,
  seeding: 10,
  failed: 9,
});

function normalizeLifecycle(value, fallback = 'queued') {
  const normalized = LEGACY_TO_V2[String(value || '').toLowerCase()];
  return normalized && LIFECYCLE_SET.has(normalized) ? normalized : fallback;
}

function mapLegacyLifecycle(record = {}) {
  const metadataPhase = String(record.metadataPhase || '').toLowerCase();
  if (metadataPhase === 'fetching' || metadataPhase === 'metadata') return 'metadata';
  if (metadataPhase === 'download' && record.status === 'waiting') return 'queued';
  if (record.recycledAt || record.status === 'removed') return 'recycled';
  if (record.errorCode || record.errorMessage) return 'failed';
  return normalizeLifecycle(record.lifecycle || record.status, 'queued');
}

function canTransition(from, to) {
  const source = normalizeLifecycle(from, from);
  const target = normalizeLifecycle(to, to);
  if (!LIFECYCLE_SET.has(source) || !LIFECYCLE_SET.has(target)) return false;
  if (source === target) return true;
  if (source === 'recycled') return target === 'preparing' || target === 'queued';
  if (source === 'completed') return target === 'recycled' || target === 'preparing' || target === 'queued';
  if (source === 'missing') return target === 'preparing' || target === 'recycled' || target === 'queued';
  if (source === 'failed') return target === 'preparing' || target === 'queued' || target === 'recycled' || target === 'missing';
  if (source === 'preparing') return ['metadata', 'queued', 'downloading', 'failed', 'recycled'].includes(target);
  if (source === 'metadata') return ['queued', 'downloading', 'failed', 'recycled', 'missing'].includes(target);
  if (source === 'queued') return ['downloading', 'paused', 'failed', 'completed', 'recycled', 'missing'].includes(target);
  if (source === 'downloading') return ['queued', 'paused', 'completed', 'failed', 'recycled', 'missing'].includes(target);
  if (source === 'paused') return ['queued', 'downloading', 'completed', 'failed', 'recycled', 'missing'].includes(target);
  return false;
}

function assertTransition(from, to, reason = 'unspecified') {
  const source = normalizeLifecycle(from, from);
  const target = normalizeLifecycle(to, to);
  if (!canTransition(source, target)) {
    const error = new Error(`invalid lifecycle transition: ${source} -> ${target}`);
    error.code = 'INVALID_LIFECYCLE_TRANSITION';
    error.details = { from: source, to: target, reason };
    throw error;
  }
  return true;
}

function nativeStatusIsKnown(status) {
  return Object.values(NATIVE_STATUS).includes(Number(status));
}

function reduceObservation(record = {}, observation = {}, now = Date.now()) {
  const current = normalizeLifecycle(record.lifecycle || record.status, 'queued');
  const patch = {
    updatedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
    observationRevision: Math.max(1, Number(record.observationRevision) || 1) + 1,
  };
  const warnings = [];
  const taskDbFound = observation.taskDbFound === true || observation.taskDbFound === undefined && observation.nativeStatus !== undefined;
  const receivedSize = Math.max(0, Number(observation.receivedSize) || 0);
  const resourceSize = Math.max(0, Number(observation.resourceSize) || 0);
  const measuredBps = Math.max(0, Number(observation.measuredDownloadBps) || 0);

  if (observation.receivedSize !== undefined) patch.completedBytes = receivedSize;
  if (observation.resourceSize !== undefined && resourceSize > 0) patch.totalBytes = resourceSize;
  if (observation.measuredDownloadBps !== undefined) patch.downloadBytesPerSecond = measuredBps;
  if (observation.realTaskName && typeof observation.realTaskName === 'string') {
    const name = observation.realTaskName.replace(/\\/g, '/').split('/').pop();
    if (name && name !== '.' && name !== '..') patch.displayName = name;
  }

  // A user pause is authoritative. TaskDb Status=5 is shared by paused and downloading.
  if (current === 'paused') {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: current, transition: false, warnings };
  }

  if (observation.metadataFileReady === false && (current === 'metadata' || record.metadataPhase === 'fetching')) {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'metadata', transition: current !== 'metadata', warnings };
  }

  if (observation.failureErrorCode !== undefined && Number(observation.failureErrorCode) !== 0) {
    patch.error = observation.error || {
      code: String(observation.failureErrorCode),
      nativeCode: Number(observation.failureErrorCode),
      category: 'engine',
      message: '引擎报告任务失败',
      retryable: true,
      actions: ['retry', 'diagnose'],
    };
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'failed', transition: current !== 'failed', warnings };
  }

  // SDK versions observed in the recon keep TaskDb Status=5 after the final
  // bytes arrive. Resource/receive sizes are the stronger completion fact.
  if (resourceSize > 0 && receivedSize >= resourceSize) {
    patch.downloadBytesPerSecond = 0;
    patch.error = null;
    return { patch, lifecycle: 'completed', transition: current !== 'completed', warnings };
  }

  if (Number(observation.nativeStatus) === NATIVE_STATUS.completed ||
      Number(observation.nativeStatus) === NATIVE_STATUS.seeding) {
    patch.downloadBytesPerSecond = 0;
    patch.error = null;
    return { patch, lifecycle: 'completed', transition: current !== 'completed', warnings };
  }

  if (Number(observation.nativeStatus) === NATIVE_STATUS.failed) {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'failed', transition: current !== 'failed', warnings };
  }

  if (observation.fileExists === false && (receivedSize > 0 || current === 'downloading' || current === 'completed')) {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'missing', transition: current !== 'missing', warnings };
  }

  if (observation.nativeStatus !== undefined && !nativeStatusIsKnown(observation.nativeStatus)) {
    warnings.push({ code: 'UNKNOWN_NATIVE_STATUS', nativeStatus: observation.nativeStatus });
  }

  if (current === 'metadata' && !taskDbFound) {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'metadata', transition: false, warnings };
  }

  // 引擎实时报速兜底：TaskDb TotalReceiveSize 冻结时自测增量恒 0，webui 速度
  // 假死、downloading 被误判停滞降级 queued（HANDOVER §5.2）。引擎快照自带
  // downloadSpeed（内存态，不冻结）——自测 0 而引擎报速 >0 时采信引擎值。
  const engineBps = Math.max(0, Number(observation.engineDownloadBps) || 0);
  if (measuredBps > 0 || observation.receivedGrew === true) {
    patch.downloadBytesPerSecond = measuredBps;
    return { patch, lifecycle: 'downloading', transition: current !== 'downloading', warnings };
  }
  if (engineBps > 0) {
    patch.downloadBytesPerSecond = engineBps;
    return { patch, lifecycle: 'downloading', transition: current !== 'downloading', warnings };
  }

  if (current === 'downloading' && observation.stalled === true) {
    patch.downloadBytesPerSecond = 0;
    return { patch, lifecycle: 'queued', transition: true, warnings };
  }

  if (current === 'preparing' || current === 'metadata') {
    return { patch, lifecycle: taskDbFound ? 'queued' : current, transition: taskDbFound && current !== 'queued', warnings };
  }
  // Status=4（StartPending）：引擎标签滞后的活跃前置态。current 已 downloading 时不降级
  // （数据面为准，降级会造成 webui 卡 queued 假象）；queued 等待增长/引擎速度信号再迁移。
  if (Number(observation.nativeStatus) === NATIVE_STATUS.startPending && current === 'downloading') {
    return { patch, lifecycle: 'downloading', transition: false, warnings };
  }
  return { patch, lifecycle: current === 'downloading' ? 'queued' : current, transition: current === 'downloading', warnings };
}

function toLegacyStatus(lifecycle) {
  switch (normalizeLifecycle(lifecycle, lifecycle)) {
    case 'downloading': return 'active';
    case 'queued':
    case 'preparing':
    case 'metadata': return 'waiting';
    case 'paused': return 'paused';
    case 'completed': return 'complete';
    case 'recycled': return 'removed';
    case 'failed':
    case 'missing': return 'error';
    default: return 'waiting';
  }
}

function isTerminalLifecycle(value) {
  return TERMINAL_LIFECYCLES.has(normalizeLifecycle(value, value));
}

module.exports = {
  LIFECYCLES,
  TERMINAL_LIFECYCLES,
  NATIVE_STATUS,
  normalizeLifecycle,
  mapLegacyLifecycle,
  canTransition,
  assertTransition,
  reduceObservation,
  toLegacyStatus,
  isTerminalLifecycle,
};
