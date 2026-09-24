'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { XUNLEI_CLIENT } = require('./xunlei-client-config');

const DEFAULT_ORIGIN = 'https://ali-pc-x-speed-auth-vip.xunlei.com';
const DEFAULT_ENDPOINT = `${DEFAULT_ORIGIN}/speed/speedup`;
const DEFAULT_RESOURCE_STATUS_ENDPOINT = `${DEFAULT_ORIGIN}/speed/res_status`;
const ZERO = (value) => Number(value) === 0;

class VipSpeedupError extends Error {
  constructor(code, status = 0, resultCode = undefined) {
    super(code);
    this.name = 'VipSpeedupError';
    this.code = code;
    this.status = Number(status) || 0;
    if (resultCode !== undefined) this.resultCode = Number(resultCode) || 0;
  }
}

function boundedString(value, max, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new VipSpeedupError('invalid-input');
    return '';
  }
  const out = String(value);
  if (out.length > max || (required && !out)) throw new VipSpeedupError('invalid-input');
  return out;
}

function deriveAesKey(uid, random, client = XUNLEI_CLIENT) {
  const u = boundedString(uid, 256, 'uid', { required: true });
  const r = boundedString(random, 128, 'random', { required: true });
  return crypto.createHash('md5').update(client.clientName + client.clientVersion + u + r)
    .digest('hex').toUpperCase().slice(0, 16);
}

function encryptJson(uid, random, value, client = XUNLEI_CLIENT) {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(deriveAesKey(uid, random, client), 'ascii'), null);
  return Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
}

function decryptJson(uid, random, value, client = XUNLEI_CLIENT) {
  if (!Buffer.isBuffer(value)) value = Buffer.from(value);
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(deriveAesKey(uid, random, client), 'ascii'), null);
  const plain = Buffer.concat([decipher.update(value), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function requestBinary(endpoint, { headers, body, timeoutMs, maxResponseBytes, signal } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(endpoint); } catch { reject(new VipSpeedupError('invalid-endpoint')); return; }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) { reject(new VipSpeedupError('invalid-endpoint')); return; }
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    const req = mod.request({ method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers, timeout: timeoutMs }, (res) => {
      const contentLength = Number(res.headers['content-length'] || 0);
      if (contentLength > maxResponseBytes) {
        res.destroy();
        finish(reject, new VipSpeedupError('response-too-large', res.statusCode));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxResponseBytes) {
          res.destroy();
          finish(reject, new VipSpeedupError('response-too-large', res.statusCode));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, { status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => finish(reject, new VipSpeedupError('connection-error', res.statusCode)));
    });
    req.on('timeout', () => { req.destroy(); finish(reject, new VipSpeedupError('timeout')); });
    req.on('error', () => finish(reject, new VipSpeedupError('connection-error')));
    const abort = () => { req.destroy(); finish(reject, new VipSpeedupError('aborted')); };
    if (signal) {
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      req.once('close', () => signal.removeEventListener('abort', abort));
    }
    req.write(body);
    req.end();
  });
}

function normalizeFiles(files, { infohash, maxItems, maxFieldLength }) {
  if (!Array.isArray(files) || files.length < 1 || files.length > maxItems)
    throw new VipSpeedupError('invalid-input');
  const hash = boundedString(infohash, maxFieldLength, 'infohash');
  return files.map((file) => {
    if (!file || !Number.isSafeInteger(Number(file.fileIndex)) || Number(file.fileIndex) < -1)
      throw new VipSpeedupError('invalid-input');
    const fileIndex = Number(file.fileIndex);
    const cid = boundedString(file.cid, maxFieldLength, 'cid', { required: true });
    const gcid = boundedString(file.gcid, maxFieldLength, 'gcid', { required: true });
    const name = boundedString(file.name, maxFieldLength, 'name', { required: true });
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new VipSpeedupError('invalid-input');
    const suppliedUrl = boundedString(file.url, maxFieldLength, 'url');
    const url = hash ? `bt://${hash}/${fileIndex}` : suppliedUrl;
    if (!url) throw new VipSpeedupError('invalid-input');
    return { fileIndex, url, filename: name, gcid, cid, filesize: size,
      traceId: boundedString(file.traceId, maxFieldLength, 'traceId') };
  });
}

