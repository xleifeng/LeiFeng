'use strict';

const SENSITIVE_KEY = /(?:accessToken|refreshToken|sessionId|peerId|authorization|token|cert|secret|password|cookie|privateKey|clientKey|proxy|uid|userId|credential)/i;
const SENSITIVE_VALUE = /^(?:(?:Bearer|Capture|Basic)\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const SECRET_QUERY_KEY = /^(?:access_token|refresh_token|token|secret|password|passwd|auth|authorization|session|session_id|cookie|sig|signature|key)$/i;

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    if (url.username || url.password) { url.username = '[REDACTED]'; url.password = '[REDACTED]'; }
    return url.toString();
  } catch {
    return String(value);
  }
}

function redactHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [
    key,
    SENSITIVE_KEY.test(key) || /^(?:x-thunder-private-session|x-thunder-csrf)$/i.test(key) ? '[REDACTED]' : redact(value, key),
  ]));
}

function redactError(error) {
  if (!error) return error;
  return redact({ name: error.name, code: error.code, message: error.message, details: error.details });
}

function redactPath(value, { privateRoot = '', allowedRoots = [] } = {}) {
  const input = String(value || '');
  const roots = [privateRoot, ...(Array.isArray(allowedRoots) ? allowedRoots : [])].filter(Boolean).map((item) => String(item));
  for (const root of roots) {
    if (input === root || input.startsWith(`${root}/`) || input.startsWith(`${root}\\`)) {
      const base = input.split(/[\\/]/).pop() || '';
      return `${input.startsWith(String(privateRoot)) ? '<private-path>' : '<allowed-root>'}/${base}`;
    }
  }
  return input.split(/[\\/]/).pop() || input;
}

function redact(value, key = '', depth = 0, seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(String(key))) return '[REDACTED]';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (SENSITIVE_VALUE.test(trimmed)) return '[REDACTED]';
    const bounded = value.length > 4096 ? `${value.slice(0, 4096)}…` : value;
    return /^https?:\/\//i.test(bounded) ? redactUrl(bounded) : bounded;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8 || seen.has(value)) return '[TRUNCATED]'; seen.add(value);
  const output = Array.isArray(value) ? value.map((item) => redact(item, '', depth + 1, seen)) : Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, depth + 1, seen)]));
  seen.delete(value); return output;
}

module.exports = { redact, SENSITIVE_KEY };
module.exports.redactUrl = redactUrl;
module.exports.redactHeaders = redactHeaders;
module.exports.redactError = redactError;
module.exports.redactPath = redactPath;
