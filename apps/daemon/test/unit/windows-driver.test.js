'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowsNodeDriver, WindowsProgramProcessController } = require('../../host/src/driver');

test('Windows native driver forwards only the required launch variables and converts engine paths', () => {
  const driver = new WindowsNodeDriver({
    repoRoot: '/home/test/tlei',
    programDir: '/mnt/c/Users/test/AppData/Local/tlei-sdk/Thunder-25.0.90.1592/program',
    profileDir: '/mnt/c/Users/test/AppData/Local/tlei-sdk/runtime/profile',
    engineMirrorDir: '/mnt/c/Users/test/AppData/Local/tlei-sdk/runtime/profile/engine',
    distroName: 'Ubuntu', sdkVersionName: '25.0.90.1592', sdkVersionCode: 2500901592, sdkPlatform: '0', sdkGuid: 'peer-id',
    syncEngineBundle: () => {}, processController: { list: async () => [], waitForSdk: async () => [], terminate: async () => {} },
  });
  assert.deepEqual(Object.keys(driver._launchEnvironment()).sort(), ['ELECTRON_RUN_AS_NODE', 'PATH', 'THUNDERD_SDK_GUID', 'THUNDERD_SDK_PLATFORM', 'THUNDERD_SDK_VERSION_CODE', 'THUNDERD_SDK_VERSION_NAME', 'WSLENV'].sort());
  assert.match(driver._launchEnvironment().WSLENV, /ELECTRON_RUN_AS_NODE\/w/);
  assert.deepEqual(driver._launchArguments(16800), [
    'C:\\Users\\test\\AppData\\Local\\tlei-sdk\\runtime\\profile\\engine\\engine.js', '--port', '16800',
    '--profile', 'C:\\Users\\test\\AppData\\Local\\tlei-sdk\\runtime\\profile',
    '--addon', 'C:\\Users\\test\\AppData\\Local\\tlei-sdk\\Thunder-25.0.90.1592\\program\\dk_addon.node',
  ]);
  assert.equal(driver.toEnginePath('/home/test/downloads'), '\\\\wsl.localhost\\Ubuntu\\home\\test\\downloads');
});

test('Windows process controller filters and terminates only processes inside the selected program root', async () => {
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args });
    if (String(command).endsWith('powershell.exe')) callback(null, JSON.stringify([
      { pid: 10, name: 'thunder.exe', path: 'C:\\Thunder\\program\\thunder.exe' },
      { pid: 11, name: 'other.exe', path: 'C:\\Other\\other.exe' },
    ]));
    else callback(null, '');
  };
  const controller = new WindowsProgramProcessController({ programDir: '/mnt/c/Thunder/program', distroName: 'Ubuntu', execFileImpl });
  assert.deepEqual((await controller.list()).map((row) => row.pid), [10]);
  await controller.terminate([10, 11]);
  const taskkill = calls.find((call) => String(call.command).endsWith('taskkill.exe'));
  assert.deepEqual(taskkill.args, ['/PID', '10', '/T', '/F']);
});
