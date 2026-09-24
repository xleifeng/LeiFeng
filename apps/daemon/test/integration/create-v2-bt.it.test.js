'use strict';

// Local, deterministic BT acceptance. Run with:
// THUNDERD_RUN_CREATE_V2_BT_IT=1 node --test daemon/test/integration/create-v2-bt.it.test.js
// The tracker and seeder stay on loopback; no public torrent or user directory is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const enabled = process.env.THUNDERD_RUN_CREATE_V2_BT_IT === '1';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const rpcPort = Number(process.env.THUNDERD_CREATE_V2_BT_PORT || 16921);
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-bt-runtime-'));
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-bt-download-'));
let daemon; let tracker; let seeder;

function encode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return Buffer.from(`${Buffer.byteLength(value)}:${value}`);
  if (Number.isInteger(value)) return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(encode), Buffer.from('e')]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((key) => [encode(key), encode(value[key])]), Buffer.from('e')]);
}

function makeTorrent() {
  const data = crypto.createHash('sha256').update('bt-local-bt-fixture').digest();
  const payload = Buffer.alloc(256 * 1024);
  for (let offset = 0; offset < payload.length; offset += data.length) data.copy(payload, offset, 0, Math.min(data.length, payload.length - offset));
  const pieceLength = 16 * 1024;
  const pieces = [];
  for (let offset = 0; offset < payload.length; offset += pieceLength) pieces.push(crypto.createHash('sha1').update(payload.subarray(offset, offset + pieceLength)).digest());
  const info = { length: payload.length, name: 'bt-local-fixture.bin', 'piece length': pieceLength, pieces: Buffer.concat(pieces) };
  return { payload, info, infoBytes: encode(info) };
}

function startSeeder({ infoHash, payload, infoBytes = null }) {
  const peerId = Buffer.from('-TLEI01-SEEDER000001');
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0); let handshaken = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaken) {
        if (buffer.length < 68) return;
        const receivedHash = buffer.subarray(28, 48); buffer = buffer.subarray(68);
        if (!receivedHash.equals(infoHash)) return socket.destroy();
        const reserved = Buffer.alloc(8); if (infoBytes) reserved[5] = 0x10;
        socket.write(Buffer.concat([Buffer.from([19]), Buffer.from('BitTorrent protocol'), reserved, infoHash, peerId]));
        const bitfield = Buffer.alloc(Math.ceil(payload.length / (16 * 1024) / 8), 0xff);
        const bitfieldMessage = Buffer.concat([Buffer.from([0, 0, 0, bitfield.length + 1, 5]), bitfield]);
        socket.write(bitfieldMessage);
        socket.write(Buffer.from([0, 0, 0, 1, 1])); // unchoke
        handshaken = true;
      }
      while (handshaken && buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) { buffer = buffer.subarray(4); continue; }
        if (buffer.length < length + 4) break;
        const message = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
        if (message[0] === 20 && infoBytes) {
          if (message[1] === 0) {
            const metadata = encode({ m: { ut_metadata: 1 }, metadata_size: infoBytes.length }); const lengthBuffer = Buffer.alloc(4); lengthBuffer.writeUInt32BE(metadata.length + 2, 0);
            socket.write(Buffer.concat([lengthBuffer, Buffer.from([20, 0]), metadata]));
          } else {
            const metadata = encode({ msg_type: 1, piece: 0, total_size: infoBytes.length }); const lengthBuffer = Buffer.alloc(4); lengthBuffer.writeUInt32BE(metadata.length + 2 + infoBytes.length, 0);
            socket.write(Buffer.concat([lengthBuffer, Buffer.from([20, 1]), metadata, infoBytes]));
          }
          continue;
        }
        if (message[0] !== 6 || message.length < 13) continue;
        const index = message.readUInt32BE(1); const begin = message.readUInt32BE(5); const requested = message.readUInt32BE(9);
        const pieceLength = 16 * 1024; const start = index * pieceLength + begin; const end = Math.min(payload.length, start + requested);
        if (start < 0 || start >= payload.length || end <= start) continue;
        const piece = payload.subarray(start, end);
        const responseLength = piece.length + 9;
        const header = Buffer.alloc(4); header.writeUInt32BE(responseLength, 0);
        const pieceMessage = Buffer.alloc(9); pieceMessage[0] = 7; pieceMessage.writeUInt32BE(index, 1); pieceMessage.writeUInt32BE(begin, 5);
        socket.write(Buffer.concat([header, pieceMessage, piece]));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startTracker({ infoHash, seederPort }) {
  const peerBytes = Buffer.alloc(6); peerBytes.writeUInt32BE(0x7f000001, 0); peerBytes.writeUInt16BE(seederPort, 4);
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/announce')) { res.writeHead(404); return res.end(); }
    const body = encode({ interval: 1, peers: peerBytes });
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': body.length }); res.end(body);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })); });
}

