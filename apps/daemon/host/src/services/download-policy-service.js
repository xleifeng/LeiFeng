'use strict';

const { normalizePolicy, validatePolicy, legacyFromPolicy } = require('../domain/download-policy');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

class DownloadPolicyService {
  constructor({ settings, driver, proxySecrets = null, clock = Date, nativeGeneration = () => 0, scheduler = null, eventBus = null } = {}) {
    if (!settings || !driver) throw new Error('DownloadPolicyService dependencies are incomplete');
    this.settings = settings;
    this.driver = driver;
    this.proxySecrets = proxySecrets;
    this.clock = clock;
    this.nativeGeneration = nativeGeneration;
    this.scheduler = scheduler;
    this.eventBus = eventBus;
    this.fullSpeedSnapshot = null;
    this.scheduleService = null;
  }

  _snapshot() { return typeof this.settings.getSnapshot === 'function' ? this.settings.getSnapshot() : this.settings.get(); }
  _policy() { return normalizePolicy(this._snapshot().policy || this._snapshot().desired); }
  _dto(snapshot = this._snapshot()) {
    const policy = normalizePolicy(snapshot.policy || snapshot.desired);
    return {
      revision: snapshot.revision,
      policy: { ...clone(policy), proxy: { ...policy.proxy, passwordPresent: !!(policy.proxy.passwordRef && this.proxySecrets && this.proxySecrets.has(policy.proxy.passwordRef)) } },
      lastApplied: clone(snapshot.lastApplied || (snapshot.applied ? { values: snapshot.applied } : null)),
      fullSpeed: !!this.fullSpeedSnapshot,
    };
  }

  get() { return this._dto(); }

  async update({ expectedRevision, patch = {}, proxySecret = null } = {}) {
    const current = this._snapshot();
    const currentPolicy = normalizePolicy(current.policy || current.desired);
    let nextPatch = { ...(patch || {}) };
    let nextSecretRef = currentPolicy.proxy.passwordRef || null;
    if (proxySecret && proxySecret.action) {
      if (proxySecret.action === 'replace') {
        if (!this.proxySecrets) throw Object.assign(new Error('代理密码存储不可用'), { code: 'PROXY_SECRET_UNAVAILABLE' });
        nextSecretRef = this.proxySecrets.set({ username: proxySecret.username || currentPolicy.proxy.username, password: proxySecret.password });
      } else if (proxySecret.action === 'clear') {
        nextSecretRef = null;
      } else if (proxySecret.action !== 'keep') throw Object.assign(new Error('代理密码操作无效'), { code: 'INVALID_ARGUMENT' });
    }
    if (nextPatch.proxy || proxySecret) nextPatch.proxy = { ...currentPolicy.proxy, ...(nextPatch.proxy || {}), passwordRef: nextSecretRef };
    const updated = typeof this.settings.updatePolicy === 'function'
      ? this.settings.updatePolicy(nextPatch, { expectedRevision })
      : this.settings.update(legacyFromPolicy({ ...currentPolicy, ...nextPatch }), { expectedRevision });
    const applied = await this.applyAll({ reason: 'policy-update', engineGeneration: this.nativeGeneration() });
    const windowRuntime = this.scheduleService ? await this.scheduleService.syncDownloadLimitWindowRuntime({ reason: 'policy-update' }) : null;
    if (proxySecret && proxySecret.action === 'clear' && currentPolicy.proxy.passwordRef && this.proxySecrets) this.proxySecrets.delete(currentPolicy.proxy.passwordRef);
    return { ...this._dto(updated), applied: applied.applied && (!windowRuntime || windowRuntime.applied), applyProblems: [...applied.failures, ...(windowRuntime && !windowRuntime.applied ? [windowRuntime.problem] : [])] };
  }

