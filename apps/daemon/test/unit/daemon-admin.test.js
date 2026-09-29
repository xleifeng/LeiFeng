'use strict';
// daemon-admin 单测：status 形态（engine 可选段）、restart 标记协议、RPC 注册与 UI 能力贡献。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { daemonAdmin, RESTART_MARKER } = require('../../host/plugins/daemon-admin.cjs');

// fake ctx 直驱 apply（对齐 plugin-admin.test 风格）：普通对象即可——插件 apply
// 内经属性访问消费注入面；kernelHub 可选链（?.default?.）在这里直接工作。
function makeContext() {
  const registered = new Map();
  const context = {
    leifengConfig: {
      appConfig: { version: '9.9.9' },
      runtimeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-admin-')),
      env: {},
    },
    leifengKernelHub: { default: () => null }, // 无内核：engine 段 null
    leifengRpc: { registry: { register: (ns, map) => { registered.set(ns, map); return () => registered.delete(ns); } } },
    leifengUiRegistry: {
      contribute: (pluginId, caps) => { assert.equal(pluginId, 'daemon-admin'); assert.deepEqual(caps, ['daemon-admin']); return () => {}; },
    },
  };
  return { context, registered, services: context };
}

test('daemon.status：无内核时 engine 为 null，基础字段齐', () => {
  const { context, registered } = makeContext();
  const teardown = daemonAdmin.apply(context);
  try {
    const status = registered.get('daemon-admin').get('leifeng.ui.v2.daemon.status')();
    assert.equal(status.version, '9.9.9');
    assert.equal(typeof status.pid, 'number');
    assert.equal(status.uptimeMs >= 0, true);
    assert.equal(status.restartPending, false);
    assert.equal(status.engine, null);
    assert.equal(typeof status.memory.rssBytes, 'number');
  } finally { teardown(); }
});

test('daemon.status：有内核时 engine 段反映 driver 快照', () => {
  const { context, registered } = makeContext();
  context.leifengKernelHub = { default: () => ({ kernel: { sdkReady: true, enginePid: () => 4242, restarts: 2, _generation: 3 } }) };
  const teardown = daemonAdmin.apply(context);
  try {
    const status = registered.get('daemon-admin').get('leifeng.ui.v2.daemon.status')();
    assert.deepEqual(status.engine, { sdkReady: true, enginePid: 4242, restarts: 2, generation: 3 });
  } finally { teardown(); }
});

test('daemon.restart：写标记文件 + 延迟自杀信号（桩 process.kill），幂等不重发', () => {
  const { context, registered } = makeContext();
  const runtimeDir = context.leifengConfig.runtimeDir;
  const signals = [];
  const originalKill = process.kill;
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  // 桩信号与定时器：不真死、不等 500ms
  process.kill = (pid, signal) => { signals.push({ pid, signal }); return true; };
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  const teardown = daemonAdmin.apply(context);
  try {
    const restart = registered.get('daemon-admin').get('leifeng.ui.v2.daemon.restart');
    const result = restart();
    assert.equal(result.restarting, true);
    assert.equal(fs.existsSync(path.join(runtimeDir, RESTART_MARKER)), true, '标记文件须落盘');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 500);
    // 第二次调用幂等：不再排新信号
    const again = restart();
    assert.equal(again.restarting, true);
    assert.equal(timers.length, 1, '幂等：pending 时不叠加定时器');
    // 触发缓冲回调 → SIGTERM 发给自己
    timers[0].fn();
    assert.deepEqual(signals, [{ pid: process.pid, signal: 'SIGTERM' }]);
    // status 反映 restartPending
    assert.equal(registered.get('daemon-admin').get('leifeng.ui.v2.daemon.status')().restartPending, true);
  } finally {
    teardown();
    process.kill = originalKill;
    global.setTimeout = originalSetTimeout;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test('teardown 撤销 RPC 注册与 UI 贡献', () => {
  const { context, registered } = makeContext();
  let uiWithdrawn = false;
  context.leifengUiRegistry = { contribute: () => () => { uiWithdrawn = true; } };
  const teardown = daemonAdmin.apply(context);
  assert.equal(registered.size, 1);
  teardown();
  assert.equal(registered.size, 0, 'RPC 注销');
  assert.equal(uiWithdrawn, true, 'UI 能力撤销');
});

test('KNOWN 能力表含 daemon-admin（ui-capabilities 守卫）', () => {
  const { KNOWN } = require('../../host/src/domain/ui-capabilities');
  assert.equal(KNOWN.has('daemon-admin'), true);
});
