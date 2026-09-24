'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteHandler } = require('../src/remote/handler');

function request(method, url, body = null) { return { method, url, async *[Symbol.asyncIterator]() { if (body !== null) yield Buffer.from(JSON.stringify(body)); } }; }
function response() { return { status: 0, body: '', writeHead(status) { this.status = status; }, end(body = '') { this.body = body; } }; }

test('external remote handler maps mTLS fingerprint to daemon control methods', async () => {
  const calls = []; const client = { call: async (method, params) => { calls.push({ method, params }); return method.endsWith('hello') ? { nodeId: 'node-1' } : { items: [] }; } };
  const handler = createRemoteHandler({ client, nodeId: 'node-1' });
  const hello = response(); await handler(request('GET', '/remote/v1/hello'), hello, { fingerprint: 'abc' }); assert.equal(JSON.parse(hello.body).nodeId, 'node-1');
  const tasks = response(); await handler(request('POST', '/remote/v1/tasks/query', { view: 'all' }), tasks, { fingerprint: 'abc' }); assert.deepEqual(JSON.parse(tasks.body), { items: [] });
  assert.deepEqual(calls.map((item) => item.method), ['daemon.v1.remote.hello', 'daemon.v1.remote.tasks.query']); assert.equal(calls[1].params.fingerprint, 'abc');
});
