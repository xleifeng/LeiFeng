'use strict';
// thunderd 迅雷原生引擎适配器。由 Wine 或 Windows 原生 Electron-as-Node 承载。
// 协议：TCP 127.0.0.1 JSON-lines。默认禁用 callback API / attach*Event（V8 fatal）。
// BT TaskExtra 只读回调仅在对应 SDK capability 明确标记安全时开放。
const net = require('net');
const path = require('path');
const { createVipHandlers } = require('./vip-control');
const { detectNativeCapabilities } = require('./native-capabilities');
const { createTaskControlHandlers } = require('./task-control');
const { createBtControlHandlers } = require('./bt-control');
const { createNetworkControlHandlers } = require('./network-control');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 0));
const PROFILE = arg('profile', 'Z:\\tmp\\thunderd-runtime');
const ADDON = arg('addon', null) || path.resolve(path.dirname(process.argv[1]), '..\\..\\thunder_x\\program\\dk_addon.node');
if (!PORT) { console.error('[engine] missing --port'); process.exit(1); }

const log = (...a) => console.log('[engine]', ...a);
// 致命遗言：把静默死变成有记录的死（崩溃取证，daemon 侧 [engine-down] 对齐归因）。
process.on('uncaughtException', (e) => { console.error('[engine] fatal uncaughtException:', e && (e.stack || e.message || String(e))); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[engine] fatal unhandledRejection:', e && (e.stack || e.message || String(e))); });
const m = require(ADDON);
let thunderHelper = null;
try {
  // The stock Electron client validates pasted 32/40-character magnet codes
  // with thunder_helper.node before routing them to NativeDkHelper. Keep the
  // same native validator in the Wine engine; the host-side parser only
  // remains a compatibility fallback for environments missing this addon.
  thunderHelper = require(path.join(path.dirname(ADDON), 'thunder_helper.node'));
  log('thunder_helper.node loaded');
} catch (error) {
  log('thunder_helper.node unavailable; hash validation fallback:', String(error && error.message || error));
}

function sdkVersionCode(versionName) {
  const parts = String(versionName || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return 2500821562;
  return Number(parts[0].padStart(2, '0') + parts[1].padStart(2, '0') + parts[2].padStart(2, '0') + parts[3].padStart(4, '0'));
}

const SDK_VERSION_NAME = process.env.THUNDERD_SDK_VERSION_NAME || '25.0.82.1562';
const SDK_VERSION_CODE = Number(process.env.THUNDERD_SDK_VERSION_CODE) || sdkVersionCode(SDK_VERSION_NAME);
const SDK_GUID = String(process.env.THUNDERD_SDK_GUID || '').trim();

// 初始化顺序必须保持为 initAddon → SDK platform → NativeTaskManager → download server。
const INIT_CFG = {
  dbDir: PROFILE + '\\profile', dbName: 'TaskDb.dat', panDstDbName: 'PanUpload.dat',
  logDir: PROFILE + '\\log', dkCfgDir: PROFILE + '\\profile\\dkcfg',
  torrentsCacheDir: PROFILE + '\\profile\\Torrents', tempDir: PROFILE + '\\profile\\temp',
  versionName: SDK_VERSION_NAME, versionCode: SDK_VERSION_CODE, appName: 'thunder',
  appKey: 'xzcGMudGh1bmRlclg7MA^^SDK==edee53fd0b15e8d65dbfe7824f5f^a23',
  ...(SDK_GUID ? { guid: SDK_GUID } : {}),
};
log('initAddon ->', String(m.initAddon(INIT_CFG)));
process.env['01KVYZS23XBRBTN7XTFFPAXQNV_SDK_Platform'] = process.env.THUNDERD_SDK_PLATFORM || '64';
const tm = new m.NativeTaskManager();
tm.beginInitDownloadServer();
log('beginInitDownloadServer done; settling 8s before host connect');

// TASKTYPE/CREATORS/validateInfo 与 daemon/test/unit/helpers/fake-engine.js 同构（单测验形状对齐）。
// native 方法需 .bind(tm)。事件与未经逐项验证的 callback API 仍禁止进入生产路径。
const TASKTYPE = { P2SP: 1, BT: 2, EMULE: 3, MAGNET: 5 };
const helper = m.NativeDkHelper;
const vipHandlers = createVipHandlers({ tm, NativeTaskInterface: m.NativeTaskInterface });
const nativeCapabilities = detectNativeCapabilities({ tm, NativeTaskInterface: m.NativeTaskInterface, NativeDkHelper: helper, sdkVersion: INIT_CFG.versionName });
const taskControlHandlers = createTaskControlHandlers({ tm, capabilities: nativeCapabilities });
const btControlHandlers = createBtControlHandlers({ tm, NativeTaskInterface: m.NativeTaskInterface, capabilities: nativeCapabilities });
const networkControlHandlers = createNetworkControlHandlers({ tm, NativeDkHelper: helper, capabilities: nativeCapabilities });
const CREATORS = {
  1: tm.createP2spTask.bind(tm),
  2: tm.createBtTask.bind(tm),
  3: tm.createEmuleTask.bind(tm),
  5: tm.createMagnetTask.bind(tm),
};
function validateInfo(taskType, info) {
  const need = (c, msg) => { if (!c) throw new Error('invalid info: ' + msg); };
  if (!info) throw new Error('invalid info: missing');
  if (taskType === TASKTYPE.BT) {
    need(typeof info.seedFile === 'string' && info.seedFile, 'btInfo.seedFile missing');
    need(info.infoId, 'btInfo.infoId missing');
  } else if (taskType === TASKTYPE.MAGNET) {
    need(typeof info.url === 'string' && info.url, 'magnetInfo.url missing');
    need(typeof info.torrentFilePath === 'string' && info.torrentFilePath, 'magnetInfo.torrentFilePath missing');
  } else if (taskType === TASKTYPE.EMULE) {
    need(typeof info.url === 'string' && info.url, 'emuleInfo.url missing');
  } else if (taskType === TASKTYPE.P2SP) {
    need(typeof info.url === 'string' && info.url, 'p2spInfo.url missing');
  }
}

function taskSnapshot(engineId) {
  const id = Number(engineId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  let nativeTask;
  try { nativeTask = tm.findTaskById(id); } catch { nativeTask = null; }
  if (!nativeTask || !nativeTask.t) return null;
  const task = nativeTask.t;
  let base = null;
  let channelInfo = null;
  let vipSpeed = 0;
  try { base = m.NativeTaskInterface.getTaskBase(task); } catch {}
  try { channelInfo = m.NativeTaskInterface.getAttribute(task, 22); } catch {}
  try { vipSpeed = Number(m.NativeTaskInterface.getAttribute(task, 4)) || 0; } catch {}
  if (!base || typeof base !== 'object') return null;
  return {
    taskId: id,
    status: Number(base.taskStatus) || 0,
    totalReceiveSize: Number(base.downloadSize) || 0,
    resourceSize: Number(base.fileSize) || 0,
    failureErrorCode: Number(base.errorCode) || 0,
    name: base.taskName || null,
    url: base.url || '',
    cid: base.cid || null,
    gcid: base.gcid || null,
    downloadSpeed: Number(base.downloadSpeed) || 0,
    vipSpeed,
    channelInfo: channelInfo && typeof channelInfo === 'object' ? channelInfo : null,
  };
}

const HANDLERS = {
  ping: () => ({ pong: true, uptimeMs: Math.round(process.uptime() * 1000) }),
  getTaskSnapshots: ({ ids }) => ({ tasks: (Array.isArray(ids) ? ids : []).slice(0, 10000).map(taskSnapshot).filter(Boolean) }),
  normalizeTorrentHash: ({ value }) => {
    const original = String(value || '').trim();
    const hash = original.replace(/^(?:urn:)?btih:/i, '');
    if (!thunderHelper || typeof thunderHelper.isMagnetCode !== 'function') return { accepted: false, native: false };
    let valid = false;
    try { valid = Boolean(thunderHelper.isMagnetCode(hash)); } catch {}
    if (!valid) return { accepted: false, native: true };
    const normalizedSource = `magnet:?xt=urn:btih:${hash}`;
    let taskType = 0;
    try { taskType = Number(helper.getTaskTypeFromUrl(normalizedSource)) || 0; } catch {}
    if (taskType !== TASKTYPE.MAGNET) return { accepted: false, native: true, taskType };
    let parsed = null;
    try { parsed = helper.parseMagnetUrl(normalizedSource); } catch {}
    return {
      accepted: true,
      native: true,
      taskType,
      normalizedSource,
      infoHash: parsed && parsed.infoHash ? String(parsed.infoHash) : hash,
      displayName: parsed && (parsed.displayName || parsed.title) ? String(parsed.displayName || parsed.title) : `${hash}.torrent`,
    };
  },
  createTask: ({ taskType, taskInfo, info }) => {
    const fn = CREATORS[taskType];
    if (!fn) throw new Error('unsupported taskType: ' + taskType);
    taskInfo.taskType = taskType; // 冗余消除：engine 端填 taskType
    validateInfo(taskType, info);
    return { engineId: fn(taskInfo, info) };
  },
  parseTaskInfo: ({ kind, data }) => {
    if (kind === 'torrent') return helper.parseBtTaskInfo(data);
    if (kind === 'magnet') return helper.parseMagnetUrl(data);
    if (kind === 'ed2k') return helper.parserEd2kLink(data);
    if (kind === 'thunder') return { resolvedUrl: helper.parseThunderPrivateUrl(data) };
    if (kind === 'urltype') return { taskType: helper.getTaskTypeFromUrl(data) };
    throw new Error('unknown parse kind: ' + kind);
  },
  startTasks: ({ ids }) => (tm.batchStartTasks(ids), {}),
  stopTasks: ({ ids }) => (tm.batchStopTasks(ids), {}),
  deleteTasks: ({ ids }) => (tm.batchDeleteTasks(ids), {}),
  ...taskControlHandlers,
  ...btControlHandlers,
  getQueueCount: () => ({ count: tm.getDownloadQueueCount() }),
  getDhtNodeCount: () => ({ count: tm.getDhtNodeCount() }),
  getChannelSwitches: () => ({ p2p: tm.isP2pChannelOpen(), p2s: tm.isP2sChannelOpen() }),
  getNativeCapabilities: () => nativeCapabilities,
  ...networkControlHandlers,
  enableVipDcdn: vipHandlers.enableVipDcdn,
  disableVipDcdn: vipHandlers.disableVipDcdn,
  // 登录/登出使用官方同步通知序列，逐步返回失败位置。
  // 纯 Node 模式禁止 callback API / attach*Event；这里只调用已验证安全的同步通知接口。
  notifyAuth: ({ uid, vipStr }) => {
    const steps = [
      ['setUserInfo', () => tm.setUserInfo(String(uid), '')],
      ['setCurrentPanUserId', () => tm.getCategoryManager().setCurrentPanUserId(String(uid))],
      ['setGlobalExtInfo', () => tm.setGlobalExtInfo(String(vipStr), false)],
    ];
    for (const [name, fn] of steps) {
      try { fn(); } catch (e) { return { ok: false, failedStep: name, error: String((e && e.message) || e) }; }
    }
    return { ok: true };
  },
  notifyLogout: () => {
    const steps = [
      ['setUserInfo', () => tm.setUserInfo('', '')],
      ['setCurrentPanUserId', () => tm.getCategoryManager().setCurrentPanUserId('')],
      ['setGlobalExtInfo', () => tm.setGlobalExtInfo('isvip=0,viptype=,viplevel=0,userchannel=', false)],
    ];
    for (const [name, fn] of steps) {
      try { fn(); } catch (e) { return { ok: false, failedStep: name, error: String((e && e.message) || e) }; }
    }
    return { ok: true };
  },
  shutdown: () => (setTimeout(() => process.exit(0), 100), {}),
};

function connect() {
  const sock = net.createConnection({ host: '127.0.0.1', port: PORT }, () => log('connected to host'));
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const h = HANDLERS[msg.method];
      if (!h) { sock.write(JSON.stringify({ id: msg.id, ok: false, error: 'unknown method: ' + msg.method }) + '\n'); continue; }
      Promise.resolve().then(() => h(msg.params || {})).then(
        (result) => sock.write(JSON.stringify({ id: msg.id, ok: true, result }) + '\n'),
        (e) => sock.write(JSON.stringify({ id: msg.id, ok: false, error: String((e && e.message) || e) }) + '\n'));
    }
  });
  sock.on('close', () => { log('host closed; exiting'); process.exit(0); });
  sock.on('error', (e) => { log('socket error', e.message); process.exit(1); });
}

setTimeout(connect, 8000);
