'use strict';
// 五链路集成（真 daemon + 真 Wine 引擎）。运行: node --test e2e/
// 断言依据 = Task 0 RESULTS.md 的实测语义（stop/resume/delete/restart/404）。
// v1/aria2 兼容面已删除（2026-09-28），全部链路走 leifeng.ui.v2.*。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { rpc } = require('./helpers/fixture-server');

const repoRoot = path.resolve(__dirname, '..');
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

// v2 任务创建：preflight → draft → commit，返回 taskId（fixture.url 的 out 经 displayName）
async function createTask(url, { displayName } = {}) {
  const preflight = await rpc(PORT, 'leifeng.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: url }], savePath: downloadDir, ...(displayName ? { displayName } : {}) }]);
  const first = preflight.results[0];
  // preflight 拒绝面（如 4xx 源 SOURCE_UNREACHABLE）不抛 RPC 错，落在 results[0].ok=false——
  // 显式透传错误，避免下游读 undefined draft 报无意义的 TypeError
  if (!first.ok) throw new Error(`create.preflight rejected: ${first.error && first.error.code}: ${first.error && first.error.message}`);
  const draft = first.draft;
  const committed = await rpc(PORT, 'leifeng.ui.v2.create.commit', [{ draftIds: [draft.draftId], expectedRevisions: { [draft.draftId]: draft.revision }, idempotencyKey: `it-create-${crypto.randomUUID()}` }]);
  const result = committed.results[0];
  if (!result.ok) throw new Error(`create.commit failed: ${result.error && result.error.message}`);
  return result.taskIds[0];
}

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
      const boot = await rpc(PORT, 'leifeng.ui.v2.bootstrap', [{}]);
      if (boot.engine.transportReady && boot.engine.sdkReady) return boot.engine;
    } catch {}
    if (Date.now() > deadline) throw new Error('engine never became healthy');
    await sleep(2000);
  }
}