class VipSpeedupClient {
  constructor({ endpoint, statusEndpoint, origin, timeoutMs = 15000, maxItems = 32, maxFieldLength = 4096,
    maxBodyBytes = 256 * 1024, maxResponseBytes = 4 * 1024 * 1024, maxTokenLength = 16384,
    requestAttempts = 2, transport = requestBinary, client = XUNLEI_CLIENT,
    random = () => Date.now(), log = () => {} } = {}) {
    const configuredOrigin = origin || process.env.THUNDERD_VIP_API_ORIGIN || '';
    this.endpoint = endpoint || (configuredOrigin ? new URL('/speed/speedup', configuredOrigin).toString() : DEFAULT_ENDPOINT);
    this.statusEndpoint = statusEndpoint || (configuredOrigin ? new URL('/speed/res_status', configuredOrigin).toString() : DEFAULT_RESOURCE_STATUS_ENDPOINT);
    this.timeoutMs = Math.max(100, Number(timeoutMs) || 15000);
    this.maxItems = Math.max(1, Math.min(128, Number(maxItems) || 32));
    this.maxFieldLength = Math.max(64, Math.min(16384, Number(maxFieldLength) || 4096));
    this.maxBodyBytes = Math.max(1, Number(maxBodyBytes) || 256 * 1024);
    this.maxResponseBytes = Math.max(1, Number(maxResponseBytes) || 4 * 1024 * 1024);
    this.maxTokenLength = Math.max(64, Math.min(1024 * 1024, Number(maxTokenLength) || 16384));
    this.requestAttempts = Math.max(1, Math.min(3, Number(requestAttempts) || 2));
    this.transport = typeof transport === 'function' ? transport : requestBinary;
    this.client = client;
    this.random = random;
    this.log = typeof log === 'function' ? log : () => {};
    this.clientSequence = 1;
  }

  _log(endpoint, summary) {
    try { this.log({ host: new URL(endpoint).host, path: new URL(endpoint).pathname, ...summary }); } catch {}
  }

