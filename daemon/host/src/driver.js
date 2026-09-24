'use strict';
const { EventEmitter } = require('events');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EngineClient } = require('./engine-client');
const { repairTorrentSdkResult } = require('./domain/native-text');
const { linuxToWindowsPath } = require('./windows-path');

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function linuxToWinePath(p) { return 'Z:' + p.replace(/\//g, '\\'); }

function quoteCmd(value) { return `"${String(value).replace(/"/g, '""')}"`; }

function execFilePromise(execFileImpl, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout) => error ? reject(error) : resolve(stdout || ''));
  });
}

function readCmdline(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); }
  catch { return ''; }
}

function isVerifiedSdkPid(pid) {
  const n = Number(pid);
  return Number.isSafeInteger(n) && n > 0 && readCmdline(n).includes('DownloadSDKServer.exe');
}

async function discoverSdkPids() {
  const output = await new Promise((resolve) => execFile('pgrep', ['-f', 'DownloadSDKServer.exe'], { encoding: 'utf8' }, (e, stdout) => resolve(e ? '' : stdout || '')));
  return [...new Set(String(output).trim().split(/\s+/).map(Number).filter((pid) => isVerifiedSdkPid(pid)))];
}

async function defaultSdkReadyCheck(deadlineMs = 30000) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const pids = await discoverSdkPids();
    if (pids.length) return pids;
    if (Date.now() > end) return [];
    await sleep(1000);
  }
}

async function createTcpEngineListener() {
  const server = net.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  let fail = () => {};
  const connected = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(reject, new Error('engine connect timeout (30s)')), 30000);
    if (timer.unref) timer.unref();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    fail = (error) => finish(reject, error);
    server.once('connection', (socket) => finish(resolve, socket));
    server.once('error', fail);
  });
  return { port, connected, fail, close: () => server.close() };
}

class WineNodeDriver extends EventEmitter {
  constructor(opts) {
    super();
    this.repoRoot = opts.repoRoot;
    this.programDir = opts.programDir || path.join(opts.repoRoot, 'thunder_x', 'program');
    this.thunderExe = path.join(this.programDir, 'thunder.exe'); // Electron-as-Node 运行时
    this.engineScript = opts.engineScript || path.join(opts.repoRoot, 'daemon', 'engine', 'engine.js');
    this.profileDir = opts.profileDir;
    this.logFile = opts.logFile || path.join(opts.profileDir, 'engine.log');
    this.wineExe = opts.wineExe || 'wine';
    this.winePrefix = opts.winePrefix || process.env.WINEPREFIX || '';
    this.toEnginePath = opts.toEnginePath || linuxToWinePath;
    this.engineMode = 'wine';
    this.taskDbPath = path.join(this.profileDir, 'profile', 'TaskDb.dat');
    this.spawnImpl = opts.spawnImpl || ((cmd, args, o) => spawn(cmd, args, o));
    this.backoffMs = opts.backoffMs || DEFAULT_BACKOFF_MS;
    this.sdkReadyCheck = opts.sdkReadyCheck || defaultSdkReadyCheck;
    this.sdkPidFinder = opts.sdkPidFinder || discoverSdkPids;
    this.listenerFactory = opts.listenerFactory || createTcpEngineListener;
    this.client = new EngineClient();
    this.child = null;
    this.sdkReady = false;
    this.restarts = 0;
    this.bootedAt = 0;
    this._healthy = false;
    this._generation = 0;
    this._backoffIdx = 0;
    this._bootPromise = null;
    this._respawnTimer = null;
    this._stopping = false;
    this._started = false;
    this._starting = false;
    this._sdkPids = new Set();
    this.nativeCapabilities = {};
  }

  isHealthy() { return this._healthy && this.sdkReady && this.client.isConnected(); }
  enginePid() { return this.child && !this.child.killed ? this.child.pid : null; }

