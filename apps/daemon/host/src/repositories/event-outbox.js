'use strict';

const crypto = require('crypto');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class EventOutbox {
  constructor({ events = [], sequence = 0, maxEvents = 100000, clock = Date, idFactory } = {}) {
    this.clock = clock;
    this.maxEvents = maxEvents;
    this.idFactory = idFactory || (() => crypto.randomBytes(12).toString('hex'));
    this.events = Array.isArray(events) ? clone(events) : [];
    this.sequence = Number.isSafeInteger(Number(sequence)) ? Number(sequence) : 0;
  }

  hydrate({ events = [], sequence = 0 } = {}) {
    this.events = Array.isArray(events) ? clone(events) : [];
    this.sequence = Number.isSafeInteger(Number(sequence)) ? Number(sequence) : 0;
    return this;
  }

  isFull() { return this.events.length >= this.maxEvents; }

  append({ type, taskId = null, revision = null, payload = {}, requiredConsumers = [] } = {}) {
    if (this.isFull()) {
      const error = new Error('event outbox is full');
      error.code = 'OUTBOX_FULL';
      throw error;
    }
    const event = {
      id: this.idFactory(),
      sequence: ++this.sequence,
      type: String(type || 'task.updated'),
      taskId: taskId === undefined ? null : taskId,
      revision: Number.isSafeInteger(Number(revision)) ? Number(revision) : null,
      occurredAt: Number(this.clock.now ? this.clock.now() : Date.now()),
      payload: clone(payload) || {},
      requiredConsumers: [...new Set((Array.isArray(requiredConsumers) ? requiredConsumers : []).map(String))],
      ackedBy: [],
    };
    this.events.push(event);
    return clone(event);
  }

  listUnacknowledged(consumerName) {
    const name = String(consumerName || '');
    return this.events.filter((event) => event.requiredConsumers.includes(name) && !event.ackedBy.includes(name)).map(clone);
  }

  ack(consumerName, sequence) {
    const name = String(consumerName || '');
    const seq = Number(sequence);
    const event = this.events.find((item) => item.sequence === seq);
    if (!event) return false;
    if (event.requiredConsumers.includes(name) && !event.ackedBy.includes(name)) event.ackedBy.push(name);
    this.compact();
    return true;
  }

  compact() {
    this.events = this.events.filter((event) => event.requiredConsumers.some((consumer) => !event.ackedBy.includes(consumer)) || event.requiredConsumers.length === 0);
  }

  snapshot() { return { events: clone(this.events), sequence: this.sequence }; }
}

module.exports = { EventOutbox };
