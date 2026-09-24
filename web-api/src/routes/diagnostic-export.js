'use strict';

const fs = require('node:fs');
const { sendJson, errorStatus } = require('./helpers');

function createDiagnosticExportRoute({ client } = {}) {
  if (!client) throw new Error('diagnostic export route requires daemon client');
  return { name: 'diagnostic-export', async tryHandle(req, res, context = {}) {
    const match = /^\/api\/v2\/diagnostics\/exports\/([^/]+)$/.exec(String(req.url || '').split('?')[0]);
    if (!match || req.method !== 'GET') return false;
    let resource;
    try {
      resource = await client.call('daemon.v1.web.diagnostics.export', { exportId: decodeURIComponent(match[1]), context });
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': resource.length, 'content-disposition': 'attachment; filename="thunder-diagnostics.zip"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-diagnostics-export-id': resource.manifest?.exportId || match[1] });
      const stream = fs.createReadStream(resource.path); let released = false;
      const release = () => { if (released) return; released = true; client.call('daemon.v1.web.lease.release', { leaseId: resource.leaseId }).catch(() => {}); };
      res.once('close', release); stream.once('close', release); stream.once('error', () => { release(); try { res.destroy(); } catch {} }); stream.pipe(res);
    } catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'DIAGNOSTIC_EXPORT_FAILED', message: error.message } }, error.details?.retryAfterMs ? { 'retry-after': String(Math.ceil(error.details.retryAfterMs / 1000)) } : {}); }
    return true;
  } };
}

module.exports = { createDiagnosticExportRoute };
