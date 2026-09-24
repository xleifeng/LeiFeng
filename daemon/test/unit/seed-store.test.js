'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SeedStore } = require('../../host/src/repositories/seed-store');

test('seed store exposes opaque refs, durable owners and safe sweeping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-store-v2-')); const source = path.join(dir, 'sample.torrent'); fs.writeFileSync(source, Buffer.from('d4:infod4:name4:testee'));
  let now = 1000; const store = new SeedStore({ rootDir: path.join(dir, 'seeds'), clock: { now: () => now } }); const ref = store.importFile(source);
  assert.match(ref, /^sha256:[a-f0-9]{64}$/); assert.ok(fs.existsSync(store.resolve(ref))); store.retain(ref, 'draft:1'); now += 10 * 24 * 60 * 60 * 1000; assert.equal(store.sweepUnreferenced({ olderThanMs: 1 }), 0); store.release(ref, 'draft:1'); now += 2; assert.equal(store.sweepUnreferenced({ olderThanMs: 1 }), 1); assert.throws(() => store.resolve(ref), (error) => error.code === 'SEED_NOT_FOUND');
});
