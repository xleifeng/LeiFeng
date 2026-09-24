'use strict';
// 五链路集成（真 daemon + 真 Wine 引擎）。运行: node --test daemon/test/integration/
// 断言依据 = Task 0 RESULTS.md 的实测语义（stop/resume/delete/restart/404）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFixture, rpc } = require('./helpers/fixture-server');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const PORT = 16899;
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'thunderd-it-'));
const downloadDir = path.join(runtime, 'downloads');
let daemon = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fsize = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };

// 等真实文件落盘且有字节（引擎启动下载到首字节有延迟；pause 前须确认文件已在写）
async function waitForFile(target, minSize = 1, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sz = fsize(target);
    if (sz >= minSize) return sz;
    if (Date.now() > deadline) throw new Error(`file ${target} never reached ${minSize} bytes (last=${sz})`);
    await sleep(1000);
  }
}

async function waitEngineHealthy(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const info = await rpc(PORT, 'thunder.getEngineInfo', []);
      if (info.transportReady && info.sdkReady) return info;
    } catch {}
    if (Date.now() > deadline) throw new Error('engine never became healthy');
    await sleep(2000);
  }
}

async function waitStatus(gid, want, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
    if (want.includes(s.status)) return s;
    if (Date.now() > deadline) throw new Error(`task ${gid} stuck at ${s.status}, want ${want}`);
    await sleep(1000);
  }
}

test.before(async () => {
  fs.mkdirSync(downloadDir, { recursive: true });
  daemon = spawn('bash', [path.join(repoRoot, 'daemon', 'run.sh')], {
    env: { ...process.env, THUNDERD_PORT: String(PORT), THUNDERD_RUNTIME_DIR: runtime,
      THUNDERD_DOWNLOAD_DIR: downloadDir,
      THUNDERD_LEGACY_RPC: '1',
      WINEPREFIX: process.env.WINEPREFIX || path.join(process.env.HOME, '.wine-thunder') },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitEngineHealthy();
}, { timeout: 120000 });

test.after(() => { try { daemon && daemon.kill('SIGTERM'); } catch {} });

test('chain1: addUri → complete → sha256 (TaskDb-driven)', { timeout: 90000 }, async () => {
  const fx = await startFixture({ bytes: 2 * 1024 * 1024 });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], {}]);
  const s = await waitStatus(gid, ['complete'], 60000);
  assert.strictEqual(s.totalLength, String(fx.size));
  assert.strictEqual(s.completedLength, String(fx.size));
  const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(downloadDir, 'fixture.bin'))).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

