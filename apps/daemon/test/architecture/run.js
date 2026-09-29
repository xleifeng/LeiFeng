'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, 'no-aria2-service-dependency.test.js'), path.join(__dirname, 'v2-production-scan.test.js')], { stdio: 'inherit' });
process.exitCode = result.status === null ? 1 : result.status;
