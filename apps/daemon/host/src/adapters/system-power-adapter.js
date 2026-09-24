'use strict';

class SystemPowerAdapter {
  constructor({ processRunner, allow = false } = {}) { this.processRunner = processRunner; this.allow = allow === true; }
  isAvailable(action) { return this.allow && ['suspend', 'poweroff'].includes(String(action)); }
  async suspend() { if (!this.isAvailable('suspend')) throw Object.assign(new Error('系统睡眠动作未启用'), { code: 'POWER_ACTION_DISABLED' }); return this.processRunner.run('loginctl', ['suspend'], { shell: false }); }
  async poweroff() { if (!this.isAvailable('poweroff')) throw Object.assign(new Error('系统关机动作未启用'), { code: 'POWER_ACTION_DISABLED' }); return this.processRunner.run('loginctl', ['poweroff'], { shell: false }); }
}

module.exports = { SystemPowerAdapter };
