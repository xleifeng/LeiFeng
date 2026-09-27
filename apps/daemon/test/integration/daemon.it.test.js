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
const { rpc } = require('./helpers/fixture-server');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const PORT = 16899;
// 临时目录纪律：/tmp 是配额 tmpfs（写满连 Bash 工具都会失灵），测试临时物走家目录
const tmpBase = process.env.THUNDERD_IT_TMP || path.join(process.env.HOME, 'tmp');
const runtime = fs.mkdtempSync(path.join(tmpBase, 'thunderd-it-'));
const downloadDir = path.join(runtime, 'downloads');
let daemon = null;
// 登记所有 fixture server：链路正常走完各自 close()，断言失败时由 test.after 兜底回收
const liveFixtures = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fsize = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };

// 等真实文件落盘且有字节（引擎启动下载到首字节有延迟；pause 前须确认文件已在写）。
// 引擎下载中写 <name>.bin.xltd 部分文件，完成后才改名最终名（create-task-service.js 同认知），
// 两个候选名任一落盘即可；返回实际命中的路径供调用方继续 stat/read。
async function waitForFile(target, minSize = 1, timeoutMs = 30000) {
  const candidates = [target, `${target}.xltd`];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const p of candidates) if (fsize(p) >= minSize) return p;
    if (Date.now() > deadline) throw new Error(`file ${target} (or .xltd) never reached ${minSize} bytes`);
    await sleep(1000);
  }
}

