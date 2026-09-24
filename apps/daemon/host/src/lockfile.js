'use strict';

const fs = require('fs');
const path = require('path');

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function parsePid(contents) {
  const value = String(contents).trim();
  if (!/^\d+$/.test(value)) return 0;
  const pid = Number(value);
  return Number.isSafeInteger(pid) ? pid : 0;
}

function acquireLock(lockPath, pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new TypeError('lock PID must be a positive safe integer');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // O_EXCL is the ownership primitive.  If a stale lock is found, remove it
  // and retry the exclusive create instead of truncating a file another
  // contender may have just acquired.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o644);
      try {
        fs.writeSync(fd, String(pid));
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let old;
      try {
        old = parsePid(fs.readFileSync(lockPath, 'utf8'));
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        throw readError;
      }
      if (isPidAlive(old)) return false;
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code === 'ENOENT') continue;
        throw unlinkError;
      }
    }
  }
  return false;
}

function releaseLock(lockPath, pid) {
  // When the owner is known, do not let an old process remove a replacement
  // lock after a stale-lock takeover.  The optional argument preserves the
  // original releaseLock(path) API used by callers/tests.
  if (pid !== undefined) {
    let owner;
    try {
      owner = parsePid(fs.readFileSync(lockPath, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
    if (owner !== pid) return false;
  }
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

module.exports = { acquireLock, releaseLock, isPidAlive, parsePid };
