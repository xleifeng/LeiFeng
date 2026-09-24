'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkControlHandlers } = require('../../engine/network-control');

test('network control applies limits and keeps an applied runtime mirror', () => {
  const calls = [];
  const tm = {
    updateDownloadSpeedLimit: (value) => calls.push(['down', value]),
    updateUploadSpeedLimit: (value) => calls.push(['up', value]),
    setGlobalConnectionLimit: (value) => calls.push(['conn', value]),
    updateMaxDownloadTaskCount: (value) => calls.push(['max', value]),
  };
  const control = createNetworkControlHandlers({ tm, capabilities: { flat: { 'network.globalRateLimit': 'verified' } } });
  const result = control.setGlobalLimits({ downloadLimit: 1024, uploadLimit: 2048, connectionLimit: 20, maxTasks: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['down', 1024], ['up', 2048], ['conn', 20], ['max', 3]]);
  assert.equal(control.getNetworkRuntime().globalDownloadLimit, 1024);
});

test('network control never aliases unverified p2s to p2p', () => {
  const calls = [];
  const control = createNetworkControlHandlers({ tm: { setP2pChannelSwitch: (v) => calls.push(v) }, capabilities: { flat: { 'network.p2pSwitch': 'verified', 'network.p2sSwitch': 'not-probed' } } });
  const result = control.setChannelSwitches({ p2p: true, p2s: false });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [true]);
  assert.equal(result.failures[0].field, 'p2s');
});

test('proxy input is validated before native invocation', () => {
  const control = createNetworkControlHandlers({ tm: { setProxy: () => {} }, capabilities: { flat: { 'network.proxy': 'verified' } } });
  assert.throws(() => control.setProxy({ mode: 'http', host: '', port: 8080 }), (error) => error.code === 'INVALID_ARGUMENT');
});

test('proxy verification uses the stock NativeDkHelper entrypoint', () => {
  const calls = [];
  const control = createNetworkControlHandlers({
    tm: {}, NativeDkHelper: { proxyVerify: (...args) => { calls.push(args); return true; } },
    capabilities: { flat: { 'network.proxyVerify': 'present' } },
  });
  const result = control.verifyProxy({ mode: 'socks5', host: '127.0.0.1', port: 1080, username: 'user', password: 'pass' });
  assert.equal(result.reachable, true);
  assert.deepEqual(calls, [['socks5', '127.0.0.1', 1080, 'user', 'pass']]);
});
