'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { FrameDecoder, encodeFrame, DEFAULT_MAX_FRAME_BYTES } = require('./framing');

function daemonError(payload, fallback = 'daemon control request failed') {
  const data = payload && payload.data || {};
  const error = new Error(payload && payload.message || fallback);
  error.code = data.code || 'DAEMON_CONTROL_FAILED';
  error.details = data.details;
  error.rpcCode = payload && payload.code;
  return error;
}

class DaemonClient extends EventEmitter {
  constructor({ socketPath, requestTimeoutMs = 120000, connectTimeoutMs = 10000, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
    super();
    if (!socketPath) throw new Error('DaemonClient requires socketPath');
    this.socketPath = socketPath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.maxFrameBytes = maxFrameBytes;
    this.socket = null;
    this.connecting = null;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async connect() {
    if (this.closed) throw daemonError({ message: 'daemon client is closed', data: { code: 'DAEMON_CLIENT_CLOSED' } });
    if (this.socket && !this.socket.destroyed) return this.socket;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const timer = setTimeout(() => socket.destroy(daemonError({ message: 'daemon control connection timed out', data: { code: 'DAEMON_CONNECT_TIMEOUT' } })), this.connectTimeoutMs);
      const decoder = new FrameDecoder({ maxFrameBytes: this.maxFrameBytes, onMessage: (message) => this._onMessage(message) });
      const failConnect = (error) => { clearTimeout(timer); reject(error); };
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.off('error', failConnect);
        this.socket = socket;
        this.connecting = null;
        this.emit('connect');
        resolve(socket);
      });
      socket.once('error', failConnect);
      socket.on('data', (chunk) => {
        try { decoder.push(chunk); }
        catch (error) { socket.destroy(error); }
      });
      socket.on('error', (error) => this.emit('transportError', error));
      socket.on('close', () => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        if (this.connecting) this.connecting = null;
        this._rejectPending(daemonError({ message: 'daemon control connection closed', data: { code: 'DAEMON_CONNECTION_CLOSED' } }));
        this.emit('disconnect');
      });
    });
    return this.connecting;
  }

  _onMessage(message) {
    if (!message || message.jsonrpc !== '2.0' || message.id == null) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) pending.reject(daemonError(message.error));
    else pending.resolve(message.result);
  }

  _rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async call(method, params = {}) {
    const socket = await this.connect();
    const id = String(this.nextId++);
    const frame = encodeFrame({ jsonrpc: '2.0', id, method, params }, { maxFrameBytes: this.maxFrameBytes });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(daemonError({ message: `daemon control request timed out: ${method}`, data: { code: 'DAEMON_REQUEST_TIMEOUT' } }));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      socket.write(frame, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  health() { return this.call('daemon.v1.health'); }
  invoke(method, params, context = {}) { return this.call('daemon.v1.web.invoke', { method, params, context }); }
  importTorrent(input) { return this.call('daemon.v1.web.torrent.import', input); }
  exportTorrent(input) { return this.call('daemon.v1.web.torrent.export', input); }
  issueMediaToken(input) { return this.call('daemon.v1.web.media.issueToken', input); }
  openMedia(input) { return this.call('daemon.v1.web.media.open', input); }
  exportDiagnostics(input) { return this.call('daemon.v1.web.diagnostics.export', input); }
  releaseLease(leaseId) { return this.call('daemon.v1.web.lease.release', { leaseId }); }

  close() {
    this.closed = true;
    this._rejectPending(daemonError({ message: 'daemon client closed', data: { code: 'DAEMON_CLIENT_CLOSED' } }));
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}

module.exports = { DaemonClient, daemonError };
