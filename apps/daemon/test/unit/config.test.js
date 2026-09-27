'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { loadConfig, engineMode, versionCodeFromName, versionNameFromProgramDir, mergeConfigFile } = require('../../host/src/config');

test('config resolves all paths once and rejects unsafe roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-v2-')); const config = loadConfig({ repoRoot: dir, env: { HOME: path.join(dir, 'home'), THUNDERD_RUNTIME_DIR: path.join(dir, 'runtime'), THUNDERD_DOWNLOAD_DIR: path.join(dir, 'downloads'), THUNDERD_PORT: '17000' } });
  assert.equal(config.port, 17000); assert.equal(config.tasksPath, path.join(dir, 'runtime', 'data', 'tasks.json'));
  // win32 下控制通道是 named pipe，无文件系统实体；socket 文件路径断言仅 POSIX 平台有效
  if (process.platform === 'win32') assert.ok(config.controlSocketPath.startsWith('\\\\.\\pipe\\thunderd-control-'), config.controlSocketPath);
  else assert.equal(config.controlSocketPath, path.join(dir, 'runtime', 'thunderd-control.sock'));
  assert.equal(config.captureClientConfigPath, path.join(dir, 'home', '.config', 'thunder', 'capture.json')); assert.equal(Object.isFrozen(config), true);
  assert.throws(() => loadConfig({ repoRoot: dir, env: { HOME: '/tmp/home', THUNDERD_RUNTIME_DIR: '/' } }), (error) => error.code === 'UNSAFE_PATH');
});

test('production config disables legacy RPC by default', () => {
  const config = loadConfig({ env: { HOME: '/tmp/thunder-test-home', THUNDERD_RUNTIME_DIR: '/tmp/thunder-runtime-v2', THUNDERD_DOWNLOAD_DIR: '/tmp/thunder-download-v2' }, repoRoot: '/tmp/repo-v2' });
  assert.equal(config.legacyRpcEnabled, false);
});

// ---- 引擎模式两态 + auto ----
test('engineMode：auto 按平台解析，显式值校验，旧 windows-native 不再接受', () => {
  assert.equal(engineMode('auto', 'linux'), 'wine');
  assert.equal(engineMode('auto', 'win32'), 'native');
  assert.equal(engineMode('', 'linux'), 'wine'); // 缺省 = auto
  assert.equal(engineMode('wine', 'win32'), 'wine');
  assert.equal(engineMode('native', 'linux'), 'native');
  assert.equal(engineMode('windows', 'win32'), 'native'); // 宽容别名
  assert.throws(() => engineMode('windows-native'), /must be wine, native or auto/);
  assert.throws(() => engineMode('bogus'), /must be wine, native or auto/);
});

test('loadConfig 平台默认：win32 下 pipe 控制通道与 PUBLIC xlconfig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-win-'));
  const config = loadConfig({
    repoRoot: dir, platform: 'win32',
    env: { USERPROFILE: path.join(dir, 'Users', 'test'), PUBLIC: path.join(dir, 'Users', 'Public'),
      THUNDERD_RUNTIME_DIR: path.join(dir, 'runtime'), THUNDERD_DOWNLOAD_DIR: path.join(dir, 'downloads') },
  });
  assert.equal(config.engineMode, 'native'); // auto → win32 → native
  assert.ok(config.controlSocketPath.startsWith('\\\\.\\pipe\\thunderd-control-'), config.controlSocketPath);
  assert.equal(config.xlconfigPath, path.join(path.join(dir, 'Users', 'Public'), 'Thunder Network', 'Thunder', 'xlconfig.ini'));
  assert.equal(config.sdkPlatform, '0');
});

test('loadConfig 平台默认：linux 下 UDS 控制通道与 wine prefix xlconfig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-linux-'));
  const config = loadConfig({
    repoRoot: dir, platform: 'linux',
    env: { HOME: path.join(dir, 'home'), THUNDERD_RUNTIME_DIR: path.join(dir, 'runtime'), THUNDERD_DOWNLOAD_DIR: path.join(dir, 'downloads') },
  });
  assert.equal(config.engineMode, 'wine');
  assert.equal(config.controlSocketPath, path.join(path.join(dir, 'runtime'), 'thunderd-control.sock'));
  assert.equal(config.xlconfigPath, path.join(path.join(dir, 'home'), '.wine-thunder', 'drive_c', 'users', 'Public', 'Thunder Network', 'Thunder', 'xlconfig.ini'));
  assert.equal(config.sdkPlatform, '64');
});

