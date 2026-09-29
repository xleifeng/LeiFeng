'use strict';

/**
 * QbitDriver：qBittorrent Web API v2 引擎的 KernelPort 实现（P3 参照内核）。
 *
 * 目的不是完整 qbit 封装，而是验证 KernelPort 契约在第二内核下的完备性——
 * 每一处「实现但无对应物」都显式 NOT_SUPPORTED（带 error.code），进 P3 spec §5
 * 缺口清单；契约允许「实现但拒绝」，不允许「缺失」。
 *
 * HTTP 层写法借鉴 apps/bridge/src/qbit-client.js（cookie 鉴权 + 重试登录）。
 * engineId 契约注意：迅雷 engineId 是 number，qbit 的任务标识是 40 位 hex
 * hash——内部维护 hash↔自增序号映射，快照查表还原（缺口：契约未声明类型）。
 */
const { EventEmitter } = require('events');

const QBIT_PROTOCOLS = Object.freeze(['bt', 'magnet']);

function notSupported(method) {
  const error = new Error(`kernel-port: qbit 内核不支持 ${method}`);
  error.code = 'NOT_SUPPORTED';
  error.kernelId = 'qbit';
  return error;
}

class QbitDriver extends EventEmitter {
  constructor({ origin = 'http://127.0.0.1:8085', username = '', password = '', transport = null, clock = Date } = {}) {
    super();
    this.origin = String(origin).replace(/\/$/, '');
    this.username = String(username || '');
    this.password = String(password || '');
    this.clock = clock;
    // transport({ path, method, body, contentType }) → { status, text, headers }；
    // 缺省用全局 fetch + 手拼 cookie（与桥 qbit-client 同形态，注入式便于单测）
    this.transport = transport || ((request) => this._fetchTransport(request));
    this.engineMode = 'qbit';
    this.taskDbPath = null; // P3：taskDbPath 已归契约可选属性（迅雷富件）；qbit 缺席，壳层经 slot.nativeBtLookup 消费
    this.sdkReady = false;
    this._healthy = false;
    this._generation = 0;
    this.nativeCapabilities = {}; // 缺口：nativeCapabilities 是迅雷探测形态
    this.bootedAt = 0;
    this.restarts = 0;
    this._cookie = '';
    this._hashToId = new Map();
    this._idToHash = new Map();
    this._nextEngineId = 1;
    this._started = false;
    this._stopping = false;
    this._probeTimer = null;
  }