  async _requestEncrypted(endpoint, context, payload, { signal, query = {} } = {}) {
    if (!context || !context.ok || !context.isVip) throw new VipSpeedupError('auth-required');
    const uid = boundedString(context.uid, this.maxFieldLength, 'uid', { required: true });
    const accessToken = boundedString(context.accessToken, this.maxFieldLength, 'accessToken', { required: true });
    const sessionId = boundedString(context.sessionId, this.maxFieldLength, 'sessionId', { required: true });
    const random = String(this.random());
    if (!/^\d{1,32}$/.test(random)) throw new VipSpeedupError('invalid-input');
    const body = encryptJson(uid, random, payload, this.client);
    if (body.length > this.maxBodyBytes) throw new VipSpeedupError('request-too-large');
    const u = new URL(endpoint);
    u.searchParams.set('client_name', this.client.clientName);
    u.searchParams.set('client_version', this.client.clientVersion);
    u.searchParams.set('client_sequence', String(this.clientSequence));
    this.clientSequence = this.clientSequence >= Number.MAX_SAFE_INTEGER ? 1 : this.clientSequence + 1;
    u.searchParams.set('r', random);
    u.searchParams.set('release_version', this.client.releaseVersion);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, String(value));
    }
    const request = {
      timeoutMs: this.timeoutMs, maxResponseBytes: this.maxResponseBytes, signal, body,
      headers: { accept: 'application/json; version=1.0', 'content-type': 'application/json',
        'content-length': String(body.length), Authorization: 'Basic ' + Buffer.from(uid + ':' + sessionId).toString('base64'),
        Authorization2: 'Bearer ' + accessToken },
    };
    let response;
    let lastError;
    for (let attempt = 0; attempt < this.requestAttempts; attempt++) {
      try {
        response = await this.transport(u.toString(), request);
        if (response && response.status === 200) break;
        lastError = new VipSpeedupError('http-error', response && response.status);
      } catch (error) {
        lastError = error instanceof VipSpeedupError ? error : new VipSpeedupError('connection-error');
        if (lastError.code === 'aborted' || !['connection-error', 'timeout'].includes(lastError.code)) throw lastError;
      }
    }
    if (!response || response.status !== 200) throw lastError || new VipSpeedupError('connection-error');
    const responseRandom = response.headers['random-num'];
    if (!responseRandom || Array.isArray(responseRandom)) throw new VipSpeedupError('missing-random', response.status);
    let data;
    try { data = decryptJson(uid, String(responseRandom), response.body, this.client); }
    catch { throw new VipSpeedupError('decrypt-failed', response.status); }
    return { status: response.status, data };
  }

  async requestTokens(context, { peerId, infohash, btTitle, files, signal } = {}) {
    const started = Date.now();
    let resultCode;
    try {
      const peer = boundedString(peerId, this.maxFieldLength, 'peerId', { required: true });
      const hash = boundedString(infohash, this.maxFieldLength, 'infohash');
      const normalized = normalizeFiles(files, { infohash: hash, maxItems: this.maxItems, maxFieldLength: this.maxFieldLength });
      const payload = { peer_id: peer,
        task_infos: normalized.map(({ fileIndex, url, filename, gcid, cid, filesize, traceId }) => ({
          url, filename, gcid, cid, filesize, traceId,
          ...(hash ? { file_index: fileIndex } : {}),
        })),
        extra_infos: { bt_token_mode: 1 } };
      if (hash) {
        payload.infohash = hash;
        payload.bt_title = boundedString(btTitle, this.maxFieldLength, 'btTitle');
      }
      const { status, data } = await this._requestEncrypted(this.endpoint, context, payload, {
        signal, query: { verify_type: 0, isvip: 1 },
      });
      if (!data || !ZERO(data.result) || !Array.isArray(data.task_infos)) {
        resultCode = Number(data && data.result) || 0;
        throw new VipSpeedupError('result-error', status, resultCode);
      }
      const items = normalized.map((file, index) => {
        const item = data.task_infos[index] || {};
        const rc = Number(item.result) || 0;
        const token = typeof item.token === 'string' && item.token.length > 0 && item.token.length <= this.maxTokenLength && !/[\r\n]/.test(item.token)
          ? item.token : null;
        return { fileIndex: file.fileIndex, token: ZERO(rc) && token ? token : null,
          resultCode: ZERO(rc) && token ? 0 : (ZERO(rc) ? 'invalid-token' : rc),
          intervalSec: Number(item.time_interval) > 0 ? Number(item.time_interval) : 0 };
      });
      const valid = items.filter((item) => item.token);
      if (!valid.length) throw new VipSpeedupError('item-error', status, items[0] && items[0].resultCode);
      const intervalValues = items.map((item) => item.intervalSec).filter((n) => Number.isFinite(n) && n > 0);
      const intervalSec = intervalValues.length ? Math.min(...intervalValues) : 3600;
      this._log(this.endpoint, { action: 'speedup', httpStatus: status, resultCode: 0, itemCount: items.length, durationMs: Date.now() - started });
      return { intervalSec, items };
    } catch (e) {
      const err = e instanceof VipSpeedupError ? e : new VipSpeedupError('protocol-error');
      this._log(this.endpoint, { action: 'speedup', httpStatus: err.status || 0, resultCode: err.resultCode, itemCount: 0, durationMs: Date.now() - started });
      throw err;
    }
  }

  async requestResourceStatus(context, { peerId, infohash, btTitle, files, signal } = {}) {
    const started = Date.now();
    let resultCode;
    try {
      const peer = boundedString(peerId, this.maxFieldLength, 'peerId', { required: true });
      const hash = boundedString(infohash, this.maxFieldLength, 'infohash');
      const normalized = normalizeFiles(files, { infohash: hash, maxItems: this.maxItems, maxFieldLength: this.maxFieldLength });
      const payload = { peer_id: peer,
        task_infos: normalized.map(({ fileIndex, url, filename, gcid, cid, filesize, traceId }) => ({
          url, filename, gcid, cid, filesize, traceId,
          ...(hash ? { file_index: fileIndex } : {}),
        })) };
      if (hash) {
        payload.infohash = hash;
        payload.bt_title = boundedString(btTitle, this.maxFieldLength, 'btTitle');
      }
      const { status, data } = await this._requestEncrypted(this.statusEndpoint, context, payload, {
        signal, query: { verify_type: 0, isvip: 1, need_check_filter: 1, need_check_sec: 1 },
      });
      if (!data || !ZERO(data.result) || !Array.isArray(data.task_infos)) {
        resultCode = Number(data && data.result) || 0;
        throw new VipSpeedupError('result-error', status, resultCode);
      }
      const items = normalized.map((file, index) => {
        const item = data.task_infos[index] || {};
        const filterResult = item.filter_result !== null && item.filter_result !== undefined && Number.isFinite(Number(item.filter_result)) ? Number(item.filter_result) : null;
        const secResult = item.sec_result !== null && item.sec_result !== undefined && Number.isFinite(Number(item.sec_result)) ? Number(item.sec_result) : null;
        return { fileIndex: file.fileIndex, banned: filterResult !== null ? filterResult !== 0 : null,
          eligible: secResult !== null ? secResult === 0 : null, filterResult, secResult };
      });
      this._log(this.statusEndpoint, { action: 'resource-status', httpStatus: status, resultCode: 0, itemCount: items.length, durationMs: Date.now() - started });
      return { items };
    } catch (e) {
      const err = e instanceof VipSpeedupError ? e : new VipSpeedupError('protocol-error');
      this._log(this.statusEndpoint, { action: 'resource-status', httpStatus: err.status || 0, resultCode: err.resultCode, itemCount: 0, durationMs: Date.now() - started });
      throw err;
    }
  }
}

module.exports = { VipSpeedupClient, VipSpeedupError, deriveAesKey, encryptJson, decryptJson, normalizeFiles,
  DEFAULT_ENDPOINT, DEFAULT_RESOURCE_STATUS_ENDPOINT };