  async applyAll({ reason = 'startup', engineGeneration = this.nativeGeneration() } = {}) {
    const policy = validatePolicy(this._policy());
    const failures = [];
    let applied = { ...policy, proxy: { ...policy.proxy } };
    const healthy = this.driver && typeof this.driver.isHealthy === 'function' && this.driver.isHealthy();
    if (!healthy) return { applied: false, failures: [{ code: 'ENGINE_UNAVAILABLE', message: '下载引擎暂不可用' }] };
    try {
      const limits = await this.driver.setGlobalLimits({ downloadLimit: policy.globalDownloadLimit, uploadLimit: policy.globalUploadLimit, connectionLimit: policy.globalConnectionLimit, maxTasks: policy.maxConcurrentTasks });
      if (limits && limits.applied) applied = { ...applied, ...limits.applied };
      if (limits && Array.isArray(limits.failures)) failures.push(...limits.failures);
    } catch (error) { failures.push({ code: error.code || 'LIMIT_APPLY_FAILED', message: String(error.message || error).slice(0, 180) }); }
    try {
      const switches = await this.driver.setChannelSwitches({ p2p: policy.p2pEnabled, p2s: policy.p2sEnabled });
      if (switches && switches.applied) { applied.p2pEnabled = switches.applied.p2p; applied.p2sEnabled = switches.applied.p2s; }
      if (switches && Array.isArray(switches.failures)) failures.push(...switches.failures);
    } catch (error) { failures.push({ code: error.code || 'CHANNEL_APPLY_FAILED', message: String(error.message || error).slice(0, 180) }); }
    if (policy.proxy.mode !== 'direct' || (this._snapshot().lastApplied && this._snapshot().lastApplied.values && this._snapshot().lastApplied.values.proxy && this._snapshot().lastApplied.values.proxy.mode !== 'direct')) {
      try {
        const secret = policy.proxy.passwordRef && this.proxySecrets ? this.proxySecrets.get(policy.proxy.passwordRef) : null;
        const result = await this.driver.setProxy({ ...policy.proxy, ...(secret || {}), password: secret ? secret.password : '' });
        if (result && result.applied) applied.proxy = { ...policy.proxy, ...result.applied };
      } catch (error) { failures.push({ code: error.code || 'PROXY_APPLY_FAILED', message: '代理设置未应用，已保留上一份已应用配置' }); }
    }
    if (policy.autoMoveSlowTaskToTail) {
      try { await this.driver.setAutoMoveLowSpeed(true); } catch (error) { failures.push({ code: error.code || 'LOW_SPEED_APPLY_FAILED', message: String(error.message || error).slice(0, 180) }); }
    }
    if (typeof this.settings.setApplyResult === 'function') this.settings.setApplyResult({ engineGeneration, values: applied, failures });
    this.eventBus?.emit?.('policy.applied', { reason, generation: engineGeneration, failures: clone(failures) });
    this.scheduler?.onPolicyChanged?.();
    return { applied: failures.length === 0, failures, values: applied };
  }

  async enableFullSpeed() {
    if (!this.fullSpeedSnapshot) {
      const policy = this._policy();
      this.fullSpeedSnapshot = { globalDownloadLimit: policy.globalDownloadLimit, globalUploadLimit: policy.globalUploadLimit, globalConnectionLimit: policy.globalConnectionLimit, maxTasks: policy.maxConcurrentTasks };
    }
    const result = await this.driver.setGlobalLimits({ downloadLimit: null, uploadLimit: null, connectionLimit: this._policy().globalConnectionLimit, maxTasks: this._policy().maxConcurrentTasks });
    return { ...this._dto(), fullSpeed: true, runtime: result };
  }

  async restoreLimits() {
    const policy = this._policy();
    const snapshot = this.fullSpeedSnapshot;
    const limits = snapshot
      ? { downloadLimit: snapshot.globalDownloadLimit, uploadLimit: snapshot.globalUploadLimit, connectionLimit: snapshot.globalConnectionLimit, maxTasks: snapshot.maxTasks }
      : { downloadLimit: policy.globalDownloadLimit, uploadLimit: policy.globalUploadLimit, connectionLimit: policy.globalConnectionLimit, maxTasks: policy.maxConcurrentTasks };
    const result = await this.driver.setGlobalLimits(limits);
    this.fullSpeedSnapshot = null;
    return { ...this._dto(), fullSpeed: false, runtime: result };
  }

  async testProxy(candidate) {
    const value = { ...(candidate || {}) };
    const startedAt = Number(this.clock.now ? this.clock.now() : Date.now());
    const secret = value.passwordRef && this.proxySecrets ? this.proxySecrets.get(value.passwordRef) : null;
    const result = await this.driver.verifyProxy({ ...value, ...(secret || {}), password: secret ? secret.password : String(value.password || '') });
    return { ...result, elapsedMs: Math.max(0, (Number(this.clock.now ? this.clock.now() : Date.now()) - startedAt)) };
  }

  async onEngineUp(generation) {
    const applied = await this.applyAll({ reason: 'engine-up', engineGeneration: generation });
    if (this.scheduleService) await this.scheduleService.syncDownloadLimitWindowRuntime({ reason: 'engine-up' });
    return applied;
  }
}

module.exports = { DownloadPolicyService };