function rpc(method, params, port = rpcPort) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/jsonrpc', method: 'POST', headers: { authorization: 'Bearer bt-create-it', 'content-type': 'application/json' } }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => { try { const payload = JSON.parse(body); if (payload.error) reject(Object.assign(new Error(payload.error.message), { code: payload.error.code })); else resolve(payload.result); } catch (error) { reject(error); } });
    });
    request.on('error', reject); request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

function uploadTorrent(torrent) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: rpcPort, path: '/api/v2/create-drafts/torrent', method: 'POST', headers: { authorization: 'Bearer bt-create-it', 'content-type': 'application/x-bittorrent', 'x-thunder-filename': 'bt-local.torrent', 'content-length': torrent.length } }, (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => { try { const payload = JSON.parse(body); if (response.statusCode >= 400) reject(new Error(payload.error && payload.error.message)); else resolve(payload.draft); } catch (error) { reject(error); } }); });
    request.on('error', reject); request.end(torrent);
  });
}

async function waitHealthy(port = rpcPort, timeoutMs = 120000) { const deadline = Date.now() + timeoutMs; for (;;) { try { const snapshot = await rpc('thunder.ui.v2.bootstrap', [], port); if (snapshot.engine && snapshot.engine.transportReady && snapshot.engine.sdkReady) return; } catch {} if (Date.now() > deadline) throw new Error('engine did not become healthy'); await new Promise((resolve) => setTimeout(resolve, 1000)); } }