async function waitTask(taskId, want, timeoutMs = 60000) {
  const wantSet = Array.isArray(want) ? want : [want];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
    if (wantSet.includes(task.lifecycle)) return task;
    if (Date.now() > deadline) throw new Error(`task ${taskId} stuck at ${task.lifecycle}, want ${wantSet.join('/')}`);
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
    || path.join(process.env.HOME, 'tmp', `leifeng-it-wine-${process.pid}`);
  daemon = spawn('bash', [path.join(repoRoot, 'apps', 'daemon', 'run.sh')], {
    env: { ...process.env, THUNDERD_PORT: String(PORT), THUNDERD_RUNTIME_DIR: runtime,
      THUNDERD_DOWNLOAD_DIR: downloadDir,
      WINEPREFIX: winePrefix },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitEngineHealthy();
}, { timeout: 180000 });

test.after(() => {
  try { daemon && daemon.kill('SIGTERM'); } catch {}
  // 清理自建隔离 WINEPREFIX（wineboot 自建约 60MB；不清会累积）
  try {
    const prefix = path.join(process.env.HOME, 'tmp', `leifeng-it-wine-${process.pid}`);
    if (prefix.startsWith(path.join(process.env.HOME, 'tmp', 'leifeng-it-wine-'))) fs.rmSync(prefix, { recursive: true, force: true });
  } catch {}
  // fixture 兜底回收：断言失败时链路尾部的 fx.server.close() 不会执行，LISTEN socket
  // 残留会挂住 runner 事件循环（实测挂 18 分钟直到人工 kill）。closeAllConnections 断存量连接。
  for (const srv of liveFixtures) { try { srv.close(); srv.closeAllConnections?.(); } catch {} }
});

test('sup0: bootstrap capabilities.views 含全量 UI 能力（thunderd profile）', { timeout: 30000 }, async () => {
  const boot = await rpc(PORT, 'leifeng.ui.v2.bootstrap', [{}]);
  const views = boot.capabilities.views;
  assert.ok(Array.isArray(views), 'views 应为数组');
  // ALWAYS 集合 + product-services 贡献（daemon 侧 host/src/domain/ui-capabilities.js）
  for (const id of ['tasks', 'settings', 'diagnostics', 'history', 'link-library',
    'private-space', 'media', 'daemon-admin']) {
    assert.ok(views.includes(id), `views 应含 ${id}，实际: ${views.join(',')}`);
  }
});

test('sup1: 插件管理面 plugins.list / setEnabled 持久化（plugin-admin）', { timeout: 30000 }, async () => {
  const before = await rpc(PORT, 'leifeng.ui.v2.plugins.list', [{}]);
  assert.ok(Array.isArray(before) && before.length > 0, 'plugins.list 应返回注册表全量');
  const byId = new Map(before.map((p) => [p.id, p]));
  // 全 daemon profile 必含的面（P4 拆分后 product-services → 五插件）
  for (const id of ['runtime-config', 'rpc-host', 'private-space', 'history-links', 'media-capture', 'product-core', 'plugin-admin', 'daemon-admin', 'web-api-process']) {
    assert.ok(byId.has(id), `plugins.list 应含 ${id}`);
    assert.equal(byId.get(id).enabled, true, `${id} 初始应为启用`);
  }
  // setEnabled 拒绝面：runtime-config 是 BASE 不可禁
  await assert.rejects(() => rpc(PORT, 'leifeng.ui.v2.plugins.setEnabled', [{ id: 'runtime-config', enabled: false }]), /不可禁用/);
  // 合法禁用 → restartRequired + 状态翻转 + 落盘（plugin-state.json）
  const result = await rpc(PORT, 'leifeng.ui.v2.plugins.setEnabled', [{ id: 'web-api-process', enabled: false }]);
  assert.equal(result.restartRequired, true);
  const after = await rpc(PORT, 'leifeng.ui.v2.plugins.list', [{}]);
  assert.equal(after.find((p) => p.id === 'web-api-process').enabled, false);
  const stateFile = path.join(runtime, 'plugin-state.json');
  assert.ok(fs.existsSync(stateFile), 'plugin-state.json 应落盘');
  // P0 三态：v2 形状 { enabled: { id: bool } }（v1 disabled 数组已退役）
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).enabled, { 'web-api-process': false });
  // 复原（保持后续用例环境干净）
  await rpc(PORT, 'leifeng.ui.v2.plugins.setEnabled', [{ id: 'web-api-process', enabled: true }]);
});

test('chain1: create → complete → sha256 (TaskDb-driven)', { timeout: 90000 }, async () => {
  const fx = await startFx({ bytes: 2 * 1024 * 1024 });
  const taskId = await createTask(fx.url);
  const task = await waitTask(taskId, ['completed'], 60000);
  assert.strictEqual(task.totalBytes, fx.size);
  assert.strictEqual(task.completedBytes, fx.size);
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
  const taskId = await createTask(fx.url);
  await waitTask(taskId, ['downloading'], 30000);
  // 引擎首字节有延迟（HEAD/连接/SDK 初始化），须等真实文件落盘后再 pause。
  // 下载中文件名是 throttled.bin.xltd（SDK 部分文件），pause 停写断言直接对它做。
  const target = path.join(downloadDir, 'throttled.bin');
  const partial = await waitForFile(target, 1, 30000);
  const before = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'pause', expectedRevisions: { [taskId]: before.revision }, idempotencyKey: `it-pause-${taskId}` }]);
  // 评审②：断言真实文件（fs.stat），不是 RPC 里的 completedBytes
  const s1 = fsize(partial);
  await sleep(3000);
  const s2 = fsize(partial);
  assert.ok(s1 > 0, 'partial file exists');
  assert.ok(s2 - s1 < 512 * 1024, `file kept growing after pause (${s1} → ${s2})`);
  const after = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'start', expectedRevisions: { [taskId]: after.revision }, idempotencyKey: `it-start-${taskId}` }]);
  await waitTask(taskId, ['completed'], 90000);
  const got = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

