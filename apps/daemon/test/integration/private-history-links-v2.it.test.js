'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteDatabase } = require('../../host/src/repositories/sqlite-database');
const { HistoryRepository } = require('../../host/src/repositories/history-repository');
const { LinkRepository } = require('../../host/src/repositories/link-repository');

test('private/history/link V2 data contract keeps public rows redacted and local links replayable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-private-history-it-')); const db = new SqliteDatabase({ filePath: path.join(root, 'thunder-data.db') }).open(); const history = new HistoryRepository({ db }); const links = new LinkRepository({ db });
  history.upsertFromTask({ id: 'public', revision: 1, kind: 'http', displayName: 'public.bin', source: 'https://example.test/public', sourceFingerprint: 'public-fp', savePath: root, lifecycle: 'completed', createdAt: 1, privateSpace: false });
  history.upsertFromTask({ id: 'private', revision: 1, kind: 'http', displayName: 'private.bin', source: 'https://example.test/private', sourceFingerprint: 'private-fp', savePath: root, lifecycle: 'completed', createdAt: 1, privateSpace: true, privatePayload: { version: 1, iv: 'iv', tag: 'tag', ciphertext: 'cipher' } });
  const publicRows = history.query({}); assert.equal(publicRows.items.length, 1); assert.equal(publicRows.items[0].displayName, 'public.bin'); const privateRow = history.get(history.query({ privateMode: true }).items[0].id, { allowPrivate: true }); assert.equal(privateRow.privateSpace, true); assert.ok(privateRow.privatePayload);
  const link = links.save({ source: 'https://example.test/public', sourceFingerprint: 'public-fp', title: 'public' }); assert.equal(links.query({}).items[0].id, link.id); assert.equal(links.setTags(link.id, ['local']).tags[0].name, 'local'); db.close();
});
