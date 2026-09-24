'use strict';

const STATES = Object.freeze(['probing', 'metadata', 'ready', 'committing', 'committed', 'failed', 'cancelled', 'expired']);
const TERMINAL = new Set(['committed', 'cancelled', 'expired']);
const TRANSITIONS = Object.freeze({ probing: ['metadata', 'ready', 'failed', 'cancelled', 'expired'], metadata: ['ready', 'failed', 'cancelled', 'expired'], ready: ['committing', 'cancelled', 'expired', 'failed'], committing: ['committed', 'ready', 'failed'], failed: ['probing', 'metadata', 'ready', 'cancelled', 'expired'], committed: [], cancelled: [], expired: [] });

function assertDraftTransition(from, to) { if (from === to) return true; if (!STATES.includes(from) || !STATES.includes(to) || !TRANSITIONS[from].includes(to)) { const error = new Error(`invalid draft transition: ${from} -> ${to}`); error.code = 'INVALID_DRAFT_TRANSITION'; throw error; } return true; }
function isDraftTerminal(state) { return TERMINAL.has(state); }

module.exports = { STATES, TERMINAL, TRANSITIONS, assertDraftTransition, isDraftTerminal };