test('chain3: remove → 任务行消失 + recycled 终态', { timeout: 90000 }, async () => {
  const fx = await startFx({ bytes: 16 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 200, path: 'toberemoved.bin' });
  const taskId = await createTask(fx.url);
  await waitTask(taskId, ['downloading'], 30000);
  // 等真实文件在写，确认任务确实在下载中（.xltd 部分文件也算）
  await waitForFile(path.join(downloadDir, 'toberemoved.bin'), 1, 30000);
  // 不断言 getDownloadQueueCount 回落：直连引擎探针（recon + qprobe out5/out6）证实
  // deleteTasks 后该计数 ≥10s 不变（活跃会话不释放），完成才归 0——它不是移除的可靠
  // 信号。本链路核心契约 = remove 后任务转 removed 终态且引擎任务行可查。
  const before = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'remove-record', expectedRevisions: { [taskId]: before.revision }, idempotencyKey: `it-remove-${taskId}` }]);
  const task = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  assert.strictEqual(task.lifecycle, 'recycled');
  fx.server.close();
});

test('chain4: kill engine via enginePid → all non-terminal interrupted, RPC up', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（kill 前不会 complete）
  const fx = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim.bin' });
  const taskId = await createTask(fx.url);
  // hang fixture：body 不发，任务不会 complete；只需确认任务是非终态（downloading/queued）
  await waitTask(taskId, ['downloading', 'queued'], 30000);
  const fx2 = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'victim2.bin' });
  const taskId2 = await createTask(fx2.url);
  await waitTask(taskId2, ['downloading', 'queued'], 30000);
  const before2 = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId: taskId2 }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId2], command: 'pause', expectedRevisions: { [taskId2]: before2.revision }, idempotencyKey: `it-pause2-${taskId2}` }]); // paused 任务也应被标引擎下线失败（评审③）
  const engine = await waitEngineHealthy(30000);
  const enginePid = engine.enginePid;
  assert.ok(enginePid > 0);
  process.kill(enginePid, 'SIGKILL');
  // V2 契约：引擎下线 → markEngineGenerationLost 写结构化错误 ENGINE_RESTARTED
  // （桥 orchestrator 的 ENGINE_FAILURE_CODES 消费此码；阶段 1 的裸 'interrupted' 已退役）
  const task = await waitTask(taskId, ['failed'], 30000);
  assert.strictEqual(task.error.code, 'ENGINE_RESTARTED');
  const task2 = await waitTask(taskId2, ['failed'], 30000);
  assert.strictEqual(task2.error.code, 'ENGINE_RESTARTED');
  const info = await waitEngineHealthy(90000);
  assert.ok(info.restarts >= 1);
  const counts = await rpc(PORT, 'leifeng.ui.v2.tasks.counts', [{}]); // RPC 全程在线
  assert.ok(typeof counts.all === 'number');
  fx.server.close();
  fx2.server.close();
});

test('chain5: 404 → preflight 源探测拒绝（SOURCE_UNREACHABLE，建任务前）', { timeout: 30000 }, async () => {
  // v2 语义：preflight 对 ≥400 源直接拒绝、任务不落地（v1 时代是建任务后引擎报错 error 态；
  // 405/501 例外——部分源拒绝 HEAD，probeUrl 回退 ranged GET，不视为不可达）
  const fx = await startFx({ bytes: 1024 });
  const pre = await rpc(PORT, 'leifeng.ui.v2.create.preflight', [{ inputs: [{ kind: 'link', value: `http://127.0.0.1:${fx.server.address().port}/notfound` }], savePath: downloadDir }]);
  assert.equal(pre.results[0].ok, false, '404 源应被 preflight 拒绝');
  assert.strictEqual(pre.results[0].error.code, 'SOURCE_UNREACHABLE');
  assert.match(pre.results[0].error.message, /404/);
  fx.server.close();
});

// ---- Task 6 补测（Task 5 评审遗留，控制者裁定在集成测试里补）----

