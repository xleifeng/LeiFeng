'use strict';
// 假引擎：两种运行模式共用同一 HANDLERS 表
//
// 模式 A：子进程（driver.test 用）—— wine thunder.exe engine.js … 的替身。
//   node fake-engine.js --port <port>  连接宿主监听端口，应答线协议。
//   环境变量用于覆盖超时、业务错误和通知失败等测试路径：
//     FAKE_HANG_ON=<method>   该方法永不应答（模拟 hang，触发 _call 超时）
//     FAKE_ERROR_ON=<method>  该方法返回 ok:false error:'boom'（模拟业务错误）
//     FAKE_EXIT_AFTER_MS=<n>  连接建立后 n ms 主动退出（模拟崩溃）
//     FAKE_NOTIFY_LOG=<path>  notifyAuth/notifyLogout 调用落盘该文件（每行一个 JSON）
//     FAKE_FAIL_NOTIFY_STEP=<step>  notifyAuth 该步返回 ok:false failedStep=<step>
//
// 模式 B：模块 require（engine-task-creation.test 使用）——不起 Wine，进程内 TCP server。
//   const { startFakeEngine } = require('./helpers/fake-engine');
//   const fx = await startFakeEngine();
//   fx.call('createTask', {...}) → 返回 result（reject on ok:false）
//   fx.TASKTYPE / fx.CREATORS / fx.state.createCalls / fx.state.parseCalls 供测
//   fx.server.close() 释放。
const net = require('net');
const fs = require('fs');
const { duplexPair } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createVipHandlers } = require('../../../engine/vip-control');
const { createTaskControlHandlers } = require('../../../engine/task-control');
const { createBtControlHandlers } = require('../../../engine/bt-control');

