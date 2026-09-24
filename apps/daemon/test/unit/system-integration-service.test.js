'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SafePathResolver } = require('../../host/src/services/safe-path-resolver');
const { SystemIntegrationService } = require('../../host/src/services/system-integration-service');

test('system integration resolves task target and invokes fixed argv without shell', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-integration-v2-'));
  const savePath = path.join(root, 'downloads'); fs.mkdirSync(savePath, { recursive: true });
  const file = path.join(savePath, 'file.bin'); fs.writeFileSync(file, 'data');
  const calls = [];
  const service = new SystemIntegrationService({ resolver: new SafePathResolver({ allowedRoots: [root] }), processRunner: { run: async (...args) => calls.push(args) }, opener: 'fake-opener' });
  const task = { savePath, displayName: 'file.bin' };
  assert.deepEqual(await service.open(task), { target: file });
  assert.deepEqual(await service.showInFolder(task), { target: file, directory: savePath });
  assert.deepEqual(calls, [['fake-opener', [file]], ['fake-opener', [savePath]]]);
});

test('system integration reports desktop capability without exposing arbitrary paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-capability-v2-')); const service = new SystemIntegrationService({ resolver: new SafePathResolver({ allowedRoots: [root] }), processRunner: { run: async () => {} } });
  const capabilities = service.getCapabilities(); assert.equal(typeof capabilities.openOnHost, 'boolean'); assert.equal(typeof capabilities.headless, 'boolean');
});
