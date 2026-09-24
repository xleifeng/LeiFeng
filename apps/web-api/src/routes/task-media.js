'use strict';

const fs = require('node:fs');
const { sendJson, errorStatus } = require('./helpers');

function parseTarget(url) { const match = /^\/api\/v2\/tasks\/([^/]+)\/files\/(\d+)\/(media-token|content)$/.exec(String(url || '').split('?')[0]); return match ? { taskId: decodeURIComponent(match[1]), fileIndex: Number(match[2]), kind: match[3] } : null; }

function createTaskMediaRoutes({ client, maxBodyBytes = 64 * 1024 } = {}) {
  if (!client) throw new Error('media route requires daemon client');
  return { name: 'task-media', async tryHandle(req, res, context = {}) {
    const target = parseTarget(req.url); if (!target) return false;
    if (target.kind === 'media-token') {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return true; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBodyBytes) { sendJson(res, 413, { error: { code: 'BODY_TOO_LARGE', message: '请求体过大' } }); return true; } chunks.push(chunk); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { sendJson(res, 400, { error: { code: 'INVALID_ARGUMENT', message: '请求体无效' } }); return true; }
      try { sendJson(res, 200, await client.call('daemon.v1.web.media.issueToken', { input: { taskId: target.taskId, fileIndex: target.fileIndex, disposition: input.disposition }, context })); }
      catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'MEDIA_FAILED', message: error.message } }, error.details?.retryAfterMs ? { 'retry-after': String(Math.ceil(error.details.retryAfterMs / 1000)) } : {}); }
      return true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return true; }
    const token = new URL(req.url, 'http://127.0.0.1').searchParams.get('token');
    let resource;
    try {
      resource = await client.call('daemon.v1.web.media.open', { input: { taskId: target.taskId, fileIndex: target.fileIndex, token, method: req.method, rangeHeader: req.headers.range, ifRange: req.headers['if-range'] }, context });
      const headers = { 'content-type': resource.mimeType, 'content-length': resource.length, 'accept-ranges': 'bytes', etag: resource.etag, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `${resource.disposition}; filename*=UTF-8''${encodeURIComponent(resource.displayName)}` };
      if (resource.contentRange) headers['content-range'] = resource.contentRange;
      res.writeHead(resource.status, headers);
      if (req.method === 'HEAD' || resource.length === 0) { await client.call('daemon.v1.web.lease.release', { leaseId: resource.leaseId }).catch(() => {}); res.end(); return true; }
      const stream = fs.createReadStream(resource.path, { start: resource.start, end: resource.end });
      let released = false;
      const release = () => { if (released) return; released = true; client.call('daemon.v1.web.lease.release', { leaseId: resource.leaseId }).catch(() => {}); };
      res.once('close', release); stream.once('close', release); stream.once('error', () => { release(); try { res.destroy(); } catch {} }); stream.pipe(res);
    } catch (error) { const status = errorStatus(error); sendJson(res, status, { error: { code: error.code || 'MEDIA_FAILED', message: error.message } }, status === 416 ? { 'content-range': 'bytes */*' } : {}); }
    return true;
  } };
}

module.exports = { createTaskMediaRoutes, parseTarget };
