'use strict';
const { EventEmitter } = require('events');

class EngineClient extends EventEmitter {
  constructor() {
    super();
    this._sock = null;
    this._buf = '';
    this._seq = 0;
    this._pending = new Map();
  }
  attach(sock) {
    this._sock = sock;
    sock.setNoDelay(true);
    sock.on('data', (c) => this._onData(c));
    sock.on('close', () => this._onClose(sock));
    sock.on('error', () => {}); // 'close' 随之而来
  }
  isConnected() { return !!this._sock && !this._sock.destroyed; }
  request(method, params = {}, timeoutMs = 10000) {
    if (!this.isConnected()) return Promise.reject(new Error('engine not connected'));
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        const err = new Error(`engine command timeout: ${method}`);
        err.code = 'ETIMEDOUT'; // I3: Driver 按 code 判定受控重启，禁文案匹配
        reject(err);
      }, timeoutMs);
      if (timer.unref) timer.unref();
      this._pending.set(id, { resolve, reject, timer });
      this._sock.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  _onData(chunk) {
    this._buf += chunk.toString('utf8');
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i); this._buf = this._buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = this._pending.get(msg.id);
      if (!p) continue;
      this._pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'engine error'));
    }
  }
  _onClose(sock) {
    // I1 stale guard：旧 socket 的迟到 close 不影响新 socket 状态
    if (this._sock !== sock) return;
    for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new Error('engine connection closed')); }
    this._pending.clear();
    this._sock = null;
    this.emit('close');
  }
  close() { if (this._sock) this._sock.destroy(); }
}

module.exports = { EngineClient };
