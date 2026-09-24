'use strict';

const { Readable, Writable } = require('node:stream');
const { once } = require('node:events');

class MemoryResponse extends Writable {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.headersSent = false; this.chunks = []; }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])); this.headersSent = true; return this; }
  body() { return Buffer.concat(this.chunks); }
}

async function invokeHttp(handler, { method = 'GET', url = '/', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
  const chunks = body === null || body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(String(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  req.socket = { remoteAddress };
  const res = new MemoryResponse();
  const finished = once(res, 'finish');
  await Promise.resolve(handler(req, res));
  await finished;
  return { status: res.statusCode, headers: res.headers, body: res.body() };
}

module.exports = { MemoryResponse, invokeHttp };
