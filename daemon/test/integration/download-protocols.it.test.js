'use strict';
// 多协议集成冒烟（真 daemon + 真 Wine 引擎）。运行: node --test daemon/test/integration/download-protocols.it.test.js
//
// 策略（与daemon.it.test.js 同）：
//   - HTTP 冒烟可跑（复用fixture-server），验 daemon 协议扩展后 仍能下 HTTP。
//   - BT/ed2k/磁力标 skip：Wine 时序 flakiness + 真种子 6.5GB 长跑 / Kad 暖机慢 / metadata 拉取依赖 DHT，
//     全量跑会卡死或超时；逻辑由 unit 覆盖（methods-download-protocols.test.js / poller-magnet.test.js 等），
//     这里的测试体文档化"手动验收时应确认什么"，去掉 skip 手动跑即可。
//   - savePath 默认使用仓库所在文件系统而非 tmpfs；BT/磁力可能预分配大尺寸稀疏文件，tmpfs 空间不足会返回 errorCode=205。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { startFixture, rpc } = require('./helpers/fixture-server');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const PORT = 16898; // 与 daemon.it.test.js（16899）错开，同机并行不撞端口
// 默认放在仓库文件系统；需要长期保留证据时可通过 THUNDERD_IT_SAVE 指向独立目录。
const SAVE = process.env.THUNDERD_IT_SAVE || path.join(repoRoot, '.runtime-integration-it');
const runtime = path.join(SAVE, '.runtime');
const downloadDir = path.join(SAVE, 'downloads');
let daemon = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fsize = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };

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

// ---- HTTP 冒烟（可跑，验 daemon 协议扩展后 仍能下 HTTP）----
test('http-download: addUri → complete → sha256（协议扩展后 回归）', { timeout: 90000 }, async () => {
  const fx = await startFixture({ bytes: 2 * 1024 * 1024 });
  const gid = await rpc(PORT, 'aria2.addUri', [[fx.url], {}]);
  const s = await waitStatus(gid, ['complete'], 60000);
  assert.strictEqual(s.totalLength, String(fx.size));
  assert.strictEqual(s.completedLength, String(fx.size));
  const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(downloadDir, 'fixture.bin'))).digest('hex');
  assert.strictEqual(got, fx.sha);
  fx.server.close();
});

// ---- BT 冒烟（skip：Wine 时序 flakiness + 6.5GB 长跑，手动验收）----
// 去掉 skip 手动跑：addTorrent ubuntu 真种子 → tellStatus active/complete + 文件落盘 savePath/taskName/
test('bt-download: addTorrent ubuntu → active + 文件落盘', { skip: 'Wine 时序 flakiness + 6.5GB 长跑，手动验收（需隔离手工 BT 验收）', timeout: 600000 }, async () => {
  const torrent = process.env.THUNDERD_IT_TORRENT || '';
  assert.ok(torrent && fs.existsSync(torrent), 'set THUNDERD_IT_TORRENT to a local torrent fixture');
  const gid = await rpc(PORT, 'aria2.addTorrent', [torrent, { dir: downloadDir }]);
  const s = await waitStatus(gid, ['active', 'complete'], 300000);
  assert.ok(['active', 'complete'].includes(s.status), `bt task reached active/complete: ${s.status}`);
  // 文件落盘到 downloadDir/taskName/（种子内文件名，poller 回读 TaskBase.Name 对齐）
  assert.ok(s.files && s.files.length > 0, 'bt files list non-empty');
  assert.ok(fs.existsSync(s.files[0].path), `bt file on disk: ${s.files[0].path}`);
  // 完整 SHA-256 校验需下完 6.5GB，手动验
});

// ---- ed2k 冒烟（skip：Kad/eD2k 暖机慢 + 网络依赖，手动验收）----
// 去掉 skip 手动跑：addUri 真实 ed2k → tellStatus active（进队列即算冒烟通过，不要求下完）
test('ed2k-download: addUri ed2k → active（进队列即通过）', { skip: 'Kad/eD2k 暖机慢且依赖真实网络，需隔离手工验收', timeout: 300000 }, async () => {
  const ed2k = 'ed2k://|file|eMule0.50a-Installer.exe|3389035|3D366ED505B977FC61C9A6EE01E96329|h=EKE4PSKRQ65MWEPFTRDSAHW5VMDIMFAJ|/';
  const gid = await rpc(PORT, 'aria2.addUri', [[ed2k], { dir: downloadDir }]);
  const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.ok(['waiting', 'active'].includes(s.status), `ed2k entered queue (waiting/active): ${s.status}`);
  // 进队列即算冒烟通过；ed2k 暖机慢（Status=5 后可能长时间 0 字节，非 error）
});

// ---- 磁力冒烟（skip：metadata 拉取依赖 DHT/trackers + Wine 时序，手动验收）----
// 去掉 skip 手动跑：addMagnetAddress ubuntu 磁力 → metadataPhase=download + 文件增长
test('magnet-download: addMagnetAddress → metadataPhase=download + 文件增长', { skip: 'metadata 拉取依赖 DHT、tracker 和 Wine 时序，需隔离手工验收', timeout: 600000 }, async () => {
  const magnet = 'magnet:?xt=urn:btih:4H6BICTDSE2X7IOPBDO3OATU7HAF5OEL&dn=ubuntu-26.04-live-server-amd64.iso&xl=2918598656&tr=https%3A%2F%2Ftorrent.ubuntu.com%2Fannounce';
  const gid = await rpc(PORT, 'aria2.addMagnetAddress', [magnet, { dir: downloadDir }]);
  // 两步走：立即返回 gid，metadataPhase=fetching（TaskDb 无行）；后台拉 metadata → 转 BT（metadataPhase=download）
  const s0 = await rpc(PORT, 'aria2.tellStatus', [gid]);
  assert.ok(['fetching', 'download'].includes(s0.metadataPhase), `magnet metadata phase: ${s0.metadataPhase}`);
  // 等 metadata 拉到转 BT（metadataPhase=download），文件开始增长即算通过
  const deadline = Date.now() + 300000;
  for (;;) {
    const s = await rpc(PORT, 'aria2.tellStatus', [gid]);
    if (s.metadataPhase === 'download' && s.files && s.files.length > 0) {
      const sz = fsize(s.files[0].path);
      if (sz > 0) return;
    }
    if (Date.now() > deadline) throw new Error(`magnet never reached metadataPhase=download with file growth (last phase=${s.metadataPhase})`);
    await sleep(2000);
  }
});
