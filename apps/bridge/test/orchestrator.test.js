// orchestrator.test.js — 编排器集成单测（假 daemon RPC stub，不打真服务）。
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

// 复用 bridge.test.js 的种子构造（动态 import bencode）
async function makeTorrent({ name, files, pieceLength = 16384 }) {
  const bencode = (await import('bencode')).default;
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  let offset = 0;
  const layout = [];
  const all = Buffer.alloc(sorted.reduce((s, f) => s + f.data.length, 0));
  for (const f of sorted) {
    f.data.copy(all, offset);
    layout.push({ path: f.path, length: f.data.length, offset });
    offset += f.data.length;
  }
  const pieces = [];
  for (let p = 0; p * pieceLength < all.length; p++) {
    pieces.push(crypto.createHash('sha1').update(all.subarray(p * pieceLength, (p + 1) * pieceLength)).digest());
  }
  const fileList = sorted.length === 1 && sorted[0].path === name
    ? null
    : sorted.map((f) => ({ length: f.data.length, path: f.path.split('/') }));
  const info = fileList
    ? { files: fileList, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) }
    : { length: all.length, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) };
  return { raw: bencode.encode({ announce: 'http://t/ann', info }), layout, total: all.length };
}

test('orchestrator: hybrid 编排——假 daemon 流程贯通 + 会话建立 + web seed 注入', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const { createInjector } = require('../src/torrent-injector');
  const { createServer } = require('../src/http-server');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
  // 数据：已有一半（前 2 pieces 落盘）
  const data = crypto.randomBytes(40000);
  fs.writeFileSync(path.join(dir, 'h.bin'), data.subarray(0, 32768));
  const { raw, total } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data }] });

  // 会话（单文件直落形态 c：root = <dataPath>/<name>）
  const orch = createOrchestrator({ savePath: dir });
  const session = await orch.adoptTorrent(raw);
  assert.strictEqual(session.infohash.length, 40);
  session.verifier.verifyAll(); // 测试中同步推一把（生产由 HTTP 按需验证驱动）
  // 40000B 数据 / 16384B piece = 3 pieces；落盘 32768B = piece0 全 + piece1 全；piece2 缺
  assert.strictEqual(session.verifier.verifiedCount, 2);

  // HTTP 服务走 fileMap
  const { server, port } = await createServer({ sessions: orch.sessions, port: 0 });
  const r = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/seeds/${session.infohash}/h.bin`, { headers: { Range: 'bytes=0-1023' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.strictEqual(r.status, 206);
  assert.ok(r.body.equals(data.subarray(0, 1024)));

  // 未验证区间 503
  const r2 = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/seeds/${session.infohash}/h.bin`, { headers: { Range: 'bytes=32768-33791' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    }).on('error', reject);
  });
  assert.strictEqual(r2.status, 503);

  server.close();
  orch.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hybrid 接管同 hash 已有任务，不提交新建草稿', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-adopt-'));
  const { raw } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data: Buffer.alloc(16384, 7) }] });
  const parsed = await (await import('parse-torrent')).default(raw);
  const calls = [];
  const task = { taskId: 'existing', kind: 'bt', lifecycle: 'queued', savePath: dir,
    sourceFingerprint: `bt:info:${parsed.infoHash}` };
  const daemonClient = {
    rpc: async (method) => {
      calls.push(method);
      if (method === 'thunder.ui.v2.tasks.query') return { items: [task], nextCursor: null };
      if (method === 'thunder.ui.v2.tasks.get') return task;
      if (method === 'thunder.ui.v2.tasks.command') return { results: [{ ok: true }] };
      throw new Error(`unexpected RPC ${method}`);
    },
    exportTorrent: async () => raw,
  };
  const qbitClient = { addTorrent: async () => true };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient });
  try {
    const result = await orch.hybridDownload(`magnet:?xt=urn:btih:${parsed.infoHash}`);
    assert.equal(result.taskId, 'existing');
    assert.equal(result.session.taskId, 'existing');
    assert.equal(calls.includes('thunder.ui.v2.create.commit'), false);
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('原生会话占用且无种子元数据时，qbit 独立接管磁力', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-busy-'));
  const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;
  let added = false;
  const daemonClient = { rpc: async (method) => {
    if (method === 'thunder.ui.v2.tasks.query') return { items: [], nextCursor: null };
    if (method === 'thunder.ui.v2.create.preflight') return { results: [{ ok: true, draft: { draftId: 'd1', state: 'ready' } }] };
    if (method === 'thunder.ui.v2.create.commit') return { results: [{ ok: false, error: { code: 'BT_NATIVE_SESSION_BUSY' } }] };
    throw new Error(`unexpected RPC ${method}`);
  } };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient: { addMagnet: async (value) => { added = value === magnet; } } });
  try {
    const result = await orch.hybridDownload(magnet);
    assert.equal(result.session, null);
    assert.equal(added, true);
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('异步 208 删除失败任务并更新 session taskId', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-recover-'));
  const { raw } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data: Buffer.alloc(16384, 3) }] });
  const parsed = await (await import('parse-torrent')).default(raw);
  let commits = 0; const commands = [];
  const daemonClient = { rpc: async (method, params) => {
    if (method === 'thunder.ui.v2.tasks.query') return { items: [], nextCursor: null };
    if (method === 'thunder.ui.v2.create.preflight') return { results: [{ ok: true, draft: { draftId: 'd1', state: 'ready' } }] };
    if (method === 'thunder.ui.v2.create.commit') return { results: [{ ok: true, taskIds: [++commits === 1 ? 'old' : 'new'] }] };
    if (method === 'thunder.ui.v2.tasks.get') return params[0].taskId === 'old'
      ? { taskId: 'old', lifecycle: 'failed', error: { nativeCode: 208 } }
      : { taskId: 'new', lifecycle: 'queued' };
    if (method === 'thunder.ui.v2.tasks.command') { commands.push(params[0].command); return { results: [{ ok: true }] }; }
    throw new Error(`unexpected RPC ${method}`);
  }, exportTorrent: async () => raw };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient: { addTorrent: async () => true }, recoveryIntervalMs: 10 });
  try {
    const result = await orch.hybridDownload(`magnet:?xt=urn:btih:${parsed.infoHash}`);
    for (let i = 0; i < 40 && result.session.taskId !== 'new'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(result.session.taskId, 'new');
    assert.deepEqual(commands.slice(0, 4), ['set-bt-scheduler', 'recycle', 'delete-permanently', 'set-bt-scheduler']);
    assert.equal(commits, 2);
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('引擎失败(START_FAILED)自动 start 重试救回任务，不删除不重建', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-engine-recover-'));
  const { raw } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data: Buffer.alloc(16384, 5) }] });
  const parsed = await (await import('parse-torrent')).default(raw);
  // 场景：任务先健康；引擎重启后变 START_FAILED；桥发 start；daemon 恢复为 downloading。
  let phase = 'healthy'; const commands = []; let starts = 0;
  const daemonClient = { rpc: async (method, params) => {
    if (method === 'thunder.ui.v2.tasks.query') return { items: [], nextCursor: null };
    if (method === 'thunder.ui.v2.create.preflight') return { results: [{ ok: true, draft: { draftId: 'd1', state: 'ready' } }] };
    if (method === 'thunder.ui.v2.create.commit') return { results: [{ ok: true, taskIds: ['t1'] }] };
    if (method === 'thunder.ui.v2.tasks.get') {
      if (params[0].taskId !== 't1') throw new Error('unexpected taskId');
      return phase === 'healthy' ? { taskId: 't1', lifecycle: 'downloading' }
        : phase === 'failed' ? { taskId: 't1', lifecycle: 'failed', error: { code: 'START_FAILED', retryable: true } }
        : { taskId: 't1', lifecycle: 'downloading' };
    }
    if (method === 'thunder.ui.v2.tasks.command') {
      commands.push(params[0].command);
      if (params[0].command === 'start' && params[0].taskIds[0] === 't1') { starts++; phase = 'recovered'; }
      return { results: [{ ok: true }] };
    }
    throw new Error(`unexpected RPC ${method}`);
  }, exportTorrent: async () => raw };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient: { addTorrent: async () => true }, recoveryIntervalMs: 5 });
  try {
    const result = await orch.hybridDownload(`magnet:?xt=urn:btih:${parsed.infoHash}`);
    assert.equal(result.session.taskId, 't1');
    phase = 'failed'; // 引擎崩溃：任务被标 START_FAILED
    for (let i = 0; i < 200 && starts === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(starts >= 1, '应发出 start 重试');
    // 不走删除/重建路径
    assert.equal(commands.includes('recycle'), false);
    assert.equal(commands.includes('delete-permanently'), false);
    assert.equal(result.session.taskId, 't1');
    // 自愈后监控继续
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('matchingTasks 翻页遇 CURSOR_EXPIRED 从首页重开', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cursor-'));
  const { raw } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data: Buffer.alloc(16384, 9) }] });
  const parsed = await (await import('parse-torrent')).default(raw);
  let pageCalls = 0; let expiredOnce = false;
  const target = { taskId: 't9', kind: 'bt', lifecycle: 'queued', savePath: dir,
    sourceFingerprint: `bt:info:${parsed.infoHash}` };
  const daemonClient = {
    rpc: async (method, params) => {
      if (method === 'thunder.ui.v2.tasks.query') {
        pageCalls++;
        if (params[0].cursor && !expiredOnce) {
          // 翻第二页时列表已变更 → 游标失效
          expiredOnce = true;
          const e = new Error('CURSOR_EXPIRED');
          e.code = 'CURSOR_EXPIRED';
          throw e;
        }
        if (!params[0].cursor) {
          // 首页：含目标 + nextCursor
          return { items: [target, { taskId: 'other', kind: 'http' }], nextCursor: 'c2' };
        }
        return { items: [], nextCursor: null };
      }
      if (method === 'thunder.ui.v2.tasks.get') return target;
      throw new Error(`unexpected RPC ${method}`);
    },
    exportTorrent: async () => raw,
  };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient: { addTorrent: async () => true } });
  try {
    const result = await orch.hybridDownload(`magnet:?xt=urn:btih:${parsed.infoHash}`);
    assert.equal(result.taskId, 't9');
    assert.ok(pageCalls >= 3, `应翻页重试（calls=${pageCalls}）`);
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hybrid 接管引擎失败(START_FAILED)任务：先 start 救活，不重建', async () => {
  const { createOrchestrator } = require('../src/orchestrator');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-adopt-engfail-'));
  const { raw } = await makeTorrent({ name: 'h.bin', files: [{ path: 'h.bin', data: Buffer.alloc(16384, 4) }] });
  const parsed = await (await import('parse-torrent')).default(raw);
  const commands = []; let commits = 0;
  const task = { taskId: 'engfail', kind: 'bt', lifecycle: 'failed', savePath: dir,
    sourceFingerprint: `bt:info:${parsed.infoHash}`,
    error: { code: 'START_FAILED', retryable: true } };
  const daemonClient = { rpc: async (method, params) => {
    if (method === 'thunder.ui.v2.tasks.query') return { items: [task], nextCursor: null };
    if (method === 'thunder.ui.v2.tasks.get') return task; // 接管判定时仍是 failed；start 后由 recovery 监控续观
    if (method === 'thunder.ui.v2.tasks.command') { commands.push(params[0].command); return { results: [{ ok: true }] }; }
    if (method === 'thunder.ui.v2.create.commit') { commits++; throw new Error('unexpected commit'); }
    if (method === 'thunder.ui.v2.create.preflight') { commits++; throw new Error('unexpected preflight'); }
    throw new Error(`unexpected RPC ${method}`);
  }, exportTorrent: async () => raw };
  const orch = createOrchestrator({ savePath: dir, daemonClient, qbitClient: { addTorrent: async () => true } });
  try {
    const result = await orch.hybridDownload(`magnet:?xt=urn:btih:${parsed.infoHash}`);
    assert.equal(result.taskId, 'engfail');
    assert.equal(commits, 0, '绝不能重建任务');
    assert.deepEqual(commands.slice(0, 2), ['start', 'set-bt-scheduler']);
  } finally { orch.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
