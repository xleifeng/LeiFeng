'use strict';

const { spawn } = require('node:child_process');

class ProcessRunner {
  constructor({ spawnImpl = spawn, timeoutMs = 10000, maxConcurrent = 4 } = {}) { this.spawnImpl = spawnImpl; this.timeoutMs = timeoutMs; this.maxConcurrent = maxConcurrent; this.active = 0; }

  run(command, args = [], { timeoutMs = this.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      if (this.active >= this.maxConcurrent) { const error = new Error('系统操作过于频繁'); error.code = 'PROCESS_RATE_LIMIT'; reject(error); return; }
      this.active += 1;
      let settled = false;
      let timer;
      const finish = (error, result) => { if (settled) return; settled = true; this.active = Math.max(0, this.active - 1); if (timer) clearTimeout(timer); error ? reject(error) : resolve(result); };
      let child;
      try { child = this.spawnImpl(command, args, { shell: false, stdio: 'ignore' }); }
      catch (cause) { const error = new Error('系统程序不可用'); error.code = cause && cause.code === 'ENOENT' ? 'PROCESS_NOT_FOUND' : 'PROCESS_FAILED'; finish(error); return; }
      timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} const error = new Error('系统程序启动超时'); error.code = 'PROCESS_TIMEOUT'; finish(error); }, timeoutMs);
      child.once('error', (cause) => { const error = new Error('系统程序不可用'); error.code = cause && cause.code === 'ENOENT' ? 'PROCESS_NOT_FOUND' : 'PROCESS_FAILED'; finish(error); });
      child.once('exit', (code, signal) => finish(null, { code, signal }));
    });
  }
}

module.exports = { ProcessRunner };
