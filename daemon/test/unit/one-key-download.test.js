'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideOneKey } = require('../../host/src/domain/one-key-download');

test('one-key policy only allows explicit safe HTTP silent paths', () => {
  const safe = decideOneKey({ kind: 'https', totalBytes: 1024, pathCheck: { writable: true, creatable: true }, policy: { mode: 'by-size', maxSilentBytes: 2048, allowedKinds: ['https'] } });
  assert.equal(safe.silent, true); assert.deepEqual(safe.reasons, []);
  const magnet = decideOneKey({ kind: 'magnet', totalBytes: 1024, pathCheck: { writable: true, creatable: true }, policy: { mode: 'always-silent', maxSilentBytes: 2048, allowedKinds: ['magnet'] } });
  assert.equal(magnet.silent, false); assert.ok(magnet.reasons.includes('file-tree-confirmation'));
  const duplicate = decideOneKey({ kind: 'http', totalBytes: 1, duplicate: { taskId: 'task-1' }, pathCheck: { writable: true, creatable: true }, policy: { mode: 'always-silent' } });
  assert.equal(duplicate.silent, false); assert.ok(duplicate.reasons.includes('duplicate'));
  const ftp = decideOneKey({ kind: 'ftp', totalBytes: 1024, pathCheck: { writable: true, creatable: true }, policy: { mode: 'always-silent', allowedKinds: ['ftp'] } });
  assert.equal(ftp.silent, true);
});
