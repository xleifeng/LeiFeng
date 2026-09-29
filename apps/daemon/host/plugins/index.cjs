'use strict';
// daemon 插件汇总：一插件一文件，本文件只做聚合与 registry 组装。
const { plugin } = require('./shared.cjs');
const { runtimeConfig } = require('./runtime-config.cjs');
const { repositories } = require('./repositories.cjs');
const { kernelHub } = require('./kernel-hub.cjs');
const { rpcRegistryPlugin } = require('./rpc-registry.cjs');
const { requestPolicy } = require('./request-policy.cjs');
const { controlTransport } = require('./control-transport.cjs');
const { rpcHost } = require('./rpc-host.cjs');
const { kernelThunder } = require('./kernel-thunder.cjs');
const { kernelQbit } = require('./kernel-qbit.cjs');
const { taskShell } = require('./task-shell.cjs');
const { privateSpace } = require('./private-space.cjs');
const { historyLinks } = require('./history-links.cjs');
const { mediaCapture } = require('./media-capture.cjs');
const { remoteAccess } = require('./remote-access.cjs');
const { productCore } = require('./product-core.cjs');
const { pluginAdmin } = require('./plugin-admin.cjs');
const { webApiProcess } = require('./web-api-process.cjs');

function daemonRegistry() {
  const definitions = [
    ['runtime-config', runtimeConfig, 'leifengConfig', ['leifengUiRegistry']],
    ['repositories', repositories, 'leifengRepositories'],
    ['kernel-hub', kernelHub, 'leifengKernelHub'],
    // P1（cordis-arch）拆分：注册机制（无监听）→ 策略 → 传输监听。消费方经
    // leifengRpcRegistry 注册方法，attachAuth 晚注入退役。
    ['rpc-registry', rpcRegistryPlugin, 'leifengRpcRegistry'],
    ['request-policy', requestPolicy, 'leifengRequestPolicy'],
    ['control-transport', controlTransport, 'leifengControlTransport'],
    ['rpc-host', rpcHost, 'leifengRpc'],
    ['kernel-thunder', kernelThunder, 'leifengKernel:thunder'],
    // P3 参照内核升级为常驻成员（kernel-any-only）：defaultEnabled:false 默认不
    // 启动，patch { id:'kernel-qbit', enabled:true } 启用；slot 注册进 kernel-hub。
    ['kernel-qbit', kernelQbit, 'leifengKernel:qbit', [], false],
    ['task-shell', taskShell, 'leifengTasks'],
    // P4（cordis-arch）product-services 拆分：私密/历史链接/媒体捕获/远程访问
    // 四域独立插件 + bootstrap/diagnostics 聚合核。outbox 消费者语义完成前
    // history-links 保持必需（不可禁用）。
    ['private-space', privateSpace, 'leifengPrivateSpace'],
    ['history-links', historyLinks, 'leifengHistoryLinks'],
    ['media-capture', mediaCapture, 'leifengMediaCapture'],
    ['remote-access', remoteAccess, 'leifengRemoteAccess'],
    ['product-core', productCore, 'leifengProducts'],
    ['plugin-admin', pluginAdmin, 'leifengPluginAdmin'],
    ['web-api-process', webApiProcess, 'leifengWebApi'],
  ];
  return Object.fromEntries(definitions.map(([id, definition, provided, extraProvides, defaultEnabled]) => [id, {
    plugin: definition, provides: [provided, ...(extraProvides ?? [])], requires: definition.inject,
    ...(defaultEnabled === false ? { defaultEnabled: false } : {}),
  }]));
}

module.exports = { daemonRegistry };