// ---- TASKTYPE/CREATORS/validateInfo/parseTaskInfo（与 engine.js 同构） ----
const TASKTYPE = { P2SP: 1, BT: 2, EMULE: 3, MAGNET: 5 };
let _idCounter = 100000000;
// CREATORS 模拟 native create*Task：接收 (taskInfo, info) 返回 engineId（正整数）
const CREATORS = {
  1: (_ti, _info) => ++_idCounter, // createP2spTask
  2: (_ti, _info) => ++_idCounter, // createBtTask
  3: (_ti, _info) => ++_idCounter, // createEmuleTask
  5: (_ti, _info) => ++_idCounter, // createMagnetTask
};
function validateInfo(taskType, info) {
  const need = (c, m) => { if (!c) throw new Error('invalid info: ' + m); };
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
// PARSE 模拟 NativeDkHelper 的五个 parse 方法
const PARSE = {
  torrent: (_d) => ({
    infoId: 'ABC123', title: 'fake', trackerUrls: [],
    fileLists: [{ fileSize: 1024, realIndex: 0, fileOffset: 0, fileName: 'f.bin', filePath: '' }],
  }),
  magnet: (d) => ({ url: d, infoHash: 'HASH', displayName: 'f', trackerUrls: [] }),
  ed2k: (_d) => ({ fileSize: 1, fileName: 'f', fileHash: 'H' }),
  thunder: (_d) => ({ resolvedUrl: 'http://resolved' }),
  urltype: (d) => ({ taskType: String(d).startsWith('magnet') ? 5 : String(d).startsWith('ed2k') ? 3 : 1 }),
};

// ---- HANDLERS（两种模式共用） ----
// 子进程模式专属：env 驱动的 hang/error/notify-log 逻辑只在模式 A 注入；模式 B 走裸 HANDLERS。
// 因此把 HANDLERS 拆成两部分：baseHandlers（纯函数逻辑，模式 B 直接用）+
// wrapForChild(base, envOpts)（模式 A 套上 hang/error/notify 等副作用）。
const state = { createCalls: [], parseCalls: [], vipCalls: [], taskCalls: [] };
const fakeTaskManager = {
  findTaskById: (id) => ({ t: { id } }),
  batchRecycleTasks: (ids) => state.taskCalls.push(['recycle', ids]),
  batchRecoverTasks: (ids) => state.taskCalls.push(['recover', ids]),
  reDownload: (task, deleteLocal) => state.taskCalls.push(['redownload', task.id, deleteLocal]),
  renameTask: (task, displayName) => state.taskCalls.push(['rename', task.id, displayName]),
  moveTask: (task, targetPath) => state.taskCalls.push(['move', task.id, targetPath]),
  setTaskDownloadSpeedLimit: (task, limit) => state.taskCalls.push(['speed', task.id, limit]),
  updateBtSubFileDownload: (task, selected) => state.taskCalls.push(['selection', task.id, selected]),
  updateBtSubFileScheduler: (task, scheduler) => state.taskCalls.push(['scheduler', task.id, scheduler]),
  getTaskSeedFile: (task) => `seed-${task.id}`,
};
const fakeNativeTaskInterface = {
  toTaskExtra: (task) => ({
    waitLoadBtFileFinish: (callback) => callback(),
    getBtFileInfos: (callback) => callback([{ realIndex: task.id, state: 'queued' }]),
  }),
};
const fakeTaskCapabilities = { flat: {
  recycle: 'verified', recover: 'verified', redownload: 'verified', rename: 'verified', move: 'verified', perTaskRateLimit: 'verified',
  'bt.updateSelection': 'verified', 'bt.sequential': 'verified', 'bt.getFileRuntime': 'verified', 'bt.getSeed': 'verified',
} };
const vipHandlers = createVipHandlers({
  tm: { findTaskById: (id) => ({ t: `handle-${id}` }) },
  NativeTaskInterface: {
    enableDcdnWithVipCert: (handle, token, fileIndex) => { state.vipCalls.push({ op: 'enable', handle, fileIndex, tokenLength: token.length }); },
    disableDcdnWithVipCert: (handle, fileIndex) => { state.vipCalls.push({ op: 'disable', handle, fileIndex }); },
  },
});
const taskControlHandlers = createTaskControlHandlers({ tm: fakeTaskManager, capabilities: fakeTaskCapabilities });
const btControlHandlers = createBtControlHandlers({ tm: fakeTaskManager, NativeTaskInterface: fakeNativeTaskInterface, capabilities: fakeTaskCapabilities });

const baseHandlers = {
  ping: () => ({ pong: true, uptimeMs: 1 }),
  normalizeTorrentHash: ({ value }) => {
    const hash = String(value || '').trim().replace(/^(?:urn:)?btih:/i, '');
    const accepted = /^[A-Za-z0-9]{32}$/.test(hash) || /^[A-Za-z0-9]{40}$/.test(hash);
    return accepted ? { accepted: true, native: true, taskType: 5, normalizedSource: `magnet:?xt=urn:btih:${hash}`, infoHash: hash, displayName: `${hash}.torrent` } : { accepted: false, native: true };
  },
  createTask: ({ taskType, taskInfo, info }) => {
    const fn = CREATORS[taskType];
    if (!fn) throw new Error('unsupported taskType: ' + taskType);
    taskInfo.taskType = taskType; // 冗余消除：engine 端填 taskType
    validateInfo(taskType, info);
    state.createCalls.push({ taskType, taskInfo, info });
    return { engineId: fn(taskInfo, info) };
  },
  parseTaskInfo: ({ kind, data }) => {
    const fn = PARSE[kind];
    if (!fn) throw new Error('unknown parse kind: ' + kind);
    state.parseCalls.push({ kind, data });
    return fn(data);
  },
  startTasks: () => ({}), stopTasks: () => ({}), deleteTasks: () => ({}),
  getTaskSnapshots: ({ ids }) => ({ tasks: (ids || []).map((taskId) => ({
    taskId, status: 5, totalReceiveSize: 128, resourceSize: 1024,
    failureErrorCode: 0, name: `task-${taskId}.bin`, url: 'http://fixture',
    cid: 'CID', gcid: 'GCID', downloadSpeed: 64, vipSpeed: 16,
    channelInfo: { originSize: 128, dcdnSize: 0 },
  })) }),
  ...taskControlHandlers, ...btControlHandlers,
  getQueueCount: () => ({ count: 0 }), getDhtNodeCount: () => ({ count: 7 }),
  getChannelSwitches: () => ({ p2p: true, p2s: true }),
  getNativeCapabilities: () => ({ sdkVersion: 'fake', flat: { startPause: 'present', 'network.proxy': 'missing' } }),
  enableVipDcdn: vipHandlers.enableVipDcdn,
  disableVipDcdn: vipHandlers.disableVipDcdn,
  notifyAuth: (p) => ({ ok: true }),
  notifyLogout: () => ({ ok: true }),
  shutdown: () => ({}),
};

// 模式 A：子进程入口
function runChild() {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
  const HANG_ON = process.env.FAKE_HANG_ON || '';
  const ERROR_ON = process.env.FAKE_ERROR_ON || '';
  const EXIT_AFTER_MS = Number(process.env.FAKE_EXIT_AFTER_MS || '0');
  const NOTIFY_LOG = process.env.FAKE_NOTIFY_LOG || '';
  const FAIL_NOTIFY_STEP = process.env.FAKE_FAIL_NOTIFY_STEP || '';

  // 模式 A 的 notifyAuth/notifyLogout 包一层落盘 + 失败步注入。
  const childHandlers = {
    ...baseHandlers,
    notifyAuth: (p) => {
      if (NOTIFY_LOG) fs.appendFileSync(NOTIFY_LOG, JSON.stringify({ m: 'notifyAuth', p }) + '\n');
      return FAIL_NOTIFY_STEP ? { ok: false, failedStep: FAIL_NOTIFY_STEP, error: 'boom' } : { ok: true };
    },
    notifyLogout: () => {
      if (NOTIFY_LOG) fs.appendFileSync(NOTIFY_LOG, JSON.stringify({ m: 'notifyLogout' }) + '\n');
      return { ok: true };
    },
  };

  const sock = net.createConnection({ host: '127.0.0.1', port });
  let buf = '';
  sock.on('connect', () => {
    if (EXIT_AFTER_MS > 0) setTimeout(() => process.exit(1), EXIT_AFTER_MS);
  });
  sock.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.method === HANG_ON) continue; // 不应答，模拟 hang
      if (msg.method === ERROR_ON) { sock.write(JSON.stringify({ id: msg.id, ok: false, error: 'boom' }) + '\n'); continue; }
      const h = childHandlers[msg.method];
      if (!h) { sock.write(JSON.stringify({ id: msg.id, ok: false, error: 'unknown method' }) + '\n'); continue; }
      Promise.resolve().then(() => h(msg.params || {})).then(
        (result) => sock.write(JSON.stringify({ id: msg.id, ok: true, result }) + '\n'),
        (e) => sock.write(JSON.stringify({ id: msg.id, ok: false, error: String((e && e.message) || e) }) + '\n'));
    }
  });
  sock.on('error', () => process.exit(1));
  sock.on('close', () => process.exit(0));
}

