'use strict';

const { EventEmitter } = require('events');

class DomainEventBus {
  constructor() { this.emitter = new EventEmitter(); this.emitter.setMaxListeners(100); }
  on(type, listener) { this.emitter.on(type, listener); return () => this.emitter.off(type, listener); }
  once(type, listener) { this.emitter.once(type, listener); return () => this.emitter.off(type, listener); }
  emit(type, event) { return this.emitter.emit(type, event); }
  close() { this.emitter.removeAllListeners(); }
}

module.exports = { DomainEventBus };
