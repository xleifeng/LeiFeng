'use strict';

// Real V2 operation acceptance. Opt in with THUNDERD_RUN_TASK_OPERATIONS_IT=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const enabled = process.env.THUNDERD_RUN_TASK_OPERATIONS_IT === '1';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = Number(process.env.THUNDERD_TASK_OPERATIONS_PORT || 16940);
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-ops-runtime-'));
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-v2-ops-download-'));
const targetDir = path.join(downloadDir, 'moved');
let daemon; let fixture;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/jsonrpc', method: 'POST', headers: { authorization: 'Bearer task-ops-it' } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => { try { const value = JSON.parse(body); if (value.error) reject(Object.assign(new Error(value.error.message), { code: value.error.code })); else resolve(value.result); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}
function startFixture() {
  const bytes = crypto.randomBytes(128 * 1024); const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-length': bytes.length, 'accept-ranges': 'bytes' }); if (req.method !== 'HEAD') res.end(bytes); else res.end(); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, bytes, sha, url: `http://127.0.0.1:${server.address().port}/ops.bin` })));
}
async function waitHealthy() { const deadline = Date.now() + 120000; for (;;) { try { const result = await rpc('thunder.ui.v2.bootstrap', []); if (result.engine?.transportReady && result.engine?.sdkReady) return; } catch {} if (Date.now() > deadline) throw new Error('engine did not become healthy'); await sleep(1000); } }
async function waitTask(taskId, predicate) { const deadline = Date.now() + 90000; for (;;) { const result = await rpc('thunder.ui.v2.tasks.get', [{ taskId }]); if (predicate(result)) return result; if (Date.now() > deadline) throw new Error(`task operation timeout: ${result.lifecycle}`); await sleep(1000); } }

test('real V2 task operations rename → move → recycle → permanent delete', { skip: !enabled, timeout: 240000 }, async () => {
  fixture = await startFixture();
  daemon = spawn('bash', [path.join(repoRoot, 'daemon', 'run.sh')], { env: { ...process.env, THUNDERD_PORT: String(port), THUNDERD_RPC_SECRET: 'task-ops-it', THUNDERD_RUNTIME_DIR: runtime, THUNDERD_DOWNLOAD_DIR: downloadDir, WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder') }, stdio: ['ignore', 'inherit', 'inherit'] });
  try {
    await waitHealthy();
    const preflight = await rpc('thunder.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: fixture.url }], savePath: downloadDir }]);
    const draft = preflight.results[0].draft; const committed = await rpc('thunder.ui.v2.create.commit', [{ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: 'task-ops-create' }]);
    const taskId = committed.results[0].taskIds[0]; const completed = await waitTask(taskId, (task) => task.lifecycle === 'completed');
    const renamed = await rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'rename', expectedRevisions: { [taskId]: completed.revision }, options: { displayName: 'ops-renamed.bin' }, idempotencyKey: 'task-ops-rename' }]);
    assert.equal(renamed.results[0].ok, true); assert.equal(fs.existsSync(path.join(downloadDir, 'ops-renamed.bin')), true);
    const afterRename = await rpc('thunder.ui.v2.tasks.get', [{ taskId }]);
    const moved = await rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'move', expectedRevisions: { [taskId]: afterRename.revision }, options: { targetDirectory: targetDir }, idempotencyKey: 'task-ops-move' }]);
    assert.equal(moved.results[0].ok, true); assert.equal(fs.existsSync(path.join(targetDir, 'ops-renamed.bin')), true);
    const afterMove = await rpc('thunder.ui.v2.tasks.get', [{ taskId }]);
    const recycled = await rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'recycle', expectedRevisions: { [taskId]: afterMove.revision }, options: { deleteLocalFiles: false }, idempotencyKey: 'task-ops-recycle' }]);
    assert.equal(recycled.results[0].ok, true); assert.equal((await rpc('thunder.ui.v2.trash.query', [{}])).items.some((item) => item.taskId === taskId), true);
    const deleted = await rpc('thunder.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'delete-permanently', expectedRevisions: { [taskId]: (await rpc('thunder.ui.v2.tasks.get', [{ taskId }])).revision }, options: { deleteLocalFiles: true }, idempotencyKey: 'task-ops-delete' }]);
    assert.equal(deleted.results[0].ok, true); assert.equal(fs.existsSync(path.join(targetDir, 'ops-renamed.bin')), false);
  } finally { try { fixture.server.close(); } catch {} try { daemon.kill('SIGTERM'); } catch {} await sleep(1500); }
});
