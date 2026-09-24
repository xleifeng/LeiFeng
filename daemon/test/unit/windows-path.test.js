'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linuxToWindowsPath, normalizeComparableEnginePath, normalizeDistroName } = require('../../host/src/windows-path');

test('Windows path conversion handles mounted drives and WSL UNC paths', () => {
  assert.equal(linuxToWindowsPath('/mnt/c/Users/test/file.bin'), 'C:\\Users\\test\\file.bin');
  assert.equal(linuxToWindowsPath('/home/test/downloads', { distroName: 'Ubuntu-24.04' }), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\test\\downloads');
  assert.equal(normalizeComparableEnginePath('\\\\wsl.localhost\\Ubuntu\\home\\test\\downloads'), '/home/test/downloads');
  assert.equal(normalizeComparableEnginePath('C:\\Users\\test\\file.bin'), '/mnt/c/users/test/file.bin');
  assert.equal(normalizeDistroName('Ubuntu'), 'Ubuntu');
  assert.throws(() => normalizeDistroName('../bad'));
});
