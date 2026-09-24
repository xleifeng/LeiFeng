'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseBridgeInputs, preflightBridgeInputs, runBridgeBatch } = require('../src/inputs');
const { createQbitRecipient } = require('../src/recipient-qbit');
const { assertRecipient } = require('../src/recipient');
const { createOrchestrator } = require('../src/orchestrator');

async function seed() {
  const bencode = (await import('bencode')).default;
  const data = Buffer.from('test bytes');
  return Buffer.from(bencode.encode({ info: { name: 'sample.bin', length: data.length, 'piece length': 16384, pieces: crypto.createHash('sha1').update(data).digest() } }));
}

test('E4 parses mixed CLI and input file with per-item save paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-input-'));
  try {
    fs.writeFileSync(path.join(dir, 'list.txt'), './sample.torrent\n');
    const args = parseBridgeInputs(['hybrid', '--magnet', `magnet:?xt=urn:btih:${'a'.repeat(40)}`, '--save-path', 'a', '--input-file', 'list.txt', '--save-path', 'b'], { cwd: dir });
    assert.equal(args.inputs.length, 2);
    assert.equal(args.inputs[0].savePath, path.join(dir, 'a'));
    assert.equal(args.inputs[1].savePath, path.join(dir, 'b'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('E4 preflight de-duplicates infohash and isolates failures in a batch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-batch-'));
  try {
    const raw = await seed();
    fs.writeFileSync(path.join(dir, 'sample.torrent'), raw);
    const hash = (await (await import('parse-torrent')).default(raw)).infoHash;
    const items = await preflightBridgeInputs([
      { kind: 'torrent', value: path.join(dir, 'sample.torrent') },
      { kind: 'magnet', value: `magnet:?xt=urn:btih:${hash}` },
      { kind: 'torrent', value: path.join(dir, 'missing.torrent') },
    ], { defaultSavePath: dir });
    assert.equal(items[0].infohash, hash);
    assert.equal(items[1].error.code, 'DUPLICATE_INFOHASH');
    assert.equal(items[2].error.code, 'ENOENT');
    const calls = [];
    const results = await runBridgeBatch(items, { hybridTorrent: async () => { calls.push('torrent'); return { taskId: 't1', session: {} }; } });
    assert.deepEqual(calls, ['torrent']);
    assert.deepEqual(results.map((item) => item.ok), [true, false, false]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Recipient definition rejects incomplete providers and qbit adapter preserves roles', async () => {
  assert.throws(() => assertRecipient({ addTorrent() {} }), { code: 'RECIPIENT_INCOMPLETE' });
  const calls = [];
  const provider = createQbitRecipient({ client: {
    addTorrent: async () => { calls.push('torrent'); }, addMagnet: async () => { calls.push('magnet'); },
    getTorrent: async () => ({ hash: 'a' }), webseeds: async () => ['http://127.0.0.1/'],
  } });
  await provider.addTorrent(Buffer.from('x'));
  await provider.addMagnet('magnet:?xt=urn:btih:a');
  assert.equal((await provider.getTorrent('a')).hash, 'a');
  assert.equal((await provider.webseeds('a')).length, 1);
  assert.deepEqual(calls, ['torrent', 'magnet']);
});

test('E4 torrent uploads through daemon draft and passes injected webseed to Recipient', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-torrent-'));
  const raw = await seed();
  const calls = [];
  const daemonClient = {
    uploadTorrent: async (bytes) => { assert.ok(bytes.equals(raw)); calls.push('upload'); return { draftId: 'd1', options: {} }; },
    rpc: async (method, params) => {
      calls.push(method);
      if (method === 'thunder.ui.v2.tasks.query') return { items: [], nextCursor: null };
      if (method === 'thunder.ui.v2.create.updateDraft') { assert.equal(params[0].savePath, dir); return { draftId: 'd1' }; }
      if (method === 'thunder.ui.v2.create.commit') return { results: [{ ok: true, taskIds: ['t1'] }] };
      throw new Error(`unexpected RPC ${method}`);
    },
  };
  let added;
  const recipient = { addTorrent: async (buffer, metadata) => { added = { buffer, metadata }; },
    addMagnet: async () => {}, getTorrent: async () => null, webseeds: async () => [] };
  const orchestrator = createOrchestrator({ daemonClient, recipient, savePath: dir });
  try {
    const result = await orchestrator.hybridTorrent(raw, { dataPath: dir });
    assert.equal(result.taskId, 't1');
    assert.equal(result.infohash, added.metadata.infohash);
    const after = await (await import('parse-torrent')).default(added.buffer);
    assert.equal(after.infoHash, result.infohash);
    assert.ok(after.urlList[0].includes(`/seeds/${result.infohash}/`));
    assert.deepEqual(calls, ['thunder.ui.v2.tasks.query', 'upload', 'thunder.ui.v2.create.updateDraft', 'thunder.ui.v2.create.commit', 'thunder.ui.v2.tasks.command']);
  } finally { orchestrator.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
