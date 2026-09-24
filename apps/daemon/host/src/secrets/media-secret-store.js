'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class MediaSecretStore {
  constructor({ filePath, fsImpl = fs } = {}) {
    if (!filePath) throw new Error('MediaSecretStore filePath is required');
    this.filePath = filePath;
    this.fs = fsImpl;
    this.key = null;
  }

  load() {
    if (this.key) return this;
    try {
      const value = this.fs.readFileSync(this.filePath);
      if (value.length !== 32) throw new Error('invalid media secret');
      this.key = Buffer.from(value);
      try { this.fs.chmodSync(this.filePath, 0o600); } catch {}
    } catch {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      this.key = crypto.randomBytes(32);
      const tmp = `${this.filePath}.tmp`;
      this.fs.writeFileSync(tmp, this.key, { mode: 0o600, flag: 'wx' });
      try { this.fs.chmodSync(tmp, 0o600); } catch {}
      this.fs.renameSync(tmp, this.filePath);
    }
    return this;
  }

  getKey() { this.load(); return Buffer.from(this.key); }
}

module.exports = { MediaSecretStore };
