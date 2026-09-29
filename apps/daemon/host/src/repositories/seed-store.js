'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SeedStore {
  constructor({ rootDir, clock = Date } = {}) { if (!rootDir) throw new Error('SeedStore rootDir is required'); this.rootDir = path.resolve(rootDir); this.indexPath = path.join(this.rootDir, 'index.json'); this.clock = clock; this.index = { schemaVersion: 1, seeds: {} }; this.loaded = false; }
  _load() { if (this.loaded) return; this.loaded = true; try { const value = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); if (value && value.schemaVersion === 1 && value.seeds) this.index = value; } catch {} }
  _write() { fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 }); const temp = `${this.indexPath}.tmp-${process.pid}`; fs.writeFileSync(temp, JSON.stringify(this.index, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.indexPath); }
  importFile(sourcePath) { this._load(); fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 }); const hash = crypto.createHash('sha256'); const data = fs.readFileSync(sourcePath); hash.update(data); const digest = hash.digest('hex'); const target = path.join(this.rootDir, `${digest}.torrent`); if (!fs.existsSync(target)) { const temp = `${target}.tmp-${process.pid}`; fs.writeFileSync(temp, data, { mode: 0o600 }); fs.renameSync(temp, target); } const timestamp = Number(this.clock.now ? this.clock.now() : Date.now()); const seedRef = `sha256:${digest}`; const current = this.index.seeds[digest] || { owners: {}, createdAt: timestamp }; current.lastUsedAt = timestamp; this.index.seeds[digest] = current; this._write(); return seedRef; }
  resolve(seedRef) { this._load(); const match = /^sha256:([a-f0-9]{64})$/i.exec(String(seedRef || '')); if (!match) { const error = new Error('seedRef 无效'); error.code = 'INVALID_SEED_REF'; throw error; } const target = path.join(this.rootDir, `${match[1].toLowerCase()}.torrent`); if (!fs.existsSync(target)) { const error = new Error('seed 不存在'); error.code = 'SEED_NOT_FOUND'; throw error; } return target; }
  retain(seedRef, ownerId) { this._load(); const match = /^sha256:([a-f0-9]{64})$/i.exec(String(seedRef || '')); if (!match || !ownerId) return false; const digest = match[1].toLowerCase(); const item = this.index.seeds[digest] || { owners: {}, createdAt: Date.now() }; item.owners[String(ownerId)] = Number(this.clock.now ? this.clock.now() : Date.now()); item.lastUsedAt = Number(this.clock.now ? this.clock.now() : Date.now()); this.index.seeds[digest] = item; this._write(); return true; }
  release(seedRef, ownerId) { this._load(); const match = /^sha256:([a-f0-9]{64})$/i.exec(String(seedRef || '')); if (!match || !ownerId) return false; const item = this.index.seeds[match[1].toLowerCase()]; if (!item) return false; delete item.owners[String(ownerId)]; item.lastUsedAt = Number(this.clock.now ? this.clock.now() : Date.now()); this._write(); return true; }
  exportStream(seedRef) { return fs.createReadStream(this.resolve(seedRef)); }
  sweepUnreferenced({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) { this._load(); const at = Number(this.clock.now ? this.clock.now() : Date.now()); let removed = 0; for (const [digest, item] of Object.entries(this.index.seeds)) { if (Object.keys(item.owners || {}).length || at - Number(item.lastUsedAt || item.createdAt || at) < olderThanMs) continue; try { fs.rmSync(path.join(this.rootDir, `${digest}.torrent`), { force: true }); } catch {} delete this.index.seeds[digest]; removed += 1; } if (removed) this._write(); return removed; }
}

module.exports = { SeedStore };
