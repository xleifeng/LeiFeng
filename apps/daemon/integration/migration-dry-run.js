#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function inspect(file) {
  if (!fs.existsSync(file)) return { path: file, exists: false };
  let parsed = null; let parseError = null;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { parseError = error.message; }
  return {
    path: file,
    exists: true,
    sha256: sha256(file),
    bytes: fs.statSync(file).size,
    schemaVersion: parsed?.schemaVersion || (Array.isArray(parsed) ? 1 : null),
    taskCount: Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.tasks) ? parsed.tasks.length : 0,
    parseError,
  };
}

function hasLegacyBackup(file) {
  if (!fs.existsSync(file)) return false;
  try {
    const prefix = `${path.basename(file)}.v1-backup-`;
    return fs.readdirSync(path.dirname(file)).some((name) => name.startsWith(prefix));
  } catch { return false; }
}

function parseArgs(argv) {
  const result = { runtime: process.env.THUNDERD_RUNTIME_DIR || path.resolve(__dirname, '..', '.runtime'), output: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runtime') result.runtime = path.resolve(argv[++i] || result.runtime);
    else if (argv[i] === '--output') result.output = path.resolve(argv[++i] || '');
    else throw new Error('usage: migration-dry-run.js [--runtime <dir>] [--output <manifest.json>]');
  }
  return result;
}

function main(argv) {
  const { runtime, output } = parseArgs(argv);
  const legacy = inspect(path.join(runtime, 'registry.json'));
  const v2 = inspect(path.join(runtime, 'data', 'tasks.json'));
  const checks = {
    legacyReadable: !legacy.exists || !legacy.parseError,
    v2Readable: !v2.exists || !v2.parseError,
    noTaskLossInExistingV2: !legacy.exists || !v2.exists || v2.taskCount >= legacy.taskCount,
    backupReady: !legacy.exists || hasLegacyBackup(legacy.path),
  };
  const manifest = {
    fromVersion: legacy.exists ? 'legacy-registry' : 'none',
    toVersion: 'v2-task-repository',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    dryRun: true,
    originalFiles: [legacy, v2].filter((item) => item.exists).map((item) => ({ path: item.path, sha256: item.sha256 })),
    createdFiles: [],
    checks,
    verified: Object.values(checks).every(Boolean),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 }); fs.writeFileSync(output, text, { mode: 0o600 }); }
  process.stdout.write(text);
  if (!manifest.verified) process.exitCode = 1;
}

try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
