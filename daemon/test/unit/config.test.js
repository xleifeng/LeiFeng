'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { loadConfig, versionCodeFromName, versionNameFromProgramDir } = require('../../host/src/config');

test('config resolves all paths once and rejects unsafe roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-v2-')); const config = loadConfig({ repoRoot: dir, env: { HOME: path.join(dir, 'home'), THUNDERD_RUNTIME_DIR: path.join(dir, 'runtime'), THUNDERD_DOWNLOAD_DIR: path.join(dir, 'downloads'), THUNDERD_PORT: '17000' } });
  assert.equal(config.port, 17000); assert.equal(config.tasksPath, path.join(dir, 'runtime', 'data', 'tasks.json')); assert.equal(config.controlSocketPath, path.join(dir, 'runtime', 'thunderd-control.sock')); assert.equal(config.captureClientConfigPath, path.join(dir, 'home', '.config', 'thunder', 'capture.json')); assert.equal(Object.isFrozen(config), true);
  assert.throws(() => loadConfig({ repoRoot: dir, env: { HOME: '/tmp/home', THUNDERD_RUNTIME_DIR: '/' } }), (error) => error.code === 'UNSAFE_PATH');
});

test('production config disables legacy RPC by default', () => {
  const config = loadConfig({ env: { HOME: '/tmp/thunder-test-home', THUNDERD_RUNTIME_DIR: '/tmp/thunder-runtime-v2', THUNDERD_DOWNLOAD_DIR: '/tmp/thunder-download-v2' }, repoRoot: '/tmp/repo-v2' });
  assert.equal(config.legacyRpcEnabled, false);
});

test('Windows native SDK version derives matching numeric version code and platform', () => {
  assert.equal(versionCodeFromName('25.0.90.1592'), 2500901592);
  assert.equal(versionNameFromProgramDir('/mnt/c/tlei-sdk/Thunder-25.0.90.1592/program'), '25.0.90.1592');
  assert.equal(versionCodeFromName('bad', 123), 123);
  const config = loadConfig({ env: {
    HOME: '/tmp/thunder-test-home', THUNDERD_RUNTIME_DIR: '/tmp/thunder-native-runtime',
    THUNDERD_DOWNLOAD_DIR: '/tmp/thunder-native-downloads', THUNDERD_ENGINE_MODE: 'windows-native',
    THUNDERD_WINDOWS_SDK_VERSION: '25.0.90.1592',
  }, repoRoot: '/tmp/repo-native' });
  assert.equal(config.engineMode, 'windows-native');
  assert.equal(config.windowsSdkVersionCode, 2500901592);
  assert.equal(config.windowsSdkPlatform, '0');
});

test('Windows native SDK version derives from program directory when explicit version is absent', () => {
  const config = loadConfig({ env: {
    HOME: '/tmp/thunder-test-home', THUNDERD_RUNTIME_DIR: '/tmp/thunder-native-path-runtime',
    THUNDERD_DOWNLOAD_DIR: '/tmp/thunder-native-path-downloads', THUNDERD_ENGINE_MODE: 'windows-native',
    THUNDERD_WINDOWS_PROGRAM_DIR: '/mnt/c/tlei-sdk/Thunder-25.0.90.1592/program',
  }, repoRoot: '/tmp/repo-native-path' });
  assert.equal(config.windowsSdkVersionName, '25.0.90.1592');
  assert.equal(config.windowsSdkVersionCode, 2500901592);
});
