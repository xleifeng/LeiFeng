'use strict';

const { sendJson, decodeFilename, errorStatus, stageRequest } = require('./helpers');

function isCapturePath(url) { const pathname = new URL(String(url || '/'), 'http://127.0.0.1').pathname; return ['/api/v2/capture', '/api/v2/capture/pair', '/api/v2/capture/torrent'].includes(pathname); }

function createBrowserCaptureRoute({ client, maxBodyBytes = 1024 * 1024, maxTorrentBytes = 20 * 1024 * 1024, tempRoot, allowRemote = false } = {}) {
  if (!client || !tempRoot) throw new Error('browser capture route dependencies are incomplete');
  return { name: 'browser-capture', async tryHandle(req, res, context = {}) {
    if (!isCapturePath(req.url)) return false;
    const pathname = new URL(String(req.url || '/'), 'http://127.0.0.1').pathname;
    const origin = String(req.headers.origin || '');
    const allowed = await client.call('daemon.v1.web.capture.originAllowed', { origin }).then((value) => value.allowed).catch(() => false);
    if (req.method === 'OPTIONS') {
      if (!allowed) { sendJson(res, 403, { error: { code: 'CAPTURE_ORIGIN_INVALID', message: '扩展来源未配对' } }); return true; }
      sendJson(res, 204, {}, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', vary: 'Origin' }); return true;
    }
    const cors = allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    if (pathname === '/api/v2/capture/pair') {
      if (req.method !== 'POST') { sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST' } }, { allow: 'POST', ...cors }); return true; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBodyBytes) { sendJson(res, 413, { error: { code: 'CAPTURE_BODY_TOO_LARGE', message: '请求体过大' } }, cors); return true; } chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { sendJson(res, 400, { error: { code: 'INVALID_ARGUMENT', message: '请求体无效' } }, cors); return true; }
      try { const result = await client.call('daemon.v1.web.capture.acceptPairing', { input, context, allowRemote }); sendJson(res, 200, result, { 'access-control-allow-origin': String(input.origin || origin), vary: 'Origin' }); }
      catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'PAIRING_FAILED', message: error.message } }, cors); }
      return true;
    }
    if (req.method !== 'POST') { sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 POST' } }, { allow: 'POST', ...cors }); return true; }
    const token = String(req.headers.authorization || '').replace(/^Capture\s+/i, '');
    const principal = await client.call('daemon.v1.web.capture.authenticate', { token, origin }).then((value) => value.principal).catch(() => null);
    if (!principal) { sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '扩展未配对或已撤销' } }, cors); return true; }
    if (pathname === '/api/v2/capture/torrent') {
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['application/x-bittorrent', 'application/octet-stream'].includes(contentType)) { sendJson(res, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'torrent 接管必须使用二进制 body' } }, cors); return true; }
      let staged;
      try {
        staged = await stageRequest(req, { rootDir: tempRoot, prefix: 'capture-', maxBytes: maxTorrentBytes });
        const result = await client.call('daemon.v1.web.capture.torrent', { filePath: staged.filePath, originalName: decodeFilename(req.headers['x-thunder-filename'], 'capture.torrent'), principal, context, allowRemote });
        sendJson(res, 201, result, cors);
      } catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'CAPTURE_FAILED', message: error.message } }, cors); }
      finally { staged?.cleanup(); }
      return true;
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBodyBytes) { sendJson(res, 413, { error: { code: 'CAPTURE_BODY_TOO_LARGE', message: '请求体过大' } }, cors); return true; } chunks.push(chunk); }
    try { const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); sendJson(res, 200, await client.call('daemon.v1.web.capture.submit', { input, principal, context, allowRemote }), cors); }
    catch (error) { sendJson(res, errorStatus(error), { error: { code: error.code || 'CAPTURE_FAILED', message: error.message } }, cors); }
    return true;
  } };
}

module.exports = { createBrowserCaptureRoute, isCapturePath };