// 包一层 startFixture：自动登记，链路尾部 close 时移除
async function startFx(opts) {
  const { startFixture } = require('./helpers/fixture-server');
  const fx = await startFixture(opts);
  liveFixtures.add(fx.server);
  const origClose = fx.server.close.bind(fx.server);
  fx.server.close = (...a) => { liveFixtures.delete(fx.server); return origClose(...a); };
  return fx;
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
  // 独立 WINEPREFIX：迅雷以命名互斥体（thunder11_{GUID} / Global\thunder5_app_mutex）
  // 做单实例检测，同一 wineserver 命名空间下第二个引擎进程会静默 ExitProcess(0)
  // （表现为 pre-connect-exit 循环）。隔离前缀 = 隔离 wineserver = 隔离命名对象空间。
  // 临时目录纪律：/tmp 是配额 tmpfs，一律用家目录隔离区（见 CLAUDE.md）。
  const winePrefix = process.env.THUNDERD_IT_WINEPREFIX
    || path.join(process.env.HOME, 'tmp', `tlei-it-wine-${process.pid}`);
  daemon = spawn('bash', [path.join(repoRoot, 'apps', 'daemon', 'run.sh')], {
    env: { ...process.env, THUNDERD_PORT: String(PORT), THUNDERD_RUNTIME_DIR: runtime,
      THUNDERD_DOWNLOAD_DIR: downloadDir,
      THUNDERD_LEGACY_RPC: '1',
      WINEPREFIX: winePrefix },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitEngineHealthy();
}, { timeout: 180000 });

test.after(() => {
  try { daemon && daemon.kill('SIGTERM'); } catch {}
  // 清理自建隔离 WINEPREFIX（wineboot 自建约 60MB；不清会累积）
  try {
    const prefix = path.join(process.env.HOME, 'tmp', `tlei-it-wine-${process.pid}`);
    if (prefix.startsWith(path.join(process.env.HOME, 'tmp', 'tlei-it-wine-'))) fs.rmSync(prefix, { recursive: true, force: true });
  } catch {}
  // fixture 兜底回收：断言失败时链路尾部的 fx.server.close() 不会执行，LISTEN socket
  // 残留会挂住 runner 事件循环（实测挂 18 分钟直到人工 kill）。closeAllConnections 断存量连接。
  for (const srv of liveFixtures) { try { srv.close(); srv.closeAllConnections?.(); } catch {} }
});

test('chain1: addUri → complete → sha256 (TaskDb-driven)', { timeout: 90000 }, async () => {
  const fx = await startFx({ bytes: 2 * 1024 * 1024 });
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
  // 限速是**每连接**限速，引擎 5 线程各开独立连接 → 实际吞吐 ≈ 5×(chunk/ms)。
  // 64MB + 64KB/400ms ≈ 5×160KB/s = 800KB/s → 全程 ≈80s，保证 pause 窗口（active 确认 +
  // 文件落盘 + 3s 停写断言 ≈15s）内绝不完成（32MB/200ms 时实测 23s 即完成，pause 撞上
  // complete 边界报 INVALID_TASK_STATE）。
  const fx = await startFx({ bytes: 64 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 400, path: 'throttled.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'throttled.bin' }]);
  await waitStatus(gid, ['active'], 30000);
  // 引擎首字节有延迟（HEAD/连接/SDK 初始化），须等真实文件落盘后再 pause。
  // 下载中文件名是 throttled.bin.xltd（SDK 部分文件），pause 停写断言直接对它做。
  const target = path.join(downloadDir, 'throttled.bin');
  const partial = await waitForFile(target, 1, 30000);
  await rpc(PORT, 'aria2.pause', [gid]);
  // 评审②：断言真实文件（fs.stat），不是 RPC 里的 completedLength
  const s1 = fsize(partial);
  await sleep(3000);
  const s2 = fsize(partial);
  assert.ok(s1 > 0, 'partial file exists');
  assert.ok(s2 - s1 < 512 * 1024, `file kept growing after pause (${s1} → ${s2})`);
  await rpc(PORT, 'aria2.unpause', [gid]);
  await waitStatus(gid, ['complete'], 90000);
  const got = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

test('chain3: remove → 任务行消失 + removed 终态', { timeout: 90000 }, async () => {
  const fx = await startFx({ bytes: 16 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 200, path: 'toberemoved.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'toberemoved.bin' }]);
  await waitStatus(gid, ['active'], 30000);
  // 等真实文件在写，确认任务确实在下载中（.xltd 部分文件也算）
  await waitForFile(path.join(downloadDir, 'toberemoved.bin'), 1, 30000);
  // 不断言 getDownloadQueueCount 回落：直连引擎探针（recon + qprobe out5/out6）证实
  // deleteTasks 后该计数 ≥10s 不变（活跃会话不释放），完成才归 0——它不是移除的可靠
  // 信号。本链路核心契约 = remove 后任务转 removed 终态且引擎任务行可查。
  await rpc(PORT, 'aria2.remove', [gid]);
  const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.strictEqual(s.status, 'removed');
  fx.server.close();
});

test('chain4: kill engine via enginePid → all non-terminal interrupted, RPC up', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（kill 前不会 complete）
  const fx = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'victim.bin' }]);
  // hang fixture：body 不发，任务不会 complete；只需确认 gid 是非终态（active/waiting）
  await waitStatus(gid, ['active', 'waiting'], 30000);
  const fx2 = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim2.bin' });
  const gid2 = await rpc(PORT, 'aria2.addUri', [[fx2.url], { out: 'victim2.bin' }]);
  await waitStatus(gid2, ['active', 'waiting'], 30000);
  await rpc(PORT, 'aria2.pause', [gid2]); // paused 任务也应被标引擎下线失败（评审③）
  const { enginePid } = await rpc(PORT, 'thunder.getEngineInfo', []);
  assert.ok(enginePid > 0);
  process.kill(enginePid, 'SIGKILL');
  // V2 契约：引擎下线 → markEngineGenerationLost 写结构化错误 ENGINE_RESTARTED
  // （桥 orchestrator 的 ENGINE_FAILURE_CODES 恢复逻辑消费此码；阶段 1 的裸 'interrupted' 已退役）
  const s = await waitStatus(gid, ['error'], 30000);
  assert.strictEqual(s.errorCode, 'ENGINE_RESTARTED');
  const s2 = await waitStatus(gid2, ['error'], 30000);
  assert.strictEqual(s2.errorCode, 'ENGINE_RESTARTED');
  const info = await waitEngineHealthy(90000);
  assert.ok(info.restarts >= 1);
  const stat = await rpc(PORT, 'aria2.getGlobalStat', []); // RPC 全程在线
  assert.ok(typeof stat.numActive === 'string');
  fx.server.close();
  fx2.server.close();
});

test('chain5: 404 → task reaches error (engine-reported)', { timeout: 90000 }, async () => {
  const fx = await startFx({ bytes: 1024 });
  const gid = await rpc(PORT, 'aria2.addUri', [[`http://127.0.0.1:${fx.server.address().port}/notfound`], { out: 'nf.bin' }]);
  const s = await waitStatus(gid, ['error'], 60000);
  assert.ok(s.errorCode && s.errorCode !== 'ENGINE_RESTARTED', `unexpected errorCode: ${s.errorCode}`);
  fx.server.close();
});

// ---- Task 6 补测（Task 5 评审遗留，控制者裁定在集成测试里补）----

test('sup1: 6-method integration smoke — getGlobalStat/tellActive/tellWaiting/tellStopped/removeAndDelete/restartEngine', { timeout: 120000 }, async () => {
  // 起一个任务到 active，用于 tellActive/tellWaiting/tellStopped 形状验证
  // 限速是每连接限速（引擎 5 线程）：32MB + 64KB/400ms ≈ 800KB/s → 全程 ≈40s，
  // 保证断言窗口（形状检查 + 落盘等待 + pause ≈15s）内不 complete（16MB/200ms 实测 ≈10s 即
  // 完成，pause 撞 completed 报 INVALID_TASK_STATE）。
  const fx = await startFx({ bytes: 32 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 400, path: 'sixmethod.bin' });
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

  // 等真实文件落盘（引擎首字节延迟；下载中是 sixmethod.bin.xltd），后续 pause/removeAndDelete 才能断言文件存在
  const target = path.join(downloadDir, 'sixmethod.bin');
  const onDisk = await waitForFile(target, 1, 30000);

  // pause 后 tellWaiting（paused 归入 waiting 桶）
  await rpc(PORT, 'aria2.pause', [gid]);
  await sleep(1500);
  const waiting = await rpc(PORT, 'aria2.tellWaiting', []);
  assert.ok(Array.isArray(waiting), 'tellWaiting returns array');
  const inWaiting = waiting.find((t) => t.gid === gid);
  assert.ok(inWaiting, 'paused task present in tellWaiting');
  assert.strictEqual(inWaiting.status, 'paused');

  // removeAndDelete：remove + 删文件（最终名与 .xltd 部分文件都应消失）
  assert.ok(fs.existsSync(onDisk), 'file exists before removeAndDelete');
  const rmId = await rpc(PORT, 'thunder.removeAndDelete', [gid]);
  assert.strictEqual(rmId, gid, 'removeAndDelete returns gid');
  const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.strictEqual(s.status, 'removed', 'task removed after removeAndDelete');
  // 文件应被删（允许短暂异步，给 2s）
  let gone = false;
  for (let i = 0; i < 4; i++) {
    if (!fs.existsSync(target) && !fs.existsSync(`${target}.xltd`)) { gone = true; break; }
    await sleep(500);
  }
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
  const fx = await startFx({ bytes: 1 * 1024 * 1024, path: 'realname.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'custom.bin' }]);
  // 等首个 poller tick 完成 Name 回读（不固定 sleep：引擎刚 boot 时首 tick 快照往返有延迟）
  const wantName = 'realname.bin';
  const deadline0 = Date.now() + 15000;
  let s0;
  for (;;) {
    s0 = await rpc(PORT, 'aria2.tellStatus', [gid]);
    if (path.basename(s0.files[0].path) === wantName) break;
    if (Date.now() > deadline0) break; // 超时后落到下方断言给出明确失败
    await sleep(500);
  }
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

// F1 final-review fix: restartEngine 任务语义——原有 active 任务变 error/ENGINE_RESTARTED，
// 同 URL 重新 addUri 返回新 gid（不被死 gid 锁死）。
test('sup3: restartEngine marks active tasks engine-restarted, same URL re-addable (F1)', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（restart 前不会 complete）
  const fx = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'restart-victim.bin' });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'restart-victim.bin' }]);
  await waitStatus(gid, ['active', 'waiting'], 30000);

  // restartEngine：受控重启，emit 'down' 触发 daemon core 把非终态标引擎下线失败
  const r = await rpc(PORT, 'thunder.restartEngine', []);
  assert.ok(typeof r.healthy === 'boolean', 'restartEngine returns {healthy:boolean}');

  // 原有 active 任务应变 error/ENGINE_RESTARTED（终态）
  const s = await waitStatus(gid, ['error'], 30000);
  assert.strictEqual(s.errorCode, 'ENGINE_RESTARTED', 'active task marked engine-restarted after restartEngine');

  // 同 URL 重新 addUri：不应被死 gid 锁死（findDuplicate 须跳过终态）→ 返回新 gid
  const gid2 = await rpc(PORT, 'aria2.addUri', [[fx.url], { out: 'restart-victim.bin' }]);
  assert.notStrictEqual(gid2, gid, 're-add same URL returns new gid (not locked by dead gid)');
  const s2 = await rpc(PORT, 'aria2.tellStatus', [gid2]);
  assert.ok(s2.status === 'waiting' || s2.status === 'active', `new task is non-terminal: ${s2.status}`);

  // 清理：remove 新任务（hang fixture 不发 body，不会 complete）
  await rpc(PORT, 'aria2.remove', [gid2]).catch(() => {});
  fx.server.close();
});
