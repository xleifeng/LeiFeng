'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWebRequestHandler } = require('../src/server');
const { invokeHttp } = require('../../daemon/test/unit/helpers/http-fixture');

async function post(handler, payload, headers = {}) { const response = await invokeHttp(handler, { method: 'POST', url: '/jsonrpc', headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload) }); return JSON.parse(response.body.toString('utf8')); }

test('external Web API preserves JSON-RPC envelopes and forwards request context', async () => {
  let received;
  const client = { invoke: async (method, params, context) => { received = { method, params, context }; if (method === 'fail') throw Object.assign(new Error('nope'), { code: 'EXPECTED' }); return { ok: true }; } };
  const handler = createWebRequestHandler({ client, host: '127.0.0.1', port: 16800 });
  const result = await post(handler, { jsonrpc: '2.0', id: 1, method: 'thunder.ui.v2.bootstrap', params: [{ keep: true }] }, { authorization: 'Bearer secret', origin: 'http://127.0.0.1:16800' });
  assert.deepEqual(result.result, { ok: true }); assert.equal(received.context.bearerToken, 'secret'); assert.equal(received.context.isLoopback, true); assert.deepEqual(received.params, [{ keep: true }]);
  assert.equal((await post(handler, 'not json')).error.code, -32700);
  assert.equal((await post(handler, { jsonrpc: '2.0', id: 2, method: 'fail' })).error.code, 'EXPECTED');
});

test('external Web API executes JSON-RPC batches sequentially', async () => {
  const order = []; const client = { invoke: async (method) => { order.push(method); await new Promise((resolve) => setTimeout(resolve, 5)); return method; } };
  const handler = createWebRequestHandler({ client });
  const result = await post(handler, [{ jsonrpc: '2.0', id: 1, method: 'first' }, { jsonrpc: '2.0', id: 2, method: 'second' }]);
  assert.deepEqual(order, ['first', 'second']); assert.deepEqual(result.map((item) => item.result), ['first', 'second']);
});

test('external Web API owns static WebUI delivery and security headers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-web-api-')); fs.writeFileSync(path.join(root, 'index.html'), '<title>Thunder</title>');
  const handler = createWebRequestHandler({ client: { invoke: async () => null }, staticDir: root });
  const response = await invokeHttp(handler, { url: '/' });
  assert.equal(response.status, 200); assert.match(response.headers['content-security-policy'], /script-src 'self'/); assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/); assert.match(response.body.toString(), /Thunder/);
  const traversal = await invokeHttp(handler, { url: '/%2e%2e/%2e%2e/etc/passwd' }); assert.notEqual(traversal.status, 200);
  fs.rmSync(root, { recursive: true, force: true });
});

test('external Web API rejects oversized JSON-RPC bodies before daemon dispatch', async () => {
  let calls = 0; const handler = createWebRequestHandler({ client: { invoke: async () => { calls += 1; } }, maxBodyBytes: 32 });
  const result = await post(handler, { jsonrpc: '2.0', id: 1, method: 'x', params: ['x'.repeat(100)] });
  assert.equal(result.error.code, -32001); assert.equal(calls, 0);
});

test('external Web API survives client aborting mid-body (no crash path)', async () => {
  // 产品化 2026-09-23：客户端中断请求曾把 Web API 打进 crash-restart 循环
  //（for-await 读 body 无兜底）。真 HTTP 连接中途 RST 断开，服务必须不抛未处理 rejection。
  const client = { invoke: async () => ({ ok: true }) };
  const handler = createWebRequestHandler({ client });
  const http = require('node:http');
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const socket = require('node:net').connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('POST /jsonrpc HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\n{"jsonrpc"');
    // 半途硬断（RST）
    socket.resetAndDestroy ? socket.resetAndDestroy() : socket.destroy();
    // 给服务端一拍处理断流；进程若被打挂此处直接失败
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 服务端仍应能正常应后续请求
    const after = await invokeHttp(handler, { method: 'POST', url: '/jsonrpc', body: '{"jsonrpc":"2.0","id":9,"method":"ping"}' });
    assert.equal(JSON.parse(after.body.toString('utf8')).result.ok, true);
  } finally { server.close(); }
});
