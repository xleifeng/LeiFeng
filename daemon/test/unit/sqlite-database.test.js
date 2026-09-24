'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteDatabase } = require('../../host/src/repositories/sqlite-database');

test('SQLite database opens with migrations, integrity check and recoverable backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-sqlite-')); const file = path.join(root, 'data', 'thunder-data.db'); const db = new SqliteDatabase({ filePath: file, backupDir: path.join(root, 'backups') }).open();
  assert.equal(db.integrityCheck(), 'ok'); assert.equal(db.all('SELECT COUNT(*) AS count FROM schema_migrations')[0].count, 4); const backup = db.backup(); assert.ok(fs.existsSync(backup)); db.close();
});
