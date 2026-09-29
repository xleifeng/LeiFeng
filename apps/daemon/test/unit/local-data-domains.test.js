'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteDatabase } = require('../../host/src/repositories/sqlite-database');
const { HistoryRepository } = require('../../host/src/repositories/history-repository');
const { LinkRepository } = require('../../host/src/repositories/link-repository');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { PrivateSpaceSecretStore } = require('../../host/src/secrets/private-space-secret-store');
const { PrivateSpaceService } = require('../../host/src/services/private-space-service');
const { HistoryService } = require('../../host/src/services/history-service');
const { LinkLibraryService } = require('../../host/src/services/link-library-service');
const { DomainEventBus } = require('../../host/src/services/domain-event-bus');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-local-data-')); }

test('sqlite migrations are durable and history/link repositories round-trip', () => {
  const root = temp(); const db = new SqliteDatabase({ filePath: path.join(root, 'data', 'thunder-data.db') }).open();
  assert.equal(db.integrityCheck(), 'ok'); assert.deepEqual(db.all('SELECT version FROM schema_migrations ORDER BY version').map((row) => row.version), [1, 2, 3, 4]);
  const history = new HistoryRepository({ db });
  const task = { id: 'task-1', revision: 2, kind: 'http', displayName: 'demo.bin', source: 'https://example.test/demo.bin', sourceFingerprint: 'fp-1', savePath: root, totalBytes: 12, lifecycle: 'completed', createdAt: 1, completedAt: 2, error: null, privateSpace: false };
  const row = history.upsertFromTask(task); assert.equal(row.displayName, 'demo.bin'); assert.equal(history.query({ search: 'demo' }).items.length, 1); assert.equal(history.count(), 1);
  const links = new LinkRepository({ db }); const link = links.save({ source: task.source, sourceFingerprint: task.sourceFingerprint, kind: 'http', title: 'demo', totalBytes: 12 });
  assert.equal(link.favorite, false); const tagged = links.setTags(link.id, ['电影', '收藏']); assert.deepEqual(tagged.tags.map((tag) => tag.name), ['收藏', '电影']); assert.equal(links.setFavorite(link.id, true).favorite, true);
  db.close(); const reopened = new SqliteDatabase({ filePath: path.join(root, 'data', 'thunder-data.db') }).open(); assert.equal(reopened.integrityCheck(), 'ok'); assert.equal(new LinkRepository({ db: reopened }).query({ favorite: true }).items.length, 1); reopened.close();
});

test('private space encrypts metadata, uses expiring session and hides it from normal task query', async () => {
  const root = temp(); const tasks = new TaskRepository({ filePath: path.join(root, 'tasks.json') }); tasks.load();
  const secrets = new PrivateSpaceSecretStore({ filePath: path.join(root, 'secrets', 'private.json') });
  const service = new PrivateSpaceService({ secretStore: secrets, tasks, defaultDirectory: path.join(root, 'private'), ttlMs: 20 });
  const setup = service.setup({ password: 'correct horse', directory: path.join(root, 'private') }); assert.equal(setup.status.unlocked, false);
  const task = tasks.create({ source: 'https://example.test/secret.bin', sourceFingerprint: 'private-source', displayName: 'secret.bin', savePath: root, kind: 'http', lifecycle: 'completed' });
  const unlocked = service.unlock({ password: 'correct horse' }); assert.ok(unlocked.sessionToken); const context = { privateSession: unlocked.sessionToken };
  const moved = await service.moveIn({ taskId: task.id, expectedRevision: task.revision }, context); assert.equal(moved.task.displayName, 'secret.bin'); const stored = tasks.get(task.id); assert.equal(stored.displayName, '私人任务'); assert.equal(stored.source, null); assert.ok(stored.privatePayload);
  assert.equal(service.queryTasks({}, context)[0].displayName, 'secret.bin'); service.lock(unlocked.sessionToken); assert.throws(() => service.queryTasks({}, context), (error) => error.code === 'PRIVATE_SPACE_LOCKED');
  const renewed = service.unlock({ password: 'correct horse' }); const movedOut = await service.moveOut({ taskId: task.id, targetDirectory: path.join(root, 'public'), expectedRevision: tasks.get(task.id).revision }, { privateSession: renewed.sessionToken }); assert.equal(movedOut.task.privateSpace, false); assert.equal(tasks.get(task.id).displayName, 'secret.bin');
});

test('history and link services consume task events idempotently', () => {
  const root = temp(); const tasks = new TaskRepository({ filePath: path.join(root, 'tasks.json') }); tasks.load(); const db = new SqliteDatabase({ filePath: path.join(root, 'data.db') }).open(); const bus = new DomainEventBus();
  const history = new HistoryService({ repository: new HistoryRepository({ db }), tasks, eventBus: bus }); const links = new LinkLibraryService({ repository: new LinkRepository({ db }), tasks, eventBus: bus }); history.start(); links.start();
  const task = tasks.create({ source: 'https://example.test/a.bin', sourceFingerprint: 'fp-a', displayName: 'a.bin', savePath: root, kind: 'http', lifecycle: 'completed', completedAt: 3 });
  bus.emit('task.transition', { taskId: task.id, revision: task.revision, to: 'completed' }); bus.emit('task.transition', { taskId: task.id, revision: task.revision, to: 'completed' });
  assert.equal(history.repository.count(), 1); assert.equal(links.repository.query({}).items.length, 1); history.stop(); links.stop(); db.close();
});
