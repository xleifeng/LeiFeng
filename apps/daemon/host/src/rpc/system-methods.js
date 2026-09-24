'use strict';

const validators = require('./validators');

function createSystemMethods({ systemIntegration, media, driver = null, operations = null, eventBus = null } = {}) {
  const methods = [];
  if (systemIntegration) {
    methods.push(['thunder.ui.v2.system.capabilities', () => systemIntegration.getCapabilities()]);
    methods.push(['thunder.ui.v2.system.openFile', (params) => systemIntegration.openFile(params && params[0] || {})]);
    methods.push(['thunder.ui.v2.system.showInFolder', (params) => systemIntegration.showTaskInFolder(params && params[0] || {})]);
    methods.push(['thunder.ui.v2.system.openFolder', (params) => systemIntegration.openFolder(params && params[0] || {})]);
  }
  if (media) methods.push(['thunder.ui.v2.system.mediaCapabilities', () => media.getCapabilities()]);
  if (driver && typeof driver.restart === 'function') methods.push(['thunder.ui.v2.system.restartEngine', async (params) => {
    const input = validators.systemRestart(params && params[0] || {});
    const pending = operations?.listRecoverable?.() || [];
    if (pending.length && input.force !== true) {
      const error = new Error('仍有未完成的破坏性操作，暂不能重启引擎');
      error.code = 'ENGINE_RESTART_BLOCKED';
      error.details = { pendingOperations: pending.length };
      throw error;
    }
    eventBus?.emit?.('engine.restart.requested', { pendingOperations: pending.length, forced: input.force === true });
    await driver.restart();
    eventBus?.emit?.('engine.restart.completed', { generation: driver._generation, healthy: driver.isHealthy?.() === true });
    return { engineGeneration: driver._generation, healthy: driver.isHealthy?.() === true, restarts: Number(driver.restarts) || 0 };
  }]);
  return methods;
}

module.exports = { createSystemMethods };
