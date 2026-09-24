'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { DaemonControlServer } = require('../../daemon/host/src/control/server');

async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port; }
function rpc(port, method) { return new Promise((resolve, reject) => { const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }); const req = http.request({ host: '127.0.0.1', port, path: '/jsonrpc', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks)); value.error ? reject(Object.assign(new Error(value.error.message), value.error)) : resolve(value.result); } catch (error) { reject(error); } }); }); req.on('error', reject); req.end(body); }); }
async function waitForHttp(port) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { try { await rpc(port, 'test.get'); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); } } throw new Error('web-api did not start'); }
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); }

test('restarting Web API preserves daemon-owned state and control process', { timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-api-restart-')); const socketPath = path.join(root, 'control.sock'); const port = await freePort(); let value = 0;
  const control = new DaemonControlServer({ socketPath, dispatch: async (method, params) => { if (method === 'daemon.v1.health') return { pid: process.pid, daemonVersion: 'test' }; if (method === 'daemon.v1.web.invoke') { if (params.method === 'test.increment') { value += 1; return { value }; } if (params.method === 'test.get') return { value }; } throw Object.assign(new Error(method), { code: 'METHOD_NOT_FOUND' }); } });
  await once(control.start(), 'listening');
  const entry = path.join(__dirname, '../src/main.js'); const env = { ...process.env, THUNDERD_CONTROL_SOCKET: socketPath, THUNDERD_RUNTIME_DIR: root, THUNDERD_PORT: String(port), THUNDERD_HOST: '127.0.0.1', THUNDERD_WEBUI_DIR: path.join(root, 'missing-webui') };
  const start = () => spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let web = start();
  t.after(async () => { await stop(web); await control.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await waitForHttp(port); assert.deepEqual(await rpc(port, 'test.increment'), { value: 1 });
  await stop(web); assert.equal(value, 1); assert.equal(control.server.listening, true);
  web = start(); await waitForHttp(port); assert.deepEqual(await rpc(port, 'test.get'), { value: 1 });
});