// ---- THUNDERD_CONFIG 配置文件 ----
function configEnv(dir, extra = {}) {
  return { HOME: path.join(dir, 'home'), THUNDERD_RUNTIME_DIR: path.join(dir, 'runtime'), THUNDERD_DOWNLOAD_DIR: path.join(dir, 'downloads'), ...extra };
}

test('THUNDERD_CONFIG：文件值补默认、环境变量覆盖文件、未知键与 secret 键拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-file-'));
  const file = path.join(dir, 'thunderd.json');
  fs.writeFileSync(file, JSON.stringify({ THUNDERD_PORT: 18000, THUNDERD_ENGINE_MODE: 'wine', THUNDERD_VIP_ENABLED: false }));
  // 文件值生效
  const fromFile = loadConfig({ repoRoot: dir, platform: 'win32', env: configEnv(dir), configPath: file });
  assert.equal(fromFile.port, 18000);
  assert.equal(fromFile.engineMode, 'wine'); // 文件显式 wine 覆盖平台默认 native
  assert.equal(fromFile.vipEnabled, false);
  // 环境变量 > 文件
  const envWins = loadConfig({ repoRoot: dir, platform: 'win32', env: configEnv(dir, { THUNDERD_PORT: '19000' }), configPath: file });
  assert.equal(envWins.port, 19000);
  // 未知键
  fs.writeFileSync(file, JSON.stringify({ THUNDERD_NO_SUCH_KEY: 1 }));
  assert.throws(() => loadConfig({ repoRoot: dir, env: configEnv(dir), configPath: file }), /unknown key THUNDERD_NO_SUCH_KEY/);
  // secret 键
  fs.writeFileSync(file, JSON.stringify({ THUNDERD_RPC_SECRET: 'x' }));
  assert.throws(() => loadConfig({ repoRoot: dir, env: configEnv(dir), configPath: file }), /secret key/);
  // 非法 JSON
  fs.writeFileSync(file, '{oops');
  assert.throws(() => loadConfig({ repoRoot: dir, env: configEnv(dir), configPath: file }), /not valid JSON/);
  // 非法值类型
  fs.writeFileSync(file, JSON.stringify({ THUNDERD_PORT: { nested: true } }));
  assert.throws(() => loadConfig({ repoRoot: dir, env: configEnv(dir), configPath: file }), /must be a string, number or boolean/);
});

test('mergeConfigFile 直接暴露的合并语义（env 已设置的键不被文件覆盖）', () => {
  const read = (file) => '{"THUNDERD_PORT": 18000}';
  const merged = mergeConfigFile({ env: { THUNDERD_PORT: '20000' }, configPath: 'x.json', readFileImpl: read });
  assert.equal(merged.THUNDERD_PORT, '20000');
  const patched = mergeConfigFile({ env: {}, configPath: 'x.json', readFileImpl: read });
  assert.equal(patched.THUNDERD_PORT, '18000');
});

// ---- SDK 版本派生（沿有行为） ----
test('SDK version derives matching numeric version code from name or program dir', () => {
  assert.equal(versionCodeFromName('25.0.90.1592'), 2500901592);
  assert.equal(versionNameFromProgramDir('C:\\tlei-sdk\\Thunder-25.0.90.1592\\program'), '25.0.90.1592');
  assert.equal(versionNameFromProgramDir('/opt/tlei-sdk/Thunder-25.0.90.1592/program'), '25.0.90.1592');
  assert.equal(versionCodeFromName('bad', 123), 123);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-sdk-'));
  const config = loadConfig({ repoRoot: dir, env: configEnv(dir, {
    THUNDERD_ENGINE_MODE: 'native',
    THUNDERD_PROGRAM_DIR: 'C:\\tlei-sdk\\Thunder-25.0.90.1592\\program',
  }) });
  assert.equal(config.engineMode, 'native');
  assert.equal(config.sdkVersionName, '25.0.90.1592');
  assert.equal(config.sdkVersionCode, 2500901592);
  assert.equal(config.sdkPlatform, '0');
});