test('chain2: pause stalls the REAL file, unpause completes', { timeout: 120000 }, async () => {
  // path=out='throttled.bin'：引擎按 URL basename 落盘（Task 0 实测），须使 URL basename=out
  // 32MB + 限速 64KB/200ms（引擎 5 线程并发，每线程独立限速；防 pause 窗口内完成）
  const fx = await startFixture({ bytes: 32 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 200, path: 'throttled.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'throttled.bin' }]);
  await waitStatus(gid, ['active'], 30000);
  // 引擎首字节有延迟（HEAD/连接/SDK 初始化），须等真实文件落盘后再 pause
  const target = path.join(downloadDir, 'throttled.bin');
  await waitForFile(target, 1, 30000);
  await rpc(PORT, 'aria2.pause', [gid]);
  // 评审②：断言真实文件（fs.stat），不是 RPC 里的 completedLength
  const s1 = fsize(target);
  await sleep(3000);
  const s2 = fsize(target);
  assert.ok(s1 > 0, 'partial file exists');
  assert.ok(s2 - s1 < 512 * 1024, `file kept growing after pause (${s1} → ${s2})`);
  await rpc(PORT, 'aria2.unpause', [gid]);
  await waitStatus(gid, ['complete'], 90000);
  const got = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

test('chain3: remove → queue baseline delta + tellStopped', { timeout: 90000 }, async () => {
  const fx = await startFixture({ bytes: 16 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 200, path: 'toberemoved.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'toberemoved.bin' }]);
  await waitStatus(gid, ['active'], 30000);
  // 等真实文件在写，确认任务确实在引擎队列中下载（防 qBefore=0 假阴性）
  await waitForFile(path.join(downloadDir, 'toberemoved.bin'), 1, 30000);
  const qBefore = (await rpc(PORT, 'thunder.getEngineInfo', [])).queue;
  await rpc(PORT, 'aria2.remove', [gid]);
  await sleep(2000);
  const qAfter = (await rpc(PORT, 'thunder.getEngineInfo', [])).queue;
  assert.ok(qAfter < qBefore, `queue did not drop (${qBefore} → ${qAfter})`);
  const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.strictEqual(s.status, 'removed');
  fx.server.close();
});

test('chain4: kill engine via enginePid → all non-terminal interrupted, RPC up', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（kill 前不会 complete）
  const fx = await startFixture({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'victim.bin' }]);
  // hang fixture：body 不发，任务不会 complete；只需确认 gid 是非终态（active/waiting）
  await waitStatus(gid, ['active', 'waiting'], 30000);
  const fx2 = await startFixture({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim2.bin' });
  const gid2 = await rpc(PORT, 'aria2.addUri', [[fx2.url], { out: 'victim2.bin' }]);
  await waitStatus(gid2, ['active', 'waiting'], 30000);
  await rpc(PORT, 'aria2.pause', [gid2]); // paused 任务也应被标 interrupted（评审③）
  const { enginePid } = await rpc(PORT, 'thunder.getEngineInfo', []);
  assert.ok(enginePid > 0);
  process.kill(enginePid, 'SIGKILL');
  const s = await waitStatus(gid, ['error'], 30000);
  assert.strictEqual(s.errorCode, 'interrupted');
  const s2 = await waitStatus(gid2, ['error'], 30000);
  assert.strictEqual(s2.errorCode, 'interrupted');
  const info = await waitEngineHealthy(90000);
  assert.ok(info.restarts >= 1);
  const stat = await rpc(PORT, 'aria2.getGlobalStat', []); // RPC 全程在线
  assert.ok(typeof stat.numActive === 'string');
  fx.server.close();
  fx2.server.close();
});

test('chain5: 404 → task reaches error (engine-reported)', { timeout: 90000 }, async () => {
  const fx = await startFixture({ bytes: 1024 });
  const gid = await rpc(PORT, 'aria2.addUri', [[`http://127.0.0.1:${fx.server.address().port}/notfound`], { out: 'nf.bin' }]);
  const s = await waitStatus(gid, ['error'], 60000);
  assert.ok(s.errorCode && s.errorCode !== 'interrupted', `unexpected errorCode: ${s.errorCode}`);
  fx.server.close();
});

// ---- Task 6 补测（Task 5 评审遗留，控制者裁定在集成测试里补）----

test('sup1: 6-method integration smoke — getGlobalStat/tellActive/tellWaiting/tellStopped/removeAndDelete/restartEngine', { timeout: 120000 }, async () => {
  // 起一个任务到 active，用于 tellActive/tellWaiting/tellStopped 形状验证
  // 16MB + 限速 64KB/200ms 确保任务在断言窗口内不会先 complete
  const fx = await startFixture({ bytes: 16 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 200, path: 'sixmethod.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'sixmethod.bin' }]);
  await waitStatus(gid, ['active'], 30000);

  // getGlobalStat: 字符串数值字段
  const stat = await rpc(PORT, 'aria2.getGlobalStat', []);
  assert.ok(typeof stat.downloadSpeed === 'string', 'getGlobalStat.downloadSpeed is string');
  assert.ok(typeof stat.numActive === 'string', 'getGlobalStat.numActive is string');
  assert.ok(typeof stat.numWaiting === 'string');
  assert.ok(typeof stat.numStopped === 'string');

  // tellActive: 数组，含本次 active 任务
  const active = await rpc(PORT, 'aria2.tellActive', []);
  assert.ok(Array.isArray(active), 'tellActive returns array');
  const inActive = active.find((t) => t.gid === gid);
  assert.ok(inActive, 'our task present in tellActive');
  assert.strictEqual(inActive.status, 'active');

  // 等真实文件落盘（引擎首字节延迟），后续 pause/removeAndDelete 才能断言文件存在
  const target = path.join(downloadDir, 'sixmethod.bin');
  await waitForFile(target, 1, 30000);

  // pause 后 tellWaiting（paused 归入 waiting 桶）
  await rpc(PORT, 'aria2.pause', [gid]);
  await sleep(1500);
  const waiting = await rpc(PORT, 'aria2.tellWaiting', []);
  assert.ok(Array.isArray(waiting), 'tellWaiting returns array');
  const inWaiting = waiting.find((t) => t.gid === gid);
  assert.ok(inWaiting, 'paused task present in tellWaiting');
  assert.strictEqual(inWaiting.status, 'paused');

  // removeAndDelete：remove + 删文件
  assert.ok(fs.existsSync(target), 'file exists before removeAndDelete');
  const rmId = await rpc(PORT, 'thunder.removeAndDelete', [gid]);
  assert.strictEqual(rmId, gid, 'removeAndDelete returns gid');
  const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.strictEqual(s.status, 'removed', 'task removed after removeAndDelete');
  // 文件应被删（允许短暂异步，给 2s）
  let gone = false;
  for (let i = 0; i < 4; i++) { if (!fs.existsSync(target)) { gone = true; break; } await sleep(500); }
  assert.ok(gone, 'file deleted by removeAndDelete');

  // tellStopped: 数组，含本次 removed 任务（removed 属 terminal）
  const stopped = await rpc(PORT, 'aria2.tellStopped', []);
  assert.ok(Array.isArray(stopped), 'tellStopped returns array');
  const inStopped = stopped.find((t) => t.gid === gid);
  assert.ok(inStopped, 'removed task present in tellStopped');
  assert.strictEqual(inStopped.status, 'removed');

  // restartEngine: 返回 healthy 布尔（受控重启；引擎会 re-boot）
  const r = await rpc(PORT, 'thunder.restartEngine', []);
  assert.ok(typeof r.healthy === 'boolean', 'restartEngine returns {healthy:boolean}');
  // 重启后引擎应重新健康（waitEngineHealthy 轮询 transportReady+sdkReady）
  await waitEngineHealthy(90000);

  fx.server.close();
});

test('sup2: out ≠ URL basename — 落盘名回读对齐（限制 1 根治）', { timeout: 90000 }, async () => {
  // 根治后行为：poller 首个 tick 回读 TaskDb Name 修正 registry.taskName，
  // tellStatus 报真实落盘名；磁盘只有引擎按 URL basename 落的 realname.bin，无 custom.bin 分裂文件。
  const fx = await startFixture({ bytes: 1 * 1024 * 1024, path: 'realname.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'custom.bin' }]);
  await sleep(1200); // 等首个 poller tick 完成 Name 回读
  const s0 = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.strictEqual(path.basename(s0.files[0].path), 'realname.bin', 'tellStatus 报告真实落盘名（下载中即成立，不等 complete）');
  const s = await waitStatus(gid, ['complete'], 60000);
  assert.strictEqual(path.basename(s.files[0].path), 'realname.bin', 'complete 后仍报真实落盘名');
  const engineFile = path.join(downloadDir, 'realname.bin');
  assert.ok(fs.existsSync(engineFile), 'engine wrote URL basename file');
  assert.ok(!fs.existsSync(path.join(downloadDir, 'custom.bin')), 'no split-brain custom.bin on disk');
  const got = crypto.createHash('sha256').update(fs.readFileSync(engineFile)).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

// F1 final-review fix: restartEngine 任务语义——原有 active 任务变 error/interrupted，
// 同 URL 重新 addUri 返回新 gid（不被死 gid 锁死）。
test('sup3: restartEngine marks active tasks interrupted, same URL re-addable (F1)', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（restart 前不会 complete）
  const fx = await startFixture({ bytes: 4 * 1024 * 1024, hang: true, path: 'restart-victim.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'restart-victim.bin' }]);
  await waitStatus(gid, ['active', 'waiting'], 30000);

  // restartEngine：受控重启，emit 'down' 触发 daemon core 把非终态标 interrupted
  const r = await rpc(PORT, 'thunder.restartEngine', []);
  assert.ok(typeof r.healthy === 'boolean', 'restartEngine returns {healthy:boolean}');

  // 原有 active 任务应变 error/interrupted（终态）
  const s = await waitStatus(gid, ['error'], 30000);
  assert.strictEqual(s.errorCode, 'interrupted', 'active task marked interrupted after restartEngine');

  // 同 URL 重新 addUri：不应被死 gid 锁死（findDuplicate 须跳过终态）→ 返回新 gid
  const gid2 = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'restart-victim.bin' }]);
  assert.notStrictEqual(gid2, gid, 're-add same URL returns new gid (not locked by dead gid)');
  const s2 = await rpc(PORT, 'aria2.tellStatus', [gid2]);
  assert.ok(s2.status === 'waiting' || s2.status === 'active', `new task is non-terminal: ${s2.status}`);

  // 清理：remove 新任务（hang fixture 不发 body，不会 complete）
  await rpc(PORT, 'aria2.remove', [gid2]).catch(() => {});
  fx.server.close();
});
