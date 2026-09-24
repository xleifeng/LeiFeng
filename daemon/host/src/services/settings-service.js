'use strict';

class SettingsService {
  constructor({ settings, driver, clock = Date } = {}) {
    if (!settings) throw new Error('SettingsService settings is required');
    this.settings = settings;
    this.driver = driver;
    this.clock = clock;
  }

  get() {
    const state = this.settings.get();
    return {
      revision: state.revision,
      desired: state.desired,
      applied: state.applied,
      source: state.applied ? 'applied-cache' : 'desired',
    };
  }

  async update(patch = {}, { expectedRevision } = {}) {
    const state = this.settings.update(patch, { expectedRevision });
    await this.applyToEngine();
    return this.get();
  }

  async applyToEngine() {
    const desired = this.settings.get().desired;
    if (!this.driver || typeof this.driver.setGlobalLimits !== 'function' || !this.driver.isHealthy()) return this.get();
    const applied = await this.driver.setGlobalLimits(desired);
    const values = applied && typeof applied === 'object' ? { ...desired, ...applied } : desired;
    this.settings.setApplied(values);
    return this.get();
  }
}

module.exports = { SettingsService };
