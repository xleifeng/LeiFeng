'use strict';

// 旧 core 入口保留兼容；运行时装配仅由 profile launcher 完成。
const { spawn } = require('node:child_process');
const path = require('node:path');

function startCore(argv = process.argv.slice(2)) {
  const entry = path.join(__dirname, 'entry.mjs');
  const child = spawn(process.execPath, [entry, '--profile', 'thunderd-core', ...argv], {
    cwd: path.resolve(__dirname, '..', '..', '..'), env: process.env, stdio: 'inherit',
  });
  child.on('exit', (code, signal) => { process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return child;
}

if (require.main === module) startCore();

module.exports = { startCore };
