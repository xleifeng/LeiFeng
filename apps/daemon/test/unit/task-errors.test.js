'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapNativeError, makeTaskError, sanitizeTaskError } = require('../../host/src/domain/task-errors');

test('native errors become stable user-facing categories and actions', () => {
  const disk = mapNativeError('write failed: ENOSPC');
  assert.deepEqual({ code: disk.code, category: disk.category, retryable: disk.retryable }, { code: 'DISK_FULL', category: 'filesystem', retryable: false });
  assert.ok(disk.actions.includes('change-path'));
  const network = mapNativeError(Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }));
  assert.equal(network.category, 'network');
});

test('task error sanitizer only keeps allowed action vocabulary', () => {
  const error = sanitizeTaskError({ code: 'X', category: 'unknown', message: 'x', retryable: true, actions: ['retry', 'secret-action'] });
  assert.deepEqual(error.actions, ['retry']);
  assert.deepEqual(makeTaskError({ code: 'Y', message: 'y', category: 'engine', retryable: false, actions: ['diagnose'] }).actions, ['diagnose']);
});