test('sup1v2: task query counts/list views + delete-permanently + system.restartEngine', { timeout: 120000 }, async () => {
  // 起一个任务到 downloading，用于 query 视图/形状验证
  // 限速是每连接限速（引擎 5 线程）：32MB + 64KB/400ms ≈ 800KB/s → 全程 ≈40s，
  // 保证断言窗口（形状检查 + 落盘等待 + pause ≈15s）内不 complete（16MB/200ms 实测 ≈10s 即
  // 完成，pause 撞 completed 报 INVALID_TASK_STATE）。
  const fx = await startFx({ bytes: 32 * 1024 * 1024, throttleChunk: 64 * 1024, throttleMs: 400, path: 'sixmethod.bin' });
  const taskId = await createTask(fx.url);
  await waitTask(taskId, ['downloading'], 30000);

  // counts: number 形状
  const counts = await rpc(PORT, 'leifeng.ui.v2.tasks.counts', [{}]);
  assert.ok(typeof counts.all === 'number', 'counts.all is number');
  assert.ok(typeof counts.active === 'number', 'counts.active is number');
  assert.ok(typeof counts.completed === 'number');
  assert.ok(typeof counts.trash === 'number');

  // query view=downloading: 数组含本次任务
  const active = await rpc(PORT, 'leifeng.ui.v2.tasks.query', [{ view: 'downloading' }]);
  assert.ok(Array.isArray(active.items), 'tasks.query returns items array');
  const inActive = active.items.find((t) => t.taskId === taskId);
  assert.ok(inActive, 'our task present in downloading view');
  assert.strictEqual(inActive.lifecycle, 'downloading');

  // 等真实文件落盘（引擎首字节延迟；下载中是 sixmethod.bin.xltd），后续 pause/delete 才能断言文件存在
  const target = path.join(downloadDir, 'sixmethod.bin');
  const onDisk = await waitForFile(target, 1, 30000);

  // pause 后 query view=downloading（paused 归入 downloading 视图桶）
  const before = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'pause', expectedRevisions: { [taskId]: before.revision }, idempotencyKey: `it-pause-${taskId}` }]);
  await sleep(1500);
  const waiting = await rpc(PORT, 'leifeng.ui.v2.tasks.query', [{ view: 'downloading' }]);
  const inWaiting = waiting.items.find((t) => t.taskId === taskId);
  assert.ok(inWaiting, 'paused task present in downloading view (paused 桶)');
  assert.strictEqual(inWaiting.lifecycle, 'paused');

  // delete-permanently：delete + 删文件（最终名与 .xltd 部分文件都应消失）。
  // 生命周期门（C1）只收 recycled/failed——paused 须先 recycle 进回收站再彻底删除。
  assert.ok(fs.existsSync(onDisk), 'file exists before delete-permanently');
  const pausedTask = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'recycle', expectedRevisions: { [taskId]: pausedTask.revision }, idempotencyKey: `it-recycle-${taskId}` }]);
  const recycled = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
  assert.strictEqual(recycled.lifecycle, 'recycled');
  const deleted = await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId], command: 'delete-permanently', expectedRevisions: { [taskId]: recycled.revision }, options: { deleteLocalFiles: true }, idempotencyKey: `it-delete-${taskId}` }]);
  assert.equal(deleted.results[0].ok, true);
  // 文件应被删（允许短暂异步，给 2s）
  let gone = false;
  for (let i = 0; i < 4; i++) {
    if (!fs.existsSync(target) && !fs.existsSync(`${target}.xltd`)) { gone = true; break; }
    await sleep(500);
  }
  assert.ok(gone, 'file deleted by delete-permanently');

  // trash 视图（recycled 属 trash）
  const trash = await rpc(PORT, 'leifeng.ui.v2.trash.query', [{}]);
  assert.ok(Array.isArray(trash.items), 'trash.query returns items array');

  // restartEngine: v2 system.restartEngine 返回 healthy 布尔（受控重启；引擎会 re-boot）
  const r = await rpc(PORT, 'leifeng.ui.v2.system.restartEngine', []);
  assert.ok(typeof r.healthy === 'boolean', 'restartEngine returns {healthy:boolean}');
  // 重启后引擎应重新健康（waitEngineHealthy 轮询 transportReady+sdkReady）
  await waitEngineHealthy(90000);

  fx.server.close();
});

