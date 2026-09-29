'use strict';

const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');

class MtlsClient {
  constructor({ endpoint, ca = '', cert, key, serverFingerprint, timeoutMs = 10000 } = {}) {
    if (!endpoint || !cert || !key || !serverFingerprint) throw new Error('MtlsClient endpoint, client certificate and server fingerprint are required');
    this.endpoint = new URL(endpoint);
    this.ca = ca ? fs.readFileSync(ca) : null;
    this.cert = fs.readFileSync(cert);
    this.key = fs.readFileSync(key);
    this.serverFingerprint = String(serverFingerprint).toLowerCase();
    this.timeoutMs = timeoutMs;
  }
  request(method, pathname, body) { return new Promise((resolve, reject) => { const payload = body === undefined ? null : Buffer.from(JSON.stringify(body)); const req = https.request(new URL(pathname, this.endpoint), { method, ...(this.ca ? { ca: this.ca } : {}), cert: this.cert, key: this.key, checkServerIdentity: () => undefined, rejectUnauthorized: false, headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}, timeout: this.timeoutMs }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { value = {}; } if (res.statusCode >= 400) { const error = new Error(value?.error?.message || `remote HTTP ${res.statusCode}`); error.code = value?.error?.code || 'REMOTE_HTTP_FAILED'; reject(error); } else resolve(value); }); }); req.on('socket', (socket) => socket.once('secureConnect', () => { const certificate = socket.getPeerCertificate(true); const actual = certificate?.raw ? crypto.createHash('sha256').update(certificate.raw).digest('hex') : ''; if (!actual || actual.toLowerCase() !== this.serverFingerprint) req.destroy(Object.assign(new Error('远程服务器证书指纹不匹配'), { code: 'REMOTE_CERT_MISMATCH' })); })); req.on('timeout', () => req.destroy(Object.assign(new Error('远程请求超时'), { code: 'REMOTE_TIMEOUT' }))); req.on('error', reject); if (payload) req.write(payload); req.end(); }); }
}

module.exports = { MtlsClient };
