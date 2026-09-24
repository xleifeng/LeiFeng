'use strict';

function methodAvailable(runtime, name) {
  if (!runtime || !runtime.native) return false;
  const value = runtime.native[name];
  return value === true || value === 'verified' || value === 'present';
}

function computeTaskCapabilities(record = {}, runtime = {}) {
  const lifecycle = record.lifecycle || record.status;
  const terminal = lifecycle === 'completed' || lifecycle === 'complete' || lifecycle === 'failed' || lifecycle === 'error' || lifecycle === 'missing';
  const active = lifecycle === 'downloading' || lifecycle === 'active';
  const paused = lifecycle === 'paused';
  const recycled = lifecycle === 'recycled' || lifecycle === 'removed';
  const sourcePresent = [record.source, record.url, record.seedRef].some((value) => typeof value === 'string' && value.length > 0);
  const btTask = record.kind === 'bt' || record.kind === 'magnet' || record.taskType === 'bt' || record.taskType === 'magnet';
  const enginePresent = Number.isSafeInteger(Number(record.engineId)) && Number(record.engineId) > 0;
  const startable = ['preparing', 'metadata', 'queued', 'paused'].includes(lifecycle);
  const btMutable = ['preparing', 'metadata', 'queued', 'downloading', 'active', 'paused'].includes(lifecycle);
  const btRecreateReady = btTask && btMutable && enginePresent && sourcePresent && Array.isArray(record.files) && record.files.length > 0;
  const fallback = runtime && runtime.fallbackOperations || {};
  const canFallback = (name) => fallback[name] === true;
  return Object.freeze({
    start: !recycled && startable && enginePresent && methodAvailable(runtime, 'startPause'),
    pause: active && methodAvailable(runtime, 'startPause'),
    removeRecord: !recycled,
    recycle: !recycled && (methodAvailable(runtime, 'recycle') || canFallback('recycle')),
    recover: recycled && (methodAvailable(runtime, 'recover') || canFallback('recover') && sourcePresent),
    retry: terminal && sourcePresent,
    rename: !recycled && (methodAvailable(runtime, 'rename') || canFallback('rename')),
    move: !recycled && (methodAvailable(runtime, 'move') || canFallback('move')),
    redownload: terminal && sourcePresent && (methodAvailable(runtime, 'redownload') || canFallback('redownload')),
    deletePermanently: recycled,
    setSpeedLimit: methodAvailable(runtime, 'perTaskRateLimit') && !recycled,
    updateBtSelection: !recycled && btTask && (methodAvailable(runtime, 'bt.updateSelection') || canFallback('btSelection') && btRecreateReady),
    setBtScheduler: !recycled && btTask && (methodAvailable(runtime, 'bt.sequential') || canFallback('btSequential') && btRecreateReady),
    open: !recycled && canFallback('open'),
    showInFolder: !recycled && canFallback('showInFolder'),
    copyInfo: !recycled && canFallback('copyInfo'),
    perTaskRateLimit: methodAvailable(runtime, 'perTaskRateLimit') && !recycled,
    btSelection: !recycled && btTask && (methodAvailable(runtime, 'bt.updateSelection') || canFallback('btSelection') && btRecreateReady),
    btSequential: !recycled && btTask && (methodAvailable(runtime, 'bt.sequential') || canFallback('btSequential') && btRecreateReady),
  });
}

function computeGlobalCapabilities({ native = {}, environment = {}, protocols = [] } = {}) {
  const has = (name) => native[name] === true || native[name] === 'verified' || native[name] === 'present';
  const fallback = environment.fallbackOperations || {};
  const available = (name) => has(name) || fallback[name] === true;
  return Object.freeze({
    protocols: [...new Set(protocols)],
    taskControl: has('startPause'),
    recycle: available('recycle'),
    recover: available('recover'),
    rename: available('rename'),
    move: available('move'),
    redownload: available('redownload'),
    perTaskRateLimit: has('perTaskRateLimit'),
    btFileSelection: available('btSelection') || has('bt.updateSelection'),
    btSequential: available('btSequential') || has('bt.sequential'),
    globalRateLimit: environment.globalRateLimit !== false,
    proxy: has('network.proxy'),
    proxyVerify: has('network.proxyVerify'),
    p2pSwitch: has('network.p2pSwitch'),
    p2sSwitch: has('network.p2sSwitch'),
    autoMoveLowSpeed: has('network.autoMoveLowSpeed'),
    schedules: environment.schedules !== false,
    idleDownload: environment.idleDownload === true,
    completionActions: environment.completionActions !== false,
    powerActions: environment.powerActions === true,
    linkSync: environment.linkSync || 'local-only',
    superChannel: environment.superChannel === true,
    speedTrial: environment.speedTrial === true,
    openOnHost: environment.openOnHost === true,
    streamInBrowser: environment.streamInBrowser === true,
    remoteNodes: environment.remoteNodes === true,
    cloudDrive: false,
  });
}

module.exports = { computeTaskCapabilities, computeGlobalCapabilities };
