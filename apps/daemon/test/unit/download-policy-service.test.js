'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsRepository } = require('../../host/src/repositories/settings-repository');
const { DownloadPolicyService } = require('../../host/src/services/download-policy-service');
const { ProxySecretStore } = require('../../host/src/secrets/proxy-secret-store');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'download-policy-v2-'));
  const settings = new SettingsRepository({ filePath: path.join(root, 'settings.json'), defaults: { downloadDir: root } }); settings.load();
  const calls = [];
  const driver = { isHealthy: () => true, setGlobalLimits: async (v) => { calls.push(['limits', v]); return { applied: v, failures: [] }; }, setChannelSwitches: async (v) => { calls.push(['channels', v]); return { applied: v, failures: [] }; }, setProxy: async (v) => { calls.push(['proxy', v]); return { applied: v }; }, verifyProxy: async () => ({ ok: true, reachable: true }) };
  const secrets = new ProxySecretStore({ filePath: path.join(root, 'proxy.json') }); secrets.load();
  return { root, settings, driver, calls, secrets, service: new DownloadPolicyService({ settings, driver, proxySecrets: secrets }) };
}

test('policy update persists desired values separately from applied runtime', async () => {
  const f = setup();
  const result = await f.service.update({ expectedRevision: 0, patch: { globalDownloadLimit: 1024, maxConcurrentTasks: 2 } });
  assert.equal(result.policy.globalDownloadLimit, 1024);
  assert.equal(result.policy.maxConcurrentTasks, 2);
  assert.equal(result.applied, true);
  assert.deepEqual(f.calls[0], ['limits', { downloadLimit: 1024, uploadLimit: null, connectionLimit: null, maxTasks: 2 }]);
});

test('proxy password is stored by reference and never returned', async () => {
  const f = setup();
  const result = await f.service.update({ expectedRevision: 0, patch: { proxy: { mode: 'http', host: '127.0.0.1', port: 8080 } }, proxySecret: { action: 'replace', username: 'u', password: 'secret-value' } });
  assert.equal(result.policy.proxy.passwordPresent, true);
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
  assert.equal(f.secrets.snapshot()[result.policy.proxy.passwordRef].username, 'u');
});

test('full speed is an in-memory override and restore uses the snapshot', async () => {
  const f = setup();
  await f.service.update({ expectedRevision: 0, patch: { globalDownloadLimit: 1234 } });
  await f.service.enableFullSpeed();
  assert.equal(f.calls.at(-1)[1].downloadLimit, null);
  await f.service.restoreLimits();
  assert.equal(f.calls.at(-1)[1].downloadLimit, 1234);
});

test('policy updates and engine recovery reapply the active download limit window', async () => {
  const f = setup();
  const reasons = [];
  f.service.scheduleService = { syncDownloadLimitWindowRuntime: async ({ reason }) => { reasons.push(reason); return { applied: true }; } };
  await f.service.update({ expectedRevision: 0, patch: { globalDownloadLimit: 2048 } });
  await f.service.onEngineUp(7);
  assert.deepEqual(reasons, ['policy-update', 'engine-up']);
});
