'use strict';

// Service Definition: bridge orchestration depends on these capabilities only.
const RECIPIENT_METHODS = Object.freeze(['addTorrent', 'addMagnet', 'getTorrent', 'webseeds']);

function assertRecipient(value) {
  if (!value || RECIPIENT_METHODS.some((method) => typeof value[method] !== 'function')) {
    const error = new Error('Recipient provider must implement addTorrent, addMagnet, getTorrent and webseeds');
    error.code = 'RECIPIENT_INCOMPLETE';
    throw error;
  }
  return value;
}

function recipientError(error, fallback = 'RECIPIENT_FAILED') {
  const wrapped = new Error(error?.message || 'Recipient operation failed');
  wrapped.code = error?.code || fallback;
  wrapped.retryable = error?.retryable !== false;
  wrapped.cause = error;
  return wrapped;
}

module.exports = { RECIPIENT_METHODS, assertRecipient, recipientError };