  // engine.log 大小轮转：append-only 无上限会吃盘（Wine 崩溃时的句柄 dump 一次可数 KB，
  // respawn 循环下增长加速）。每次 boot 前检查，超限轮转保留一份旧档。
  _rotateEngineLog(maxBytes = 10 * 1024 * 1024) {
    try {
      const st = fs.statSync(this.logFile);
      if (st.size < maxBytes) return;
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch { /* 不存在/不可改名：继续 append（不因日志阻塞引擎启动） */ }
  }

  // 唯一对外入口：初始 boot + 失败退避重试；之后崩溃由事件驱动重 spawn。永不 reject。
  // _started 在首次 healthy 后才置位——初始重试期 _onEngineDown 直接返回，保证单一重试路径。
  start() {
    if (this._starting || this._started) return;
    this._starting = true;
    (async () => {
      while (!this._stopping && !this.isHealthy()) {
        try { await this.boot(); this._started = true; }
        catch (e) {
          this.emit('bootError', e);
          await sleep(this.backoffMs[Math.min(this._backoffIdx++, this.backoffMs.length - 1)]);
        }
      }
    })();
  }

  boot() {
    if (this.isHealthy()) return Promise.resolve();
    if (this._bootPromise) return this._bootPromise;
    this._bootPromise = this._bootOnce().finally(() => { this._bootPromise = null; });
    return this._bootPromise;
  }

  async _bootOnce() {
    this._stopping = false;
    const gen = ++this._generation;
    const sdkBefore = new Set(await this.sdkPidFinder().catch(() => []));
    fs.mkdirSync(this.profileDir, { recursive: true });
    let listener = null;
    let socket = null;
    let child = null;
    let logFd; // 提升到 try 外，确保 spawnImpl 同步抛错时也能关闭描述符。
    try {
      listener = await this.listenerFactory({ generation: gen, mode: this.engineMode });
      const port = listener.port;
      this._rotateEngineLog();
      logFd = fs.openSync(this.logFile, 'a');
      const env = { ...process.env,
        ELECTRON_RUN_AS_NODE: '1', WINEDEBUG: '-all', WINEESYNC: '1',
        '01KVYZS23XBRBTN7XTFFPAXQNV_SDK_Platform': '64' };
      if (this.winePrefix) env.WINEPREFIX = this.winePrefix;
      child = this.spawnImpl(this.wineExe,
        [linuxToWinePath(this.thunderExe), linuxToWinePath(this.engineScript), '--port', String(port), '--profile', linuxToWinePath(this.profileDir)],
        { env, cwd: this.programDir, stdio: ['ignore', logFd, logFd] });
      fs.closeSync(logFd);
      logFd = undefined; // 已关，标记避免 catch 重复关
      this.child = child;
      child.once('exit', (code, signal) => { listener?.fail?.(new Error(`engine exited before connect (code=${code}, signal=${signal || 'none'})`)); this._onEngineDown(gen, `pre-connect-exit code=${code} signal=${signal || 'none'}`); });

      socket = await listener.connected;
      this.client.attach(socket);
      this.client.once('close', () => this._onEngineDown(gen));
      await this.ping(); // transportReady
      const readiness = await this.sdkReadyCheck(30000);
      const readyPids = Array.isArray(readiness) ? readiness : readiness && Array.isArray(readiness.pids) ? readiness.pids : [];
      this.sdkReady = readiness === true || (readiness && readiness.ready === true) || readyPids.length > 0;
      if (!this.sdkReady) throw new Error('sdkReady timeout (30s): DownloadSDKServer.exe not observed');
      try { this.nativeCapabilities = await this._call('getNativeCapabilities', {}, 5000); }
      catch { this.nativeCapabilities = {}; }
      // 只记录本代 boot 后出现的、且再次通过 cmdline 身份校验的 SDK PID；不触碰既有用户进程。
      this._sdkPids = new Set(readyPids.map(Number).filter((pid) => !sdkBefore.has(pid) && isVerifiedSdkPid(pid)));
      this._healthy = true;
      this._started = true; // 首次 healthy 后置位：使 _onEngineDown 重 spawn 生效（对齐 start()/restart() 语义）
      this._backoffIdx = 0;
      this.bootedAt = Date.now();
      console.error(`[engine-up] gen=${this._generation} restarts=${this.restarts} pid=${this.child && this.child.pid}`);
      this.emit('up');
    } catch (e) {
      if (logFd !== undefined) { try { fs.closeSync(logFd); } catch {} } // spawnImpl 抛错时补关。
      this.client.close();
      if (child) { try { child.kill(); } catch {} }
      this.sdkReady = false;
      throw e;
    } finally {
      listener?.close?.({ connected: Boolean(socket) });
    }
  }

  _onEngineDown(gen, exitReason = 'socket-lost') {
    if (gen !== this._generation || this._stopping) return; // 陈旧事件丢弃
    const was = this._healthy;
    // 崩溃取证：每次引擎失联记录代际/重启计数/失联方式（boot 前 exit 有 code/signal，
    // 连接丢失型为 socket-lost）。与 engine.log 的 wineserver NT 对象转储对齐可归因。
    console.error(`[engine-down] gen=${gen} restarts=${this.restarts} healthy=${was} reason=${exitReason}`);
    this._healthy = false;
    this.sdkReady = false;
    // 受控重启必须清理旧 child 和旧 socket，避免孤儿进程占用 profileDir 或迟到 close 污染新代际。
    if (this.child && !this.child.killed) { try { this.child.kill(); } catch {} }
    this.client.close(); // destroy 旧 socket，断掉迟到 close 来源
    // 清理 SDK 自动 spawn 的 DownloadSDKServer.exe 孤儿（Wine 下 SIGKILL thunder.exe 后可残留；
    // 残留时新代 sdkReadyCheck 的 pgrep 不区分代际会匹配旧代孤儿而提前判 ready）。单实例授权此清理。
    this._cleanupSdkPids().catch(() => {});
    if (was) this.emit('down');
    if (this._respawnTimer || !this._started) return;
    const delay = this.backoffMs[Math.min(this._backoffIdx++, this.backoffMs.length - 1)];
    this._respawnTimer = setTimeout(async () => {
      this._respawnTimer = null;
      if (this._stopping) return;
      try { this.restarts++; await this.boot(); }
      catch { this._onEngineDown(this._generation); } // 失败 → 下一轮退避
    }, delay);
    if (this._respawnTimer.unref) this._respawnTimer.unref();
  }

  async _cleanupSdkPids() {
    const pids = [...this._sdkPids];
    this._sdkPids.clear();
    for (const pid of pids) {
      if (isVerifiedSdkPid(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    }
    if (!pids.length) return;
    await sleep(100);
    for (const pid of pids) {
      if (isVerifiedSdkPid(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }

  // 命令通道：超时 → 本代标记 down 并触发受控重 spawn
  async _call(method, params, timeoutMs = 10000) {
    try { return await this.client.request(method, params, timeoutMs); }
    catch (e) {
      if (e.code === 'ETIMEDOUT') this._onEngineDown(this._generation);
      throw e;
    }
  }

  ping() { return this._call('ping'); }
  getNativeCapabilities() { return this._call('getNativeCapabilities'); }
  // BT.seedFile 与磁力 metadata 目录必须转换到实际引擎可见的路径。
  static withEnginePaths(taskType, info, convert = linuxToWinePath) {
    if (taskType === 2 && info && info.seedFile) return { ...info, seedFile: convert(info.seedFile) };
    if (taskType === 5 && info && info.torrentFilePath) return { ...info, torrentFilePath: convert(info.torrentFilePath) };
    return info;
  }
  static withWinePaths(taskType, info) { return WineNodeDriver.withEnginePaths(taskType, info, linuxToWinePath); }
  async createTask({ taskType, savePath, taskName, info }) {
    const taskInfo = { background: false, taskBaseInfo: { savePath: this.toEnginePath(savePath), taskName, openOnComplete: 0, origin: 'thunderd' } };
    const engineInfo = WineNodeDriver.withEnginePaths(taskType, info, this.toEnginePath);
    const r = await this._call('createTask', { taskType, taskInfo, info: engineInfo });
    if (!r || typeof r.engineId !== 'number' || r.engineId <= 0) throw new Error('engine createTask failed');
    return r.engineId;
  }
  async parseTaskInfo({ kind, data }) {
    // torrent kind 的 data 是文件路径 → 转 Wine；其他 kind（magnet/ed2k/thunder/urltype）data 是字符串不转
    const engineData = kind === 'torrent' && data ? this.toEnginePath(data) : data;
    const parsed = await this._call('parseTaskInfo', { kind, data: engineData });
    return kind === 'torrent' ? repairTorrentSdkResult(parsed) : parsed;
  }
  async normalizeTorrentHash(value) { return this._call('normalizeTorrentHash', { value }, 5000); }
  async resolveThunderUrl(thunderUrl) {
    const r = await this.parseTaskInfo({ kind: 'thunder', data: thunderUrl });
    const t = await this.parseTaskInfo({ kind: 'urltype', data: r.resolvedUrl });
    return { resolvedUrl: r.resolvedUrl, taskType: t.taskType };
  }
  async startTasks(ids) { await this._call('startTasks', { ids }); }
  async stopTasks(ids) { await this._call('stopTasks', { ids }); }
  async deleteTasks(ids) { await this._call('deleteTasks', { ids }); }
  // 任务控制显式入口。操作超时后由 EngineClient/_call 触发代际失效，
  // Host operation journal 不会因为连接中断而自动重发破坏性命令。
  async recycleTask(engineId) { return this._call('recycleTask', { engineId }, 10000); }
  async recoverTask(engineId) { return this._call('recoverTask', { engineId }, 10000); }
  async redownloadTask(engineId, { deleteLocal = false } = {}) { return this._call('redownloadTask', { engineId, deleteLocal: deleteLocal === true }, 30000); }
  async renameTask(engineId, displayName) { return this._call('renameTask', { engineId, displayName }, 10000); }
  async moveTask(engineId, targetPath) { return this._call('moveTask', { engineId, wineTargetPath: this.toEnginePath(targetPath) }, 120000); }
  async setTaskSpeedLimit(engineId, bytesPerSecond) { return this._call('setTaskSpeedLimit', { engineId, bytesPerSecond }, 10000); }
  async updateBtSelection(engineId, selectedFileIndices) { return this._call('updateBtSelection', { engineId, selectedFileIndices }, 30000); }
  async setBtScheduler(engineId, scheduler) { return this._call('setBtScheduler', { engineId, scheduler }, 10000); }
  async getBtFileRuntime(engineId) { return this._call('getBtFileRuntime', { engineId }, 10000); }
  async getSeedDescriptor(engineId) { return this._call('getSeedDescriptor', { engineId }, 10000); }
  async getTaskSnapshots(ids) {
    const response = await this._call('getTaskSnapshots', { ids }, 10000);
    const map = new Map();
    for (const row of response && Array.isArray(response.tasks) ? response.tasks : []) {
      const id = Number(row && row.taskId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      map.set(id, {
        status: Number(row.status) || 0,
        totalReceiveSize: Number(row.totalReceiveSize) || 0,
        resourceSize: Number(row.resourceSize) || 0,
        failureErrorCode: Number(row.failureErrorCode) || 0,
        name: row.name || null,
        url: row.url || '',
        cid: row.cid || null,
        gcid: row.gcid || null,
        downloadSpeed: Number(row.downloadSpeed) || 0,
        vipSpeed: Number(row.vipSpeed) || 0,
        channelInfo: row.channelInfo && typeof row.channelInfo === 'object' ? row.channelInfo : null,
      });
    }
    return map;
  }
  async enableVipDcdn(engineId, certs) { return this._call('enableVipDcdn', { engineId, certs }); }
  async disableVipDcdn(engineId, fileIndices) { return this._call('disableVipDcdn', { engineId, fileIndices }); }
  async getQueueCount() { return (await this._call('getQueueCount')).count; }
  async getDhtNodeCount() { return (await this._call('getDhtNodeCount')).count; }
  getChannelSwitches() { return this._call('getChannelSwitches'); }
  // 策略层显式网络控制。密码只在本次 engine 消息中短暂存在。
  async setGlobalLimits({ downloadLimit, uploadLimit, connectionLimit, maxTasks }) { return this._call('setGlobalLimits', { downloadLimit, uploadLimit, connectionLimit, maxTasks }); }
  async setChannelSwitches({ p2p, p2s }) { return this._call('setChannelSwitches', { p2p, p2s }); }
  async verifyProxy(proxy) { return this._call('verifyProxy', proxy, 15000); }
  async setProxy(proxy) { return this._call('setProxy', proxy, 15000); }
  async setAutoMoveLowSpeed(enabled) { return this._call('setAutoMoveLowSpeed', { enabled: enabled === true }); }
  async getNetworkRuntime() { return this._call('getNetworkRuntime'); }
  async getGlobalLimits() { return this._call('getNetworkRuntime'); }

  // 登录/登出通知转发。engine 返回 ok:false 时带 failedStep。
  async notifyAuth({ uid, vipStr }) {
    const r = await this._call('notifyAuth', { uid, vipStr });
    if (!r || r.ok !== true) {
      const e = new Error(`notifyAuth failed at ${r && r.failedStep}: ${r && r.error}`);
      e.failedStep = r && r.failedStep;
      throw e;
    }
  }
  async notifyLogout() {
    const r = await this._call('notifyLogout');
    if (!r || r.ok !== true) {
      const e = new Error(`notifyLogout failed at ${r && r.failedStep}: ${r && r.error}`);
      e.failedStep = r && r.failedStep;
      throw e;
    }
  }

  async restart() {
    // 受控重启：语义等同"引擎更换"——原有 active/paused 任务的 engineId 已失效。
    // 若之前 healthy，shutdown 后 emit 'down' 触发 main.js 把全部非终态标 interrupted
    // （否则 boot 后 queue=0、任务卡 waiting 永不推进，且 findDuplicate 会锁死同 URL 重加）。
    const was = this._healthy;
    await this.shutdown();
    if (was) this.emit('down');
    this._stopping = false;
    this._started = true;
    this.restarts++;
    try {
      await this.boot();
    } catch (e) {
      // boot 失败：接入退避重试（避免 _started=true 但无子进程、无 respawn 定时器 → 永久死亡）
      this._onEngineDown(this._generation);
      throw e;
    }
  }

  async shutdown() {
    this._stopping = true;
    this._generation++; // 旧事件全部过期
    this._started = false;
    this._starting = false;
    if (this._respawnTimer) { clearTimeout(this._respawnTimer); this._respawnTimer = null; }
    try { if (this.client.isConnected()) await this.client.request('shutdown', {}, 3000); } catch {}
    this.client.close();
    if (this.child) { try { this.child.kill(); } catch {} this.child = null; }
    // 与引擎失联路径一致，清理 Wine 下不会随 thunder.exe 自动回收的 DownloadSDKServer.exe。
    await this._cleanupSdkPids();
    this._healthy = false;
    this.sdkReady = false;
  }

  static linuxToWinePath(p) { return linuxToWinePath(p); }
}

function powershellLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }

class WindowsProgramProcessController {
  constructor({ programDir, distroName, execFileImpl = execFile,
    powershellExe = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    taskkillExe = '/mnt/c/Windows/System32/taskkill.exe' } = {}) {
    if (!programDir) throw new Error('Windows program directory is required');
    this.programDir = programDir;
    this.windowsProgramDir = linuxToWindowsPath(programDir, { distroName }).replace(/[\\/]+$/, '');
    this.execFileImpl = execFileImpl;
    this.powershellExe = powershellExe;
    this.taskkillExe = taskkillExe;
  }

  async list() {
    const root = `${this.windowsProgramDir}\\`;
    const script = `$root=${powershellLiteral(root)}; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase) } | Select-Object @{n='pid';e={$_.ProcessId}},@{n='name';e={$_.Name}},@{n='path';e={$_.ExecutablePath}}) | ConvertTo-Json -Compress`;
    const stdout = await execFilePromise(this.execFileImpl, this.powershellExe,
      ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    const text = String(stdout || '').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: Number(row.pid), name: String(row.name || ''), path: String(row.path || ''),
    })).filter((row) => Number.isSafeInteger(row.pid) && row.pid > 0 && row.path.toLowerCase().startsWith(root.toLowerCase()));
  }

  async waitForSdk(beforePids = new Set(), deadlineMs = 30000) {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const rows = await this.list();
      const created = rows.filter((row) => !beforePids.has(row.pid));
      if (created.some((row) => row.name.toLowerCase() === 'downloadsdkserver.exe')) return created;
      if (Date.now() >= deadline) return [];
      await sleep(500);
    }
  }

  async terminate(pids) {
    const wanted = new Set((pids || []).map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0));
    if (!wanted.size) return;
    let rows = [];
    try { rows = await this.list(); } catch {}
    for (const row of rows.filter((item) => wanted.has(item.pid)).sort((a, b) => b.pid - a.pid)) {
      try { await execFilePromise(this.execFileImpl, this.taskkillExe, ['/PID', String(row.pid), '/T', '/F'], { timeout: 10000 }); }
      catch {}
    }
  }
}

class WindowsNodeDriver extends WineNodeDriver {
  constructor(opts) {
    const distroName = opts.distroName || process.env.WSL_DISTRO_NAME || 'Ubuntu';
    super({ ...opts, toEnginePath: (value) => linuxToWindowsPath(value, { distroName }) });
    this.engineMode = 'windows-native';
    this.distroName = distroName;
    this.sdkVersionName = opts.sdkVersionName || '25.0.90.1592';
    this.sdkVersionCode = Number(opts.sdkVersionCode) || 2500901592;
    this.sdkPlatform = String(opts.sdkPlatform ?? '0');
    this.sdkGuid = String(opts.sdkGuid || '');
    this.engineSourceDir = opts.engineSourceDir || path.join(opts.repoRoot, 'daemon', 'engine');
    this.engineMirrorDir = opts.engineMirrorDir || path.join(this.profileDir, 'engine');
    this.engineScript = opts.engineScript || path.join(this.engineMirrorDir, 'engine.js');
    this.syncEngineBundle = opts.syncEngineBundle || (() => {
      fs.mkdirSync(this.engineMirrorDir, { recursive: true });
      fs.cpSync(this.engineSourceDir, this.engineMirrorDir, { recursive: true, force: true });
    });
    this.processController = opts.processController || new WindowsProgramProcessController({
      programDir: this.programDir,
      distroName,
      execFileImpl: opts.execFileImpl || execFile,
      powershellExe: opts.powershellExe,
      taskkillExe: opts.taskkillExe,
    });
    this._windowsPids = new Set();
  }

  _launchEnvironment() {
    const forwarded = [
      'ELECTRON_RUN_AS_NODE/w',
      'THUNDERD_SDK_VERSION_NAME/w',
      'THUNDERD_SDK_VERSION_CODE/w',
      'THUNDERD_SDK_PLATFORM/w',
      'THUNDERD_SDK_GUID/w',
    ];
    return {
      PATH: '/usr/bin:/bin',
      ELECTRON_RUN_AS_NODE: '1',
      THUNDERD_SDK_VERSION_NAME: this.sdkVersionName,
      THUNDERD_SDK_VERSION_CODE: String(this.sdkVersionCode),
      THUNDERD_SDK_PLATFORM: this.sdkPlatform,
      THUNDERD_SDK_GUID: this.sdkGuid,
      WSLENV: forwarded.join(':'),
    };
  }

  _launchArguments(port) {
    return [
      this.toEnginePath(this.engineScript),
      '--port', String(port),
      '--profile', this.toEnginePath(this.profileDir),
      '--addon', this.toEnginePath(path.join(this.programDir, 'dk_addon.node')),
    ];
  }
  async _bootOnce() {
    this._stopping = false;
    const generation = ++this._generation;
    const beforeRows = await this.processController.list().catch(() => []);
    const beforePids = new Set(beforeRows.map((row) => row.pid));
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.syncEngineBundle();
    let listener = null;
    let socket = null;
    let child = null;
    let logFd;
    try {
      listener = await this.listenerFactory({ generation, mode: this.engineMode });
      const port = listener.port;
      this._rotateEngineLog();
      logFd = fs.openSync(this.logFile, 'a');
      child = this.spawnImpl(this.thunderExe, this._launchArguments(port), {
        env: this._launchEnvironment(), cwd: this.programDir, stdio: ['ignore', logFd, logFd],
      });
      fs.closeSync(logFd);
      logFd = undefined;
      this.child = child;
      child.once('exit', (code, signal) => {
        listener?.fail?.(new Error(`Windows native engine exited before connect (code=${code}, signal=${signal || 'none'})`));
        this._onEngineDown(generation, `pre-connect-exit code=${code} signal=${signal || 'none'}`);
      });
      child.once('error', (error) => {
        listener?.fail?.(error);
        this.emit('spawnError', error);
      });

      socket = await listener.connected;
      this.client.attach(socket);
      this.client.once('close', () => this._onEngineDown(generation));
      await this.ping();
      const createdRows = await this.processController.waitForSdk(beforePids, 30000);
      if (!createdRows.length) throw new Error('sdkReady timeout (30s): Windows DownloadSDKServer.exe not observed');
      this._windowsPids = new Set(createdRows.map((row) => row.pid));
      this.sdkReady = true;
      try { this.nativeCapabilities = await this._call('getNativeCapabilities', {}, 5000); }
      catch { this.nativeCapabilities = {}; }
      this._healthy = true;
      this._started = true;
      this._backoffIdx = 0;
      this.bootedAt = Date.now();
      console.error(`[engine-up] gen=${this._generation} restarts=${this.restarts} pid=${this.child && this.child.pid}`);
      this.emit('up', { generation });
    } catch (error) {
      if (logFd !== undefined) { try { fs.closeSync(logFd); } catch {} }
      this.client.close();
      if (child) { try { child.kill(); } catch {} }
      let createdRows = [];
      try { createdRows = (await this.processController.list()).filter((row) => !beforePids.has(row.pid)); } catch {}
      await this.processController.terminate(createdRows.map((row) => row.pid));
      this.sdkReady = false;
      throw error;
    } finally {
      listener?.close?.({ connected: Boolean(socket) });
    }
  }

  async _cleanupSdkPids() {
    const pids = [...this._windowsPids];
    this._windowsPids.clear();
    await this.processController.terminate(pids);
  }
}

module.exports = {
  WineNodeDriver,
  WindowsNodeDriver,
  WindowsProgramProcessController,
  linuxToWinePath,
  linuxToWindowsPath,
  defaultSdkReadyCheck,
  discoverSdkPids,
  isVerifiedSdkPid,
};
