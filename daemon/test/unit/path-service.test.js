'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { PathService } = require('../../host/src/services/path-service');

test('path service validates writable targets and safe names without touching a user path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-v2-')); const service = new PathService({ defaultPath: dir });
  const result = service.validateDownloadTarget({ path: path.join(dir, 'downloads'), estimatedBytes: 1 });
  assert.equal(result.writable, true); assert.equal(service.validateDisplayName('hello.bin'), 'hello.bin');
  assert.throws(() => service.validateDisplayName('../bad'), (error) => error.code === 'INVALID_NAME');
  assert.throws(() => service.validateDisplayName('CON.txt'), (error) => error.code === 'INVALID_NAME');
});
