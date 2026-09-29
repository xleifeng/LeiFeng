'use strict';
// daemon 插件汇总：一插件一文件，本文件只做聚合与 registry 组装。
const { plugin } = require('./shared.cjs');
const { runtimeConfig } = require('./runtime-config.cjs');
const { repositories } = require('./repositories.cjs');
const { kernelHub } = require('./kernel-hub.cjs');
const { rpcHost } = require('./rpc-host.cjs');
const { kernelThunder } = require('./kernel-thunder.cjs');
const { kernelQbit } = require('./kernel-qbit.cjs');
const { taskShell } = require('./task-shell.cjs');
const { productServices } = require('./product-services.cjs');
const { pluginAdmin } = require('./plugin-admin.cjs');
const { webApiProcess } = require('./web-api-process.cjs');

function daemonRegistry() {
  const definitions = [
    ['runtime-config', runtimeConfig, 'leifengConfig', ['leifengUiRegistry']],
    ['repositories', repositories, 'leifengRepositories'],
    ['kernel-hub', kernelHub, 'leifengKernelHub'],
    ['rpc-host', rpcHost, 'leifengRpc'],
    ['kernel-thunder', kernelThunder, 'leifengKernel:thunder'],
    // P3 参照内核升级为常驻成员（kernel-any-only）：defaultEnabled:false 默认不
    // 启动，patch { id:'kernel-qbit', enabled:true } 启用；slot 注册进 kernel-hub。
    ['kernel-qbit', kernelQbit, 'leifengKernel:qbit', [], false],
    ['task-shell', taskShell, 'leifengTasks'],
    ['product-services', productServices, 'leifengProducts'],
    ['plugin-admin', pluginAdmin, 'leifengPluginAdmin'],
    ['web-api-process', webApiProcess, 'leifengWebApi'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided, extraProvides, defaultEnabled]) => [id, {
    plugin: definition, provides: [provided, ...(extraProvides ?? [])], requires: definition.inject,
    ...(defaultEnabled === false ? { defaultEnabled: false } : {}),
  }]));
}

module.exports = { daemonRegistry };
