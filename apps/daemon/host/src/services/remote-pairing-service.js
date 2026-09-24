'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class RemotePairingService {
  constructor({ clock = Date, certificateFingerprint = '', filePath = '' } = {}) { this.clock = clock; this.certificateFingerprint = certificateFingerprint; this.filePath = filePath; this.windows = new Map(); this.clients = new Map(); this._load(); }
  _load() { if (!this.filePath) return; try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); for (const client of value.clients || []) if (/^[a-f0-9]{64}$/i.test(String(client.certificateFingerprint || ''))) this.clients.set(String(client.certificateFingerprint).toLowerCase(), { ...client, certificateFingerprint: String(client.certificateFingerprint).toLowerCase() }); } catch {} }
  _save() { if (!this.filePath) return; fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); const temp = `${this.filePath}.tmp`; fs.writeFileSync(temp, JSON.stringify({ clients: this.queryPairedClients() }, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.filePath); }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  startServerPairing({ permissions = ['submit', 'view'], expiresInSeconds = 300 } = {}) { if (!/^[a-f0-9]{64}$/i.test(this.certificateFingerprint)) { const error = new Error('远程 mTLS 监听证书尚未配置'); error.code = 'REMOTE_UNAVAILABLE'; throw error; } const pairingId = crypto.randomBytes(12).toString('base64url'); const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); const window = { pairingId, code, permissions: [...new Set(permissions.filter((item) => ['submit', 'view', 'control', 'stream'].includes(item)))], expiresAt: this._now() + Math.min(600, Math.max(30, Number(expiresInSeconds) || 300)) * 1000, attempts: 0 }; this.windows.set(pairingId, window); return { pairingId, code, expiresAt: window.expiresAt, serverFingerprint: this.certificateFingerprint }; }
  acceptClient({ pairingId, code, clientId, certificateFingerprint, name, requestedPermissions = [] } = {}) { const window = this.windows.get(String(pairingId)); if (!window || window.expiresAt <= this._now() || window.attempts >= 5) { const error = new Error('远程配对窗口已失效'); error.code = 'PAIRING_EXPIRED'; throw error; } window.attempts += 1; if (String(code) !== window.code) { const error = new Error('远程配对码错误'); error.code = 'PAIRING_CODE_INVALID'; throw error; } const normalizedFingerprint = String(certificateFingerprint || '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(normalizedFingerprint)) { const error = new Error('远程客户端证书指纹无效'); error.code = 'REMOTE_FINGERPRINT_INVALID'; throw error; } const client = { id: String(clientId || crypto.randomBytes(8).toString('hex')), certificateFingerprint: normalizedFingerprint, name: String(name || '远程节点').slice(0, 100), permissions: [...new Set(requestedPermissions.filter((item) => window.permissions.includes(item)))], createdAt: this._now(), revokedAt: null }; this.clients.set(client.certificateFingerprint, client); this.windows.delete(window.pairingId); this._save(); return { ...client }; }
  getActiveWindow() { for (const [id, item] of this.windows) { if (item.expiresAt <= this._now()) this.windows.delete(id); } return this.windows.values().next().value || null; }
  stopServerPairing({ pairingId } = {}) { return this.windows.delete(String(pairingId)); }
  queryPairedClients() { return [...this.clients.values()].map((item) => ({ ...item })); }
  revokeClient(clientId) { const client = [...this.clients.values()].find((item) => item.id === String(clientId) || item.certificateFingerprint === String(clientId).toLowerCase()); if (!client) return false; client.revokedAt = this._now(); this._save(); return true; }
}

module.exports = { RemotePairingService };
