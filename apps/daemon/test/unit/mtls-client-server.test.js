'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PkiService } = require('../../host/src/remote/pki-service');
const { MtlsServer, fingerprint } = require('../../../web-api/src/remote/mtls-server');
const { MtlsClient } = require('../../host/src/remote/mtls-client');
const { RemotePairingService } = require('../../host/src/services/remote-pairing-service');
const { createRemotePairingRoute } = require('../../../web-api/src/remote/pairing-route');

test('mTLS server/client pin certificate fingerprint and expose principal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtls-v2-')); const pki = new PkiService({ directory: root }); const serverCert = await pki.ensureServerCertificate({ nodeId: 'node-1', hosts: ['127.0.0.1'] });
  const certPem = fs.readFileSync(serverCert.cert);
  const server = new MtlsServer({ key: serverCert.key, cert: serverCert.cert, ca: serverCert.ca, handler: async (req, res, context) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ fingerprint: context.fingerprint, path: req.url })); } }).start(); await new Promise((resolve) => server.once('listening', resolve)); const port = server.address().port;
  const client = new MtlsClient({ endpoint: `https://127.0.0.1:${port}`, ca: serverCert.ca, cert: serverCert.cert, key: serverCert.key, serverFingerprint: fingerprint(new (require('node:crypto').X509Certificate)(certPem)) }); const result = await client.request('GET', '/remote/v1/hello'); assert.deepEqual(result, { fingerprint: serverCert.fingerprint, path: '/remote/v1/hello' }); await new Promise((resolve) => server.close(resolve));
});

test('unknown mTLS client can pair once and then call authenticated routes', async () => {
  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mtls-pair-server-')); const clientRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mtls-pair-client-'));
  const serverCert = await new PkiService({ directory: serverRoot }).ensureServerCertificate({ nodeId: 'server', hosts: ['127.0.0.1'] });
  const clientCert = await new PkiService({ directory: clientRoot }).ensureServerCertificate({ nodeId: 'client', hosts: ['127.0.0.1'] });
  const pairing = new RemotePairingService({ certificateFingerprint: serverCert.fingerprint }); const window = pairing.startServerPairing({ permissions: ['view', 'control'] });
  const daemonClient = { call: async (method, params) => { if (method === 'daemon.v1.remote.pairing.accept') return pairing.acceptClient(params.input); throw new Error(method); } };
  const server = new MtlsServer({ key: serverCert.key, cert: serverCert.cert, ca: serverCert.ca, pairingRoute: createRemotePairingRoute({ client: daemonClient }), handler: async (_req, res, context) => { const principal = pairing.clients.get(context.fingerprint); if (!principal || principal.revokedAt) throw Object.assign(new Error('rejected'), { code: 'REMOTE_CERT_REJECTED' }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ clientId: principal.id, permissions: principal.permissions })); } }).start();
  await new Promise((resolve) => server.once('listening', resolve)); const port = server.address().port;
  const client = new MtlsClient({ endpoint: `https://127.0.0.1:${port}`, cert: clientCert.cert, key: clientCert.key, serverFingerprint: serverCert.fingerprint });
  const accepted = await client.request('POST', '/remote/v1/pairing/accept', { pairingId: window.pairingId, code: window.code, clientId: 'client-node', name: 'Client Node', requestedPermissions: ['view', 'control'] });
  assert.deepEqual(accepted.permissions, ['view', 'control']); assert.equal(pairing.clients.has(clientCert.fingerprint), true);
  const authenticated = await client.request('GET', '/remote/v1/hello'); assert.equal(authenticated.clientId, 'client-node');
  await new Promise((resolve) => server.close(resolve));
});
