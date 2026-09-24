'use strict';
const validators = require('./validators');

function createDiagnosticsMethods({ diagnostics } = {}) {
  if (!diagnostics) return [];
  return [
    ['thunder.ui.v2.diagnostics.get', (params, ctx) => diagnostics.getSystemSnapshot(validators.diagnosticSystemGet(params && params[0]), ctx)],
    ['thunder.ui.v2.diagnostics.system.get', (params, ctx) => diagnostics.getSystemSnapshot(validators.diagnosticSystemGet(params && params[0]), ctx)],
    ['thunder.ui.v2.diagnostics.tasks.get', (params, ctx) => diagnostics.getTaskDiagnostics(validators.diagnosticTaskGet(params && params[0]), ctx)],
    ['thunder.ui.v2.diagnostics.events.query', (params) => diagnostics.queryEvents(validators.diagnosticEventsQuery(params && params[0])),],
    ['thunder.ui.v2.diagnostics.checks.run', (params, ctx) => diagnostics.runCheck(validators.diagnosticCheckRun(params && params[0]), ctx)],
    ['thunder.ui.v2.diagnostics.exports.prepare', (params, ctx) => diagnostics.prepareExport(validators.diagnosticExportPrepare(params && params[0]), ctx)],
    ['thunder.ui.v2.diagnostics.exports.getManifest', (params) => diagnostics.getManifest(validators.diagnosticExportGet(params && params[0]).exportId)],
    ['thunder.ui.v2.diagnostics.exports.get', (params) => diagnostics.exportPayload(validators.diagnosticExportGet(params && params[0]).exportId)],
    ['thunder.ui.v2.diagnostics.exports.cancel', (params) => ({ cancelled: diagnostics.cancel(validators.diagnosticExportCancel(params && params[0]).exportId) })],
  ];
}

module.exports = { createDiagnosticsMethods };
