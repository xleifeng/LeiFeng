'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { WineNodeDriver, linuxToWinePath } = require('../../host/src/driver');
const { startFakeEngine, createInMemoryDriverHarness } = require('./helpers/fake-engine');

const FAKE = path.join(__dirname, 'helpers', 'fake-engine.js');
function spawnWithEnv(extraEnv) { const marker = () => {}; marker.fakeEngineEnv = extraEnv; return marker; }

function makeDriver(extra = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-test-'));
  const marker = extra.spawnImpl;
  const harness = createInMemoryDriverHarness(marker && marker.fakeEngineEnv || {});
  const overrides = { ...extra };
  if (marker && marker.fakeEngineEnv) delete overrides.spawnImpl;
  return new WineNodeDriver({
    repoRoot: '/nonexistent', profileDir, spawnImpl: marker && !marker.fakeEngineEnv ? marker : harness.spawnImpl,
    listenerFactory: harness.listenerFactory, sdkPidFinder: async () => [],
    engineScript: FAKE, backoffMs: [50, 50], sdkReadyCheck: async () => true, ...overrides,
  });
}

// 直接把 driver.client 接到内存 Duplex 假引擎，覆盖真实 JSON-lines 线协议且无需占端口。
async function setup() {
  const fx = await startFakeEngine();
  const driver = makeDriver();
  fx.connect(driver.client);
  fx.state.createCalls.length = 0;
  fx.state.parseCalls.length = 0;
  const _origClose = fx.server.close.bind(fx.server);
  fx.server.close = function (cb) {
    try { driver.client.close(); } catch {}
    return _origClose(cb);
  };
  return { driver, fx };
}

test('linuxToWinePath', () => {
  assert.strictEqual(linuxToWinePath('/a/b/c'), 'Z:\\a\\b\\c');
});

test('task and BT driver methods use operation-specific transport calls', async () => {
  const { driver, fx } = await setup();
  fx.state.taskCalls.length = 0;
  await driver.recycleTask(4);
  await driver.recoverTask(4);
  await driver.redownloadTask(4, { deleteLocal: true });
  await driver.renameTask(4, 'renamed.bin');
  await driver.moveTask(4, '/downloads/target');
  await driver.setTaskSpeedLimit(4, 1024);
  await driver.updateBtSelection(4, [2, 0]);
  await driver.setBtScheduler(4, 'sequential');
  assert.deepStrictEqual(fx.state.taskCalls, [
    ['recycle', [4]], ['recover', [4]], ['redownload', 4, true], ['rename', 4, 'renamed.bin'],
    ['move', 4, 'Z:\\downloads\\target'], ['speed', 4, 1024], ['selection', 4, [0, 2]], ['scheduler', 4, 1],
  ]);
  fx.server.close();
});

test('boot → healthy → commands → shutdown', async () => {
  const d = makeDriver();
  await d.boot();
  assert.ok(d.isHealthy());
  assert.deepStrictEqual(await d.ping(), { pong: true, uptimeMs: 1 });
  assert.ok((await d.createTask({ taskType: 1, savePath: '/x', taskName: 'f', info: { url: 'u' } })) > 0);
  assert.strictEqual(await d.getDhtNodeCount(), 7);
  assert.ok(d.enginePid() > 0);
  await d.shutdown();
  assert.ok(!d.isHealthy());
});

test('crash → down → auto respawn (single owner)', async () => {
  const d = makeDriver();
  await d.boot();
  const down = new Promise((r) => d.once('down', r));
  const up = new Promise((r) => d.once('up', r));
  d.child.kill('SIGKILL');
  await down;
  assert.ok(!d.isHealthy());
  await up;
  assert.ok(d.isHealthy());
  assert.strictEqual(d.restarts, 1);
  await d.shutdown();
});

test('stale generation events are ignored after respawn', async () => {
  const d = makeDriver();
  await d.boot();
  const gen1Child = d.child;
  const up2 = new Promise((r) => d.once('up', r));
  gen1Child.kill('SIGKILL');
  await up2; // 已重起到 generation 2
  const ups = [];
  d.on('up', () => ups.push(1));
  const downs = [];
  d.on('down', () => downs.push(1));
  gen1Child.emit('exit'); // 陈旧事件：不应触发 down / 不应再拉起
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(d.isHealthy());
  assert.strictEqual(d.restarts, 1);
  assert.strictEqual(downs.length, 0);
  assert.strictEqual(ups.length, 0);
  await d.shutdown();
});

