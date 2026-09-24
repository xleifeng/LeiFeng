'use strict';

const { redact } = require('../security/log-redactor');

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const CATEGORIES = new Set(['daemon', 'engine', 'task', 'network', 'auth', 'vip', 'filesystem', 'policy', 'remote', 'security', 'diagnostic']);

/**
 * In-memory structured diagnostic buffer.  It deliberately never owns a file
 * descriptor: a production log sink may subscribe to the returned redacted
 * event, while the default stays bounded and safe for a long-running daemon.
 */
class DiagnosticEventBuffer {
  constructor({ max = 100, capacity, clock = Date, redactor = redact } = {}) {
    this.max = Math.max(1, Number(capacity ?? max) || 100);
    this.clock = clock;
    this.redactor = typeof redactor === 'function' ? redactor : redact;
    this.items = [];
    this.sequence = 0;
  }

  _now() { return Number(this.clock?.now ? this.clock.now() : Date.now()); }

  emit({ level = 'info', category = 'daemon', code, message, taskId = null, operationId = null, data = {}, type } = {}) {
    const safeLevel = LEVELS.has(level) ? level : 'info';
    const safeCategory = CATEGORIES.has(category) ? category : 'daemon';
    const at = this._now();
    const event = {
      sequence: ++this.sequence,
      id: `${at.toString(36)}-${this.sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at,
      level: safeLevel,
      category: safeCategory,
      code: String(code || type || 'EVENT'),
      message: String(message || type || '诊断事件').slice(0, 512),
      taskId: taskId == null ? null : String(taskId),
      operationId: operationId == null ? null : String(operationId),
      type: String(type || code || 'event'),
      data: this.redactor(data),
      payload: this.redactor(data),
    };
    this.items.push(event);
    while (this.items.length > this.max) this.items.shift();
    return this._clone(event);
  }

  // Compatibility shim for existing callers while all new producers can use
  // the explicit event shape above.
  record(type, payload = {}, level = 'info') {
    return this.emit({ type, code: type, category: 'daemon', level, message: type, data: payload });
  }

  _clone(value) { return JSON.parse(JSON.stringify(value)); }

  query({ afterSequence = 0, category, level, limit = this.max } = {}) {
    const max = Math.max(1, Math.min(this.max, Number(limit) || this.max));
    return this.items
      .filter((item) => Number(item.sequence) > Number(afterSequence || 0))
      .filter((item) => !category || item.category === category)
      .filter((item) => !level || item.level === level)
      .slice(-max)
      .map((item) => this._clone(item));
  }

  snapshot(limit = this.max) { return this.query({ limit }); }
  list(limit = this.max) { return this.snapshot(limit); }
}

module.exports = { DiagnosticEventBuffer };
