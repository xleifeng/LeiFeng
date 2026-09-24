'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function decodeFilename(value, fallback = 'upload.torrent') {
  let decoded;
  try { decoded = decodeURIComponent(String(value || fallback)); } catch { decoded = String(value || fallback); }
  const name = path.basename(decoded.replace(/\\/g, '/')).replace(/[\r\n"/\\]+/g, '_').slice(0, 180);
  return name || fallback;
}

function errorStatus(error) {
  const code = error && error.code;
  if (code === 'UNAUTHORIZED' || code === 'PRIVATE_SPACE_LOCKED' || /^MEDIA_TOKEN_/.test(code || '')) return 401;
  if (code === 'CSRF_INVALID' || code === 'ORIGIN_REQUIRED' || code === 'CAPTURE_LOOPBACK_ONLY' || code === 'REMOTE_CERT_REJECTED' || code === 'REMOTE_PERMISSION_DENIED') return 403;
  if (code === 'TASK_NOT_FOUND' || code === 'FILE_NOT_FOUND' || code === 'SEED_NOT_FOUND' || code === 'DIAGNOSTIC_EXPORT_NOT_FOUND' || code === 'DIAGNOSTIC_EXPORT_EXPIRED') return 404;
  if (code === 'UPLOAD_TOO_LARGE' || code === 'BODY_TOO_LARGE' || code === 'CAPTURE_BODY_TOO_LARGE') return 413;
  if (code === 'UNSUPPORTED_MEDIA_TYPE') return 415;
  if (code === 'INVALID_TORRENT' || code === 'INVALID_ARGUMENT' || code === 'INVALID_IDEMPOTENCY_KEY') return 400;
  if (code === 'RANGE_NOT_SATISFIABLE' || code === 'MULTI_RANGE_UNSUPPORTED' || code === 'INVALID_RANGE') return 416;
  if (code === 'RANGE_NOT_AVAILABLE_YET') return 409;
  if (code === 'RATE_LIMITED' || code === 'MEDIA_RATE_LIMIT' || code === 'CAPTURE_RATE_LIMIT') return 429;
  if (code === 'METHOD_NOT_ALLOWED') return 405;
  return 422;
}

async function stageRequest(req, { rootDir, prefix = 'upload-', maxBytes }) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) throw Object.assign(new Error('torrent 文件超过大小限制'), { code: 'UPLOAD_TOO_LARGE' });
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(rootDir, prefix));
  const filePath = path.join(directory, `${crypto.randomUUID()}.part`);
  const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw Object.assign(new Error('torrent 文件超过大小限制'), { code: 'UPLOAD_TOO_LARGE' });
      if (!output.write(chunk)) await once(output, 'drain');
    }
    await new Promise((resolve, reject) => { output.once('error', reject); output.end(resolve); });
    const descriptor = fs.openSync(filePath, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    return { directory, filePath, bytes, cleanup: () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} } };
  } catch (error) {
    output.destroy();
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    if (error && error.code === 'ERR_STREAM_PREMATURE_CLOSE') error.code = 'UPLOAD_ABORTED';
    throw error;
  }
}

module.exports = { sendJson, decodeFilename, errorStatus, stageRequest };
