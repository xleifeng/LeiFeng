'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function safeCompare(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); }

class CaptureTokenStore {
  constructor({ filePath, clock = Date } = {}) { if (!filePath) throw new Error('CaptureTokenStore filePath is required'); this.filePath = filePath; this.clock = clock; this.state = { clients: [] }; this.pairings = new Map(); }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  load() { try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); if (value && Array.isArray(value.clients)) this.state = { clients: value.clients }; } catch {} try { fs.chmodSync(this.filePath, 0o600); } catch {} return this; }
  _save() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600, flag: 'w' }); try { fs.chmodSync(tmp, 0o600); } catch {} fs.renameSync(tmp, this.filePath); }
  issueClient({ origin, name = '下载接管客户端', permissions = ['submit'] } = {}) { const normalizedOrigin = String(origin || ''); if (!/^(?:(?:chrome|moz)-extension:\/\/|app:\/\/thunder-desktop$)/i.test(normalizedOrigin)) { const error = new Error('接管客户端来源无效'); error.code = 'CAPTURE_ORIGIN_INVALID'; throw error; } const token = crypto.randomBytes(32).toString('base64url'); const client = { id: crypto.randomBytes(10).toString('hex'), digest: digest(token), origin: normalizedOrigin, name: String(name).slice(0, 80), permissions: [...new Set((permissions || []).filter((item) => ['submit', 'view', 'control', 'stream'].includes(item)))], createdAt: this._now(), lastUsedAt: null, revokedAt: null }; this.state.clients.push(client); this._save(); return { clientId: client.id, token, origin: client.origin, permissions: client.permissions }; }
  revokeOrigin(origin, { exceptClientId = null } = {}) { let changed = false; for (const client of this.state.clients) { if (!client.revokedAt && client.origin === String(origin || '') && client.id !== String(exceptClientId || '')) { client.revokedAt = this._now(); changed = true; } } if (changed) this._save(); return changed; }
  createPairing({ permissions = ['submit'], expiresInMs = 5 * 60 * 1000 } = {}) { const pairingId = crypto.randomBytes(12).toString('base64url'); const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); const window = { pairingId, code, permissions: [...new Set(permissions.filter((item) => ['submit', 'view', 'control', 'stream'].includes(item)))], expiresAt: this._now() + expiresInMs, attempts: 0 }; this.pairings.set(pairingId, window); return { pairingId, code, expiresAt: window.expiresAt }; }
  acceptPairing({ pairingId, code, origin, name = '浏览器扩展' } = {}) { const window = this.pairings.get(String(pairingId)); if (!window || window.expiresAt <= this._now() || window.attempts >= 5) { this.pairings.delete(String(pairingId)); const error = new Error('配对窗口已失效'); error.code = 'PAIRING_EXPIRED'; throw error; } window.attempts += 1; if (!safeCompare(window.code, code)) { if (window.attempts >= 5) this.pairings.delete(String(pairingId)); const error = new Error('配对码错误'); error.code = 'PAIRING_CODE_INVALID'; throw error; } if (!/^((chrome|moz)-extension):\/\//i.test(String(origin || ''))) { const error = new Error('扩展来源无效'); error.code = 'CAPTURE_ORIGIN_INVALID'; throw error; } const client = this.issueClient({ origin: String(origin), name, permissions: window.permissions }); this.pairings.delete(String(pairingId)); return client; }
  authenticate(token, origin) { const hash = digest(token); const client = this.state.clients.find((item) => !item.revokedAt && item.digest === hash && item.origin === String(origin || '')); if (!client) return null; client.lastUsedAt = this._now(); this._save(); return { ...client, digest: undefined }; }
  list() { return this.state.clients.map(({ digest: _digest, ...client }) => ({ ...client })); }
  revoke(clientId) { const client = this.state.clients.find((item) => item.id === String(clientId)); if (!client) return false; client.revokedAt = this._now(); this._save(); return true; }
  isOriginAllowed(origin) { return this.state.clients.some((item) => !item.revokedAt && item.origin === String(origin || '')); }
}

module.exports = { CaptureTokenStore, digest };
