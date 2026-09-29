'use strict';
// kernel-any-only 验收（2026-09-29 spec）：qbit 内核独立成在——真 launcher boot
// thunderd-core profile + qbit-only patch（禁 kernel-thunder、启 kernel-qbit），
// fake qBittorrent API server 承接驱动登录与版本探测。断言装配面：
//   ① bootstrap protocols=['bt','magnet']（qbit 内核能力声明，非迅雷全集）
//   ② account.valid=false（account 槽缺席，能力诚实）
//   ③ leifeng.ui.v2.account.get → -32601（注册点在 kernel-thunder，未启动）
//   ④ tasks.query 正常（task-shell 全量装配于 qbit 内核上）
//   ⑤ 对照：thunder 默认装配树含 kernel-thunder 不含 kernel-qbit（defaultEnabled）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

// ---- fake qBittorrent API：QbitDriver 用到的最小面 ----
function startFakeQbit() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/v2/auth/login') {
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=fake; path=/' });
      res.end('Ok.');
      return;
    }
    if (req.url === '/api/v2/app/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify('v5.0.0-fake'));
      return;
    }
    if (req.url.startsWith('/api/v2/torrents/info')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
      return;
    }
    if (req.url.startsWith('/api/v2/transfer/info')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ dl_info_speed: 0, up_info_speed: 0 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('qbit-only：任意内核独立装配运行（fake qbit API）', async () => {
  const { server, port } = await startFakeQbit();
  const runtimeDir = fs.mkdtempSync(path.join(os.homedir(), 'tmp', 'leifeng-qbitonly-'));
  const configPath = path.join(runtimeDir, 'qbit-only.json');
  fs.writeFileSync(configPath, JSON.stringify({ plugins: [
    { id: 'kernel-thunder', enabled: false },
    { id: 'kernel-qbit', enabled: true, config: {} },
  ] }));
  const { runCli } = await import('file:///home/yj/code/tlei/packages/runtime/src/index.mjs');
  const { daemonRegistry } = require(path.join(repoRoot, 'apps', 'daemon', 'host', 'plugins', 'index.cjs'));
  const { DaemonClient, controlSocketPath } = require(path.join(repoRoot, 'packages', 'daemon-client', 'src', 'index.js'));

  let instance;
  try {
    // boot 到常驻：runCli 会挂起等待信号，改用 bootProfile 直连
    const { bootProfile } = await import('file:///home/yj/code/tlei/packages/runtime/src/index.mjs');
    const registry = daemonRegistry();
    const userPatch = JSON.parse(fs.readFileSync(configPath, 'utf8')).plugins;
    instance = await bootProfile({
      profile: 'thunderd-core', registry, userPatch,
      profilePatch: [{ id: 'runtime-config', config: {
        env: {
          THUNDERD_QBIT_ORIGIN: `http://127.0.0.1:${port}`,
          THUNDERD_QBIT_USERNAME: 'u', THUNDERD_QBIT_PASSWORD: 'p',
          THUNDERD_RUNTIME_DIR: runtimeDir,
        },
      } }],
    });
    // 等 kernel.up（qbit 探测成功）与 rpc-host 监听
    const socket = controlSocketPath({ runtimeDir });
    const client = new DaemonClient({ socketPath: socket });
    await (async function waitForBoot(attempt = 0) {
      try { await client.call('daemon.v1.health', []); }
      catch (error) {
        if (attempt > 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return waitForBoot(attempt + 1);
      }
    })();

    // ①② bootstrap：qbit 协议面 + 账号缺席
    const bootstrap = await client.invoke("leifeng.ui.v2.bootstrap", []);
    assert.deepEqual([...bootstrap.capabilities.protocols].sort(), ['bt', 'magnet']);
    assert.equal(bootstrap.account.valid, false);
    assert.equal(bootstrap.engine.kernelId ?? bootstrap.engine.id ?? 'qbit', 'qbit');

    // ③ account.* → -32601（注册点在 kernel-thunder，缺席即不可用）
    await assert.rejects(
      () => client.invoke("leifeng.ui.v2.account.get", []),
      /-32601|Method not found/i,
    );

    // ④ task 域在 qbit 内核上可用
    const tasks = await client.invoke('leifeng.ui.v2.tasks.query', [{ limit: 10 }]);
    assert.equal(tasks.total, 0);

    await client.close?.();
  } finally {
    if (instance) await instance.dispose().catch(() => {});
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});

test('defaultEnabled：thunder 默认树含 kernel-thunder，kernel-qbit 不启动', async () => {
  const { composeProfile } = await import('file:///home/yj/code/tlei/packages/runtime/src/index.mjs');
  const { daemonRegistry } = require(path.join(repoRoot, 'apps', 'daemon', 'host', 'plugins', 'index.cjs'));
  const composed = composeProfile({ profile: 'thunderd-core', registry: daemonRegistry() });
  const ids = composed.plugins.map((p) => p.id);
  assert.ok(ids.includes('kernel-hub'), 'kernel-hub 应在默认树');
  assert.ok(ids.includes('kernel-thunder'), 'kernel-thunder 默认启动');
  assert.ok(!ids.includes('kernel-qbit'), 'kernel-qbit defaultEnabled:false 不启动');
});
