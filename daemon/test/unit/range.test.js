'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSingleRange, formatContentRange, matchesIfRange } = require('../../host/src/domain/byte-range');

test('single range parser supports open, suffix and clamps end', () => {
  assert.deepEqual(parseSingleRange('bytes=2-5', 10), { start: 2, end: 5, length: 4 });
  assert.deepEqual(parseSingleRange('bytes=7-', 10), { start: 7, end: 9, length: 3 });
  assert.deepEqual(parseSingleRange('bytes=-4', 10), { start: 6, end: 9, length: 4 });
  assert.deepEqual(parseSingleRange('bytes=0-99', 10), { start: 0, end: 9, length: 10 });
  assert.equal(formatContentRange(0, 9, 10), 'bytes 0-9/10');
});

test('range parser rejects multiple/unknown ranges and future bytes', () => {
  assert.throws(() => parseSingleRange('bytes=0-1,4-5', 10), { code: 'MULTI_RANGE_UNSUPPORTED' });
  assert.throws(() => parseSingleRange('bytes=10-', 10), { code: 'RANGE_NOT_AVAILABLE_YET' });
  assert.equal(matchesIfRange('"etag"', '"etag"', Date.now()), true);
});
