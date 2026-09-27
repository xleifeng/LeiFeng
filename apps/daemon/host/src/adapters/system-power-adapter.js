'use strict';

// 电源动作平台分流：Linux loginctl；Windows 睡眠用 SetSuspendState（系统 DLL，无弹窗），
// 关机用 shutdown.exe（30 秒宽限与 Linux 语义对齐，留出取消窗口）。
class SystemPowerAdapter {
  constructor({ processRunner, allow = false } = {}) { this.processRunner = processRunner; this.allow = allow === true; }
  isAvailable(action) { return this.allow && ['suspend', 'poweroff'].includes(String(action)); }
  async suspend() {
    if (!this.isAvailable('suspend')) throw Object.assign(new Error('系统睡眠动作未启用'), { code: 'POWER_ACTION_DISABLED' });
    if (process.platform === 'win32') return this.processRunner.run('rundll32.exe', ['powrprof.dll,SetSuspendState 0,1,0'], { shell: false });
    return this.processRunner.run('loginctl', ['suspend'], { shell: false });
  }
  async poweroff() {
    if (!this.isAvailable('poweroff')) throw Object.assign(new Error('系统关机动作未启用'), { code: 'POWER_ACTION_DISABLED' });
    if (process.platform === 'win32') return this.processRunner.run('shutdown.exe', ['/s', '/t', '30'], { shell: false });
    return this.processRunner.run('loginctl', ['poweroff'], { shell: false });
  }
}

module.exports = { SystemPowerAdapter };
