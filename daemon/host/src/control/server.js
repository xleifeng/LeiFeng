'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { FrameDecoder, encodeFrame, DEFAULT_MAX_FRAME_BYTES } = require('../../../../packages/daemon-client');

function rpcError(error) {
  return {
    code: Number.isInteger(error && error.rpcCode) ? error.rpcCode : -32000,
    message: error && error.message || String(error),
    data: { code: error && error.code || 'DAEMON_CONTROL_FAILED', ...(error && error.details !== undefined ? { details: error.details } : {}) },
  };
}

function invalidRequest(id, message = 'Invalid Request') {
  return { jsonrpc: '2.0', id: id == null ? null : id, error: { code: -32600, message, data: { code: 'CONTROL_REQUEST_INVALID' } } };
}

class DaemonControlServer {
  constructor({ socketPath, dispatch, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES, onDisconnect = null } = {}) {
    if (!socketPath || typeof dispatch !== 'function') throw new Error('DaemonControlServer dependencies are incomplete');
    this.socketPath = socketPath;
    this.dispatch = dispatch;
    this.maxFrameBytes = maxFrameBytes;
    this.onDisconnect = onDisconnect;
    this.server = null;
    this.connections = new Set();
  }

  start() {
    if (this.server) return this.server;
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    try { fs.rmSync(this.socketPath, { force: true }); } catch {}
    this.server = net.createServer((socket) => this._accept(socket));
    this.server.listen(this.socketPath, () => {
      try { fs.chmodSync(this.socketPath, 0o600); } catch {}
    });
    return this.server;
  }

  _accept(socket) {
    const connection = { id: crypto.randomUUID(), socket, openedAt: Date.now() };
    this.connections.add(connection);
    const decoder = new FrameDecoder({ maxFrameBytes: this.maxFrameBytes, onMessage: (request) => {
      this._dispatch(request, connection).catch((error) => {
        if (!socket.destroyed) socket.write(encodeFrame({ jsonrpc: '2.0', id: request && request.id || null, error: rpcError(error) }, { maxFrameBytes: this.maxFrameBytes }));
      });
    } });
    socket.on('data', (chunk) => {
      try { decoder.push(chunk); }
      catch (error) {
        if (!socket.destroyed) socket.write(encodeFrame({ jsonrpc: '2.0', id: null, error: rpcError(error) }, { maxFrameBytes: this.maxFrameBytes }), () => socket.destroy());
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      this.connections.delete(connection);
      if (typeof this.onDisconnect === 'function') Promise.resolve(this.onDisconnect(connection)).catch(() => {});
    });
  }

  async _dispatch(request, connection) {
    let response;
    if (!request || request.jsonrpc !== '2.0' || request.id == null || typeof request.method !== 'string') response = invalidRequest(request && request.id);
    else {
      try { response = { jsonrpc: '2.0', id: request.id, result: await this.dispatch(request.method, request.params || {}, connection) }; }
      catch (error) { response = { jsonrpc: '2.0', id: request.id, error: rpcError(error) }; }
    }
    if (!connection.socket.destroyed) connection.socket.write(encodeFrame(response, { maxFrameBytes: this.maxFrameBytes }));
  }

  async stop() {
    if (!this.server) return;
    for (const connection of this.connections) connection.socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    try { fs.rmSync(this.socketPath, { force: true }); } catch {}
  }
}

module.exports = { DaemonControlServer, rpcError, invalidRequest };
