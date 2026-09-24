'use strict';

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const archiver = require('archiver');
const { redact, redactError, redactPath } = require('../security/log-redactor');

function problem(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

class DiagnosticsService {
  constructor({
    config = {}, tasks = null, driver = null, settings = null, events = null,
    privateSpace = null, media = null, remoteNodes = null, taskDbReader = null,
    operations = null, policy = null, auth = null, vip = null,
    startedAt = Date.now(), clock = Date, exportTtlMs = 10 * 60 * 1000,
  } = {}) {
    this.config = config;
    this.tasks = tasks;
    this.driver = driver;
    this.settings = settings;
    this.events = events;
    this.privateSpace = privateSpace;
    this.media = media;
    this.remoteNodes = remoteNodes;
    this.taskDbReader = taskDbReader;
    this.operations = operations;
    this.policy = policy;
    this.auth = auth;
    this.vip = vip;
    this.startedAt = startedAt;
    this.clock = clock;
    this.exportTtlMs = exportTtlMs;
    this.exports = new Map();
  }

  _now() { return Number(this.clock?.now ? this.clock.now() : Date.now()); }
  _safePath(value, options = {}) { return value ? redactPath(value, options) : null; }
  _taskList() { return this.tasks?.list?.() || []; }
  _counts(records = this._taskList()) {
    return {
      total: records.length,
      active: records.filter((item) => ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(item.lifecycle)).length,
      completed: records.filter((item) => item.lifecycle === 'completed').length,
      failed: records.filter((item) => item.lifecycle === 'failed').length,
      recycled: records.filter((item) => item.lifecycle === 'recycled').length,
    };
  }

  async getSystemSnapshot() {
    const records = this._taskList();
    const settings = this.settings?.get?.() || { revision: 0, desired: {} };
    const engine = {
      healthy: Boolean(this.driver?.isHealthy?.()),
      pid: this.driver?.enginePid?.() || null,
      generation: Number(this.driver?._generation || this.driver?.generation) || 0,
      restarts: Number(this.driver?.restarts) || 0,
      sdkReady: this.driver?.sdkReady === true,
    };
    const taskDb = this.taskDbReader && typeof this.taskDbReader.snapshot === 'function'
      ? await Promise.resolve(this.taskDbReader.snapshot()).catch((error) => ({ readable: false, problem: redactError(error) }))
      : { readable: null };
    const authStatus = this.auth?.getStatus ? await this.auth.getStatus({ refresh: false }).catch(() => null) : null;
    const vipStatus = this.vip?.getStatus ? await this.vip.getStatus().catch(() => null) : null;
    return redact({
      apiVersion: 2,
      daemonVersion: this.config.version || '0.0.0',
      startedAt: this.startedAt,
      now: this._now(),
      hostname: os.hostname(),
      repository: { revision: this.tasks?.repositoryRevision || 0, counts: this._counts(records) },
      repositoryRevision: this.tasks?.repositoryRevision || 0,
      // Keep the old flat counts field for existing WebUI contracts.
      counts: this._counts(records),
      engine,
      taskDb,
      auth: authStatus ? { account: authStatus.account, session: authStatus.session, token: authStatus.token } : null,
      vip: vipStatus ? { enabled: vipStatus.enabled, accountReady: vipStatus.accountReady, isVip: vipStatus.isVip, tasks: Array.isArray(vipStatus.tasks) ? vipStatus.tasks.length : 0 } : null,
      privateSpace: this.privateSpace?.getStatus?.() || { configured: false, unlocked: false },
      media: this.media?.getCapabilities?.() || { openOnHost: false, streamInBrowser: false },
      remoteNodes: this.remoteNodes?.query?.() || { items: [] },
      policy: this.policy?.get?.() || null,
      settings: { revision: settings.revision || 0, downloadDir: this._safePath(settings.desired?.downloadDir, { privateRoot: this.config.privateSpaceDir }) },
      filesystem: { platform: process.platform, freeMemory: os.freemem(), totalMemory: os.totalmem() },
      events: this.events?.snapshot?.(100) || this.events?.list?.(100) || [],
    });
  }

  // Backwards-compatible name used by the first V2 diagnostics page.
  async snapshot() { return this.getSystemSnapshot(); }

  async getTaskDiagnostics({ taskId } = {}, context = {}) {
    if (!taskId) throw problem('INVALID_ARGUMENT', 'taskId 必填');
    let task;
    try { task = this.tasks?.require?.(taskId); } catch { throw problem('TASK_NOT_FOUND', '任务不存在或已被删除'); }
    if (!task) throw problem('TASK_NOT_FOUND', '任务不存在或已被删除');
    if (task.privateSpace === true && !this.privateSpace?.authorize?.(context.privateSession || '')) throw problem('PRIVATE_SPACE_LOCKED', '私人空间已锁定');
    const files = Array.isArray(task.files) ? task.files.map((file) => ({ index: Number(file.index), path: path.basename(String(file.path || file.name || '')), size: Number(file.length || file.size || 0), completedBytes: Number(file.completedBytes || file.receivedBytes || 0), selected: file.selected !== false })) : [];
    const events = (this.events?.query?.({ limit: 100 }) || this.events?.list?.(100) || []).filter((event) => !event.taskId || String(event.taskId) === String(taskId) || event.payload?.taskId === taskId);
    return redact({
      taskId: String(task.id), displayName: task.privateSpace ? '私人空间任务' : task.displayName,
      lifecycle: task.lifecycle, revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt,
      error: task.error ? { code: task.error.code, category: task.error.category, retryable: task.error.retryable, message: task.error.message } : null,
      source: task.privateSpace ? null : task.source,
      savePath: this._safePath(task.savePath, { privateRoot: this.config.privateSpaceDir }), files,
      timeline: events, operation: this.operations?.findByTask?.(task.id) || [],
      engine: { generation: Number(this.driver?._generation || this.driver?.generation) || 0, healthy: Boolean(this.driver?.isHealthy?.()) },
      taskDb: this.taskDbReader?.readTask ? await Promise.resolve(this.taskDbReader.readTask(task.id)).catch((error) => ({ readable: false, problem: redactError(error) })) : null,
    });
  }

  queryEvents(request = {}) {
    if (this.events?.query) return this.events.query(request);
    return this.events?.list?.(request.limit) || [];
  }

  async runCheck({ checkId, taskId } = {}, context = {}) {
    const id = String(checkId || '');
    if (!['engine', 'filesystem', 'task-repository', 'media', 'remote', 'task'].includes(id)) throw problem('DIAGNOSTIC_CHECK_UNKNOWN', '诊断检查项不存在');
    if (id === 'task') {
      if (!taskId) return { checkId: id, ok: false, details: { code: 'TASK_ID_REQUIRED' } };
      try { await this.getTaskDiagnostics({ taskId }, context); return { checkId: id, ok: true }; }
      catch (error) { return { checkId: id, ok: false, details: { code: error.code || 'TASK_DIAGNOSTIC_FAILED', message: error.message } }; }
    }
    if (id === 'engine') return { checkId: id, ok: Boolean(this.driver?.isHealthy?.()), details: { sdkReady: this.driver?.sdkReady === true } };
    if (id === 'filesystem') {
      const target = this.config.downloadDir || this.settings?.get?.().desired?.downloadDir;
      let writable = false;
      try { require('node:fs').accessSync(target, require('node:fs').constants.W_OK); writable = true; } catch {}
      return { checkId: id, ok: writable, details: { path: this._safePath(target) } };
    }
    if (id === 'task-repository') return { checkId: id, ok: Boolean(this.tasks?.list), details: { revision: this.tasks?.repositoryRevision || 0 } };
    if (id === 'media') return { checkId: id, ok: this.media?.getCapabilities?.().streamInBrowser === true, details: this.media?.getCapabilities?.() || {} };
    return { checkId: id, ok: (this.remoteNodes?.query?.().items || []).every((node) => node.state !== 'incompatible'), details: this.remoteNodes?.query?.() || { items: [] } };
  }

  _newExportId() { return `diagnostic-${this._now().toString(36)}-${crypto.randomBytes(6).toString('base64url')}`; }

  async prepareExport({ taskIds = [], includeLogs = true, includeTaskDbSchema = false } = {}, context = {}) {
    const ids = Array.isArray(taskIds) ? [...new Set(taskIds.map(String))].slice(0, 100) : [];
    const system = await this.getSystemSnapshot();
    const payload = {
      manifestVersion: 1,
      generatedAt: this._now(),
      // Keep the original top-level snapshot fields as well as the explicit
      // system envelope so older V2 diagnostic clients can still parse an
      // export prepared by a newer daemon.
      ...system,
      system,
      tasks: [],
      events: includeLogs ? this.queryEvents({ limit: 100 }) : [],
      taskDbSchema: includeTaskDbSchema ? await Promise.resolve(this.taskDbReader?.schema?.()).catch((error) => ({ problem: redactError(error) })) : null,
    };
    for (const taskId of ids) payload.tasks.push(await this.getTaskDiagnostics({ taskId }, context));
    const exportId = this._newExportId();
    const expiresAt = this._now() + this.exportTtlMs;
    const manifest = {
      exportId, expiresAt, format: 'zip', contentType: 'application/zip', files: ['diagnostics.json'],
      entries: [{ name: 'diagnostics.json', contentType: 'application/json', redaction: 'strict' }],
      warnings: ['已删除 token、密码、证书、私人字段和完整路径'],
    };
    this.exports.set(exportId, { payload: redact(payload), manifest });
    return { ...manifest };
  }

  getManifest(exportId) {
    const value = this._getExport(exportId);
    return { ...value.manifest };
  }

  _getExport(exportId) {
    const value = this.exports.get(String(exportId));
    if (!value || value.manifest.expiresAt <= this._now()) {
      this.exports.delete(String(exportId));
      throw problem('DIAGNOSTIC_EXPORT_EXPIRED', '诊断导出已过期');
    }
    return value;
  }

  async exportPayload(exportId) { return this._getExport(exportId).payload; }

  async createArchive(exportId, writable) {
    if (!writable || typeof writable.write !== 'function') throw problem('INVALID_ARGUMENT', '诊断导出目标不可写');
    const value = this._getExport(exportId);
    return new Promise((resolve, reject) => {
      const ZipArchive = archiver.ZipArchive || archiver.default?.ZipArchive;
      if (!ZipArchive) return reject(problem('DIAGNOSTIC_ARCHIVE_UNAVAILABLE', '诊断 ZIP 组件不可用'));
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', reject);
      writable.on?.('error', reject);
      archive.on('end', resolve);
      archive.pipe(writable);
      archive.append(JSON.stringify(value.payload, null, 2), { name: 'diagnostics.json' });
      const finalized = archive.finalize();
      if (finalized && typeof finalized.catch === 'function') finalized.catch(reject);
    });
  }

  cancel(exportId) { return this.exports.delete(String(exportId)); }
  cleanupExpired() { for (const [id, value] of this.exports) if (value.manifest.expiresAt <= this._now()) this.exports.delete(id); }
}

module.exports = { DiagnosticsService };
