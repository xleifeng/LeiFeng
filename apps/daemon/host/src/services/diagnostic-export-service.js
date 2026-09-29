'use strict';

// Export orchestration is kept as a small façade so HTTP/RPC callers do not
// need to know how DiagnosticsService stores its short-lived manifest.  The
// service itself owns redaction and archive streaming.
class DiagnosticExportService {
  constructor({ diagnostics } = {}) {
    if (!diagnostics) throw new Error('DiagnosticExportService diagnostics is required');
    this.diagnostics = diagnostics;
  }

  prepare(input, context) { return this.diagnostics.prepareExport(input, context); }
  getManifest(exportId) { return this.diagnostics.getManifest(exportId); }
  createArchive(exportId, writable) { return this.diagnostics.createArchive(exportId, writable); }
  cancel(exportId) { return this.diagnostics.cancel(exportId); }
  cleanupExpired() { return this.diagnostics.cleanupExpired(); }
}

module.exports = { DiagnosticExportService };
