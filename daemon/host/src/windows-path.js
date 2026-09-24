'use strict';

const path = require('node:path');

function normalizeDistroName(value) {
  const name = String(value || 'Ubuntu').trim();
  if (!name || /[\\/\0]/.test(name)) throw new Error('invalid WSL distribution name');
  return name;
}

function linuxToWindowsPath(value, { distroName = process.env.WSL_DISTRO_NAME || 'Ubuntu' } = {}) {
  const input = path.resolve(String(value || ''));
  const mounted = input.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mounted) {
    const tail = mounted[2] ? `\\${mounted[2].replaceAll('/', '\\')}` : '\\';
    return `${mounted[1].toUpperCase()}:${tail}`;
  }
  return `\\\\wsl.localhost\\${normalizeDistroName(distroName)}${input.replaceAll('/', '\\')}`;
}

function normalizeComparableEnginePath(value) {
  let normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  normalized = normalized.replace(/^\/{1,2}wsl(?:\.localhost|\$)\/[^/]+/, '');
  normalized = normalized.replace(/^z:/, '');
  normalized = normalized.replace(/^([a-z]):\//, '/mnt/$1/');
  return normalized || '/';
}

module.exports = { linuxToWindowsPath, normalizeComparableEnginePath, normalizeDistroName };
