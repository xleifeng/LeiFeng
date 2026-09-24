'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { requestContext } = require('./request-context');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8', '.eot': 'application/vnd.ms-fontobject', '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function staticFilePath(staticDir, requestUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname); } catch { return null; }
  if (pathname === '/') pathname = '/index.html';
  const root = path.resolve(staticDir); const target = path.resolve(root, `.${pathname}`);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

function serveStatic(req, res, staticDir) {
  if (!staticDir || !['GET', 'HEAD'].includes(req.method)) return false;
  const target = staticFilePath(staticDir, req.url || '/');
  if (!target) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Forbidden'); return true; }
  let stat;
  try { stat = fs.statSync(target); } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return true; }
  if (!stat.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return true; }
  const headers = {
    'content-type': MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size,
    'content-security-policy': "default-src 'self'; script-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'cache-control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(target).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
  return true;
}

function createWebRequestHandler({ client, port = 0, host = '127.0.0.1', staticDir = null, maxBodyBytes = 8 * 1024 * 1024, routes = [] } = {}) {
  if (!client || typeof client.invoke !== 'function') throw new Error('Web API requires a daemon client');
  return async (req, res) => {
    const context = requestContext(req, { host, port });
    for (const route of routes) {
      try { if (route && typeof route.tryHandle === 'function' && await route.tryHandle(req, res, context)) return; }
      catch (error) { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: { code: error.code || 'ROUTE_FAILED', message: error.message } })); } return; }
    }
    if (serveStatic(req, res, staticDir)) return;
    if (req.method !== 'POST' || req.url !== '/jsonrpc') { res.writeHead(404); res.end(); return; }
    const chunks = []; let bytes = 0; let tooLarge = false;
    let body;
    try {
      // 客户端中途断开 → ERR_STREAM_PREMATURE_CLOSE：答不了就静默收场，绝不能
      // 变成 unhandledRejection 打挂进程（审计 2026-09-23：曾有 crash-restart 风险）
      for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBodyBytes) { tooLarge = true; continue; } chunks.push(chunk); }
    } catch {
      if (!res.destroyed) res.destroy();
      return;
    }
    body = Buffer.concat(chunks);
    const reply = (value) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (tooLarge) { reply({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Request body too large' } }); return; }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const execute = async (call) => {
      if (!call || call.jsonrpc !== '2.0' || typeof call.method !== 'string') return { jsonrpc: '2.0', id: call && call.id != null ? call.id : null, error: { code: -32600, message: 'Invalid Request' } };
      let params = call.params; let rpcSecret;
      if (Array.isArray(params) && typeof params[0] === 'string' && params[0].startsWith('token:')) { rpcSecret = params[0].slice(6); params = params.slice(1); }
      try { return { jsonrpc: '2.0', id: call.id != null ? call.id : null, result: await client.invoke(call.method, params, { ...context, rpcSecret }) }; }
      catch (error) { return { jsonrpc: '2.0', id: call.id != null ? call.id : null, error: { code: error.code || error.rpcCode || 1, message: error.message || String(error), ...(error.details !== undefined ? { details: error.details } : {}) } }; }
    };
    if (Array.isArray(payload)) { const output = []; for (const call of payload) output.push(await execute(call)); reply(output); return; }
    reply(await execute(payload));
  };
}

function createWebApiServer(options) { return http.createServer(createWebRequestHandler(options)); }

module.exports = { createWebApiServer, createWebRequestHandler, staticFilePath, serveStatic };
