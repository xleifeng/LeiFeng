'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeRemoteTaskId, decodeRemoteTaskId } = require('../../host/src/domain/remote-task-id');

test('remote task ids are opaque structured values and round-trip safely', () => { const value = encodeRemoteTaskId('node:ipv6', 'task:with:colon'); assert.match(value, /^r2\./); assert.deepEqual(decodeRemoteTaskId(value), { nodeId: 'node:ipv6', taskId: 'task:with:colon' }); assert.throws(() => decodeRemoteTaskId('node:task'), { code: 'INVALID_REMOTE_TASK_ID' }); });
