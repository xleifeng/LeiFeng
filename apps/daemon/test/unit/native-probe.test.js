'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { probeNativeCapabilities } = require('../../engine/native-probe');

test('safe native probe does not promote side-effect method presence to verified', () => {
  const result = probeNativeCapabilities({ tm: { batchStartTasks() {}, batchStopTasks() {}, batchRecycleTasks() {}, updateDownloadSpeedLimit() {} }, NativeTaskInterface: {}, NativeDkHelper: {}, sdkVersion: 'test' });
  assert.equal(result.flat.startPause, 'present'); assert.equal(result.flat.recycle, 'not-probed'); assert.equal(result.probe.mode, 'safe-presence-only');
});
