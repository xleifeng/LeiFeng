'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { duplexPair } = require('node:stream');
const { EngineClient } = require('../../host/src/engine-client');

function fakeConnection(onMessage) {
  const [clientSocket, engineSocket] = duplexPair();
  clientSocket.setNoDelay = () => clientSocket;
  engineSocket.setNoDelay = () => engineSocket;
  let buffer = '';
  engineSocket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const output = onMessage(message, engineSocket);
      if (output) engineSocket.write(`${JSON.stringify(output)}\n`);
    }
  });
  return { clientSocket, engineSocket, close() { clientSocket.destroy(); engineSocket.destroy(); } };
}

test('round trip with id matching', async () => {
  const connection = fakeConnection((message) => ({ id: message.id, ok: true, result: { echo: message.method } }));
  const client = new EngineClient(); client.attach(connection.clientSocket);
  assert.deepStrictEqual(await client.request('ping'), { echo: 'ping' });
  client.close(); connection.close();
});

test('engine error rejects with message', async () => {
  const connection = fakeConnection((message) => ({ id: message.id, ok: false, error: 'boom' }));
  const client = new EngineClient(); client.attach(connection.clientSocket);
  await assert.rejects(client.request('x'), /boom/);
  client.close(); connection.close();
});

test('timeout rejects pending with ETIMEDOUT', async () => {
  const connection = fakeConnection(() => null);
  const client = new EngineClient(); client.attach(connection.clientSocket);
  await assert.rejects(client.request('slow', {}, 20), (error) => error.code === 'ETIMEDOUT' && /timeout/.test(error.message));
  client.close(); connection.close();
});

test('socket close rejects pending and emits close', async () => {
  const connection = fakeConnection(() => null);
  const client = new EngineClient(); client.attach(connection.clientSocket);
  const closed = new Promise((resolve) => client.once('close', resolve));
  const pending = client.request('never', {}, 5000);
  connection.clientSocket.destroy();
  await assert.rejects(pending, /closed/);
  await closed;
});

test('stale socket close does not affect a newly attached socket', async () => {
  const oldConnection = fakeConnection((message) => ({ id: message.id, ok: true, result: { echo: message.method } }));
  const client = new EngineClient(); client.attach(oldConnection.clientSocket);
  await client.request('ping', {}, 2000);
  const newConnection = fakeConnection((message) => ({ id: message.id, ok: true, result: { echo: message.method } }));
  client.attach(newConnection.clientSocket);
  oldConnection.engineSocket.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(client.isConnected());
  assert.deepStrictEqual(await client.request('ping', {}, 2000), { echo: 'ping' });
  client.close(); oldConnection.close(); newConnection.close();
});
