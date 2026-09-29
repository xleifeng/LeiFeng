'use strict';
// gateway-config：Web API 子进程配置装载（env → 冻结配置对象）。
const { loadWebApiConfig } = require('../config');

function pluginShape(apply) { return { inject: [], apply }; }

const gatewayConfig = pluginShape((ctx) => {
  const config = loadWebApiConfig();
  ctx.provide('gatewayConfig', config);
});

module.exports = { gatewayConfig };