// 模块入口使用内存 Duplex 对，避免把线协议单测绑在可用 TCP 端口上。
async function startFakeEngine() {
  const sockets = new Set();
  function attachProtocol(sock) {
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        const h = baseHandlers[msg.method];
        if (!h) { sock.write(JSON.stringify({ id: msg.id, ok: false, error: 'unknown method: ' + msg.method }) + '\n'); continue; }
        Promise.resolve().then(() => h(msg.params || {})).then(
          (result) => sock.write(JSON.stringify({ id: msg.id, ok: true, result }) + '\n'),
          (e) => sock.write(JSON.stringify({ id: msg.id, ok: false, error: String((e && e.message) || e) }) + '\n'));
      }
    });
    sock.on('error', () => {});
    sockets.add(sock);
    sock.once('close', () => sockets.delete(sock));
  }
  function connect(client) {
    const [hostSocket, engineSocket] = duplexPair();
    hostSocket.setNoDelay = () => hostSocket;
    engineSocket.setNoDelay = () => engineSocket;
    attachProtocol(engineSocket);
    sockets.add(hostSocket);
    hostSocket.once('close', () => sockets.delete(hostSocket));
    client.attach(hostSocket);
    return hostSocket;
  }
  async function call(method, params) {
    const handler = baseHandlers[method];
    if (!handler) throw new Error(`unknown method: ${method}`);
    return handler(params || {});
  }
  const server = {
    address: () => ({ port: 0 }),
    close(cb) {
      for (const socket of [...sockets]) { try { socket.destroy(); } catch {} }
      if (typeof cb === 'function') queueMicrotask(cb);
    },
  };

  return { server, state, call, connect, TASKTYPE, CREATORS };
}

