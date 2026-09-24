'use strict';

const fs = require('fs');
const path = require('path');

class RecentPathRepository {
  constructor({ filePath, max = 10 } = {}) { if (!filePath) throw new Error('RecentPathRepository filePath is required'); this.filePath = filePath; this.max = max; this.paths = []; this.loaded = false; }
  load() { if (this.loaded) return this; this.loaded = true; try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); this.paths = Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, this.max) : []; } catch { this.paths = []; } return this; }
  _write() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.paths, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.filePath); }
  list() { this.load(); return [...this.paths]; }
  remember(value) { this.load(); this.paths = [String(value), ...this.paths.filter((item) => item !== String(value))].slice(0, this.max); this._write(); return this.list(); }
  remove(value) { this.load(); this.paths = this.paths.filter((item) => item !== String(value)); this._write(); return this.list(); }
  clear() { this.load(); this.paths = []; this._write(); return []; }
}

module.exports = { RecentPathRepository };
