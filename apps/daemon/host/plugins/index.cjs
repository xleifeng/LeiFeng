
'use strict';
// daemon 插件汇总：一插件一文件，本文件只做聚合与 registry 组装。
const { plugin } = require('./shared.cjs');
const { runtimeConfig } = require('./runtime-config.cjs');
const { repositories } = require('./repositories.cjs');
const { engineDriver } = require('./engine-driver.cjs');
const { eventObservation } = require('./event-observation.cjs');
const { authVip } = require('./auth-vip.cjs');
const { taskCore } = require('./task-core.cjs');
const { productServices } = require('./product-services.cjs');
const { controlRpc } = require('./control-rpc.cjs');
const { webApiProcess } = require('./web-api-process.cjs');

function daemonRegistry() {
  const definitions = [
    ['runtime-config', runtimeConfig, 'tleiConfig'],
    ['repositories', repositories, 'tleiRepositories'],
    ['engine-driver', engineDriver, 'tleiEngine'],
    ['event-observation', eventObservation, 'tleiObservation'],
    ['auth-vip', authVip, 'tleiAuth'],
    ['task-core', taskCore, 'tleiTasks'],
    ['product-services', productServices, 'tleiProducts'],
    ['control-rpc', controlRpc, 'tleiControl'],
    ['web-api-process', webApiProcess, 'tleiWebApi'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided]) => [id, {
    plugin: definition, provides: [provided], requires: definition.inject,
  }]));
}

module.exports = { daemonRegistry };