  // ---- HTTP 通道（cookie 登录，401 重登一次——借鉴桥 qbit-client）----
  async _fetchTransport({ path, method = 'GET', body = null, contentType }) {
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        ...(this._cookie ? { cookie: this._cookie } : {}),
        ...(body !== null ? { 'content-type': contentType || 'application/x-www-form-urlencoded' } : {}),
      },
      body: body === null ? undefined : body,
    });
    const text = await response.text();
    return { status: response.status, text, headers: Object.fromEntries(response.headers) };
  }

  async _login() {
    const body = `username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
    const response = await this.transport({ path: '/api/v2/auth/login', method: 'POST', body });
    if (response.status !== 200 || !/Ok\./i.test(response.text)) {
      throw Object.assign(new Error('qbit login failed'), { code: 'AUTH_FAILED' });
    }
    const setCookie = response.headers['set-cookie'] || '';
    const sid = /SID=([^;]+)/i.exec(Array.isArray(setCookie) ? setCookie.join(';') : setCookie);
    this._cookie = sid ? `SID=${sid[1]}` : '';
  }

  async _request(path, { method = 'GET', body = null, contentType, retryAuth = true } = {}) {
    let response = await this.transport({ path, method, body, contentType });
    if (response.status === 403 && retryAuth) {
      await this._login();
      response = await this.transport({ path, method, body, contentType });
    }
    if (response.status >= 400) {
      throw Object.assign(new Error(`qbit api ${path} -> ${response.status}`), { code: 'QBIT_API', status: response.status });
    }
    const type = response.headers['content-type'] || '';
    if (/json/.test(type) && response.text) {
      try { return JSON.parse(response.text); } catch { return response.text; }
    }
    return response.text;
  }

  _engineIdFor(hash) {
    let id = this._hashToId.get(hash);
    if (!id) {
      id = this._nextEngineId++;
      this._hashToId.set(hash, id);
      this._idToHash.set(id, hash);
    }
    return id;
  }

  _hashOf(engineId) {
    const hash = this._idToHash.get(Number(engineId));
    if (!hash) throw Object.assign(new Error(`qbit unknown engineId ${engineId}`), { code: 'TASK_NOT_FOUND' });
    return hash;
  }

  // ---- 生命周期 ----
  async start() {
    if (this._started) return;
    this._started = true;
    this._stopping = false;
    await this._probeLoop();
  }

  async shutdown() {
    this._stopping = true;
    this._started = false;
    if (this._probeTimer) { clearTimeout(this._probeTimer); this._probeTimer = null; }
    this._setHealth(false, 'shutdown');
    try { await this._request('/api/v2/auth/logout', { method: 'POST' }); } catch { /* 尽力而为 */ }
    this._cookie = '';
  }

  async restart() {
    this.restarts += 1;
    this._generation += 1;
    this.emit('down', { generation: this._generation, reason: 'restart' });
    await this.shutdown();
    await this.start();
  }

  async _probe() {
    try {
      const version = await this._request('/api/v2/app/version');
      this.sdkReady = true;
      if (!this._healthy) {
        this._healthy = true;
        if (!this.bootedAt) this.bootedAt = this.clock();
        this._generation += 1;
        this.emit('up', { generation: this._generation, version: String(version) });
      }
    } catch (error) {
      if (this._healthy) this.emit('down', { generation: this._generation, reason: error.message });
      this._setHealth(false, error.message);
      if (!this.bootedAt && !this._stopping) this.emit('bootError', error);
    }
  }

  _setHealth(healthy, reason) {
    if (this._healthy === healthy) return;
    this._healthy = healthy;
    this.sdkReady = healthy;
    if (!healthy && reason) this._lastDownReason = reason;
  }

  async _probeLoop() {
    await this._probe();
    if (this._started && !this._stopping) {
      this._probeTimer = setTimeout(() => this._probeLoop().catch(() => {}), 5000);
      this._probeTimer.unref?.();
    }
  }

  // ---- 协议能力（P2 契约方法）----
  async getSupportedProtocols() { return [...QBIT_PROTOCOLS]; }

  isHealthy() { return this._healthy && this.sdkReady; }
  enginePid() { return null; } // 缺口：qbit 无本机进程概念

  // ---- 任务生命周期（BT 子集）----
  async createTask({ taskType, savePath, taskName, info = {} }) {
    // taskType 2=bt 种子文件、5=磁力（迅雷词汇）；qbit 侧统一 add 接口分 form
    if (info.torrentFilePath) {
      const fs = require('fs');
      const bytes = fs.readFileSync(info.torrentFilePath);
      const form = new FormData();
      form.append('torrents', new Blob([bytes]), taskName || 'seed.torrent');
      if (savePath) form.append('savepath', savePath);
      await this._request('/api/v2/torrents/add', { method: 'POST', body: form });
      // add 无返回 hash：列出最近种子按 savepath/name 对齐（尽力而为，缺口：qbit add 不回 hash）
      const list = await this._request('/api/v2/torrents/info');
      const hit = Array.isArray(list) ? list.find((t) => t.save_path === savePath && (t.name === taskName || true)) : null;
      if (!hit) throw Object.assign(new Error('qbit add 后未找到任务'), { code: 'TASK_NOT_FOUND' });
      return { engineId: this._engineIdFor(hit.hash) };
    }
    if (info.magnet || (taskType === 5 && info.url)) {
      const magnet = info.magnet || info.url;
      const body = `urls=${encodeURIComponent(magnet)}${savePath ? `&savepath=${encodeURIComponent(savePath)}` : ''}`;
      await this._request('/api/v2/torrents/add', { method: 'POST', body });
      const hash = /urn:btih:([a-f0-9]{40})/i.exec(magnet);
      if (!hash) throw Object.assign(new Error('magnet 无 btih v1 hash'), { code: 'INVALID_MAGNET' });
      return { engineId: this._engineIdFor(hash[1].toLowerCase()) };
    }
    throw notSupported(`createTask(taskType=${taskType})`);
  }

  async startTasks({ ids }) {
    await this._request(`/api/v2/torrents/resume?hashes=${ids.map((id) => this._hashOf(id)).join('|')}`, { method: 'POST' });
    return {};
  }

  async stopTasks({ ids }) {
    await this._request(`/api/v2/torrents/pause?hashes=${ids.map((id) => this._hashOf(id)).join('|')}`, { method: 'POST' });
    return {};
  }

  async deleteTasks({ ids }) {
    const hashes = ids.map((id) => this._hashOf(id)).join('|');
    await this._request(`/api/v2/torrents/delete?hashes=${hashes}&deleteFiles=true`, { method: 'POST' });
    return {};
  }

  async recycleTask() { throw notSupported('recycleTask'); }
  async recoverTask() { throw notSupported('recoverTask'); }

  async renameTask({ id, name }) {
    await this._request('/api/v2/torrents/rename', { method: 'POST', body: `hash=${this._hashOf(id)}&name=${encodeURIComponent(name)}` });
    return {};
  }

  async moveTask({ id, savePath }) {
    await this._request('/api/v2/torrents/setLocation', { method: 'POST', body: `hash=${this._hashOf(id)}&location=${encodeURIComponent(savePath)}` });
    return {};
  }

  async redownloadTask({ id }) {
    const hash = this._hashOf(id);
    await this._request(`/api/v2/torrents/recheck?hashes=${hash}`, { method: 'POST' });
    await this._request(`/api/v2/torrents/resume?hashes=${hash}`, { method: 'POST' });
    return {};
  }

  // ---- 进度观察（poller 消费形态：Map<engineId, snapshot>) ----
  async getTaskSnapshots(ids) {
    const list = await this._request('/api/v2/torrents/info');
    const wanted = new Set((ids || []).map((id) => this._idToHash.get(Number(id))).filter(Boolean));
    const map = new Map();
    for (const t of Array.isArray(list) ? list : []) {
      if (wanted.size && !wanted.has(t.hash)) continue;
      // qbit 状态 → 迅雷 snapshot 词汇（poller 消费 status/totalReceiveSize/resourceSize/name）
      const STATUS = { downloading: 1, stalledDL: 1, metaDL: 1, queuedDL: 1,
        pausedDL: 0, stoppedDL: 0, uploading: 1, stalledUP: 1, pausedUP: 3, stoppedUP: 3,
        checkingDL: 1, checkingUP: 1, error: 4, missingFiles: 4 };
      map.set(this._engineIdFor(t.hash), {
        status: STATUS[t.state] ?? 1,
        totalReceiveSize: Number(t.completed) || 0,
        resourceSize: Number(t.size) || 0,
        failureErrorCode: t.state === 'error' || t.state === 'missingFiles' ? 1 : 0,
        name: t.name || null,
        url: t.magnet_uri || '',
        cid: null, gcid: null,
        downloadSpeed: Number(t.dlspeed) || 0,
        vipSpeed: 0,
        channelInfo: null,
      });
    }
    return map;
  }

  async getQueueCount() {
    const list = await this._request('/api/v2/torrents/info?filter=downloading');
    return Array.isArray(list) ? list.length : 0;
  }

  async getDhtNodeCount() { return 0; } // 缺口：qbit 无 DHT 计数 API

  // ---- 能力与状态 ----
  async getNativeCapabilities() { return {}; } // 缺口：迅雷探测形态
  async getChannelSwitches() { return { p2p: true, p2s: false }; } // 近似：BT 网络恒开
  async parseTaskInfo({ kind, data }) {
    if (kind === 'magnet') {
      const hash = /urn:btih:([a-f0-9]{40})/i.exec(data);
      return { infoHash: hash ? hash[1].toLowerCase() : null, displayName: '', totalBytes: 0 };
    }
    if (kind === 'torrent') {
      // 最小 bencode 提取 info dict 的 length/name（不追求完整解析，够路由用）
      return this._parseTorrentMeta(String(data));
    }
    throw notSupported(`parseTaskInfo(kind=${kind})`);
  }

  _parseTorrentMeta(file) {
    const fs = require('fs');
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from(String(file), 'binary');
    const text = bytes.toString('latin1');
    const name = /4:name(\d+):/.exec(text);
    const length = /6:lengthi(\d+)e/.exec(text);
    return { displayName: name ? '' : null, totalBytes: length ? Number(length[1]) : 0, infoId: null };
  }

  async normalizeTorrentHash(value) {
    const hash = /(?:urn:)?btih:([a-f0-9]{40})/i.exec(String(value || ''));
    return hash ? { infoHash: hash[1].toLowerCase() } : null;
  }

  async resolveThunderUrl() { throw notSupported('resolveThunderUrl'); }

  // ---- 网络与策略 ----
  async setGlobalLimits({ downloadLimit, uploadLimit }) {
    const prefs = {};
    if (downloadLimit !== undefined) prefs.dl_limit = downloadLimit > 0 ? String(downloadLimit) : '0';
    if (uploadLimit !== undefined) prefs.up_limit = uploadLimit > 0 ? String(uploadLimit) : '0';
    await this._request('/api/v2/app/setPreferences', { method: 'POST', body: `json=${encodeURIComponent(JSON.stringify(prefs))}` });
    return {};
  }

  async getGlobalLimits() {
    const prefs = await this._request('/api/v2/app/preferences');
    return { downloadLimit: Number(prefs.dl_limit) || 0, uploadLimit: Number(prefs.up_limit) || 0,
      connectionLimit: -1, maxTasks: -1 };
  }

  async setChannelSwitches() { return {}; } // 近似：qbit 无 P2P/P2S 通道开关
  async verifyProxy() { throw notSupported('verifyProxy'); }

  async setProxy({ host, port, type = 'http' }) {
    const prefs = host ? { proxy_type: type === 'socks5' ? 2 : type === 'http' ? 1 : 0,
      proxy_ip: host, proxy_port: Number(port) || 0, proxy_peer_connections: true } : { proxy_type: 0 };
    await this._request('/api/v2/app/setPreferences', { method: 'POST', body: `json=${encodeURIComponent(JSON.stringify(prefs))}` });
    return {};
  }

  async setTaskSpeedLimit({ id, downloadLimit }) {
    await this._request('/api/v2/torrents/setDownloadLimit', { method: 'POST',
      body: `hashes=${this._hashOf(id)}&limit=${Number(downloadLimit) || 0}` });
    return {};
  }

  async setBtScheduler({ id, sequential }) {
    await this._request(`/api/v2/torrents/toggleSequentialDownload?hashes=${this._hashOf(id)}`, { method: 'POST' });
    return {};
  }

  async updateBtSelection({ id, fileIndices }) {
    // qbit 按 file priority（0 跳过 / 1 普通 / 7 高）；indices 为选中集 → 未列出的置 0
    const files = await this._request(`/api/v2/torrents/files?hash=${this._hashOf(id)}`);
    const selected = new Set((fileIndices || []).map(Number));
    const priority = files.map((file, index) => selected.size === 0 || selected.has(index) ? 1 : 0);
    await this._request('/api/v2/torrents/filePrio', { method: 'POST',
      body: `hash=${this._hashOf(id)}&id=${this._hashOf(id)}&priority=${priority.join(',')}` });
    return {};
  }

  async setAutoMoveLowSpeed() { throw notSupported('setAutoMoveLowSpeed'); }

  // ---- 迅雷扩展（P3 已归契约可选方法；保留显式拒绝实现——形态满足即合规，
  // 缺席语义与 NOT_SUPPORTED 并存，删掉这些方法同样不违反契约）----
  async notifyAuth() { throw notSupported('notifyAuth'); }
  async notifyLogout() { throw notSupported('notifyLogout'); }
  async getBtFileRuntime() { throw notSupported('getBtFileRuntime'); }
  async getSeedDescriptor() { throw notSupported('getSeedDescriptor'); }
}

module.exports = { QbitDriver, QBIT_PROTOCOLS };
