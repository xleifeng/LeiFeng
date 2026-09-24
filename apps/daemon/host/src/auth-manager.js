'use strict';
// AuthManager：登录凭据钱包、设备登录、会话保活、令牌刷新和原生引擎通知。
// 纯 Linux HTTPS 桥链：device flow → register → user/me → 通知 native。凭据本体不出 RPC 面。
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { EventEmitter } = require('events');
const {
  CLIENT_ID,
  CLIENT_SECRET,
  BUNDLE_NAME,
  APP_ID,
  APP_SIGN_KEY,
  APP_NAME,
  buildDesktopAuthHeaders,
} = require('./xunlei-client-config');
const { classifyVipAccount } = require('./vip-account');
const NOTIFY_SEQUENCE = ['setUserInfo', 'setCurrentPanUserId', 'setGlobalExtInfo'];

// devicesign = "div101." + deviceId + md5(sha1hex(deviceId+bundleName+appId+appSignKey))（signing.md §2 实证）
function makeDeviceSign(deviceId) {
  const sha1hex = crypto.createHash('sha1').update(deviceId + BUNDLE_NAME + APP_ID + APP_SIGN_KEY).digest('hex');
  const md5hex = crypto.createHash('md5').update(sha1hex).digest('hex');
  return 'div101.' + deviceId + md5hex;
}

function readDeviceId(xlconfigPath) {
  const text = fs.readFileSync(xlconfigPath, 'utf8');
  const m = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('DEVICEID='));
  if (!m) throw new Error('DEVICEID not found in ' + xlconfigPath);
  return m.slice('DEVICEID='.length).trim();
}

function verificationUrlFromDeviceCode(dc) {
  const complete = dc && dc.verification_uri_complete;
  if (complete) return complete;
  const base = dc && (dc.verification_url || dc.verification_uri);
  if (!base) return null;
  if (!dc.user_code) return base;
  try {
    const url = new URL(base);
    if (!url.searchParams.has('user_code')) url.searchParams.set('user_code', dc.user_code);
    return url.toString();
  } catch {
    return `${base}${String(base).includes('?') ? '&' : '?'}user_code=${encodeURIComponent(dc.user_code)}`;
  }
}

function parseVipAccount(body, fallback = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const records = Array.isArray(source.vip_info) ? source.vip_info : [];
  const normalized = records.map((value) => {
    const record = value && typeof value === 'object' ? value : {};
    return {
      isVip: !!(record.is_vip == 1 || record.is_vip === '1' || record.is_vip === true),
      userVas: Number(record.user_vas) || 0,
      vipType: Number(record.vas_type) || 0,
      vipLevel: Number(record.level) || 0,
      userChannel: source.user_channel || record.user_channel || fallback.userChannel || 'thunderd',
    };
  });
  return normalized.find((record) => classifyVipAccount(record).isDownloadVip)
    || normalized.find((record) => record.isVip)
    || normalized[0]
    || { isVip: false, userVas: 0, vipType: 0, vipLevel: 0,
      userChannel: source.user_channel || fallback.userChannel || 'thunderd' };
}

