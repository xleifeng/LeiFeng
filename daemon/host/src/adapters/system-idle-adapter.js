'use strict';

const { execFile } = require('node:child_process');

class SystemIdleAdapter {
  constructor({ runner = execFile } = {}) { this.runner = runner; this.available = false; this._probe(); }
  _probe() { this.runner('loginctl', ['show-session', 'self', '-p', 'IdleSinceHintMonotonicUSec', '--value'], { encoding: 'utf8' }, (error, stdout) => { this.available = !error && /^\d+$/.test(String(stdout || '').trim()); }); }
  isAvailable() { return this.available; }
  getIdleSeconds() { return new Promise((resolve, reject) => { this.runner('loginctl', ['show-session', 'self', '-p', 'IdleSinceHintMonotonicUSec', '--value'], { encoding: 'utf8' }, (error, stdout) => { if (error) return reject(error); const value = Number(String(stdout || '').trim()); if (!Number.isFinite(value) || value <= 0) return resolve(0); const elapsedUs = Number(process.hrtime.bigint() / 1000n) - value; resolve(Math.max(0, elapsedUs / 1e6)); }); }); }
  onActivity() { return () => {}; }
  close() {}
}

module.exports = { SystemIdleAdapter };
