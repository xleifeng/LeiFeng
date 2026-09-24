'use strict';

const fs = require('node:fs');
const { sendJson, errorStatus } = require('./helpers');

function createTaskExportRoute({ client } = {}) {
  if (!client) throw new Error('task export route requires daemon client');
  return { name: 'task-export', async tryHandle(req, res, context = {}) {
    const match = /^\/api\/v2\/tasks\/([^/]+)\/torrent$/.exec(String(req.url || '').split('?')[0]);
    if (!match || !['GET', 'HEAD'].includes(req.method)) return false;
    try {
      const resource = await client.call('daemon.v1.web.torrent.export', { taskId: decodeURIComponent(match[1]), context });
      res.writeHead(200, { 'content-type': 'application/x-bittorrent', 'content-length': resource.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resource.filename)}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      if (req.method === 'HEAD') { await client.releaseLease(resource.leaseId).catch(() => {}); res.end(); return true; }
      const stream = fs.createReadStream(resource.path); let released = false;
      const release = () => { if (released) return; released = true; client.releaseLease(resource.leaseId).catch(() => {}); };
      res.once('close', release); stream.once('close', release); stream.once('error', () => { release(); try { res.destroy(); } catch {} }); stream.pipe(res);
    } catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'TASK_EXPORT_FAILED', message: error.message } }); }
    return true;
  } };
}

module.exports = { createTaskExportRoute };
