'use strict';

const KINDS = new Set(['http', 'https', 'ftp', 'ed2k', 'thunder']);

const DEFAULT_POLICY = Object.freeze({ mode: 'always-preflight', maxSilentBytes: 0, allowedKinds: [...KINDS], pathMode: 'default', fixedPath: null });

function normalizePolicy(input = {}) {
  const mode = ['always-preflight', 'by-size', 'always-silent'].includes(input.mode) ? input.mode : DEFAULT_POLICY.mode;
  const maxSilentBytes = Number.isFinite(Number(input.maxSilentBytes)) ? Math.max(0, Number(input.maxSilentBytes)) : DEFAULT_POLICY.maxSilentBytes;
  const allowedKinds = Array.isArray(input.allowedKinds) ? [...new Set(input.allowedKinds.map(String).filter((kind) => KINDS.has(kind)))] : [...DEFAULT_POLICY.allowedKinds];
  const pathMode = ['default', 'last-used', 'fixed'].includes(input.pathMode) ? input.pathMode : DEFAULT_POLICY.pathMode;
  return { mode, maxSilentBytes, allowedKinds, pathMode, fixedPath: typeof input.fixedPath === 'string' && input.fixedPath.trim() ? input.fixedPath.trim() : null };
}

function decideOneKey({ kind, totalBytes, duplicate = null, pathCheck = {}, policy = DEFAULT_POLICY } = {}) {
  const normalized = normalizePolicy(policy);
  const reasons = [];
  if (normalized.mode === 'always-preflight') reasons.push('policy-preflight');
  if (!normalized.allowedKinds.includes(kind)) reasons.push('kind-not-allowed');
  if (kind === 'bt' || kind === 'magnet') reasons.push('file-tree-confirmation');
  if (duplicate) reasons.push('duplicate');
  if (totalBytes === null || totalBytes === undefined || !Number.isFinite(Number(totalBytes))) reasons.push('unknown-size');
  else if (normalized.mode === 'by-size' && Number(totalBytes) > normalized.maxSilentBytes) reasons.push('size-over-limit');
  if (!pathCheck.writable || !pathCheck.creatable) reasons.push('path-not-writable');
  return { silent: reasons.length === 0 && normalized.mode !== 'always-preflight', reasons, policy: normalized };
}

module.exports = { KINDS, DEFAULT_POLICY, normalizePolicy, decideOneKey };
