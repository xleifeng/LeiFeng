'use strict';
// request-policy（cordis-arch P1）：请求鉴权与限流策略服务。原为
// product-services 构造后经 attachAuth 晚注入 dispatcher——产品插件装配
// 前的 CSRF/限流守卫空窗由本插件收口：策略先于传输就绪，transport 构造
// 即持完整 policy，不再有 null 直通窗口。
// 依赖 config（csrfEnabled 等开关）；product-services 仍可贡献额外限流桶
// （经 provide 补充策略面），但基础守卫不再依赖产品插件在场。
const { RequestAuth } = require('../src/security/request-auth');
const { RateLimiter } = require('../src/security/rate-limiter');
const { plugin } = require('./shared.cjs');

const requestPolicy = plugin('leifeng-request-policy', ['leifengConfig'], (ctx) => {
  const { appConfig } = ctx.leifengConfig;
  const requestAuth = new RequestAuth({ enabled: appConfig.csrfEnabled });
  // 基础桶：机制面（web.invoke 聚合）先有最小防护；产品域桶（diagnostics-export
  // /media-token/capture/pairing）仍由 product-services 经 rateLimiter.addBuckets
  // 贡献并随其生命周期撤销。
  const rateLimiter = new RateLimiter({ buckets: {
    'web-invoke': { limit: 240, windowMs: 60 * 1000 },
  } });

  ctx.provide('leifengRequestPolicy', { requestAuth, rateLimiter });
});

module.exports = { requestPolicy };
