'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CaptureTokenStore } = require('../../host/src/secrets/capture-token-store');
const { CaptureService } = require('../../host/src/services/capture-service');

test('capture pairing stores only digest and capture enters link or torrent draft creation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-v2-')); const store = new CaptureTokenStore({ filePath: path.join(root, 'capture.json') }).load(); const service = new CaptureService({ tokenStore: store, createDraftService: { preflight: async (input) => ({ inputs: input.inputs }), createTorrentDraftFromFile: async (filePath, options) => ({ draftId: 'torrent-draft', filePath, originalName: options.originalName }) } });
  const pairing = service.startPairing({ permissions: ['submit', 'view'] }); const accepted = service.acceptPairing({ pairingId: pairing.pairingId, code: pairing.code, origin: 'chrome-extension://abc', name: 'test' }); assert.ok(accepted.token); assert.equal(store.list()[0].digest, undefined);
  const principal = service.authenticate(accepted.token, 'chrome-extension://abc'); assert.equal(principal.id, accepted.clientId);
  const result = await service.capture({ urls: ['https://example.test/a', 'ftp://example.test/a', 'magnet:?xt=urn:btih:abc'] }, { ...principal, clientId: principal.id }); assert.equal(result.inputs.length, 3);
  const torrent = await service.captureTorrent({ filePath: '/tmp/fixture.torrent', originalName: 'fixture.torrent' }, { ...principal, clientId: principal.id }); assert.equal(torrent.draft.draftId, 'torrent-draft'); assert.equal(torrent.capturedBy, principal.id);
  assert.equal(service.authenticate(accepted.token, 'https://example.test'), null);
});

test('desktop capture provisioning writes a private client config and rotates the previous token', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-desktop-v2-'));
  const configPath = path.join(root, 'client', 'capture.json');
  const store = new CaptureTokenStore({ filePath: path.join(root, 'server', 'capture.json') }).load();
  const service = new CaptureService({ tokenStore: store, createDraftService: {}, desktopConfigPath: configPath, endpoint: 'http://127.0.0.1:16800' });
  const first = service.provisionDesktopCapture();
  const firstConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(first.endpoint, 'http://127.0.0.1:16800');
  assert.equal(firstConfig.origin, 'app://thunder-desktop');
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.equal(service.authenticate(firstConfig.token, firstConfig.origin).id, first.clientId);
  const second = service.provisionDesktopCapture();
  const secondConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.notEqual(second.clientId, first.clientId); assert.notEqual(secondConfig.token, firstConfig.token);
  assert.equal(service.authenticate(firstConfig.token, firstConfig.origin), null);
  assert.equal(service.authenticate(secondConfig.token, secondConfig.origin).id, second.clientId);
  assert.equal(fs.readFileSync(store.filePath, 'utf8').includes(secondConfig.token), false);
});