test('concurrent boot() calls share one spawn', async () => {
  const d = makeDriver();
  const [a, b] = await Promise.all([d.boot(), d.boot()]);
  assert.ok(d.isHealthy());
  await d.shutdown();
});

test('start() retries initial boot failure with backoff, never rejects', async () => {
  const d = makeDriver();
  // 第一次 spawn 同步抛错（立即失败，不等 connect 超时）
  let calls = 0;
  const realSpawn = d.spawnImpl;
  d.spawnImpl = (cmd, args) => {
    calls++;
    if (calls === 1) throw new Error('spawn boom');
    return realSpawn(cmd, args);
  };
  const up = new Promise((r) => d.once('up', r));
  d.start();
  await up;
  assert.ok(d.isHealthy());
  assert.ok(calls >= 2);
  await d.shutdown();
});

// 命令超时触发受控重启时必须终止旧 child 并销毁旧 socket。
test('command timeout kills old child and destroys old socket on respawn', async () => {
  const d = makeDriver({ spawnImpl: spawnWithEnv({ FAKE_HANG_ON: 'getDhtNodeCount' }) });
  await d.boot();
  const gen1Child = d.child;
  const gen1Pid = gen1Child.pid;
  assert.ok(gen1Pid > 0);
  // 触发超时：getDhtNodeCount 不会应答 → _call 超时 → _onEngineDown → respawn
  const down = new Promise((r) => d.once('down', r));
  const up2 = new Promise((r) => d.once('up', r));
  await assert.rejects(d.getDhtNodeCount(), (e) => e.code === 'ETIMEDOUT' || /timeout/.test(e.message));
  await down;
  // 旧 child 必须被终止。
  assert.ok(gen1Child.killed, 'gen1 child must be killed on controlled restart');
  // 等待旧进程退出（kill 是异步的，SIGTERM 后进程需一小段时间才退出）
  const exited = new Promise((r) => gen1Child.once('exit', r));
  await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
  // 旧进程应已退出（kill(pid,0) 失败）
  let alive = true;
  try { process.kill(gen1Pid, 0); } catch { alive = false; }
  assert.ok(!alive, 'gen1 process must be dead');
  await up2;
  assert.ok(d.isHealthy());
  assert.ok(d.child !== gen1Child, 'new child is a different process');
  await d.shutdown();
});

// 旧 socket 的迟到 close 不应误判新 generation 已断开。
test('stale socket close after respawn does not down healthy generation', async () => {
  const d = makeDriver();
  await d.boot();
  const oldClientSock = d.client._sock; // EngineClient 当前 socket 引用
  // 抓 gen1 child 用于后续手动 emit
  const gen1Child = d.child;
  // 触发崩溃重启到 gen2
  const up2 = new Promise((r) => d.once('up', r));
  gen1Child.kill('SIGKILL');
  await up2;
  assert.ok(d.isHealthy(), 'gen2 healthy');
  // 抓 gen2 状态
  const downs = [];
  d.on('down', () => downs.push(1));
  // 模拟旧 socket 迟到 close：destroy 旧 socket
  if (oldClientSock) oldClientSock.destroy();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(d.isHealthy(), 'gen2 still healthy after stale socket close');
  assert.strictEqual(downs.length, 0, 'no spurious down event from stale socket');
  await d.shutdown();
});

// spawnImpl 同步抛错不得泄漏 logFd。
test('spawnImpl sync throw does not leak logFd', async () => {
  const d = makeDriver();
  let calls = 0;
  const THROW_N = 5;
  const realSpawn = d.spawnImpl;
  d.spawnImpl = (cmd, args) => {
    calls++;
    if (calls <= THROW_N) throw new Error('spawn boom');
    return realSpawn(cmd, args);
  };
  // mock fs.closeSync 计数（验证每次抛错都关了 fd）
  const realCloseSync = fs.closeSync;
  let closeCalls = 0;
  fs.closeSync = function (fd) { closeCalls++; return realCloseSync.call(fs, fd); };
  try {
    const up = new Promise((r) => d.once('up', r));
    d.start();
    await up;
    assert.ok(d.isHealthy());
    assert.ok(calls >= THROW_N + 1, `spawn retried ${calls} times`);
    // 至少 THROW_N 次 catch 关 fd + 1 次成功路径关 fd
    assert.ok(closeCalls >= THROW_N, `logFd closed on each throw: ${closeCalls} closes for ${THROW_N} throws`);
    await d.shutdown();
  } finally {
    fs.closeSync = realCloseSync;
  }
});

