'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { submitCapture } = require('../../integration/capture-cli');

test('desktop capture submits FTP links and torrent file URIs to their authenticated endpoints', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-cli-'));
  const torrentPath = path.join(root, 'sample.torrent');
  fs.writeFileSync(torrentPath, Buffer.from('d4:infod4:name4:testee', 'ascii'));
  const calls = [];
  const request = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, text: async () => '{}' }; };
  const config = { endpoint: 'http://127.0.0.1:16800', token: 'capture-token', origin: 'chrome-extension://fixture' };
  await submitCapture('ftp://example.test/file.bin', config, request);
  await submitCapture(pathToFileURL(torrentPath).toString(), config, request);
  assert.equal(new URL(calls[0].url).pathname, '/api/v2/capture');
  assert.deepEqual(JSON.parse(calls[0].options.body), { urls: ['ftp://example.test/file.bin'] });
  assert.equal(new URL(calls[1].url).pathname, '/api/v2/capture/torrent');
  assert.equal(Buffer.isBuffer(calls[1].options.body), true);
  assert.equal(calls[1].options.headers['content-type'], 'application/x-bittorrent');
  assert.equal(calls.every((call) => call.options.headers.authorization === 'Capture capture-token'), true);
});
