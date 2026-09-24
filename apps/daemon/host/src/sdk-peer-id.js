'use strict';
const fs = require('fs');
const path = require('path');

// XLSDK 实际 crashinfo.ini 中是短的持久化标识；只允许单 token，避免把整行配置误当 peer id。
const PEER_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function candidatePaths(winePrefix) {
  if (!winePrefix) return [];
  const usersDir = path.join(winePrefix, 'drive_c', 'users');
  let users = [];
  try { users = fs.readdirSync(usersDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
  return users.flatMap((user) => [
    path.join(usersDir, user, 'AppData', 'Local', 'Temp', 'Thunder Network', 'XLSDK', 'crashinfo.ini'),
    path.join(usersDir, user, 'Temp', 'Thunder Network', 'XLSDK', 'crashinfo.ini'),
  ]);
}

function parsePeerId(text) {
  const match = String(text).split(/\r?\n/).map((line) => line.trim())
    .find((line) => /^peerid\s*=/i.test(line));
  if (!match) return null;
  const value = match.slice(match.indexOf('=') + 1).trim();
  return PEER_ID_PATTERN.test(value) ? value : undefined;
}

function readOne(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { return { ok: false, reason: e.code === 'ENOENT' ? 'not-found' : 'unreadable' }; }
  const peerId = parsePeerId(text);
  if (peerId === undefined) return { ok: false, reason: 'invalid' };
  if (!peerId) return { ok: false, reason: 'missing' };
  return { ok: true, peerId, source: filePath };
}

function readSdkPeerId({ explicitPath, winePrefix } = {}) {
  const candidates = [];
  if (explicitPath) candidates.push(path.resolve(explicitPath));
  candidates.push(...candidatePaths(winePrefix));
  if (!candidates.length) return { ok: false, reason: 'not-found' };
  for (const filePath of [...new Set(candidates)]) {
    const result = readOne(filePath);
    if (result.ok) return result;
    // 显式路径是操作者指定的权威来源；存在但损坏时不静默换另一份 peer id。
    if (filePath === candidates[0] && explicitPath && result.reason !== 'not-found') return result;
  }
  return { ok: false, reason: 'not-found' };
}

module.exports = { PEER_ID_PATTERN, readSdkPeerId, parsePeerId };
