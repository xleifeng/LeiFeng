'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBridgePluginRegistry } = require('../src/profile-plugins.cjs');
const { bridgePatch, main } = require('../src/main');

test('legacy bridge CLI maps to one bridge-host runtime patch and redacts dump', async () => {
  const patch = bridgePatch(['hybrid', '--magnet', `magnet:?xt=urn:btih:${'a'.repeat(40)}`, '--data', '/tmp/bridge-legacy']);
  assert.equal(patch[0].id, 'runtime-config');
  assert.equal(patch[0].config.mode, 'hybrid');
  assert.equal(patch[0].config.inputs.length, 1);
  let output = '';
  const code = await main(['hybrid', '--magnet', `magnet:?xt=urn:btih:${'a'.repeat(40)}`, '--data', '/tmp/bridge-legacy', '--dump-config'],
    { output: { write(value) { output += value; } }, errorOutput: { write() {} } });
  assert.equal(code, 0);
  assert.ok(!output.includes('btih:'));
  assert.match(output, /bridge-orchestrator/);
});

test('bridge-host profile composes real Cordis services and releases HTTP listener', async () => {
  const { bootProfile } = await import('../../runtime/src/index.mjs');
  const bencode = (await import('bencode')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-profile-'));
  const data = Buffer.from('bridge profile data');
  const torrentPath = path.join(dir, 'sample.torrent');
  fs.writeFileSync(path.join(dir, 'sample.bin'), data);
  fs.writeFileSync(torrentPath, Buffer.from(bencode.encode({ info: {
    name: 'sample.bin', length: data.length, 'piece length': 16384,
    pieces: crypto.createHash('sha1').update(data).digest(),
  } })));
  const output = path.join(dir, 'seed.webseed.torrent');
  const registry = createBridgePluginRegistry({
    daemonClientFactory: () => ({ rpc: async () => { throw new Error('serve must not contact daemon'); } }),
    recipientFactory: () => ({ addTorrent() {}, addMagnet() {}, getTorrent() {}, webseeds() {} }),
  });
  let instance;
  try {
    instance = await bootProfile({ profile: 'bridge-host', registry, userPatch: [{ id: 'runtime-config', config: {
      mode: 'serve', port: 0, savePath: dir, inputs: [{ kind: 'torrent', value: torrentPath }], out: output,
    } }] });
    const http = instance.context.bridgeHttp;
    assert.ok(http.port > 0);
    assert.ok(fs.existsSync(output));
    const response = await fetch(`http://127.0.0.1:${http.port}/status`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inputs[0].ok, true);
    await instance.dispose();
    instance = null;
    await assert.rejects(fetch(`http://127.0.0.1:${http.port}/status`));
  } finally {
    await instance?.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bridge-host hybrid runs torrent draft against fake daemon and recipient', async () => {
  const { bootProfile } = await import('../../runtime/src/index.mjs');
  const bencode = (await import('bencode')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-profile-hybrid-'));
  const torrentPath = path.join(dir, 'batch.torrent');
  const raw = Buffer.from(bencode.encode({ info: { name: 'batch.bin', length: 4,
    'piece length': 16384, pieces: crypto.createHash('sha1').update('data').digest() } }));
  fs.writeFileSync(torrentPath, raw);
  let added = false;
  const calls = [];
  const registry = createBridgePluginRegistry({
    daemonClientFactory: () => ({
      uploadTorrent: async () => { calls.push('upload'); return { draftId: 'draft' }; },
      rpc: async (method) => {
        calls.push(method);
        if (method === 'thunder.ui.v2.account.refresh') return { account: { valid: true }, session: { registered: true }, engine: { notified: true } };
        if (method === 'thunder.ui.v2.tasks.query') return { items: [], nextCursor: null };
        if (method === 'thunder.ui.v2.create.updateDraft') return { draftId: 'draft' };
        if (method === 'thunder.ui.v2.create.commit') return { results: [{ ok: true, taskIds: ['task'] }] };
        if (method === 'thunder.ui.v2.tasks.command') return { results: [{ ok: true }] };
        throw new Error(`unexpected ${method}`);
      },
    }),
    recipientFactory: () => ({
      addTorrent: async () => { added = true; }, addMagnet: async () => {},
      getTorrent: async () => null, webseeds: async () => [],
    }),
  });
  let instance;
  try {
    instance = await bootProfile({ profile: 'bridge-host', registry, userPatch: [{ id: 'runtime-config', config: {
      mode: 'hybrid', port: 0, savePath: dir, inputs: [{ kind: 'torrent', value: torrentPath }],
    } }] });
    assert.ok(added);
    assert.ok(calls.includes('upload'));
    const response = await fetch(`http://127.0.0.1:${instance.context.bridgeHttp.port}/status`);
    const status = await response.json();
    assert.equal(status.inputs[0].taskId, 'task');
    assert.equal(status.inputs[0].ok, true);
  } finally {
    await instance?.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
