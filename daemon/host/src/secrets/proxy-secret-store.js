'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

class ProxySecretStore {
  constructor({ filePath, clock = Date } = {}) {
    if (!filePath) throw new Error('ProxySecretStore filePath is required');
    this.filePath = filePath;
    this.clock = clock;
    this.state = { schemaVersion: 1, secrets: {} };
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!value || value.schemaVersion !== 1 || !value.secrets || typeof value.secrets !== 'object') throw new Error('invalid proxy secret schema');
        this.state = { schemaVersion: 1, secrets: value.secrets };
      }
    } catch (error) {
      try { fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch {}
      this.state = { schemaVersion: 1, secrets: {} };
    }
    return this;
  }

  _write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(this.filePath), 0o700); } catch {}
    const temp = `${this.filePath}.tmp`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(this.state, null, 2), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }

  _ensure() { if (!this.loaded) this.load(); }

  set({ username = '', password = '' } = {}) {
    this._ensure();
    if (typeof password !== 'string' || !password) { const error = new Error('代理密码不能为空'); error.code = 'INVALID_PROXY_SECRET'; throw error; }
    const ref = `proxy:${crypto.randomBytes(18).toString('base64url')}`;
    this.state.secrets[ref] = { username: String(username || ''), password, createdAt: Date.now() };
    this._write();
    return ref;
  }

  get(ref) { this._ensure(); const value = this.state.secrets[String(ref || '')]; return value ? clone(value) : null; }
  has(ref) { return !!this.get(ref); }
  delete(ref) { this._ensure(); const key = String(ref || ''); if (!this.state.secrets[key]) return false; delete this.state.secrets[key]; this._write(); return true; }
  rotate(oldRef, secret) { const next = this.set(secret); if (oldRef && oldRef !== next) this.delete(oldRef); return next; }
  snapshot() { this._ensure(); return Object.fromEntries(Object.entries(this.state.secrets).map(([ref, value]) => [ref, { username: value.username, createdAt: value.createdAt }])); }
}

module.exports = { ProxySecretStore };
