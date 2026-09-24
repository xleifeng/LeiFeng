'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { ScheduleRepository } = require('../../host/src/repositories/schedule-repository'); const { ScheduleService, isInsideDownloadLimitWindow, DOWNLOAD_LIMIT_WINDOW_IDS } = require('../../host/src/services/schedule-service');

test('schedule computes next run in a named timezone and executes idempotently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-v2-')); const repository = new ScheduleRepository({ filePath: path.join(root, 'schedules.json') }); repository.load();
  const calls = []; const taskService = { tasks: { list: () => [{ id: 't1', lifecycle: 'queued' }] }, command: async (input) => calls.push(input) };
  const service = new ScheduleService({ repository, taskService });
  const saved = service.save({ schedule: { id: 's1', name: 'start', enabled: true, action: 'start-all', daysOfWeek: [1, 2, 3, 4, 5, 6, 0], localTime: '00:00', timezone: 'UTC' } });
  assert.ok(saved.schedule.nextRunAt);
  const due = { ...saved.schedule, nextRunAt: Date.now() - 1 };
  repository.save(due, { expectedRevision: saved.schedule.revision });
  await service.tick(Date.now()); await service.tick(Date.now());
  assert.equal(calls.length, 1);
  assert.equal(repository.get('s1').lastResult, 'ok');
});

test('disabled and empty-day schedules do not receive a timer target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-v2-empty-')); const repository = new ScheduleRepository({ filePath: path.join(root, 'schedules.json') }); repository.load(); const service = new ScheduleService({ repository });
  assert.equal(service.computeNextRun({ enabled: false, daysOfWeek: [1], localTime: '00:00', timezone: 'UTC' }), null);
  assert.equal(service.computeNextRun({ enabled: true, daysOfWeek: [], localTime: '00:00', timezone: 'UTC' }), null);
});

test('download limit window handles daytime and overnight ranges with an exclusive end', () => {
  assert.equal(isInsideDownloadLimitWindow({ startLocalTime: '09:00', endLocalTime: '17:00', timezone: 'UTC' }, Date.UTC(2026, 7, 24, 9, 0)), true);
  assert.equal(isInsideDownloadLimitWindow({ startLocalTime: '09:00', endLocalTime: '17:00', timezone: 'UTC' }, Date.UTC(2026, 7, 24, 17, 0)), false);
  assert.equal(isInsideDownloadLimitWindow({ startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' }, Date.UTC(2026, 7, 24, 23, 30)), true);
  assert.equal(isInsideDownloadLimitWindow({ startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' }, Date.UTC(2026, 7, 24, 12, 0)), false);
});

test('download limit window persists managed schedules, applies current mode and hides internals from the generic list', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-limit-window-'));
  const repository = new ScheduleRepository({ filePath: path.join(root, 'schedules.json') }); repository.load();
  let now = Date.UTC(2026, 7, 24, 23, 30);
  const calls = [];
  const policyService = {
    get: () => ({ policy: { globalDownloadLimit: 1024, globalUploadLimit: null } }),
    restoreLimits: async () => { calls.push('limited'); return { fullSpeed: false }; },
    enableFullSpeed: async () => { calls.push('full-speed'); return { fullSpeed: true }; },
  };
  const service = new ScheduleService({ repository, policyService, clock: { now: () => now } });
  const saved = await service.setDownloadLimitWindow({ enabled: true, startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' });
  assert.equal(saved.enabled, true);
  assert.equal(saved.activeNow, true);
  assert.equal(calls.at(-1), 'limited');
  assert.equal(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.start).action, 'restore-limits');
  assert.equal(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.end).action, 'enable-full-speed');
  assert.deepEqual(service.query().schedules, []);

  now = Date.UTC(2026, 7, 24, 12, 0);
  const runtime = await service.syncDownloadLimitWindowRuntime({ reason: 'test' });
  assert.equal(runtime.mode, 'full-speed');
  assert.equal(calls.at(-1), 'full-speed');

  now = Date.UTC(2026, 7, 27, 23, 30);
  const recovered = await service.syncDownloadLimitWindowRuntime({ reason: 'restart-after-missed-boundaries' });
  assert.equal(recovered.mode, 'limited');
  assert.equal(calls.at(-1), 'limited');
  assert.ok(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.start).nextRunAt > now);
  assert.ok(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.end).nextRunAt > now);

  const disabled = await service.setDownloadLimitWindow({ enabled: false, startLocalTime: '22:00', endLocalTime: '06:00', timezone: 'UTC' });
  assert.equal(disabled.configured, false);
  assert.equal(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.start), null);
  assert.equal(repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.end), null);
  assert.equal(calls.at(-1), 'limited');
});

test('download limit window rejects ambiguous and limit-free configurations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-limit-invalid-'));
  const repository = new ScheduleRepository({ filePath: path.join(root, 'schedules.json') }); repository.load();
  const policyService = { get: () => ({ policy: { globalDownloadLimit: null, globalUploadLimit: null } }), restoreLimits: async () => ({}), enableFullSpeed: async () => ({}) };
  const service = new ScheduleService({ repository, policyService });
  await assert.rejects(service.setDownloadLimitWindow({ enabled: true, startLocalTime: '08:00', endLocalTime: '08:00', timezone: 'UTC' }), (error) => error.code === 'INVALID_LIMIT_WINDOW');
  await assert.rejects(service.setDownloadLimitWindow({ enabled: true, startLocalTime: '08:00', endLocalTime: '09:00', timezone: 'UTC' }), (error) => error.code === 'LIMIT_WINDOW_REQUIRES_LIMIT');
});
