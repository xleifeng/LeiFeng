'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DaemonClient, FrameDecoder, encodeFrame } = require('../../../packages/daemon-client');
const { DaemonControlServer } = require('../../host/src/control/server');

test('control framing survives fragmented and adjacent messages', () => {
  const messages = []; const decoder = new FrameDecoder({ onMessage: (message) => messages.push(message) });
  const bytes = Buffer.concat([encodeFrame({ id: 1, text: '中文' }), encodeFrame({ id: 2, ok: true })]);
  decoder.push(bytes.subarray(0, 7)); decoder.push(bytes.subarray(7, 31)); decoder.push(bytes.subarray(31));
  assert.deepEqual(messages, [{ id: 1, text: '中文' }, { id: 2, ok: true }]);
});

test('daemon client multiplexes requests over a private control socket', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-control-')); const socketPath = path.join(root, 'control.sock');
  const server = new DaemonControlServer({ socketPath, dispatch: async (method, params) => { if (method === 'fail') throw Object.assign(new Error('expected failure'), { code: 'EXPECTED', details: { value: 1 } }); await new Promise((resolve) => setTimeout(resolve, params.delay || 0)); return { method, value: params.value }; } });
  const listening = once(server.start(), 'listening'); await listening;
  const client = new DaemonClient({ socketPath });
  t.after(async () => { client.close(); await server.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const completion = []; const slowRequest = client.call('slow', { value: 1, delay: 20 }).then((value) => { completion.push('slow'); return value; }); const fastRequest = client.call('fast', { value: 2 }).then((value) => { completion.push('fast'); return value; });
  const [slow, fast] = await Promise.all([slowRequest, fastRequest]);
  assert.deepEqual(slow, { method: 'slow', value: 1 }); assert.deepEqual(fast, { method: 'fast', value: 2 });
  assert.deepEqual(completion, ['fast', 'slow']);
  await assert.rejects(client.call('fail'), (error) => error.code === 'EXPECTED' && error.details.value === 1);
  assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
});
