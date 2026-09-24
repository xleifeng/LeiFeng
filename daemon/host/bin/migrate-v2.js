#!/usr/bin/env node
'use strict';

// V2 task-repository migration gate.
//
// The command is deliberately explicit about the runtime and mode.  It never
// removes registry.json; --apply creates a byte-for-byte rollback copy first,
// writes data/tasks.json atomically, and records every input/output hash in the
// manifest.  This keeps the cutover reversible until real-engine acceptance is
// complete.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeTaskRecord, SCHEMA_VERSION } = require('../src/repositories/task-repository');

function fail(message, code = 2) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`无法读取 JSON ${file}: ${error.message}`, 1);
  }
}

function inspect(file) {
  if (!fs.existsSync(file)) return { path: file, exists: false };
  let parsed = null;
  let parseError = null;
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

function parseArgs(argv) {
  const result = { runtime: '', mode: '', report: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runtime') result.runtime = path.resolve(argv[++i] || '');
    else if (arg === '--dry-run') result.mode = 'dry-run';
    else if (arg === '--apply') result.mode = 'apply';
    else if (arg === '--verify') result.mode = 'verify';
    else if (arg === '--report') result.report = path.resolve(argv[++i] || '');
    else fail('usage: migrate-v2.js --runtime <dir> (--dry-run|--apply|--verify) [--report <manifest.json>]');
  }
  if (!result.runtime || !result.mode) fail('必须显式提供 --runtime 和一个迁移模式');
  return result;
}

function repoRoot() { return path.resolve(__dirname, '../../..'); }

function assertSafeRuntime(runtime) {
  const resolved = path.resolve(runtime);
  const home = path.resolve(process.env.HOME || '/nonexistent');
  const root = path.parse(resolved).root;
  const workspace = repoRoot();
  if (resolved === root || resolved === home || resolved === workspace)
    fail(`拒绝对不安全 runtime 执行迁移: ${resolved}`);
  if (!path.isAbsolute(resolved)) fail('runtime 必须是绝对路径');
  return resolved;
}

function filesFor(runtime) {
  return {
    runtime,
    legacy: path.join(runtime, 'registry.json'),
    v2: path.join(runtime, 'data', 'tasks.json'),
    rollbackDir: path.join(runtime, 'rollback-staging'),
    defaultReport: path.join(runtime, 'data', 'migration-manifest.json'),
  };
}

function findBackups(legacy) {
  const dir = path.dirname(legacy);
  const base = path.basename(legacy);
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.v1-backup-`))
      .map((name) => path.join(dir, name))
      .filter((file) => fs.statSync(file).isFile())
      .sort()
      .reverse();
  } catch { return []; }
}

function safeWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function buildChecks(files, legacy, v2, backups) {
  return {
    legacyReadable: !legacy.exists || !legacy.parseError,
    v2Readable: !v2.exists || !v2.parseError,
    noTaskLossInExistingV2: !legacy.exists || !v2.exists || v2.taskCount >= legacy.taskCount,
    rollbackBackupPresent: !legacy.exists || backups.length > 0,
    pathsScopedToRuntime: [files.legacy, files.v2, files.rollbackDir].every((file) => file === files.runtime || file.startsWith(`${files.runtime}${path.sep}`)),
  };
}

function baseManifest(files, legacy, v2, checks, mode) {
  const now = new Date().toISOString();
  return {
    fromVersion: legacy.exists ? 'legacy-registry' : 'none',
    toVersion: 'v2-task-repository',
    startedAt: now,
    completedAt: now,
    mode,
    dryRun: mode === 'dry-run',
    runtime: files.runtime,
    originalFiles: [legacy, v2].filter((item) => item.exists).map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes, taskCount: item.taskCount })),
    backupFiles: [],
    createdFiles: [],
    checks,
    verified: Object.values(checks).every(Boolean),
  };
}

function writeReport(report, manifest) {
  safeWriteJson(report, manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

function migrate(files, legacy, v2, manifest) {
  if (!legacy.exists) return manifest;
  if (v2.exists) {
    if (!manifest.checks.noTaskLossInExistingV2) fail('现有 V2 tasks.json 的任务数少于 legacy registry，拒绝覆盖', 1);
    let backups = findBackups(files.legacy);
    if (!backups.length) {
      const backup = `${files.legacy}.v1-backup-${Date.now()}`;
      fs.copyFileSync(files.legacy, backup, fs.constants.COPYFILE_EXCL);
      try { fs.chmodSync(backup, 0o600); } catch {}
      backups = [backup];
    }
    manifest.backupFiles.push(...backups.map((file) => ({ path: file, sha256: sha256(file), bytes: fs.statSync(file).size })));
    manifest.checks.rollbackBackupPresent = backups.length > 0;
    manifest.verified = Object.values(manifest.checks).every(Boolean);
    return manifest;
  }
  const source = readJson(files.legacy);
  if (!Array.isArray(source)) fail('legacy registry 必须是数组', 1);
  const timestamp = Date.now();
  const backup = `${files.legacy}.v1-backup-${timestamp}`;
  fs.copyFileSync(files.legacy, backup, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(backup, 0o600); } catch {}
  manifest.backupFiles.push({ path: backup, sha256: sha256(backup), bytes: fs.statSync(backup).size });

  const idFactory = () => crypto.randomBytes(8).toString('hex');
  const tasks = source.map((item) => normalizeTaskRecord(item, { idFactory }));
  tasks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  tasks.forEach((task, index) => { task.queuePosition = index; });
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision: tasks.length ? 1 : 0,
    writtenAt: Date.now(),
    tasks,
    outbox: [],
    outboxSequence: 0,
  };
  safeWriteJson(files.v2, payload);
  const created = inspect(files.v2);
  manifest.createdFiles.push({ path: created.path, sha256: created.sha256, bytes: created.bytes, taskCount: created.taskCount });
  manifest.checks.rollbackBackupPresent = true;
  manifest.checks.noTaskLossInExistingV2 = created.taskCount >= legacy.taskCount;
  manifest.verified = Object.values(manifest.checks).every(Boolean);
  if (!manifest.verified) fail('迁移后校验失败，V2 文件已写入但 manifest 未验证', 1);
  return manifest;
}

function verifyManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) fail(`manifest 不存在: ${manifestPath}`, 1);
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.toVersion !== 'v2-task-repository' || !Array.isArray(manifest.originalFiles)) fail('manifest 格式无效', 1);
  for (const file of [...(manifest.originalFiles || []), ...(manifest.backupFiles || []), ...(manifest.createdFiles || [])]) {
    if (!file.path || !fs.existsSync(file.path) || sha256(file.path) !== file.sha256) fail(`manifest hash 校验失败: ${file.path}`, 1);
  }
  if (manifest.verified !== true) fail('manifest 未标记为 verified', 1);
  process.stdout.write(`${JSON.stringify({ ...manifest, verified: true }, null, 2)}\n`);
  return true;
}

function main(argv) {
  const args = parseArgs(argv);
  const runtime = assertSafeRuntime(args.runtime);
  const files = filesFor(runtime);
  const report = args.report || files.defaultReport;
  if (args.mode === 'verify') return verifyManifest(report);

  const legacy = inspect(files.legacy);
  const v2 = inspect(files.v2);
  const backups = findBackups(files.legacy);
  const checks = buildChecks(files, legacy, v2, backups);
  const manifest = baseManifest(files, legacy, v2, checks, args.mode);
  if (args.mode === 'dry-run') {
    writeReport(report, manifest);
    if (!manifest.verified) process.exitCode = 1;
    return;
  }
  if (args.mode !== 'apply') fail('未知迁移模式');
  if (!manifest.checks.legacyReadable || !manifest.checks.v2Readable || !manifest.checks.noTaskLossInExistingV2)
    fail('迁移前检查未通过，未修改 runtime', 1);
  migrate(files, legacy, v2, manifest);
  writeReport(report, manifest);
  if (!manifest.verified) process.exitCode = 1;
}

try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 2; }
