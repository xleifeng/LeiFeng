'use strict';

class OperationLock {
  constructor() { this.chains = new Map(); }

  run(key, fn) {
    const normalized = String(key || 'global');
    const previous = this.chains.get(normalized) || Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.catch(() => {});
    this.chains.set(normalized, settled);
    settled.finally(() => {
      if (this.chains.get(normalized) === settled) this.chains.delete(normalized);
    });
    return next;
  }

  size() { return this.chains.size; }
}

module.exports = { OperationLock };
