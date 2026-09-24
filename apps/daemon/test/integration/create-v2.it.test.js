'use strict';

// Real V2 create acceptance: `THUNDERD_RUN_CREATE_V2_IT=1 node --test daemon/test/integration/create-v2.it.test.js`.
// It always uses isolated runtime/download directories and never touches the user's profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const enabled = process.env.THUNDERD_RUN_CREATE_V2_IT === '1';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = Number(process.env.THUNDERD_CREATE_V2_PORT || 16907);
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-create-runtime-'));
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-create-download-'));
let daemon; let fixture;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function request(method, params) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/jsonrpc', method: 'POST', headers: { authorization: 'Bearer create-v2-it' } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => { try { const parsed = JSON.parse(body); if (parsed.error) reject(Object.assign(new Error(parsed.error.message), { code: parsed.error.code })); else resolve(parsed.result); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}
function startFixture() {
  const data = crypto.randomBytes(32 * 1024); const sha = crypto.createHash('sha256').update(data).digest('hex');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-length': data.length, 'accept-ranges': 'bytes' }); if (req.method !== 'HEAD') res.end(data); else res.end(); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, sha, size: data.length, url: `http://127.0.0.1:${server.address().port}/fixture.bin` })));
}
async function waitHealthy(timeoutMs = 120000) { const deadline = Date.now() + timeoutMs; for (;;) { try { const info = await request('thunder.ui.v2.bootstrap', []); if (info.engine && info.engine.transportReady && info.engine.sdkReady) return; } catch {} if (Date.now() > deadline) throw new Error('engine did not become healthy'); await sleep(1000); } }

test('real V2 HTTP preflight → getDraft → commit → completed query', { skip: !enabled, timeout: 180000 }, async () => {
  fixture = await startFixture();
  daemon = spawn('bash', [path.join(repoRoot, 'daemon', 'run.sh')], { env: { ...process.env, THUNDERD_PORT: String(port), THUNDERD_RPC_SECRET: 'create-v2-it', THUNDERD_RUNTIME_DIR: runtime, THUNDERD_DOWNLOAD_DIR: downloadDir, WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder') }, stdio: ['ignore', 'inherit', 'inherit'] });
  try {
    await waitHealthy();
    const preflight = await request('thunder.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: fixture.url }], savePath: downloadDir }]);
    assert.equal(preflight.results.length, 1); assert.equal(preflight.results[0].ok, true);
    const initial = preflight.results[0].draft; assert.ok(initial && initial.draftId); assert.equal(initial.metadata.state, 'none');
    const fetched = await request('thunder.ui.v2.create.getDraft', [{ draftId: initial.draftId }]); assert.equal(fetched.draftId, initial.draftId); assert.equal(fetched.savePath, downloadDir);
    const committed = await request('thunder.ui.v2.create.commit', [{ draftIds: [initial.draftId], expectedRevisions: { [initial.draftId]: fetched.revision }, idempotencyKey: 'create-v2-it-1' }]);
    assert.equal(committed.results[0].ok, true); assert.equal(committed.results[0].taskIds.length, 1);
    const deadline = Date.now() + 90000; let item;
    for (;;) { const response = await request('thunder.ui.v2.tasks.query', [{ view: 'all', limit: 20 }]); item = response.items.find((candidate) => candidate.taskId === committed.results[0].taskIds[0]); if (item && item.lifecycle === 'completed') break; if (Date.now() > deadline) throw new Error(`V2 task did not complete: ${item && item.lifecycle}`); await sleep(1000); }
    const target = path.join(downloadDir, 'fixture.bin'); assert.equal(fs.statSync(target).size, fixture.size); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'), fixture.sha);
  } finally {
    try { fixture.server.close(); } catch {}
    try { daemon.kill('SIGTERM'); } catch {}
    await sleep(1500);
  }
});
