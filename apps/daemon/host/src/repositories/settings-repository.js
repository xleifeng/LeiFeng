'use strict';

const fs = require('fs');
const path = require('path');
const { normalizePolicy } = require('../domain/one-key-download');
const { DEFAULT_DOWNLOAD_POLICY, normalizePolicy: normalizeDownloadPolicy, policyFromLegacy, legacyFromPolicy, validatePolicy } = require('../domain/download-policy');

const DEFAULT_SETTINGS = Object.freeze({
  downloadLimit: -1,
  uploadLimit: -1,
  connectionLimit: -1,
  maxTasks: 5,
  downloadDir: '',
  oneKey: normalizePolicy({}),
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDesired(input = {}, fallback = DEFAULT_SETTINGS) {
  return {
    downloadLimit: numberOr(input.downloadLimit, fallback.downloadLimit),
    uploadLimit: numberOr(input.uploadLimit, fallback.uploadLimit),
    connectionLimit: numberOr(input.connectionLimit, fallback.connectionLimit),
    maxTasks: Math.max(1, Math.min(1000, Math.trunc(numberOr(input.maxTasks, fallback.maxTasks)))),
    downloadDir: typeof input.downloadDir === 'string' ? input.downloadDir : fallback.downloadDir,
    oneKey: normalizePolicy({ ...(fallback.oneKey || {}), ...(input.oneKey || {}) }),
  };
}

class SettingsRepository {
  constructor({ filePath, clock = Date, log = console, defaults = {} } = {}) {
    if (!filePath) throw new Error('SettingsRepository filePath is required');
    this.filePath = filePath;
    this.clock = clock;
    this.log = log;
    this.defaults = normalizeDesired(defaults, DEFAULT_SETTINGS);
    this.state = {
      schemaVersion: 1,
      revision: 0,
      desired: clone(this.defaults),
      policy: policyFromLegacy(this.defaults, { ...DEFAULT_DOWNLOAD_POLICY, defaultDownloadPath: this.defaults.downloadDir }),
      applied: null,
      lastApplied: null,
      updatedAt: 0,
    };
    this.loaded = false;
    this.readOnly = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return this;
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!value || value.schemaVersion !== 1 || !value.desired) throw new Error('invalid settings schema');
      this.state = {
        schemaVersion: 1,
        revision: Math.max(0, Math.trunc(numberOr(value.revision, 0))),
        desired: normalizeDesired(value.desired, this.defaults),
        applied: value.applied ? normalizeDesired(value.applied, this.defaults) : null,
        policy: validatePolicy(value.policy ? normalizeDownloadPolicy(value.policy, policyFromLegacy(value.desired || {}, { ...DEFAULT_DOWNLOAD_POLICY, defaultDownloadPath: this.defaults.downloadDir })) : policyFromLegacy(value.desired || {}, { ...DEFAULT_DOWNLOAD_POLICY, defaultDownloadPath: this.defaults.downloadDir })),
        lastApplied: value.lastApplied && typeof value.lastApplied === 'object' ? clone(value.lastApplied) : null,
        updatedAt: numberOr(value.updatedAt, 0),
      };
    } catch (error) {
      this.readOnly = true;
      try { fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch {}
      this.log.error?.('[settings-repository] load failed; settings are read-only', error.message);
    }
    return this;
  }

  _ensureLoaded() { if (!this.loaded) this.load(); }
  _ensureWritable() {
    this._ensureLoaded();
    if (this.readOnly) { const error = new Error('settings repository is read-only'); error.code = 'REPOSITORY_READ_ONLY'; throw error; }
  }
  _writeAtomic() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(this.state, null, 2), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.filePath);
  }
  get() { this._ensureLoaded(); return clone(this.state); }
  update(patch = {}, { expectedRevision } = {}) {
    this._ensureWritable();
    if (expectedRevision !== undefined && Number(expectedRevision) !== this.state.revision) { const error = new Error('设置已变化，请刷新后重试'); error.code = 'REVISION_CONFLICT'; throw error; }
    const policyPatch = patch.policy && typeof patch.policy === 'object'
      ? patch.policy
      : policyFromLegacy({ ...this.state.desired, ...patch }, this.state.policy);
    this.state.policy = validatePolicy(normalizeDownloadPolicy({ ...this.state.policy, ...policyPatch }, this.state.policy));
    this.state.desired = normalizeDesired({ ...this.state.desired, ...patch, ...legacyFromPolicy(this.state.policy, this.state.desired) }, this.defaults);
    this.state.revision += 1;
    this.state.updatedAt = Number(this.clock.now ? this.clock.now() : Date.now());
    this._writeAtomic();
    return this.get();
  }
  setApplied(applied) {
    this._ensureWritable();
    this.state.applied = normalizeDesired(applied, this.state.desired);
    this.state.lastApplied = { at: Number(this.clock.now ? this.clock.now() : Date.now()), values: clone(this.state.applied), failures: [] };
    this.state.updatedAt = Number(this.clock.now ? this.clock.now() : Date.now());
    this._writeAtomic();
    return this.get();
  }

  getSnapshot() {
    this._ensureLoaded();
    return { revision: this.state.revision, policy: clone(this.state.policy), lastApplied: clone(this.state.lastApplied), desired: clone(this.state.desired), applied: clone(this.state.applied), updatedAt: this.state.updatedAt };
  }

  updatePolicy(patch = {}, { expectedRevision } = {}) {
    this._ensureWritable();
    if (expectedRevision !== undefined && Number(expectedRevision) !== this.state.revision) { const error = new Error('下载策略已变化，请刷新后重试'); error.code = 'REVISION_CONFLICT'; throw error; }
    this.state.policy = validatePolicy(normalizeDownloadPolicy({ ...this.state.policy, ...patch }, this.state.policy));
    this.state.desired = normalizeDesired({ ...this.state.desired, ...legacyFromPolicy(this.state.policy, this.state.desired) }, this.defaults);
    this.state.revision += 1;
    this.state.updatedAt = Number(this.clock.now ? this.clock.now() : Date.now());
    this._writeAtomic();
    return this.getSnapshot();
  }

  setApplyResult({ engineGeneration = null, values = {}, failures = [] } = {}) {
    this._ensureWritable();
    const policy = normalizeDownloadPolicy(values, this.state.policy);
    this.state.lastApplied = { engineGeneration, at: Number(this.clock.now ? this.clock.now() : Date.now()), values: clone(policy), failures: clone(failures) };
    this.state.applied = normalizeDesired(legacyFromPolicy(policy, this.state.desired), this.state.desired);
    this._writeAtomic();
    return this.getSnapshot();
  }
  close() { if (this.loaded && !this.readOnly) this._writeAtomic(); }
}

module.exports = { SettingsRepository, DEFAULT_SETTINGS, normalizeDesired };
