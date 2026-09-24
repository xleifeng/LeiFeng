'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { SettingsRepository } = require('../../host/src/repositories/settings-repository');
const { SettingsService } = require('../../host/src/services/settings-service');

test('desired settings remain authoritative while applied state is cached separately', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-v2-')); const repository = new SettingsRepository({ filePath: path.join(dir, 'settings.json'), defaults: { downloadDir: dir } }); repository.load();
  let applied; const service = new SettingsService({ settings: repository, driver: { isHealthy: () => true, setGlobalLimits: async (value) => { applied = value; return { ok: true }; } } });
  const next = await service.update({ downloadLimit: 1024 }, { expectedRevision: 0 });
  assert.equal(next.desired.downloadLimit, 1024); assert.equal(applied.downloadLimit, 1024); assert.equal(next.applied.downloadLimit, 1024);
});
