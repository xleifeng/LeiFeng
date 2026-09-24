'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function javascriptFiles(root) { return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? javascriptFiles(path.join(root, entry.name)) : entry.name.endsWith('.js') ? [path.join(root, entry.name)] : []); }

test('external Web API imports daemon only through daemon-client', () => {
  const root = path.join(__dirname, '../../../web-api/src');
  for (const file of javascriptFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /require\(['"][^'"]*daemon\/host\/src/, file);
    assert.doesNotMatch(source, /require\(['"][^'"]*daemon\/(?:engine|host)\//, file);
  }
});

test('daemon core entry does not create HTTP or HTTPS servers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../host/src/main.js'), 'utf8');
  const plugins = fs.readFileSync(path.join(__dirname, '../../host/plugins/registry.cjs'), 'utf8');
  assert.doesNotMatch(source, /createRpcServer|createWebApiServer|http\.createServer|https\.createServer|MtlsServer/);
  assert.match(source, /entry\.mjs.*thunderd-core/s);
  assert.match(plugins, /DaemonControlServer/);
  assert.equal(fs.existsSync(path.join(__dirname, '../../host/src/server.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../../host/src/http')), false);
});

test('core-only startup is independent from WebUI build and supervisor import has no side effect', () => {
  const runScript = fs.readFileSync(path.join(__dirname, '../../run.sh'), 'utf8');
  const supervisor = fs.readFileSync(path.join(__dirname, '../../host/src/stack.js'), 'utf8');
  assert.match(runScript, /\[ "\$CORE_ONLY" -eq 0 \] && \[ -f webui\/package\.json \]/);
  assert.match(supervisor, /if \(require\.main === module\) startStack\(\);/);
  assert.match(supervisor, /entry\.mjs.*thunderd/s);
  assert.match(runScript, /entry\.mjs --profile thunderd-core/);
});
