'use strict';

class RateLimiter {
  constructor({ limit = 60, windowMs = 60 * 1000, clock = Date, buckets = {} } = {}) {
    this.limit = Math.max(1, Number(limit) || 60);
    this.windowMs = Math.max(1, Number(windowMs) || 60 * 1000);
    this.clock = clock;
    this.buckets = new Map();
    this.rules = new Map(Object.entries(buckets || {}).map(([name, rule]) => [name, {
      limit: Math.max(1, Number(rule.limit) || this.limit),
      windowMs: Math.max(1, Number(rule.windowMs) || this.windowMs),
      concurrency: rule.concurrency == null ? null : Math.max(1, Number(rule.concurrency) || 1),
    }]));
  }

  _now() { return Number(this.clock?.now ? this.clock.now() : Date.now()); }
  _rule(bucket) { return this.rules.get(String(bucket || 'default')) || { limit: this.limit, windowMs: this.windowMs, concurrency: null }; }
  _key(bucket, principalId) { return `${String(bucket || 'default')}:${String(principalId || 'anonymous')}`; }

  check({ bucket = 'default', principalId = 'anonymous', cost = 1 } = {}) {
    const rule = this._rule(bucket); const now = this._now(); const key = this._key(bucket, principalId);
    const current = this.buckets.get(key) || { startedAt: now, count: 0, active: 0 };
    if (current.startedAt + rule.windowMs <= now) { current.startedAt = now; current.count = 0; }
    const requested = Math.max(1, Number(cost) || 1);
    const allowed = current.count + requested <= rule.limit && (rule.concurrency == null || current.active < rule.concurrency);
    const retryAfterMs = allowed ? 0 : Math.max(1, current.startedAt + rule.windowMs - now);
    if (allowed) { current.count += requested; current.active += rule.concurrency == null ? 0 : 1; }
    this.buckets.set(key, current);
    return { allowed, retryAfterMs, remaining: Math.max(0, rule.limit - current.count), limit: rule.limit };
  }

  releaseConcurrency({ bucket = 'default', principalId = 'anonymous' } = {}) {
    const key = this._key(bucket, principalId); const current = this.buckets.get(key); if (current) current.active = Math.max(0, current.active - 1);
  }

  allow(key) { return this.check({ principalId: key }).allowed; }
  snapshot() { return [...this.buckets.entries()].map(([key, value]) => ({ key, ...value })); }
  reset(key) {
    const value = String(key || 'anonymous');
    for (const bucket of [...this.buckets.keys()]) if (bucket.endsWith(`:${value}`) || bucket === value) this.buckets.delete(bucket);
  }
}

module.exports = { RateLimiter };
