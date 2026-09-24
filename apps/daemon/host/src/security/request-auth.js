'use strict';

const crypto = require('node:crypto');

const READ_ONLY_METHOD = /\.(?:bootstrap|query|counts|get|capabilities|mediaCapabilities|listRecent|validate|system\.get|events\.query|exports\.getManifest)$/;

function sameOrigin(origin, allowedOrigin) {
  return Boolean(origin && allowedOrigin && String(origin) === String(allowedOrigin));
}

class RequestAuth {
  constructor({ enabled = true, clock = Date, ttlMs = 8 * 60 * 60 * 1000, idleMs = 30 * 60 * 1000, maxSessions = 1024 } = {}) {
    this.enabled = enabled !== false;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.idleMs = idleMs;
    this.maxSessions = Math.max(16, Number(maxSessions) || 1024);
    this.sessions = new Map();
  }

  _now() { return Number(this.clock?.now ? this.clock.now() : Date.now()); }
  _digest(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
  _origin(origin, host, port) { return origin || `http://${host || '127.0.0.1'}:${port || 0}`; }

  issue({ principalId = 'loopback', origin, host = '127.0.0.1', port } = {}) {
    this._prune();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this._now();
    const session = { tokenDigest: this._digest(token), principalId: String(principalId), origin: this._origin(origin, host, port), expiresAt: now + this.ttlMs, lastUsedAt: now };
    this.sessions.set(session.tokenDigest, session);
    while (this.sessions.size > this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    return { token, expiresAt: session.expiresAt };
  }

  _prune(now = this._now()) {
    for (const [digest, session] of this.sessions) if (session.expiresAt <= now || session.lastUsedAt + this.idleMs <= now) this.sessions.delete(digest);
  }

  assertCsrf({ token, principalId = 'loopback', origin, host = '127.0.0.1', port, isLoopback = false, required = true } = {}) {
    if (!this.enabled || !required) return { ok: true };
    // Command-line clients on the daemon's loopback listener do not have a
    // browser Origin and are already constrained by the loopback boundary
    // plus Bearer authentication. Browser-origin mutations still require the
    // exact Origin-bound session below.
    if (isLoopback && !origin) return { ok: true };
    this._prune();
    const session = this.sessions.get(this._digest(token));
    if (!session || session.principalId !== String(principalId) || !sameOrigin(origin, session.origin)) {
      const error = new Error('CSRF 校验失败'); error.code = 'CSRF_INVALID'; throw error;
    }
    session.lastUsedAt = this._now();
    return { ok: true, expiresAt: session.expiresAt };
  }

  isMutation(method) {
    return /^thunder\.ui\.v2\./.test(String(method || '')) && !READ_ONLY_METHOD.test(String(method || ''));
  }

  assertRpc({ method, csrfToken, principalId, origin, host, port, userAgent = '', clientType = '', isLoopback = false } = {}) {
    if (this.enabled && this.isMutation(method) && !origin && !isLoopback) {
      const error = new Error('非 loopback 请求必须提供 Origin'); error.code = 'ORIGIN_REQUIRED'; throw error;
    }
    const browserRequest = Boolean(origin);
    if (!browserRequest || !this.isMutation(method)) return { ok: true };
    return this.assertCsrf({ token: csrfToken, principalId, origin, host, port });
  }

  revoke(token) { return this.sessions.delete(this._digest(token)); }
  snapshot() { this._prune(); return [...this.sessions.values()].map(({ tokenDigest, ...rest }) => ({ ...rest, tokenDigest: `${tokenDigest.slice(0, 8)}…` })); }
}

module.exports = { RequestAuth, sameOrigin };
