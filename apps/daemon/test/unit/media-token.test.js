'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskRepository } = require('../../host/src/repositories/task-repository');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');
const { MediaSecretStore } = require('../../host/src/secrets/media-secret-store');
const { MediaService } = require('../../host/src/services/media-service');

test('media tokens bind task file revision and inode without exposing path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-token-v2-')); const downloads = path.join(root, 'downloads'); fs.mkdirSync(downloads, { recursive: true });
  const file = path.join(downloads, 'movie.mp4'); fs.writeFileSync(file, Buffer.alloc(10, 1));
  const tasks = new TaskRepository({ filePath: path.join(root, 'tasks.json') }); tasks.load(); const task = tasks.create({ id: 'task-media-1', displayName: 'movie.mp4', savePath: downloads, source: 'https://example.test/movie.mp4', lifecycle: 'completed', totalBytes: 10, completedBytes: 10 });
  const media = new MediaService({ tasks, resolver: new SafePathResolver({ allowedRoots: [downloads] }), secretStore: new MediaSecretStore({ filePath: path.join(root, 'media.key') }).load() });
  const issued = media.issueToken({ taskId: task.id, fileIndex: 0 });
  assert.equal(issued.mediaKind, 'video'); assert.equal(issued.availableBytes, 10); assert.equal(issued.token.includes(file), false);
  const response = media.resolveContent({ taskId: task.id, fileIndex: 0, token: issued.token, rangeHeader: 'bytes=2-5' });
  assert.equal(response.status, 206); assert.equal(response.length, 4); response.release();
  tasks.mutate(task.id, {}, { displayName: 'renamed.mp4' });
  assert.throws(() => media.resolveContent({ taskId: task.id, fileIndex: 0, token: issued.token }), { code: 'MEDIA_TOKEN_STALE' });
});

test('private media requires a valid private session at issue and read time', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-private-v2-')); const downloads = path.join(root, 'downloads'); fs.mkdirSync(downloads, { recursive: true });
  const file = path.join(downloads, 'secret.mp3'); fs.writeFileSync(file, Buffer.alloc(4));
  const tasks = new TaskRepository({ filePath: path.join(root, 'tasks.json') }); tasks.load(); const task = tasks.create({ id: 'task-private-media', displayName: 'secret.mp3', savePath: downloads, source: 'https://example.test/secret.mp3', lifecycle: 'completed', privateSpace: true, totalBytes: 4, completedBytes: 4 });
  const privateSpace = { authorize: (value) => value === 'ok', sessionGeneration: () => 7, isGenerationActive: (value) => value === 7 };
  const media = new MediaService({ tasks, resolver: new SafePathResolver({ allowedRoots: [downloads] }), secretStore: new MediaSecretStore({ filePath: path.join(root, 'media.key') }).load(), privateSpace });
  assert.throws(() => media.issueToken({ taskId: task.id, fileIndex: 0 }, { privateSession: 'bad' }), { code: 'PRIVATE_SPACE_LOCKED' });
  const issued = media.issueToken({ taskId: task.id, fileIndex: 0 }, { privateSession: 'ok' });
  assert.throws(() => media.resolveContent({ taskId: task.id, fileIndex: 0, token: issued.token }, { privateSession: 'bad' }), { code: 'PRIVATE_SPACE_LOCKED' });
  const content = media.resolveContent({ taskId: task.id, fileIndex: 0, token: issued.token }, { privateSession: 'ok' }); content.release();
  const browserContent = media.resolveContent({ taskId: task.id, fileIndex: 0, token: issued.token }); browserContent.release();
});