// HTTP JSON 请求（按 URL 协议选 http/https；只记端点+状态码到 log，不记 body）
function requestJson(method, fullUrl, { headers, body, timeoutMs = 15000, log } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(fullUrl); } catch (e) { return resolve({ status: 0, error: 'bad url' }); }
    const mod = u.protocol === 'https:' ? https : http;
    const opts = { method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers: headers || {}, timeout: timeoutMs };
    const req = mod.request(opts, (res) => {
      let data = ''; res.on('data', (c) => data += c); res.on('end', () => {
        if (log) log(`${method} ${u.pathname} -> ${res.statusCode}`);
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch { resolve({ status: res.statusCode, body: null, raw: data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (body !== undefined && body !== null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

class AuthManager extends EventEmitter {
  constructor({ wallet, driver, apiOrigin, xlconfigPath, clientId = CLIENT_ID, clientSecret,
    keepAliveMs = 0, notifyRetryMs = 60000, notifyBackoffMs = [60000, 120000, 240000],
    keepAliveOverride = 0, request = requestJson, log = console.error }) {
    super();
    this.wallet = wallet;
    this.driver = driver;
    this.apiOrigin = apiOrigin;
    this.xlconfigPath = xlconfigPath;
    this.clientId = clientId;
    this.clientSecret = clientSecret || CLIENT_SECRET;
    this.request = typeof request === 'function' ? request : requestJson;
    this.keepAliveMs = keepAliveMs; // 测试用：>0 时按此节拍（不经 clamp）
    this.keepAliveOverride = keepAliveOverride; // env 覆盖（已 clamp）
    this.notifyRetryMs = notifyRetryMs;
    this.notifyBackoffMs = notifyBackoffMs;
    this.log = log;
    // 运行期状态
    this.loginFlow = { state: 'idle', error: '' };
    this.account = { valid: false, uid: null, isVip: false, userVas: 0, vipType: 0, vipLevel: 0, checkedAt: null };
    this.sessionRt = { registered: false, lastRegisterAt: null, lastKeepAliveAt: null, lastError: '' };
    this.engineRt = { notified: false, notifiedAt: null };
    this._stopped = false;
    this._pollTimer = null;
    this._kaTimer = null;
    this._notifyAttempts = 0;
    this._notifyRetryAt = 0;
    this._deviceSign = null;
    this._vipRecoveryPromise = null;
  }

  _emitState(state) {
    // 只发固定脱敏状态名，不携带账号、session、token 或 peer ID。
    try { this.emit('state', { state }); } catch {}
  }

  start() {
    // 钱包恢复：若有 session，进 active；订阅 driver up/down 重放 notify
    this._stopped = false;
    if (this.wallet.load()) {
      this.sessionRt.registered = true;
      this._refreshAccountFromWallet();
      this._deviceSign = makeDeviceSign(this.wallet.data.meta.deviceId);
      this._tryNotify();
      this._startKeepAlive();
    }
    if (this.driver && this.driver.on) {
      this.driver.on('up', () => { if (this.sessionRt.registered) this._tryNotify(); });
      this.driver.on('down', () => { this.engineRt.notified = false; });
    }
  }

  stop() { this._stopped = true; this._stopPoll(); this._stopKeepAlive(); }

  cancelLogin() { this._stopPoll(); if (this.loginFlow.state === 'awaiting-scan' || this.loginFlow.state === 'completing') this.loginFlow = { state: 'idle', error: '' }; return { cancelled: true }; }

  _desktopAuthHeaders(extra = {}) {
    const deviceId = this._ensureDeviceId();
    return { ...buildDesktopAuthHeaders({ clientId: this.clientId, deviceId }), ...extra };
  }

  _ensureDeviceId() {
    let deviceId = this.wallet && this.wallet.data && this.wallet.data.meta && this.wallet.data.meta.deviceId;
    if (!deviceId) {
      try { deviceId = readDeviceId(this.xlconfigPath); } catch {}
    }
    if (!deviceId) deviceId = crypto.randomBytes(16).toString('hex');
    const meta = this.wallet.data.meta || {};
    if (meta.deviceId !== deviceId || meta.clientId !== this.clientId) {
      this.wallet.data.meta = { ...meta, deviceId, clientId: this.clientId };
      this.wallet.saveSync();
    }
    return deviceId;
  }

  async startLogin() {
    if (this.sessionRt.registered) throw this._err('already authenticated, logout first');
    if (this.loginFlow.state === 'awaiting-scan' || this.loginFlow.state === 'completing')
      throw this._err('login already in progress');
    const r = await this.request('POST', this.apiOrigin + '/v1/auth/device/code', {
      headers: this._desktopAuthHeaders(),
      body: { client_id: this.clientId, scope: '' } });
    if (r.status !== 200 || !r.body || !r.body.device_code) throw this._err('device/code failed: ' + (r.status || r.error));
    const dc = r.body;
    this.loginFlow = { state: 'awaiting-scan', error: '' };
    this._pollDeviceCode(dc);
    return {
      verificationUrl: verificationUrlFromDeviceCode(dc),
      userCode: dc.user_code, expiresIn: dc.expires_in, interval: dc.interval,
    };
  }

  _pollDeviceCode(dc) {
    const deadline = Date.now() + (dc.expires_in || 120) * 1000;
    const interval = Math.max((dc.interval || 2), 0.01) * 1000;
    const tick = async () => {
      if (this._stopped || this.loginFlow.state !== 'awaiting-scan') return;
      if (Date.now() > deadline) { this._flowFail('expired'); return; }
      const r = await this.request('POST', this.apiOrigin + '/v1/auth/token', {
        headers: this._desktopAuthHeaders(),
        body: { client_id: this.clientId, client_secret: this.clientSecret,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code } });
      if (r.status === 200 && r.body && r.body.access_token) { this._completeLogin(r.body); return; }
      const err = r.body && r.body.error;
      if (err === 'authorization_pending') { this._schedulePoll(tick, interval); return; }
      if (err === 'slow_down') { this._schedulePoll(tick, interval + 5000); return; }
      if (err === 'expired_token') { this._flowFail('expired'); return; }
      if (err === 'access_denied') { this._flowFail('denied'); return; }
      if (r.status === 0) { this._flowFail('upstream'); return; }
      this._flowFail('upstream');
    };
    this._schedulePoll(tick, interval);
  }

  _schedulePoll(fn, ms) {
    if (this._stopped || this.loginFlow.state !== 'awaiting-scan') return;
    this._pollTimer = setTimeout(() => { this._pollTimer = null; fn().catch(() => this._flowFail('upstream')); }, ms);
    if (this._pollTimer.unref) this._pollTimer.unref();
  }
  _stopPoll() { if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; } }

  _flowFail(error) {
    this._stopPoll();
    this.loginFlow = { state: 'failed', error };
    this.sessionRt.lastError = error;
  }

  async _completeLogin(tokenResp) {
    this.loginFlow = { state: 'completing', error: '' };
    try {
      const now = Date.now();
      this.wallet.data.credentials = {
        accessToken: tokenResp.access_token, refreshToken: tokenResp.refresh_token,
        accessTokenExpiresAt: now + (tokenResp.expires_in || 3600) * 1000, obtainedAt: now,
      };
      // register
      const deviceId = this._ensureDeviceId();
      this._deviceSign = makeDeviceSign(deviceId);
      const regUrl = `${this.apiOrigin}/session/v1/register?appid=${APP_ID}&token=${encodeURIComponent(tokenResp.access_token)}&appname=${APP_NAME}&devicesign=${encodeURIComponent(this._deviceSign)}&securekey=`;
      const reg = await this.request('GET', regUrl, { log: this.log });
      if (reg.status !== 200 || !reg.body || !reg.body.sessionid) {
        this.log(`[auth] register failed status=${reg.status || 0}`);
        this._flowFail('register-upstream'); return;
      }
      const sb = reg.body;
      this.wallet.data.session = {
        sessionId: sb.sessionid, secureKey: sb.secure_key, userId: String(sb.user_id || ''),
        registeredAt: now, keepAlivePeriodSec: Number(sb.keepAlivePeriod) || 300, keepAliveMinPeriodSec: Number(sb.keepAliveMinPeriod) || 30,
      };
      // user/me 拉 vip 三元组（实测：顶层无 is_vip/vas_type/level，在 vip_info[0] 数组里，字符串类型）
      const me = await this.request('GET', this.apiOrigin + '/v1/user/me', {
        headers: this._desktopAuthHeaders({ Authorization: 'Bearer ' + tokenResp.access_token }), log: this.log });
      if (me.status !== 200 || !me.body) {
        this.log(`[auth] user profile failed status=${me.status || 0}`);
        this._flowFail('profile-upstream'); return;
      }
      const m = me.body;
      this.wallet.data.vip = { ...parseVipAccount(m), checkedAt: now };
      this.wallet.saveSync();
      this.sessionRt = { registered: true, lastRegisterAt: now, lastKeepAliveAt: null, lastError: '' };
      this.account = { valid: true, uid: this.wallet.data.session.userId, isVip: this.wallet.data.vip.isVip,
        userVas: this.wallet.data.vip.userVas, vipType: this.wallet.data.vip.vipType,
        vipLevel: this.wallet.data.vip.vipLevel, checkedAt: now };
      this.loginFlow = { state: 'idle', error: '' };
      await this._tryNotify();
      this._startKeepAlive();
    } catch (e) {
      this.log(`[auth] login completion failed: ${e && e.message ? e.message : 'unknown error'}`);
      this._flowFail('completion-upstream');
    }
  }

  _refreshAccountFromWallet() {
    const w = this.wallet.data;
    if (w.vip) this.account = { valid: true, uid: w.session && w.session.userId, isVip: w.vip.isVip,
      userVas: Number(w.vip.userVas) || 0, vipType: w.vip.vipType,
      vipLevel: w.vip.vipLevel, checkedAt: w.vip.checkedAt };
  }

  async _tryNotify() {
    if (!this.sessionRt.registered || !this.driver || !this.driver.isHealthy()) return;
    const w = this.wallet.data;
    const vipStr = `isvip=${w.vip.isVip ? 1 : 0},viptype=${w.vip.vipType || ''},viplevel=${w.vip.vipLevel || 0},userchannel=${w.vip.userChannel || 'thunderd'},hit_32_64=64`;
    try {
      await this.driver.notifyAuth({ uid: w.session.userId, vipStr });
      this.engineRt = { notified: true, notifiedAt: Date.now() };
      this._notifyAttempts = 0;
    } catch (e) {
      this.engineRt.notified = false;
      // 通知失败后由保活循环按退避窗口驱动补偿重试。
    }
  }

  async getStatus({ refresh = false } = {}) {
    if (refresh && this.account.valid && this.wallet.data.credentials) {
      try {
        let credentials = this.wallet.data.credentials;
        const expiresAt = Number(credentials.accessTokenExpiresAt) || 0;
        let refreshed = false;
        if (!credentials.accessToken || !expiresAt || expiresAt - Date.now() < 300000) {
          refreshed = await this._refreshToken();
          if (!refreshed) {
            this._requireLogin('token refresh failed');
            return this._statusSnapshot();
          }
          credentials = this.wallet.data.credentials;
        }
        let me = await this.request('GET', this.apiOrigin + '/v1/user/me', {
          headers: this._desktopAuthHeaders({ Authorization: 'Bearer ' + credentials.accessToken }), timeoutMs: 5000, log: this.log });
        if (me.status === 401 && !refreshed && await this._refreshToken()) {
          credentials = this.wallet.data.credentials;
          me = await this.request('GET', this.apiOrigin + '/v1/user/me', {
            headers: this._desktopAuthHeaders({ Authorization: 'Bearer ' + credentials.accessToken }), timeoutMs: 5000, log: this.log });
        }
        if (me.status === 200 && me.body) {
          const m = me.body;
          this.wallet.data.vip = { ...this.wallet.data.vip,
            ...parseVipAccount(m, this.wallet.data.vip || {}), checkedAt: Date.now() };
          this.account = { ...this.account, isVip: this.wallet.data.vip.isVip,
            userVas: this.wallet.data.vip.userVas, vipType: this.wallet.data.vip.vipType,
            vipLevel: this.wallet.data.vip.vipLevel, checkedAt: this.wallet.data.vip.checkedAt };
          this.wallet.saveSync();
          this.sessionRt.lastError = '';
        } else if (me.status === 401) {
          this._requireLogin('account authorization expired');
        }
      } catch {}
    }
    return this._statusSnapshot();
  }

  _requireLogin(reason) {
    this.sessionRt.registered = false;
    this.sessionRt.lastError = reason;
    this.account.valid = false;
    this.engineRt.notified = false;
    this._stopKeepAlive();
    this._emitState('auth-required');
  }

  _statusSnapshot() {
    const c = this.wallet.data.credentials, s = this.wallet.data.session;
    return {
      loginFlow: { state: this.loginFlow.state, error: this.loginFlow.error },
      account: { valid: this.account.valid, isVip: this.account.isVip,
        userVas: this.account.userVas, vipType: this.account.vipType,
        vipLevel: this.account.vipLevel, checkedAt: this.account.checkedAt },
      token: { accessTokenExpiresAt: c ? c.accessTokenExpiresAt : null, refreshTokenPresent: !!(c && c.refreshToken) },
      session: { registered: this.sessionRt.registered, sessionIdPresent: !!(s && s.sessionId),
        lastRegisterAt: this.sessionRt.lastRegisterAt, lastKeepAliveAt: this.sessionRt.lastKeepAliveAt,
        lastError: this.sessionRt.lastError },
      engine: { notified: this.engineRt.notified, notifiedAt: this.engineRt.notifiedAt, sequence: NOTIFY_SEQUENCE.slice() },
    };
  }

  // VIP 控制链的内部凭据接口。并发调用共享一次 refresh/re-register，绝不启动 device flow。
  async getVipContext({ minAccessTtlMs = 300000, forceRecover = false } = {}) {
    if (this._vipRecoveryPromise) return this._vipRecoveryPromise;
    const p = this._getVipContextOnce({ minAccessTtlMs, forceRecover });
    this._vipRecoveryPromise = p;
    p.finally(() => {
      if (this._vipRecoveryPromise === p) this._vipRecoveryPromise = null;
    }).catch(() => {});
    return p;
  }

  async _getVipContextOnce({ minAccessTtlMs, forceRecover }) {
    try {
      const w = this.wallet && this.wallet.data;
      if (!w || !w.credentials || !w.credentials.accessToken || !w.session) {
        this._emitState('auth-required');
        return { ok: false, reason: 'auth-required' };
      }
      const c = w.credentials;
      const expiresAt = Number(c.accessTokenExpiresAt) || 0;
      const ttl = Math.max(0, Number(minAccessTtlMs) || 0);
      const needsRefresh = !expiresAt || expiresAt - Date.now() < ttl;
      let recovered = false;
      if (forceRecover || needsRefresh || !w.session.sessionId) {
        if (forceRecover || !w.session.sessionId) recovered = await this._recoverSession();
        else {
          recovered = await this._refreshToken();
          if (!recovered) recovered = await this._recoverSession();
        }
        if (!recovered) {
          this.sessionRt.registered = false;
          this.account.valid = false;
          this._emitState('auth-required');
          return { ok: false, reason: 'auth-required' };
        }
      }

      // 从同一个恢复操作完成后的钱包读取快照，避免交叉使用旧 token/新 session。
      const latest = this.wallet.data;
      const cred = latest && latest.credentials;
      const session = latest && latest.session;
      const vip = latest && latest.vip;
      if (!cred || !cred.accessToken || !session || !session.sessionId) {
        this._emitState('auth-required');
        return { ok: false, reason: 'auth-required' };
      }
      const tier = classifyVipAccount(vip || {});
      if (!tier.isDownloadVip) {
        this._emitState('not-vip');
        return { ok: false, reason: 'not-vip' };
      }
      this.sessionRt.registered = true;
      this.sessionRt.lastError = '';
      this.account = { valid: true, uid: String(session.userId || ''), isVip: true,
        userVas: tier.userVas, vipType: tier.vipType, vipLevel: tier.vipLevel,
        checkedAt: vip.checkedAt || Date.now() };
      if (!this.engineRt.notified) this._tryNotify().catch(() => {});
      this._emitState('ready');
      return { ok: true, uid: String(session.userId || ''), accessToken: String(cred.accessToken),
        sessionId: String(session.sessionId), isVip: true, isDownloadVip: true,
        userVas: tier.userVas, vipType: tier.vipType, vipLevel: tier.vipLevel };
    } catch {
      this._emitState('auth-required');
      return { ok: false, reason: 'auth-required' };
    }
  }

  async logout() {
    this._stopPoll();
    this._stopKeepAlive();
    if (this.driver && this.driver.isHealthy()) { try { await this.driver.notifyLogout(); } catch {} }
    this.wallet.clear();
    this.loginFlow = { state: 'idle', error: '' };
    this.account = { valid: false, uid: null, isVip: false, userVas: 0, vipType: 0, vipLevel: 0, checkedAt: null };
    this.sessionRt = { registered: false, lastRegisterAt: null, lastKeepAliveAt: null, lastError: '' };
    this.engineRt = { notified: false, notifiedAt: null };
    this._notifyAttempts = 0; this._notifyRetryAt = 0;
    this._emitState('logout');
    return { loggedOut: true };
  }

  _err(msg) { const e = new Error(msg); e.code = 1; return e; }
  _stopKeepAlive() { if (this._kaTimer) { clearTimeout(this._kaTimer); this._kaTimer = null; } }

  // ---- 会话保活、令牌刷新、降级和引擎通知补偿 ----

  _keepAlivePeriodSec() {
    const s = this.wallet.data.session;
    const base = (s && Number(s.keepAlivePeriodSec)) || 300;
    const min = (s && Number(s.keepAliveMinPeriodSec)) || 30;
    let p = this.keepAliveOverride || base;
    if (p < min) p = min;
    if (p > 3600) p = 3600;
    return p;
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    if (!this.sessionRt.registered || this._stopped) return;
    const ms = this.keepAliveMs > 0 ? this.keepAliveMs : this._keepAlivePeriodSec() * 1000;
    this._kaTimer = setTimeout(() => { this._kaTimer = null; this._keepAliveTick().catch(() => {}); }, ms);
    if (this._kaTimer.unref) this._kaTimer.unref();
  }

  async _keepAliveTick() {
    if (!this.sessionRt.registered || this._stopped) return;
    const c = this.wallet.data.credentials;
    // 前瞻刷新：access_token 距过期 <300s 则先 refresh
    if (c && c.accessTokenExpiresAt && c.accessTokenExpiresAt - Date.now() < 300 * 1000) {
      const ok = await this._refreshToken();
      if (!ok) { this._degrade('token refresh failed'); return; }
    }
    // channel/put 保活
    const r = await this._channelPut();
    if (r === 'ok') {
      this.sessionRt.lastKeepAliveAt = Date.now();
      this.sessionRt.lastError = '';
      this._notifyCompensate();
      this._startKeepAlive();
    } else if (r === '401') {
      // 降级梯：re-register → refresh → re-register → degraded
      const ok = await this._recoverSession();
      if (ok) { this.sessionRt.lastKeepAliveAt = Date.now(); this._startKeepAlive(); }
      else this._degrade('session keep-alive failed');
    } else {
      this._degrade('keep-alive network error');
    }
  }

  async _refreshToken() {
    const c = this.wallet.data.credentials;
    if (!c || !c.refreshToken) return false;
    const r = await this.request('POST', this.apiOrigin + '/v1/auth/token', {
      headers: this._desktopAuthHeaders(),
      body: { client_id: this.clientId, client_secret: this.clientSecret,
        grant_type: 'refresh_token', refresh_token: c.refreshToken }, log: this.log });
    if (r.status === 200 && r.body && r.body.access_token) {
      const now = Date.now();
      this.wallet.data.credentials = {
        accessToken: r.body.access_token, refreshToken: r.body.refresh_token || c.refreshToken,
        accessTokenExpiresAt: now + (r.body.expires_in || 3600) * 1000, obtainedAt: now,
      };
      this.wallet.saveSync();
      return true;
    }
    return false;
  }

  async _channelPut() {
    const s = this.wallet.data.session;
    if (!s) return 'error';
    const common = this._oldAccountCommonBody();
    common.sessionID = s.sessionId;
    const r = await this.request('POST', this.apiOrigin + '/channel/put', {
      headers: { 'content-type': 'application/json' }, body: common, log: this.log });
    if (r.status === 200) return 'ok';
    if (r.status === 401) return '401';
    return 'error';
  }

  _oldAccountCommonBody() {
    const now = Date.now();
    return {
      appid: APP_ID, appName: APP_NAME, devicesign: this._deviceSign || '',
      deviceModel: 'NONE', deviceName: 'NONE', OSVersion: '10.0.19045',
      netWorkType: 'NONE', providerName: 'NONE', sdkVersion: '0.0.12',
      clientVersion: '25.0.82.1562', protocolVersion: '301',
      platformVersion: '10.0.19045', fromPlatformVersion: '10.0.19045',
      format: 'json', timestamp: now, creditkey: '',
    };
  }

  async _recoverSession() {
    // re-register（用当前 access_token）→ 若 register 说 token 失效 → refresh → re-register → 仍败则 degraded
    const c = this.wallet.data.credentials;
    if (!c) return false;
    const reg1 = await this._register(c.accessToken);
    if (reg1.ok) { this._applyRegister(reg1.body); return true; }
    // register 失败 → 尝试 refresh
    const refOk = await this._refreshToken();
    if (!refOk) return false;
    const reg2 = await this._register(this.wallet.data.credentials.accessToken);
    if (reg2.ok) { this._applyRegister(reg2.body); return true; }
    return false;
  }

  async _register(accessToken) {
    if (!accessToken) return { ok: false, status: 0 };
    const deviceId = this._ensureDeviceId();
    this._deviceSign = makeDeviceSign(deviceId);
    const url = `${this.apiOrigin}/session/v1/register?appid=${APP_ID}&token=${encodeURIComponent(accessToken)}&appname=${APP_NAME}&devicesign=${encodeURIComponent(this._deviceSign)}&securekey=`;
    const r = await this.request('GET', url, { log: this.log });
    if (r.status === 200 && r.body && r.body.sessionid) return { ok: true, body: r.body };
    return { ok: false, status: r.status };
  }

  _applyRegister(body) {
    const now = Date.now();
    this.wallet.data.session = { ...this.wallet.data.session,
      sessionId: body.sessionid, secureKey: body.secure_key, userId: String(body.user_id || this.wallet.data.session.userId),
      registeredAt: now, keepAlivePeriodSec: Number(body.keepAlivePeriod) || 300, keepAliveMinPeriodSec: Number(body.keepAliveMinPeriod) || 30 };
    this.wallet.saveSync();
    this._notifyCompensate();
  }

  _degrade(reason) {
    this.sessionRt.registered = false;
    this.account.valid = false;
    this.sessionRt.lastError = reason;
    this._stopKeepAlive();
    this._emitState('degraded');
  }

  async _notifyCompensate() {
    if (this.engineRt.notified || !this.sessionRt.registered || !this.driver || !this.driver.isHealthy()) return;
    if (this._notifyAttempts >= this.notifyBackoffMs.length) return; // 预算耗尽，等下次 up/logout
    if (Date.now() < this._notifyRetryAt) return;
    try {
      await this._tryNotify();
      if (this.engineRt.notified) { this._notifyAttempts = 0; this._notifyRetryAt = 0; }
    } catch {
      this._notifyRetryAt = Date.now() + (this.notifyBackoffMs[this._notifyAttempts] || 60000);
      this._notifyAttempts++;
    }
  }
}

function clampKeepAliveSec(n) { return Math.min(Math.max(n, 30), 3600); }

module.exports = { AuthManager, makeDeviceSign, readDeviceId, parseVipAccount, NOTIFY_SEQUENCE, clampKeepAliveSec };
