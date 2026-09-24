'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DaemonControlDispatcher } = require('../../host/src/control/dispatcher');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-dispatcher-')); const uploadsDir = path.join(root, 'uploads'); fs.mkdirSync(uploadsDir);
  let imports = 0; let released = 0;
  const dispatcher = new DaemonControlDispatcher({
    config: { runtimeDir: root, uploadsDir, maxTorrentUploadBytes: 1024, version: 'test', rpcSecret: '' },
    handle: async (method, params) => ({ method, params }), driver: { isHealthy: () => true, sdkReady: true, _generation: 2 },
    tasks: { repositoryRevision: 3, require: () => ({ displayName: 'demo', seedRef: 'sha256:x' }) }, seedStore: { resolve: () => path.join(root, 'seed.torrent') },
    createDraftService: { createTorrentDraftFromFile: async () => ({ draftId: `draft-${++imports}` }) },
    media: { issueToken: () => ({ token: 'token' }), resolveContent: () => ({ target: path.join(root, 'media.bin'), status: 200, mimeType: 'application/octet-stream', disposition: 'inline', etag: 'etag', start: 0, end: 0, length: 1, availableBytes: 1, complete: true, contentRange: null, task: { displayName: 'media.bin' }, release: () => { released += 1; } }) },
    capture: { tokens: { isOriginAllowed: () => true }, authenticate: () => null }, diagnostics: {}, remotePairing: { clients: new Map() }, taskQueryService: {}, operationService: {},
  });
  return { root, uploadsDir, dispatcher, imports: () => imports, released: () => released };
}

test('control dispatcher validates staged torrent boundary and preserves idempotency', async (t) => {
  const value = fixture(); t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const filePath = path.join(value.uploadsDir, 'sample.torrent'); fs.writeFileSync(filePath, 'd4:infod4:name4:testee');
  const params = { filePath, originalName: 'sample.torrent', idempotencyKey: 'same', context: {} };
  const first = await value.dispatcher.dispatch('daemon.v1.web.torrent.import', params, { id: 'web' }); const replay = await value.dispatcher.dispatch('daemon.v1.web.torrent.import', params, { id: 'web' });
  assert.deepEqual(replay, first); assert.equal(value.imports(), 1);
  const outside = path.join(value.root, 'outside.torrent'); fs.writeFileSync(outside, 'd4:infoe');
  await assert.rejects(value.dispatcher.dispatch('daemon.v1.web.torrent.import', { filePath: outside, context: {} }, { id: 'web' }), { code: 'STAGED_FILE_INVALID' });
});

test('control dispatcher ties media leases to a client connection', async (t) => {
  const value = fixture(); t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const connection = { id: 'web-connection' }; const resource = await value.dispatcher.dispatch('daemon.v1.web.media.open', { input: {}, context: {} }, connection);
  assert.ok(resource.leaseId); assert.equal(value.released(), 0);
  value.dispatcher.releaseConnection(connection); assert.equal(value.released(), 1);
});

test('control dispatcher binds torrent export capabilities to a client connection', async (t) => {
  const value = fixture(); t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(value.root, 'seed.torrent'), 'd4:infoe');
  const connection = { id: 'web-connection' };
  const resource = await value.dispatcher.dispatch('daemon.v1.web.torrent.export', { taskId: 'task-1', context: {} }, connection);
  assert.ok(resource.leaseId); assert.equal(value.dispatcher.leases.size, 1);
  value.dispatcher.releaseConnection(connection); assert.equal(value.dispatcher.leases.size, 0);
});
