'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { DiagnosticEventBuffer } = require('../../host/src/domain/diagnostic-events');
const { DiagnosticsService } = require('../../host/src/services/diagnostics-service');

test('diagnostics redact secrets and produce expiring export manifest', async () => {
  const events = new DiagnosticEventBuffer({ max: 2 }); events.record('auth', { authorization: 'Bearer secret', token: 'abc', safe: 'ok' });
  const service = new DiagnosticsService({ config: { version: 'x' }, events, tasks: { list: () => [{ id: '1', lifecycle: 'completed' }], repositoryRevision: 2 }, driver: { isHealthy: () => false, restarts: 1 }, settings: { get: () => ({ revision: 1, desired: { downloadDir: '/home/user/downloads' } }) } });
  const snapshot = await service.snapshot(); assert.equal(snapshot.events[0].payload.authorization, '[REDACTED]'); assert.equal(snapshot.events[0].payload.token, '[REDACTED]'); assert.equal(snapshot.settings.downloadDir, 'downloads');
  const prepared = await service.prepareExport(); assert.equal(prepared.files[0], 'diagnostics.json'); const exported = await service.exportPayload(prepared.exportId); assert.equal(exported.daemonVersion, snapshot.daemonVersion); assert.deepEqual(exported.counts, snapshot.counts); assert.deepEqual(exported.settings, snapshot.settings);
  const output = new PassThrough(); const chunks = []; output.on('data', (chunk) => chunks.push(chunk)); const ended = new Promise((resolve) => output.on('end', resolve)); await service.createArchive(prepared.exportId, output); await ended; assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK');
});
