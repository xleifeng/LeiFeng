'use strict';

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const { execFileSync } = require('node:child_process');

function sqlValue(value) { if (value === null || value === undefined) return 'NULL'; if (typeof value === 'number' && Number.isFinite(value)) return String(value); if (typeof value === 'boolean') return value ? '1' : '0'; return `'${String(value).replace(/'/g, "''")}'`; }
function bind(sql, params = []) { let index = 0; return String(sql).replace(/\?/g, () => sqlValue(params[index++])); }

class SqliteDatabase {
  constructor({ filePath, backupDir = path.join(path.dirname(filePath), 'backups'), migrationsDir = path.join(__dirname, 'migrations'), log = console } = {}) { if (!filePath) throw new Error('SqliteDatabase filePath is required'); this.filePath = filePath; this.backupDir = backupDir; this.migrationsDir = migrationsDir; this.log = log; this.driver = null; this.opened = false; }
  open() { if (this.opened) return this; fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); this.opened = true; try { const Better = require('better-sqlite3'); this.driver = new Better(this.filePath); this.driver.pragma('journal_mode = WAL'); this.driver.pragma('synchronous = NORMAL'); /* WAL+NORMAL: 掉电只丢末尾事务不损坏; FULL 会 jbd2 fsync 风暴 */ this.driver.pragma('foreign_keys = ON'); this.driver.pragma('busy_timeout = 5000'); } catch { this.driver = 'sqlite3-cli'; this.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'); } this.migrate(); return this; }
  _ensure() { if (!this.opened) this.open(); }
  exec(sql) { this._ensure(); if (this.driver !== 'sqlite3-cli') return this.driver.exec(sql); return execFileSync('sqlite3', [this.filePath, String(sql)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
  run(sql, params = []) { this._ensure(); const text = bind(sql, params); if (this.driver !== 'sqlite3-cli') { const statement = this.driver.prepare(sql); const result = statement.run(...params); return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }; } this.exec(text); return { changes: 0, lastInsertRowid: null }; }
  all(sql, params = []) { this._ensure(); if (this.driver !== 'sqlite3-cli') return this.driver.prepare(sql).all(...params); const output = execFileSync('sqlite3', ['-json', this.filePath, bind(sql, params)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim(); return output ? JSON.parse(output) : []; }
  get(sql, params = []) { return this.all(sql, params)[0] || null; }
  transaction(fn) { this._ensure(); if (this.driver !== 'sqlite3-cli') return this.driver.transaction(fn)(); return fn(); }
  migrate() { this._ensure(); this.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, checksum TEXT NOT NULL);'); const files = fs.existsSync(this.migrationsDir) ? fs.readdirSync(this.migrationsDir).filter((name) => /^\d+-.+\.sql$/.test(name)).sort() : []; for (const file of files) { const version = Number(file.match(/^\d+/)[0]); if (this.get('SELECT version FROM schema_migrations WHERE version=?', [version])) continue; const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8'); const checksum = crypto.createHash('sha256').update(sql).digest('hex'); this.transaction(() => { this.exec(sql); this.run('INSERT INTO schema_migrations(version, applied_at, checksum) VALUES (?, ?, ?)', [version, Date.now(), checksum]); }); } }
  integrityCheck() { return this.get('PRAGMA integrity_check')?.integrity_check || 'unknown'; }
  // 备份保留上限：每次启停各留一份全库，无 prune 会无限增长（审计 2026-09-23：
  // 一天测试即 63 份）。保留最近 maxBackups 份，顺带清掉复制时残留的 -shm/-wal。
  backup() {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const target = path.join(this.backupDir, `thunder-data-${Date.now()}.db`);
    if (this.driver !== 'sqlite3-cli') { try { this.driver.pragma('wal_checkpoint(FULL)'); } catch {} }
    fs.copyFileSync(this.filePath, target);
    this.pruneBackups();
    return target;
  }

  pruneBackups(maxBackups = 10) {
    let entries;
    try { entries = fs.readdirSync(this.backupDir); } catch { return; }
    const stamps = entries.filter((n) => /^thunder-data-(\d+)\.db$/.exec(n)).map((n) => ({ n, t: Number(/^thunder-data-(\d+)\.db$/.exec(n)[1]) })).sort((a, b) => b.t - a.t);
    const doomed = new Set(stamps.slice(maxBackups).map((x) => x.n));
    for (const name of entries) {
      // 残留的 sidecar（.db-shm/.db-wal 谐音 thunder-data-*.db-*）也一并清
      if (doomed.has(name) || (/^thunder-data-\d+\.db-(shm|wal)$/.test(name) && doomed.has(name.replace(/-(shm|wal)$/, '')))) {
        try { fs.rmSync(path.join(this.backupDir, name), { force: true }); } catch {}
      }
    }
  }
  close() { if (this.driver && this.driver !== 'sqlite3-cli') this.driver.close(); this.driver = null; this.opened = false; }
}

module.exports = { SqliteDatabase, sqlValue, bind };
