'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventOutbox } = require('../../host/src/repositories/event-outbox');

test('outbox appends, replays per consumer and compacts after all acks', () => {
  const outbox = new EventOutbox({ maxEvents: 2, idFactory: (() => { let i = 0; return () => `e${++i}`; })() });
  const event = outbox.append({ type: 'task.created', taskId: 't1', requiredConsumers: ['history', 'links'] });
  assert.equal(event.sequence, 1);
  assert.equal(outbox.listUnacknowledged('history').length, 1);
  outbox.ack('history', 1);
  assert.equal(outbox.listUnacknowledged('links').length, 1);
  outbox.ack('links', 1);
  assert.equal(outbox.listUnacknowledged('links').length, 0);
  assert.equal(outbox.events.length, 0);
});

test('outbox protects durable facts when full', () => {
  const outbox = new EventOutbox({ maxEvents: 1 });
  outbox.append({ type: 'task.created', requiredConsumers: ['history'] });
  assert.throws(() => outbox.append({ type: 'task.deleted', requiredConsumers: ['history'] }), (error) => error.code === 'OUTBOX_FULL');
});
