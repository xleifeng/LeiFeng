'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../../host/src/security/log-redactor');

test('log redactor handles nested secret values and bearer headers', () => { const value = redact({ password: 'p', nested: { accessToken: 'a', header: 'Bearer abc' }, plain: 'ok' }); assert.deepEqual(value, { password: '[REDACTED]', nested: { accessToken: '[REDACTED]', header: '[REDACTED]' }, plain: 'ok' }); });
