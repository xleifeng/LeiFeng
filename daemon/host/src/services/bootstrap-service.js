'use strict';

const { computeGlobalCapabilities } = require('../domain/task-capabilities');
const { classifyVipAccount } = require('../vip-account');

class BootstrapService {
  constructor({ repository, settings, driver, auth = null, accountService = null, vipService = null, privateSpace = null, capabilityProvider = null, config, policyService = null, mediaService = null, requestAuth = null, remoteEnabledProvider = null } = {}) {
    this.repository = repository;
    this.settings = settings;
    this.driver = driver;
    this.auth = auth;
    this.accountService = accountService;
    this.vipService = vipService;
    this.privateSpace = privateSpace;
    this.capabilityProvider = capabilityProvider;
    this.config = config || {};
    this.policyService = policyService;
    this.mediaService = mediaService;
    this.requestAuth = requestAuth;
    this.remoteEnabledProvider = remoteEnabledProvider;
  }

  async getSnapshot(context = {}) {
    const [account, engine, settings, native, privateStatus] = await Promise.all([
      this.accountService && typeof this.accountService.getStatus === 'function' ? this.accountService.getStatus({ refresh: false }).catch(() => ({ account: { valid: false } })) : this.auth && typeof this.auth.getStatus === 'function' ? this.auth.getStatus({ refresh: false }).catch(() => ({ account: { valid: false } })) : { account: { valid: false } },
      this._engineSummary(),
      this.settings ? this.settings.get() : { revision: 0, desired: {}, applied: null },
      this.capabilityProvider ? Promise.resolve(this.capabilityProvider()) : {},
      this.privateSpace ? this.privateSpace.getStatus() : { configured: false, unlocked: false },
    ]);
    const tier = classifyVipAccount(account && account.account || {});
    const accountSummary = account && account.account ? {
      valid: !!account.account.valid,
      isVip: tier.isVip,
      isDownloadVip: tier.isDownloadVip,
      isSuperVip: tier.isSuperVip,
      isPlatinumVip: tier.isPlatinumVip,
      isPanVip: tier.isPanVip,
      userVas: tier.userVas,
      vipType: tier.vipType,
      vipLevel: tier.vipLevel,
    } : { valid: false, isVip: false, isDownloadVip: false, isSuperVip: false,
      isPlatinumVip: false, isPanVip: false, userVas: 0, vipType: 0, vipLevel: 0 };
    const media = this.mediaService?.getCapabilities?.() || { openOnHost: false, streamInBrowser: false };
    const vipFeatures = this.vipService?.getFeatureCapabilities?.() || { superChannel: false, speedTrial: false };
    const capabilities = computeGlobalCapabilities({ native: native && native.flat ? native.flat : native, environment: { fallbackOperations: { recycle: true, recover: true, rename: true, move: true, redownload: true, btSelection: true, btSequential: true }, globalRateLimit: true, schedules: true, idleDownload: true, completionActions: true, powerActions: this.config.allowPowerActions === true, linkSync: 'local-only', superChannel: vipFeatures.superChannel === true, speedTrial: vipFeatures.speedTrial === true, openOnHost: media.openOnHost === true, streamInBrowser: media.streamInBrowser === true, remoteNodes: this.remoteEnabledProvider ? this.remoteEnabledProvider() === true : false }, protocols: ['http', 'https', 'ftp', 'magnet', 'bt', 'ed2k', 'thunder'] });
    const csrf = this.requestAuth?.issue?.({ principalId: context.bearerToken || 'loopback', origin: context.origin, host: this.config.host, port: this.config.port }) || null;
    return {
      apiVersion: 2,
      daemonVersion: this.config.version || '0.0.0',
      repositoryRevision: this.repository.repositoryRevision,
      serverTime: Date.now(),
      capabilities,
      engine,
      account: accountSummary,
      policy: this.policyService ? this.policyService.get() : { revision: settings.revision, desired: settings.desired, applied: settings.applied },
      privateSpace: privateStatus,
      media,
      security: { authRequired: !!this.config.rpcSecret, csrfRequired: Boolean(this.requestAuth?.enabled), loopback: this.config.host === '127.0.0.1' || this.config.host === 'localhost', ...(csrf ? { csrfToken: csrf.token, csrfExpiresAt: csrf.expiresAt } : {}) },
    };
  }

  async _engineSummary() {
    if (!this.driver) return { transportReady: false, sdkReady: false, enginePid: null, restarts: 0, uptimeMs: 0 };
    let queue = null; let dht = null; let switches = null;
    if (this.driver.isHealthy && this.driver.isHealthy()) {
      try { queue = await this.driver.getQueueCount(); } catch {}
      try { dht = await this.driver.getDhtNodeCount(); } catch {}
      try { switches = await this.driver.getChannelSwitches(); } catch {}
    }
    return { transportReady: !!(this.driver.isHealthy && this.driver.isHealthy()), sdkReady: this.driver.sdkReady === true, enginePid: this.driver.enginePid ? this.driver.enginePid() : null, queue, dht, p2p: switches && switches.p2p, p2s: switches && switches.p2s, restarts: Number(this.driver.restarts) || 0, uptimeMs: this.driver.bootedAt ? Date.now() - this.driver.bootedAt : 0 };
  }
}

module.exports = { BootstrapService };
