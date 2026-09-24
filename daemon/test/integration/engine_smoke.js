'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtime = path.join(repoRoot, 'daemon', '.runtime-smoke');
const saveDir = path.join(runtime, 'save');
const winePath = (p) => 'Z:' + p.replace(/\//g, '\\');
const FNAME = 'smoke.bin';

let child = null, fixture = null;
const cleanup = (code) => {
  try { child && child.kill('SIGKILL'); } catch {}
  try { fixture && fixture.close(); } catch {}
  setTimeout(() => process.exit(code), 300);
};
const fail = (msg) => { console.error('SMOKE FAIL:', msg); cleanup(1); };

async function main() {
  const data = crypto.randomBytes(2 * 1024 * 1024);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  fixture = http.createServer((req, res) => {
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': data.length }); return res.end(); }
    res.writeHead(200, { 'content-length': data.length, 'content-type': 'application/octet-stream' });
    res.end(data);
  });
  const port = await new Promise((r) => fixture.listen(0, '127.0.0.1', () => r(fixture.address().port)));
  const url = `http://127.0.0.1:${port}/${FNAME}`;

  for (const d of ['profile/dkcfg', 'profile/Torrents', 'profile/temp', 'log', 'save'])
    fs.mkdirSync(path.join(runtime, d), { recursive: true });

  const server = net.createServer();
  const tcpPort = await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', () => r(server.address().port)); });
  const connected = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('engine connect timeout 40s')), 40000);
    server.once('connection', (s) => { clearTimeout(t); res(s); });
  });

  const engineScript = path.join(repoRoot, 'daemon', 'engine', 'engine.js');
  const thunderExe = path.join(repoRoot, 'thunder_x', 'program', 'thunder.exe');
  const logFd = fs.openSync(path.join(runtime, 'engine.log'), 'a');
  child = spawn('wine', [winePath(thunderExe), winePath(engineScript), '--port', String(tcpPort), '--profile', winePath(runtime)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WINEDEBUG: '-all', WINEESYNC: '1',
      WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder'),
      '01KVYZS23XBRBTN7XTFFPAXQNV_SDK_Platform': '64' },
    cwd: path.join(repoRoot, 'thunder_x', 'program'), stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  const sock = await connected;
  console.log('[smoke] engine connected');

  let buf = ''; let seq = 0; const pending = new Map();
  sock.on('data', (c) => {
    buf += c.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.ok ? p.res(msg.result) : p.rej(new Error(msg.error)); }
    }
  });
  const call = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    sock.write(JSON.stringify({ id, method, params }) + '\n');
  });

  console.log('[smoke] ping ->', JSON.stringify(await call('ping')));
  const { engineId } = await call('createTask', { url, savePath: winePath(saveDir), taskName: FNAME });
  console.log('[smoke] engineId =', engineId);
  if (!engineId || engineId <= 0) return fail('bad engineId');
  await call('startTasks', { ids: [engineId] });

  const target = path.join(saveDir, FNAME);
  const deadline = Date.now() + 45000;
  let ok = false;
  while (Date.now() < deadline) {
    try { if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === sha) { ok = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ok) {
    try { console.error(fs.readFileSync(path.join(runtime, 'engine.log'), 'utf8').slice(-2000)); } catch {}
    return fail('file never matched sha');
  }
  // settle: SDK writes TaskDb completion async after file flush; wait up to 10s for Status=8
  const settleEnd = Date.now() + 10000;
  while (Date.now() < settleEnd) {
    try {
      const _db = path.join(runtime, 'profile', 'TaskDb.dat');
      const _rows = JSON.parse(execFileSync('sqlite3', ['-json', 'file:'+_db+'?mode=ro', 'SELECT Status,TotalReceiveSize FROM TaskBase WHERE TaskId='+engineId], {encoding:'utf8'}) || '[]');
      if (_rows[0] && _rows[0].Status === 8 && _rows[0].TotalReceiveSize === data.length) { console.log('[smoke] taskdb settled Status=8'); break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  // TaskDb 通道预验证（Task 3 依赖）：row 存在、TaskId=engineId、Status=8、尺寸吻合
  try {
    const db = path.join(runtime, 'profile', 'TaskDb.dat');
    const rows = JSON.parse(execFileSync('sqlite3', ['-json', `file:${db}?mode=ro`,
      `SELECT TaskId,Status,TotalReceiveSize,ResourceSize FROM TaskBase WHERE TaskId=${engineId}`], { encoding: 'utf8' }) || '[]');
    console.log('[smoke] taskdb row =', JSON.stringify(rows));
    if (!rows[0] || rows[0].Status !== 8 || rows[0].TotalReceiveSize !== data.length) return fail('taskdb row mismatch');
  } catch (e) { return fail('taskdb read failed: ' + e.message); }
  console.log('SMOKE PASS');
  cleanup(0);
}

main().catch((e) => fail(e.stack || e));
setTimeout(() => fail('global timeout'), 120000);
