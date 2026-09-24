'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');

test('safe path resolver allows only download roots and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-v2-'));
  const resolver = new SafePathResolver({ allowedRoots: [root] });
  assert.equal(resolver.assertInsideAllowedRoots(path.join(root, 'nested')), path.join(root, 'nested'));
  assert.throws(() => resolver.assertInsideAllowedRoots(path.join(root, '..', 'outside')), (error) => error.code === 'UNSAFE_PATH');
  assert.throws(() => resolver.resolveTaskRoot({ savePath: root, displayName: '../outside.txt' }), (error) => error.code === 'UNSAFE_PATH');
});

test('safe path resolver rejects symlink components and detects file changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-link-v2-'));
  const real = path.join(root, 'real');
  const link = path.join(root, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'dir');
  const resolver = new SafePathResolver({ allowedRoots: [root] });
  assert.throws(() => resolver.resolveDirectory(link), (error) => error.code === 'SYMLINK_PATH');

  const file = path.join(real, 'file.bin');
  fs.writeFileSync(file, 'before');
  const snapshot = resolver.snapshot(file);
  fs.writeFileSync(file, 'after');
  assert.throws(() => resolver.assertUnchanged(snapshot, file), (error) => error.code === 'FILE_CHANGED_DURING_OPERATION');
});
