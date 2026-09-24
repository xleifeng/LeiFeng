'use strict';

const { sendJson, decodeFilename, errorStatus, stageRequest } = require('./helpers');

function createTorrentUploadRoute({ client, tempRoot, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!client || !tempRoot) throw new Error('torrent upload route dependencies are incomplete');
  return { name: 'torrent-upload', async tryHandle(req, res, context = {}) {
    if (req.method !== 'POST' || req.url !== '/api/v2/create-drafts/torrent') return false;
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['application/x-bittorrent', 'application/octet-stream'].includes(contentType)) { sendJson(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'torrent 上传必须使用二进制 body' } }); return true; }
    let staged;
    try {
      staged = await stageRequest(req, { rootDir: tempRoot, prefix: 'web-upload-', maxBytes });
      const result = await client.call('daemon.v1.web.torrent.import', { filePath: staged.filePath, originalName: decodeFilename(req.headers['x-thunder-filename']), idempotencyKey: String(req.headers['x-idempotency-key'] || ''), context });
      sendJson(res, 201, result);
    } catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'UPLOAD_FAILED', message: error.message } }); }
    finally { staged?.cleanup(); }
    return true;
  } };
}

module.exports = { createTorrentUploadRoute };
