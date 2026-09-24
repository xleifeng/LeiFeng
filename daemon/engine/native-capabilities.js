'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'native-capabilities.json'), 'utf8')); } catch { return null; }
}

function applyBaseline(value, baseline) {
  if (!baseline || !baseline.flat) return value;
  const flat = { ...value.flat };
  for (const [name, state] of Object.entries(flat)) {
    if (baseline.flat[name] && state !== 'missing') flat[name] = baseline.flat[name] === 'verified' ? 'verified' : baseline.flat[name];
  }
  const nested = JSON.parse(JSON.stringify(value));
  const links = [
    ['startPause', 'task', 'startPause'], ['recycle', 'task', 'recycle'], ['recover', 'task', 'recover'], ['rename', 'task', 'rename'], ['move', 'task', 'move'], ['redownload', 'task', 'redownload'], ['perTaskRateLimit', 'task', 'perTaskRateLimit'],
    ['bt.updateSelection', 'bt', 'updateSelection'], ['bt.sequential', 'bt', 'sequential'], ['bt.getFileRuntime', 'bt', 'getFileRuntime'], ['bt.getSeed', 'bt', 'getSeed'],
    ['network.globalRateLimit', 'network', 'globalRateLimit'], ['network.proxy', 'network', 'proxy'], ['network.proxyVerify', 'network', 'proxyVerify'], ['network.p2pSwitch', 'network', 'p2pSwitch'], ['network.p2sSwitch', 'network', 'p2sSwitch'], ['network.autoMoveLowSpeed', 'network', 'autoMoveLowSpeed'], ['account.taskVip', 'account', 'taskVip'],
  ];
  for (const [flatName, group, name] of links) if (flat[flatName] !== 'missing') nested[group][name] = flat[flatName];
  nested.flat = flat;
  return nested;
}

function methodState(target, path) {
  const parts = String(path).split('.');
  let current = target;
  for (const part of parts) {
    if (!current) return 'missing';
    current = current[part];
  }
  return typeof current === 'function' ? 'present' : current === true ? 'present' : 'missing';
}

function detectNativeCapabilities({ tm, NativeTaskInterface, NativeDkHelper, sdkVersion } = {}) {
  const task = {
    create: 'present',
    startPause: methodState(tm, 'batchStartTasks') === 'present' && methodState(tm, 'batchStopTasks') === 'present' ? 'present' : 'missing',
    recycle: methodState(tm, 'batchRecycleTasks'),
    recover: methodState(tm, 'batchRecoverTasks'),
    rename: methodState(tm, 'renameTask'),
    move: methodState(tm, 'moveTask'),
    redownload: methodState(tm, 'reDownload'),
    perTaskRateLimit: methodState(tm, 'setTaskDownloadSpeedLimit'),
  };
  const bt = {
    updateSelection: methodState(tm, 'updateBtSubFileDownload'),
    sequential: methodState(tm, 'updateBtSubFileScheduler'),
    getFileRuntime: methodState(NativeTaskInterface, 'toTaskExtra'),
    getSeed: methodState(tm, 'getTaskSeedFile'),
  };
  const network = {
    globalRateLimit: methodState(tm, 'updateDownloadSpeedLimit'),
    proxy: methodState(tm, 'setProxy'),
    proxyVerify: methodState(NativeDkHelper, 'proxyVerify') === 'present' ? 'present' : methodState(tm, 'proxyVerify'),
    p2pSwitch: methodState(tm, 'setP2pChannelSwitch'),
    p2sSwitch: methodState(tm, 'setP2sChannelSwitch'),
    autoMoveLowSpeed: methodState(tm, 'setAutoMoveLowSpeedTaskSwitch'),
  };
  const account = { taskVip: methodState(NativeTaskInterface, 'enableDcdnWithVipCert') };
  const parser = { torrent: methodState(NativeDkHelper, 'parseBtTaskInfo'), magnet: methodState(NativeDkHelper, 'parseMagnetUrl') };
  const result = {
    sdkVersion: sdkVersion || null,
    task,
    bt,
    network,
    account,
    parser,
    flat: {
      startPause: task.startPause,
      recycle: task.recycle,
      recover: task.recover,
      rename: task.rename,
      move: task.move,
      redownload: task.redownload,
      perTaskRateLimit: task.perTaskRateLimit,
      'bt.updateSelection': bt.updateSelection,
      'bt.sequential': bt.sequential,
      'bt.getFileRuntime': bt.getFileRuntime,
      'bt.getSeed': bt.getSeed,
      'network.globalRateLimit': network.globalRateLimit,
      'network.proxy': network.proxy,
      'network.proxyVerify': network.proxyVerify,
      'network.p2pSwitch': network.p2pSwitch,
      'network.p2sSwitch': network.p2sSwitch,
      'network.autoMoveLowSpeed': network.autoMoveLowSpeed,
      'account.taskVip': account.taskVip,
    },
  };
  const baseline = loadBaseline();
  return applyBaseline(result, baseline && baseline.sdkVersions && baseline.sdkVersions[sdkVersion]);
}

module.exports = { methodState, detectNativeCapabilities, loadBaseline, applyBaseline };
