'use strict';

// 旧 stack 入口保留兼容；Web API 子进程由 thunderd profile 托管。
const { spawn } = require('node:child_process');
const path = require('node:path');

function startStack(argv = process.argv.slice(2)) {
  const entry = path.join(__dirname, 'entry.mjs');
  const child = spawn(process.execPath, [entry, '--profile', 'thunderd', ...argv], {
    cwd: path.resolve(__dirname, '..', '..', '..'), env: process.env, stdio: 'inherit',
  });
  child.on('exit', (code, signal) => { process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return { core: child, web: null, shutdown: () => child.kill('SIGTERM') };
}

if (require.main === module) startStack();

module.exports = { startStack };
