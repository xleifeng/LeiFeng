'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTorrentUploadRoute } = require('../src/routes/torrent-upload');
const { createTaskMediaRoutes } = require('../src/routes/task-media');
const { createTaskExportRoute } = require('../src/routes/task-export');
const { createDiagnosticExportRoute } = require('../src/routes/diagnostic-export');
const { createBrowserCaptureRoute } = require('../src/routes/browser-capture');
const { invokeHttp } = require('../../daemon/test/unit/helpers/http-fixture');

test('external torrent route stages bytes and sends only a private file capability to daemon', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-upload-')); let observed;
  const client = { call: async (method, params) => { observed = { method, exists: fs.existsSync(params.filePath), bytes: fs.readFileSync(params.filePath).length, params }; return { draft: { draftId: 'draft-1' } }; } };
  const route = createTorrentUploadRoute({ client, tempRoot: root, maxBytes: 1024 });
  const handler = (req, res) => route.tryHandle(req, res, { authorization: 'Bearer secret', isLoopback: true });
  const response = await invokeHttp(handler, { method: 'POST', url: '/api/v2/create-drafts/torrent', headers: { 'content-type': 'application/x-bittorrent', 'x-thunder-filename': encodeURIComponent('sample.torrent') }, body: Buffer.from('d4:infod4:name4:testee') });
  assert.equal(response.status, 201); assert.equal(observed.method, 'daemon.v1.web.torrent.import'); assert.equal(observed.exists, true); assert.ok(observed.bytes > 0); assert.equal(fs.existsSync(observed.params.filePath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('external media route releases daemon lease after range streaming', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-media-')); const file = path.join(root, 'clip.mp4'); fs.writeFileSync(file, '0123456789'); let released = false;
  const client = { call: async (method) => { if (method.endsWith('media.issueToken')) return { token: 'token' }; if (method.endsWith('media.open')) return { leaseId: 'lease-1', path: file, status: 206, mimeType: 'video/mp4', disposition: 'inline', etag: 'etag', start: 2, end: 5, length: 4, contentRange: 'bytes 2-5/10', displayName: 'clip.mp4' }; if (method.endsWith('lease.release')) { released = true; return { released: true }; } throw new Error(method); } };
  const route = createTaskMediaRoutes({ client }); const handler = (req, res) => route.tryHandle(req, res, { isLoopback: true });
  const response = await invokeHttp(handler, { method: 'GET', url: '/api/v2/tasks/t1/files/0/content?token=token', headers: { range: 'bytes=2-5' } });
  assert.equal(response.status, 206); assert.equal(response.body.toString(), '2345');
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(released, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('external task and diagnostic exports stream daemon capabilities without exposing paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-exports-')); const torrent = path.join(root, 'seed.torrent'); const zip = path.join(root, 'diagnostics.zip'); fs.writeFileSync(torrent, 'd4:infoe'); fs.writeFileSync(zip, Buffer.from('PK\x03\x04payload', 'binary')); const released = [];
  const client = { call: async (method, params) => { if (method.endsWith('torrent.export')) return { path: torrent, length: fs.statSync(torrent).size, filename: 'demo.torrent', leaseId: 'torrent-lease' }; if (method.endsWith('diagnostics.export')) return { path: zip, length: fs.statSync(zip).size, leaseId: 'diagnostic-lease', manifest: { exportId: 'export-1' } }; if (method.endsWith('lease.release')) { released.push(params.leaseId); return { released: true }; } throw new Error(method); }, releaseLease(leaseId) { return this.call('daemon.v1.web.lease.release', { leaseId }); } };
  const taskRoute = createTaskExportRoute({ client }); const task = await invokeHttp((req, res) => taskRoute.tryHandle(req, res, {}), { method: 'GET', url: '/api/v2/tasks/task-1/torrent' });
  assert.equal(task.status, 200); assert.equal(task.body.toString(), 'd4:infoe'); assert.doesNotMatch(JSON.stringify(task.headers), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.deepEqual(released, ['torrent-lease']);
  const diagnosticRoute = createDiagnosticExportRoute({ client }); const diagnostic = await invokeHttp((req, res) => diagnosticRoute.tryHandle(req, res, {}), { method: 'GET', url: '/api/v2/diagnostics/exports/export-1' });
  assert.equal(diagnostic.status, 200); assert.equal(diagnostic.body.subarray(0, 2).toString(), 'PK'); await new Promise((resolve) => setTimeout(resolve, 20)); assert.deepEqual(released, ['torrent-lease', 'diagnostic-lease']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('external browser capture route keeps pairing tokens inside daemon client calls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-capture-')); const methods = [];
  const client = { call: async (method, params) => { methods.push(method); if (method.endsWith('originAllowed')) return { allowed: true }; if (method.endsWith('authenticate')) return { principal: { clientId: 'browser-1', permissions: ['submit'] } }; if (method.endsWith('capture.submit')) return { capturedBy: params.principal.clientId, draftIds: ['draft-1'] }; throw new Error(method); } };
  const route = createBrowserCaptureRoute({ client, tempRoot: root });
  const response = await invokeHttp((req, res) => route.tryHandle(req, res, { isLoopback: true, remoteAddress: '127.0.0.1' }), { method: 'POST', url: '/api/v2/capture', headers: { origin: 'chrome-extension://capture', authorization: 'Capture private-token', 'content-type': 'application/json' }, body: JSON.stringify({ urls: ['https://example.test/file'] }) });
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).capturedBy, 'browser-1'); assert.deepEqual(methods, ['daemon.v1.web.capture.originAllowed', 'daemon.v1.web.capture.authenticate', 'daemon.v1.web.capture.submit']);
  fs.rmSync(root, { recursive: true, force: true });
});
