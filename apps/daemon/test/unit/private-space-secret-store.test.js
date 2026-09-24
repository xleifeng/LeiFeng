'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrivateSpaceSecretStore } = require('../../host/src/secrets/private-space-secret-store');

test('private secret store wraps a random data key and rotates only the password envelope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-private-secret-')); const file = path.join(root, 'private.json'); const store = new PrivateSpaceSecretStore({ filePath: file });
  assert.deepEqual(store.getStatus(), { configured: false, unlocked: false }); store.setup('not trimmed'); assert.equal(fs.statSync(file).mode & 0o777, 0o600); const first = store.getEncryptionKeyAfterVerify().toString('hex'); store.clearKey(); assert.equal(store.verify('not trimmed'), true); assert.equal(store.getEncryptionKeyAfterVerify().toString('hex'), first); assert.equal(store.changePassword('not trimmed', 'new password').changed, true); store.clearKey(); assert.equal(store.verify('new password'), true); assert.equal(store.verify('not trimmed'), false);
});
