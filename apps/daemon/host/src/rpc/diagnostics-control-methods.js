'use strict';
// daemon.v1.web.diagnostics.export 注册工厂（P4 拆分：诊断导出归 product-core）。
// 连接语义（lease/rate/导出文件生命周期）经 ctx.dispatcher。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { finished } = require('node:stream/promises');

function createDiagnosticsControlMethods({ diagnostics, config }) {
  const methods = [];
  methods.push(['daemon.v1.web.diagnostics.export', async (params, ctx) => {
    const d = ctx.dispatcher;
    d._assertBearer(params.context);
    const rate = d._rate('diagnostics-export', params.context);
    let leased = false;
    try {
      const exportId = String(params.exportId || '');
      const manifest = diagnostics.getManifest(exportId);
      const exportDir = path.join(config.runtimeDir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true, mode: 0o700 });
      const target = path.join(exportDir, `${crypto.randomUUID()}.zip`);
      const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
      try {
        const completion = finished(output);
        await diagnostics.createArchive(exportId, output);
        await completion;
      } catch (error) {
        output.destroy();
        try { fs.rmSync(target, { force: true }); } catch {}
        throw error;
      }
      const stat = fs.statSync(target);
      const leaseId = d._lease(ctx.owner, { deletePath: target, release: () => d.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId }) });
      leased = true;
      return { leaseId, path: target, length: stat.size, manifest };
    } finally {
      if (!leased) d.rateLimiter?.releaseConcurrency?.({ bucket: 'diagnostics-export', principalId: rate.principalId });
    }
  }]);
  return methods;
}

module.exports = { createDiagnosticsControlMethods };