// 业务错误即使包含 timeout 文案也不得误触发引擎重启。
test('business error with timeout-like message does not trigger restart', async () => {
  // fake-engine 对 createTask 返回 error 文案含 'timeout'，但 ok:false（业务错误，非命令超时）
  const d = makeDriver({ spawnImpl: spawnWithEnv({ FAKE_ERROR_ON: 'createTask' }) });
  await d.boot();
  const gen1Child = d.child;
  let err;
  try { await d.createTask({ taskType: 1, savePath: '/x', taskName: 'f', info: { url: 'u' } }); } catch (e) { err = e; }
  assert.ok(err, 'createTask should reject');
  assert.match(err.message, /boom/);
  // 不应重启：仍是同一 child、未标记 down
  assert.strictEqual(d.child, gen1Child, 'no restart on business error');
  assert.ok(d.isHealthy(), 'still healthy');
  assert.strictEqual(d.restarts, 0);
  await d.shutdown();
});

// ---- notifyAuth/notifyLogout 线协议 ----
test('notifyAuth 转发 payload + ok → resolve', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notify-')), 'log.txt');
  const d = makeDriver({ spawnImpl: spawnWithEnv({ FAKE_NOTIFY_LOG: logFile }) });
  await d.boot();
  await d.notifyAuth({ uid: '664727041', vipStr: 'isvip=1' });
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.m, 'notifyAuth');
  assert.strictEqual(entry.p.uid, '664727041');
  assert.strictEqual(entry.p.vipStr, 'isvip=1');
  await d.shutdown();
});

test('notifyAuth ok:false → reject 含 failedStep + 不重启', async () => {
  const d = makeDriver({ spawnImpl: spawnWithEnv({ FAKE_FAIL_NOTIFY_STEP: 'setCurrentPanUserId' }) });
  await d.boot();
  await assert.rejects(d.notifyAuth({ uid: '1', vipStr: 'x' }), /setCurrentPanUserId/);
  assert.ok(d.isHealthy());
  assert.strictEqual(d.restarts, 0);
  await d.shutdown();
});

test('notifyLogout 转发 + ok', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notify-')), 'log.txt');
  const d = makeDriver({ spawnImpl: spawnWithEnv({ FAKE_NOTIFY_LOG: logFile }) });
  await d.boot();
  await d.notifyLogout();
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
  const entry = JSON.parse(lines.find((l) => JSON.parse(l).m === 'notifyLogout'));
  assert.strictEqual(entry.m, 'notifyLogout');
  await d.shutdown();
});