test('sup2: out ≠ URL basename — 落盘名回读对齐（限制 1 根治）', { timeout: 90000 }, async () => {
  // 根治后行为：poller 首个 tick 回读 TaskDb Name 修正 displayName，
  // tasks.get 报真实落盘名；磁盘只有引擎按 URL basename 落的 realname.bin，无 custom.bin 分裂文件。
  const fx = await startFx({ bytes: 1 * 1024 * 1024, path: 'realname.bin' });
  const taskId = await createTask(fx.url, { displayName: 'custom.bin' });
  // 等首个 poller tick 完成 Name 回读（不固定 sleep：引擎刚 boot 时首 tick 快照往返有延迟）。
  // v2 等价物是 displayName：投影只回读 TaskDb Name 修 displayName（HTTP 单文件任务 files 恒空，
  // v1 时代 files[0].path 断言已退役）
  const wantName = 'realname.bin';
  const deadline0 = Date.now() + 15000;
  let t0;
  for (;;) {
    t0 = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId }]);
    if (t0.displayName === wantName) break;
    if (Date.now() > deadline0) break; // 超时后落到下方断言给出明确失败
    await sleep(500);
  }
  assert.strictEqual(t0.displayName, 'realname.bin', 'tasks.get 报告真实落盘名（下载中即成立，不等 complete）');
  const task = await waitTask(taskId, ['completed'], 60000);
  assert.strictEqual(task.displayName, 'realname.bin', 'complete 后仍报真实落盘名');
  const engineFile = path.join(downloadDir, 'realname.bin');
  assert.ok(fs.existsSync(engineFile), 'engine wrote URL basename file');
  assert.ok(!fs.existsSync(path.join(downloadDir, 'custom.bin')), 'no split-brain custom.bin on disk');
  const got = crypto.createHash('sha256').update(fs.readFileSync(engineFile)).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

test('sup3: restartEngine marks active tasks engine-restarted, same URL re-addable (F1)', { timeout: 120000 }, async () => {
  // hang fixture：发 content-length 但不发 body，任务永久 active（restart 前不会 complete）
  const fx = await startFx({ bytes: 4 * 1024 * 1024, hang: true, path: 'restart-victim.bin' });
  const taskId = await createTask(fx.url);
  await waitTask(taskId, ['downloading', 'queued'], 30000);

  // restartEngine：受控重启，emit 'down' 触发 daemon core 把非终态标引擎下线失败
  const r = await rpc(PORT, 'leifeng.ui.v2.system.restartEngine', []);
  assert.ok(typeof r.healthy === 'boolean', 'restartEngine returns {healthy:boolean}');

  // 原有 active 任务应变 failed/ENGINE_RESTARTED（终态）
  const task = await waitTask(taskId, ['failed'], 30000);
  assert.strictEqual(task.error.code, 'ENGINE_RESTARTED', 'active task marked engine-restarted after restartEngine');

  // 同 URL 重新创建：不应被死 taskId 锁死（findDuplicate 须跳过终态）→ 返回新 taskId
  const taskId2 = await createTask(fx.url);
  assert.notStrictEqual(taskId2, taskId, 're-add same URL returns new taskId (not locked by dead task)');
  const task2 = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId: taskId2 }]);
  assert.ok(task2.lifecycle === 'queued' || task2.lifecycle === 'downloading', `new task is non-terminal: ${task2.lifecycle}`);

  // 清理：remove 新任务（hang fixture 不发 body，不会 complete）
  const cur = await rpc(PORT, 'leifeng.ui.v2.tasks.get', [{ taskId: taskId2 }]);
  await rpc(PORT, 'leifeng.ui.v2.tasks.command', [{ taskIds: [taskId2], command: 'remove-record', expectedRevisions: { [taskId2]: cur.revision }, idempotencyKey: `it-cleanup-${taskId2}` }]).catch(() => {});
  fx.server.close();
});