test('real V2 BT upload → selected draft commit → byte-complete query', { skip: !enabled, timeout: 180000 }, async () => {
  const fixture = makeTorrent(); const infoHash = crypto.createHash('sha1').update(fixture.infoBytes).digest();
  seeder = await startSeeder({ infoHash, payload: fixture.payload });
  tracker = await startTracker({ infoHash, seederPort: seeder.port });
  const torrent = encode({ announce: `http://127.0.0.1:${tracker.port}/announce`, info: fixture.info });
  daemon = spawn('bash', [path.join(repoRoot, 'daemon', 'run.sh')], { env: { ...process.env, THUNDERD_PORT: String(rpcPort), THUNDERD_RPC_SECRET: 'bt-create-it', THUNDERD_RUNTIME_DIR: runtime, THUNDERD_DOWNLOAD_DIR: downloadDir, WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder') }, stdio: ['ignore', 'inherit', 'inherit'] });
  try {
    await waitHealthy();
    const draft = await uploadTorrent(torrent);
    assert.equal(draft.kind, 'bt'); assert.equal(draft.files.length, 1); assert.equal(draft.selectedFileIndices.length, 1);
    const committed = await rpc('thunder.ui.v2.create.commit', [{ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'bt-create-it-1' }]);
    assert.equal(committed.results[0].ok, true);
    const taskId = committed.results[0].taskIds[0]; const deadline = Date.now() + 90000; let item;
    for (;;) { const result = await rpc('thunder.ui.v2.tasks.query', [{ view: 'all', limit: 20 }]); item = result.items.find((candidate) => candidate.taskId === taskId); if (item && item.lifecycle === 'completed') break; if (Date.now() > deadline) throw new Error(`BT task did not complete: ${item && item.lifecycle}`); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    const target = path.join(downloadDir, 'bt-local-fixture.bin', 'bt-local-fixture.bin'); assert.equal(fs.statSync(target).size, fixture.payload.length); assert.deepEqual(fs.readFileSync(target), fixture.payload);
  } finally {
    try { tracker && tracker.server.close(); } catch {} try { seeder && seeder.server.close(); } catch {} try { daemon && daemon.kill('SIGTERM'); } catch {} await new Promise((resolve) => setTimeout(resolve, 1500));
  }
});

test('real V2 magnet metadata → BT commit → byte-complete query', { skip: !enabled, timeout: 240000 }, async () => {
  const port = rpcPort + 1; const fixture = makeTorrent(); const infoHash = crypto.createHash('sha1').update(fixture.infoBytes).digest();
  seeder = await startSeeder({ infoHash, payload: fixture.payload, infoBytes: fixture.infoBytes });
  tracker = await startTracker({ infoHash, seederPort: seeder.port });
  const magnet = `magnet:?xt=urn:btih:${infoHash.toString('hex')}&dn=bt-local-fixture.bin&tr=${encodeURIComponent(`http://127.0.0.1:${tracker.port}/announce`)}`;
  daemon = spawn('bash', [path.join(repoRoot, 'daemon', 'run.sh')], { env: { ...process.env, THUNDERD_PORT: String(port), THUNDERD_RPC_SECRET: 'bt-create-it', THUNDERD_RUNTIME_DIR: `${runtime}-magnet`, THUNDERD_DOWNLOAD_DIR: `${downloadDir}-magnet`, WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder') }, stdio: ['ignore', 'inherit', 'inherit'] });
  try {
    await waitHealthy(port);
    const preflight = await rpc('thunder.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: magnet }], savePath: `${downloadDir}-magnet` }], port);
    assert.equal(preflight.results[0].ok, true); let draft = preflight.results[0].draft; assert.equal(draft.kind, 'magnet');
    const metadataDeadline = Date.now() + 90000;
    while (draft.metadata.state !== 'ready') { if (Date.now() > metadataDeadline) throw new Error(`magnet metadata did not become ready: ${draft.metadata.state}`); await new Promise((resolve) => setTimeout(resolve, 1000)); draft = await rpc('thunder.ui.v2.create.getDraft', [{ draftId: draft.draftId }], port); }
    assert.equal(draft.files.length, 1); const committed = await rpc('thunder.ui.v2.create.commit', [{ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'magnet-create-it-1' }], port); assert.equal(committed.results[0].ok, true);
    const taskId = committed.results[0].taskIds[0]; const deadline = Date.now() + 90000; let item;
    for (;;) { const result = await rpc('thunder.ui.v2.tasks.query', [{ view: 'all', limit: 20 }], port); item = result.items.find((candidate) => candidate.taskId === taskId); if (item && item.lifecycle === 'completed') break; if (Date.now() > deadline) throw new Error(`magnet BT task did not complete: ${item && item.lifecycle}`); await new Promise((resolve) => setTimeout(resolve, 1000)); }
    const target = path.join(`${downloadDir}-magnet`, 'bt-local-fixture.bin', 'bt-local-fixture.bin'); assert.equal(fs.statSync(target).size, fixture.payload.length); assert.deepEqual(fs.readFileSync(target), fixture.payload);
  } finally {
    try { tracker && tracker.server.close(); } catch {} try { seeder && seeder.server.close(); } catch {} try { daemon && daemon.kill('SIGTERM'); } catch {} await new Promise((resolve) => setTimeout(resolve, 1500));
  }
});