test('VIP enable/disable 为 transport 薄转发且业务返回不触发重启', async () => {
  const { driver, fx } = await setup();
  const r = await driver.enableVipDcdn(7, [{ fileIndex: -1, token: 'fixture-token' }]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(await driver.disableVipDcdn(7, [-1]), { ok: true, items: [{ fileIndex: -1, invoked: true, errorCode: '' }] });
  assert.strictEqual(driver.restarts, 0);
  fx.server.close();
});

// ---- createTask 签名 + parseTaskInfo + resolveThunderUrl + withWinePaths ----
test('createTask BT：savePath/seedFile 转 Wine + 传 info', async () => {
  const { driver, fx } = await setup();
  const id = await driver.createTask({ taskType: 2, savePath: '/srv/tlei-test/x', taskName: 't.iso',
    info: { infoId: 'ABC', seedFile: '/srv/tlei-test/x.torrent', fileRealIndexLists: [0], autoRenameWhenRepeat: false } });
  assert.ok(id > 0);
  const call = fx.state.createCalls[0];
  assert.strictEqual(call.taskType, 2);
  assert.strictEqual(call.taskInfo.taskBaseInfo.savePath, 'Z:\\srv\\tlei-test\\x');
  assert.strictEqual(call.info.seedFile, 'Z:\\srv\\tlei-test\\x.torrent');       // 转 Wine
  assert.strictEqual(call.taskInfo.taskType, 2);                            // 冗余消除
  fx.server.close();
});

test('createTask 磁力：torrentFilePath 转 Wine', async () => {
  const { driver, fx } = await setup();
  await driver.createTask({ taskType: 5, savePath: '/srv/tlei-test/s', taskName: 'H.torrent',
    info: { url: 'magnet:?xt=urn:btih:H', torrentFilePath: '/srv/tlei-test/s' } });
  const call = fx.state.createCalls[0];
  assert.strictEqual(call.info.torrentFilePath, 'Z:\\srv\\tlei-test\\s');
  fx.server.close();
});

test('createTask HTTP：savePath 转 Wine + p2spInfo 透传', async () => {
  const { driver, fx } = await setup();
  await driver.createTask({ taskType: 1, savePath: '/srv/tlei-test/d', taskName: 'f.bin',
    info: { url: 'http://x/f.bin', refUrl: '', useOriginResourceOnly: false, originResourceThreadCount: 5, loginFtp: false, ftpUserName: '', ftpPassword: '', origin: 'thunderd' } });
  const call = fx.state.createCalls[0];
  assert.strictEqual(call.taskInfo.taskBaseInfo.savePath, 'Z:\\srv\\tlei-test\\d');
  assert.strictEqual(call.info.url, 'http://x/f.bin');   // p2spInfo 不经 withWinePaths（无路径字段）
  fx.server.close();
});

test('parseTaskInfo torrent：data Linux 路径 → engine 收 Wine', async () => {
  const { driver, fx } = await setup();
  const r = await driver.parseTaskInfo({ kind: 'torrent', data: '/srv/tlei-test/x.torrent' });
  assert.ok(r.infoId);
  const call = fx.state.parseCalls[0];
  assert.strictEqual(call.data, 'Z:\\srv\\tlei-test\\x.torrent');   // driver 转 Wine
  fx.server.close();
});

test('parseTaskInfo torrent：集中修复 AssistantTools UTF-8→Windows-1252 误判', async () => {
  const driver = makeDriver();
  driver._call = async () => ({
    title: 'ä¸­æ–‡ç§å­',
    fileLists: [{ fileName: 'å…­é¾™æ¬²å¤© .png', filePath: 'ç›®å½•\\å…­é¾™æ¬²å¤© .png' }],
  });
  const parsed = await driver.parseTaskInfo({ kind: 'torrent', data: '/tmp/x.torrent' });
  assert.strictEqual(parsed.title, '中文种子');
  assert.strictEqual(parsed.fileLists[0].fileName, '六龙欲天 .png');
  assert.strictEqual(parsed.fileLists[0].filePath, '目录\\六龙欲天 .png');
});

test('parseTaskInfo 非 torrent：不改写 native 字段', async () => {
  const driver = makeDriver();
  driver._call = async () => ({ displayName: 'ä¸­æ–‡' });
  const parsed = await driver.parseTaskInfo({ kind: 'magnet', data: 'magnet:?xt=urn:btih:X' });
  assert.strictEqual(parsed.displayName, 'ä¸­æ–‡');
});

test('parseTaskInfo magnet：data 不转（magnet 非路径）', async () => {
  const { driver, fx } = await setup();
  await driver.parseTaskInfo({ kind: 'magnet', data: 'magnet:?xt=urn:btih:ABC' });
  assert.strictEqual(fx.state.parseCalls[0].data, 'magnet:?xt=urn:btih:ABC');
  fx.server.close();
});

test('normalizeTorrentHash 使用 native engine validator 结果', async () => {
  const { driver, fx } = await setup();
  const hash = 'Z'.repeat(40);
  const result = await driver.normalizeTorrentHash(hash);
  assert.equal(result.accepted, true);
  assert.equal(result.native, true);
  assert.equal(result.taskType, 5);
  assert.equal(result.normalizedSource, `magnet:?xt=urn:btih:${hash}`);
  fx.server.close();
});

test('resolveThunderUrl：thunder→解析→urltype 两步', async () => {
  const { driver, fx } = await setup();
  const r = await driver.resolveThunderUrl('thunder://abc');
  assert.ok('resolvedUrl' in r && 'taskType' in r);
  assert.strictEqual(fx.state.parseCalls.length, 2);   // thunder + urltype
  assert.strictEqual(fx.state.parseCalls[0].kind, 'thunder');
  assert.strictEqual(fx.state.parseCalls[1].kind, 'urltype');
  fx.server.close();
});
