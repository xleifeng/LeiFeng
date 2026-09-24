'use strict';

const path = require('path');

function invalidPath() {
  const error = new Error('torrent 文件路径无效');
  error.code = 'INVALID_TORRENT';
  return error;
}

function isForeignAbsolute(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[A-Za-z]:/.test(normalized)
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(normalized);
}

function normalizeRelative(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0')) return null;
  const normalized = raw.replace(/\\/g, '/');
  if (isForeignAbsolute(normalized)) return null;
  const parts = normalized.split('/');
  if (!parts.length || parts.some((part) => !part || part === '..' || part.includes('\0'))) return null;
  const clean = parts.filter((part) => part !== '.').join('/');
  return clean || null;
}

function normalizeDirectory(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0') || isForeignAbsolute(raw) || !/[\\/]$/.test(raw)) return null;
  return normalizeRelative(raw.replace(/[\\/]+$/, ''));
}

function safeRelative(value) {
  const normalized = normalizeRelative(value);
  if (!normalized) throw invalidPath();
  return normalized;
}

function foreignBasename(value) {
  let raw = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!isForeignAbsolute(raw)) return null;
  if (/^[A-Za-z]:/.test(raw)) raw = raw.slice(2);
  const base = path.posix.basename(raw);
  return normalizeRelative(base);
}

function selectTorrentRelativePath(file, index) {
  const input = file || {};
  const fileName = normalizeRelative(input.fileName);
  const directory = normalizeDirectory(input.filePath);
  if (directory && fileName) return `${directory}/${fileName}`;

  // Some SDK builds expose the complete relative filename in filePath, while
  // XL_ParseTorrentFileW normally exposes a trailing-slash directory here.
  const relativePath = normalizeRelative(input.filePath);
  if (relativePath) return relativePath;

  // Native SDK versions may return the original machine's absolute path in
  // filePath. Prefer the torrent fileName and never import that prefix.
  if (fileName) return fileName;

  const basename = foreignBasename(input.filePath) || foreignBasename(input.fileName);
  if (basename) return basename;

  // Missing path fields are tolerated because some SDK versions only expose
  // the file index and size. Malformed non-absolute paths are rejected.
  const hasPathValue = String(input.filePath || '').trim() || String(input.fileName || '').trim();
  if (hasPathValue) throw invalidPath();
  if (Number.isSafeInteger(Number(index)) && Number(index) >= 0) return `file-${Number(index)}`;
  throw invalidPath();
}

module.exports = { safeRelative, normalizeRelative, normalizeDirectory, selectTorrentRelativePath };
