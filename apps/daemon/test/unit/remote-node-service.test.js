'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RemoteNodeRepository } = require('../../host/src/repositories/remote-node-repository');
const { RemoteNodeService } = require('../../host/src/services/remote-node-service');
const { RemotePairingService } = require('../../host/src/services/remote-pairing-service');

test('remote nodes validate HTTPS endpoints and preserve offline snapshot semantics', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-node-v2-')); const repo = new RemoteNodeRepository({ filePath: path.join(root, 'nodes.json') }).load(); const service = new RemoteNodeService({ repository: repo });
  assert.throws(() => service.acceptPairing({ endpoint: 'http://127.0.0.1:1', serverFingerprint: 'a'.repeat(64) }), { code: 'REMOTE_ENDPOINT_INVALID' });
  const node = service.acceptPairing({ id: 'node-1', endpoint: 'https://127.0.0.1:18888', serverFingerprint: 'a'.repeat(64), permissions: ['view'] }); assert.equal(node.state, 'offline'); assert.equal(service.query().items[0].permissions[0], 'view');
  assert.throws(() => repo.assertPermission(node.id, 'view'), { code: 'REMOTE_NODE_OFFLINE' });
});

test('remote pairing allows only requested permissions inside one window', () => { const service = new RemotePairingService({ certificateFingerprint: 'b'.repeat(64) }); const pairing = service.startServerPairing({ permissions: ['view', 'submit'] }); const client = service.acceptClient({ pairingId: pairing.pairingId, code: pairing.code, clientId: 'client-1', certificateFingerprint: 'c'.repeat(64), requestedPermissions: ['view', 'control'] }); assert.deepEqual(client.permissions, ['view']); assert.equal(service.queryPairedClients().length, 1); assert.equal(service.revokeClient('client-1'), true); });

test('remote pairing persists certificate authorization by fingerprint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-client-v2-')); const filePath = path.join(root, 'clients.json');
  const service = new RemotePairingService({ certificateFingerprint: 'b'.repeat(64), filePath }); const pairing = service.startServerPairing({ permissions: ['view'] });
  service.acceptClient({ pairingId: pairing.pairingId, code: pairing.code, clientId: 'client-persisted', certificateFingerprint: 'e'.repeat(64), requestedPermissions: ['view'] });
  const restored = new RemotePairingService({ certificateFingerprint: 'b'.repeat(64), filePath }); assert.equal(restored.clients.get('e'.repeat(64)).id, 'client-persisted');
});

test('remote node handshake stores granted permissions and online snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-node-pair-v2-')); const repo = new RemoteNodeRepository({ filePath: path.join(root, 'nodes.json') }).load();
  const calls = [];
  const service = new RemoteNodeService({ repository: repo, transport: {
    async pair(input) { calls.push(['pair', input.pairingId, input.code]); return { permissions: ['view', 'control'] }; },
    async hello(node) { calls.push(['hello', node.endpoint]); return { version: '0.4.0', capabilities: { query: true, command: true }, remoteRevision: 7 }; },
  } });
  const node = await service.acceptPairing({ id: 'node-2', name: '远程机', endpoint: 'https://127.0.0.1:18889', serverFingerprint: 'd'.repeat(64), pairingId: 'pair-1', code: '123456', requestedPermissions: ['view', 'control'] });
  assert.equal(node.state, 'online'); assert.deepEqual(node.permissions, ['view', 'control']); assert.equal(node.version, '0.4.0'); assert.equal(node.remoteRevision, 7); assert.equal(calls.length, 2);
});
