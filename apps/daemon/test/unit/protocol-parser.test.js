'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { ProtocolParser, parseFtp, parseMagnet, parseEd2k, parseTorrentHash, normalizeTorrentHash } = require('../../host/src/domain/protocol-parser');

test('protocol parser normalizes HTTP, FTP, magnet and ed2k without accepting unsupported schemes', async () => {
  const parser = new ProtocolParser();
  const http = await parser.parseInput('https://example.test/file.bin#fragment');
  assert.equal(http.kind, 'https'); assert.equal(http.normalizedSource, 'https://example.test/file.bin');
  const magnet = parseMagnet('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=hello%20world');
  assert.equal(magnet.infoHash, '0123456789abcdef0123456789abcdef01234567'); assert.equal(magnet.displayName, 'hello world');
  assert.equal(parseEd2k('ed2k://|file|a%20b.bin|12|0123456789abcdef0123456789abcdef|/').totalBytes, 12);
  const ftp = parseFtp('ftp://user:p%40ss@example.test/releases/a.iso#fragment');
  assert.equal(ftp.kind, 'ftp');
  assert.equal(ftp.normalizedSource, 'ftp://example.test/releases/a.iso');
  assert.deepEqual(ftp.ftpAuth, { username: 'user', password: 'p@ss' });
  await assert.rejects(parser.parseInput('sftp://example.test/a'), (error) => error.code === 'UNSUPPORTED_PROTOCOL');
});

test('protocol parser accepts a pasted torrent hash through the magnet metadata path', async () => {
  const parser = new ProtocolParser();
  const hash = '520d33dad5cc0f9e535cf376052a8fdce0319299';
  const parsed = await parser.parseInput(`  ${hash.toUpperCase()}  `);
  assert.equal(parsed.kind, 'magnet');
  assert.equal(parsed.infoHash, hash);
  assert.equal(parsed.normalizedSource, `magnet:?xt=urn:btih:${hash}`);
  assert.equal(parseTorrentHash('urn:btih:' + hash).infoHash, hash);
  assert.equal(normalizeTorrentHash('btih:' + hash), hash);

  const base32 = '4H6BICTDSE2X7IOPBDO3OATU7HAF5OEL';
  const base32Parsed = await parser.parseInput(base32);
  assert.equal(base32Parsed.kind, 'magnet');
  assert.equal(base32Parsed.infoHash, parseMagnet(`magnet:?xt=urn:btih:${base32}`).infoHash);
});

test('protocol parser prefers the native pasted-hash validator when the engine is available', async () => {
  const hash = 'Z'.repeat(40);
  let called = 0;
  const parser = new ProtocolParser({ driver: {
    isHealthy: () => true,
    normalizeTorrentHash: async (value) => {
      called += 1;
      return { accepted: true, native: true, taskType: 5, normalizedSource: `magnet:?xt=urn:btih:${value}`, infoHash: hash, displayName: `${hash}.torrent` };
    },
  } });
  const parsed = await parser.parseInput(hash);
  assert.equal(called, 1);
  assert.equal(parsed.normalizedSource, `magnet:?xt=urn:btih:${hash}`);
  assert.equal(parsed.infoHash, hash);
});

test('thunder links recurse through the native resolver with loop protection', async () => {
  const parser = new ProtocolParser({ driver: { resolveThunderUrl: async (value) => value === 'thunder://one' ? { resolvedUrl: 'thunder://two' } : { resolvedUrl: 'https://example.test/file.bin' } } });
  const parsed = await parser.parseInput('thunder://one');
  assert.equal(parsed.kind, 'https'); assert.equal(parsed.originalSource, 'thunder://one');
  const loop = new ProtocolParser({ driver: { resolveThunderUrl: async (value) => ({ resolvedUrl: value === 'thunder://one' ? 'thunder://two' : 'thunder://one' }) } });
  await assert.rejects(loop.parseInput('thunder://one'), (error) => error.code === 'THUNDER_REDIRECT_LOOP');
});