function createInMemoryDriverHarness(env = {}) {
  let current = null;
  let nextPid = 900000;
  const handlers = {
    ...baseHandlers,
    notifyAuth: (params) => {
      if (env.FAKE_NOTIFY_LOG) fs.appendFileSync(env.FAKE_NOTIFY_LOG, `${JSON.stringify({ m: 'notifyAuth', p: params })}\n`);
      return env.FAKE_FAIL_NOTIFY_STEP ? { ok: false, failedStep: env.FAKE_FAIL_NOTIFY_STEP, error: 'boom' } : { ok: true };
    },
    notifyLogout: () => {
      if (env.FAKE_NOTIFY_LOG) fs.appendFileSync(env.FAKE_NOTIFY_LOG, `${JSON.stringify({ m: 'notifyLogout' })}\n`);
      return { ok: true };
    },
  };

  function attachProtocol(socket) {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.method === env.FAKE_HANG_ON) continue;
        if (message.method === env.FAKE_ERROR_ON) { socket.write(`${JSON.stringify({ id: message.id, ok: false, error: 'boom' })}\n`); continue; }
        const handler = handlers[message.method];
        if (!handler) { socket.write(`${JSON.stringify({ id: message.id, ok: false, error: `unknown method: ${message.method}` })}\n`); continue; }
        Promise.resolve().then(() => handler(message.params || {})).then(
          (result) => socket.write(`${JSON.stringify({ id: message.id, ok: true, result })}\n`),
          (error) => socket.write(`${JSON.stringify({ id: message.id, ok: false, error: String(error && error.message || error) })}\n`));
      }
    });
    socket.on('error', () => {});
  }

  const listenerFactory = async () => {
    const [hostSocket, engineSocket] = duplexPair();
    hostSocket.setNoDelay = () => hostSocket;
    engineSocket.setNoDelay = () => engineSocket;
    attachProtocol(engineSocket);
    current = { hostSocket, engineSocket };
    return {
      port: 0,
      connected: Promise.resolve(hostSocket),
      fail() {},
      close({ connected } = {}) { if (!connected) { hostSocket.destroy(); engineSocket.destroy(); } },
    };
  };

  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = ++nextPid;
    child.killed = false;
    child.kill = (signal = 'SIGTERM') => {
      if (child.killed) return false;
      child.killed = true;
      const connection = current; current = null;
      if (connection) { connection.hostSocket.destroy(); connection.engineSocket.destroy(); }
      queueMicrotask(() => child.emit('exit', signal === 'SIGKILL' ? null : 0, signal));
      return true;
    };
    const exitAfterMs = Number(env.FAKE_EXIT_AFTER_MS || 0);
    if (exitAfterMs > 0) setTimeout(() => child.kill('SIGTERM'), exitAfterMs);
    return child;
  };

  return { listenerFactory, spawnImpl };
}

// 入口判定：--port 在 argv → 子进程模式；否则模块模式（导出 startFakeEngine）
if (process.argv.includes('--port')) {
  runChild();
} else {
  module.exports = { startFakeEngine, createInMemoryDriverHarness, TASKTYPE, CREATORS };
}
