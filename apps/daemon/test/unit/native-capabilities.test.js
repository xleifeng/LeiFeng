'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { detectNativeCapabilities } = require('../../engine/native-capabilities');

test('native capability report only marks existing methods present', () => {
  const result = detectNativeCapabilities({ tm: { batchStartTasks() {}, batchStopTasks() {}, updateDownloadSpeedLimit() {} }, NativeTaskInterface: { toTaskExtra() {} }, NativeDkHelper: { parseBtTaskInfo() {} }, sdkVersion: 'test' });
  assert.equal(result.task.startPause, 'present'); assert.equal(result.task.rename, 'missing'); assert.equal(result.bt.getFileRuntime, 'present'); assert.equal(result.network.globalRateLimit, 'present'); assert.equal(result.parser.torrent, 'present');
});

test('native proxy verification capability follows NativeDkHelper', () => {
  const result = detectNativeCapabilities({ tm: {}, NativeTaskInterface: {}, NativeDkHelper: { proxyVerify() {} }, sdkVersion: 'test' });
  assert.equal(result.flat['network.proxyVerify'], 'present');
});

test('production SDK baseline verifies the isolated-probed BT TaskExtra file getter', () => {
  const result = detectNativeCapabilities({ tm: {}, NativeTaskInterface: { toTaskExtra() {} }, NativeDkHelper: {}, sdkVersion: '25.0.82.1562' });
  assert.equal(result.flat['bt.getFileRuntime'], 'verified');
  assert.equal(result.bt.getFileRuntime, 'verified');
});

test('production SDK baseline keeps unprobed task controls closed even when a symbol exists', () => {
  const result = detectNativeCapabilities({ tm: { batchStartTasks() {}, batchStopTasks() {}, batchRecycleTasks() {}, updateDownloadSpeedLimit() {} }, NativeTaskInterface: {}, NativeDkHelper: {}, sdkVersion: '25.0.82.1562' });
  assert.equal(result.flat.startPause, 'verified');
  assert.equal(result.flat.recycle, 'not-probed');
  assert.equal(result.task.recycle, 'not-probed');
  assert.equal(result.flat['network.globalRateLimit'], 'verified');
});

test('Windows native SDK closes the BT callback getter that is unsafe without a V8 HandleScope', () => {
  const result = detectNativeCapabilities({ tm: { batchStartTasks() {}, batchStopTasks() {} }, NativeTaskInterface: { toTaskExtra() {} }, NativeDkHelper: {}, sdkVersion: '25.0.90.1592' });
  assert.equal(result.flat.startPause, 'verified');
  assert.equal(result.flat['bt.getFileRuntime'], 'unsafe-callback');
  assert.equal(result.bt.getFileRuntime, 'unsafe-callback');
});
