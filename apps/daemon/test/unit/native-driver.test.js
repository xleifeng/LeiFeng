'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { WindowsNodeDriver, WindowsProgramProcessController } = require('../../host/src/driver');

test('native driver 路径恒等、launch args 显式 addon、env 无 WSL 痕迹', () => {
  const driver = new WindowsNodeDriver({
    repoRoot: 'C:\\repo',
    programDir: 'C:\\sdk\\Thunder-25.0.90.1592\\program',
    profileDir: 'C:\\runtime',
    sdkVersionName: '25.0.90.1592', sdkVersionCode: 2500901592, sdkPlatform: '0', sdkGuid: 'peer-id',
    processController: { list: async () => [], waitForSdk: async () => [], terminate: async () => {} },
  });
  // 路径恒等：宿主与引擎同文件系统，无翻译层
  assert.equal(driver.toEnginePath('C:\\Users\\test\\downloads'), 'C:\\Users\\test\\downloads');
  assert.equal(driver.engineMode, 'native');
  // 测试跑在 Linux（path 分隔符是 /），用 path.join 断言与实现同一规则；真机 win32 下两者天然一致
  assert.equal(driver.engineScript, path.join('C:\\repo', 'apps', 'daemon', 'engine', 'engine.js'));
  // 引擎参数：显式 addon，路径经 path 规范化（无 Z: 前缀、无 UNC）
  assert.deepEqual(driver._launchArguments(16800), [
    driver.engineScript, '--port', '16800',
    '--profile', 'C:\\runtime',
    '--addon', path.join('C:\\sdk\\Thunder-25.0.90.1592\\program', 'dk_addon.node'),
  ]);
  // env 只带 SDK 身份变量；无 WSLENV、无 PATH 重置（继承宿主 PATH）
  const env = driver._launchEnvironment();
  assert.deepEqual(Object.keys(env).sort(), ['ELECTRON_RUN_AS_NODE', 'THUNDERD_SDK_GUID', 'THUNDERD_SDK_PLATFORM', 'THUNDERD_SDK_VERSION_CODE', 'THUNDERD_SDK_VERSION_NAME']);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.THUNDERD_SDK_PLATFORM, '0');
  // sdkVersionCode 缺省从版本名派生
  const bare = new WindowsNodeDriver({ repoRoot: 'C:\\repo', programDir: 'C:\\p', profileDir: 'C:\\r',
    processController: { list: async () => [], waitForSdk: async () => [], terminate: async () => {} } });
  assert.equal(bare.sdkVersionCode, 2500901592);
});

test('Windows process controller 按 programDir 过滤并 taskkill 终止（PATH 解析命令）', async () => {
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args });
    if (String(command).endsWith('powershell.exe')) callback(null, JSON.stringify([
      { pid: 10, name: 'thunder.exe', path: 'C:\\Thunder\\program\\thunder.exe' },
      { pid: 11, name: 'other.exe', path: 'C:\\Other\\other.exe' },
    ]));
    else callback(null, '');
  };
  const controller = new WindowsProgramProcessController({ programDir: 'C:\\Thunder\\program', execFileImpl });
  assert.deepEqual((await controller.list()).map((row) => row.pid), [10]);
  await controller.terminate([10, 11]);
  const taskkill = calls.find((call) => String(call.command).endsWith('taskkill.exe'));
  assert.deepEqual(taskkill.args, ['/PID', '10', '/T', '/F']);
});

test('Windows process controller 默认命令走 PATH 且可被环境变量覆盖', () => {
  const original = process.env.THUNDERD_POWERSHELL;
  try {
    process.env.THUNDERD_POWERSHELL = 'C:\\tools\\pwsh.exe';
    const controller = new WindowsProgramProcessController({ programDir: 'C:\\p' });
    assert.equal(controller.powershellExe, 'C:\\tools\\pwsh.exe');
    delete process.env.THUNDERD_POWERSHELL;
    const plain = new WindowsProgramProcessController({ programDir: 'C:\\p' });
    assert.equal(plain.powershellExe, 'powershell.exe');
    assert.equal(plain.taskkillExe, 'taskkill.exe');
  } finally {
    if (original === undefined) delete process.env.THUNDERD_POWERSHELL; else process.env.THUNDERD_POWERSHELL = original;
  }
});

test('waitForSdk 只认本代新出现的 DownloadSDKServer.exe', async () => {
  let round = 0;
  const rows = [
    [{ pid: 1, name: 'thunder.exe', path: 'C:\\p\\thunder.exe' }],
    [{ pid: 1, name: 'thunder.exe', path: 'C:\\p\\thunder.exe' }, { pid: 2, name: 'DownloadSDKServer.exe', path: 'C:\\p\\DownloadSDKServer.exe' }],
  ];
  const controller = new WindowsProgramProcessController({ programDir: 'C:\\p', execFileImpl: (command, args, options, callback) => {
    callback(null, JSON.stringify(rows[Math.min(round++, rows.length - 1)]));
  } });
  const created = await controller.waitForSdk(new Set([1]), 1000);
  assert.deepEqual(created.map((row) => row.pid), [2]);
});
