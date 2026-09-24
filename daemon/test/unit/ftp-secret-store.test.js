'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FtpSecretStore } = require('../../host/src/secrets/ftp-secret-store');

test('FTP secret store persists credentials in a private file and exposes only references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftp-secret-'));
  const filePath = path.join(root, 'secrets', 'ftp.json');
  const store = new FtpSecretStore({ filePath }); store.load();
  const ref = store.set({ username: 'alice', password: 'secret' });
  assert.match(ref, /^ftp:/);
  assert.deepEqual(store.get(ref), { username: 'alice', password: 'secret', createdAt: store.get(ref).createdAt });
  assert.deepEqual(Object.keys(store.snapshot()), [ref]);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(store.delete(ref), true);
  assert.equal(store.get(ref), null);
});
