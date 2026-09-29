'use strict';
// daemon.v1.web.torrent.* 的注册工厂（rpc-plugin-registration 拆分：原
// DaemonControlDispatcher case 面按域归属搬出，task 域归 task-shell）。
// 连接语义（owner/lease/幂等缓存）经 ctx.dispatcher 取回——dispatcher 是
// 连接状态宿主，本工厂只提供 handler。
const fs = require('node:fs');
const { controlError, safeFilename } = require('../control/dispatcher');

function createTaskControlMethods({ createDraftService, tasks, seedStore, config }) {
  const methods = [];
  methods.push(['daemon.v1.web.torrent.import', async (params, ctx) => {
    const d = ctx.dispatcher;
    d._assertBearer(params.context);
    d._assertCsrf(params.context, 'torrent.import');
    const idempotencyKey = String(params.idempotencyKey || '').trim();
    if (idempotencyKey && (idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) throw controlError('INVALID_IDEMPOTENCY_KEY', 'idempotency key 无效');
    const cacheKey = idempotencyKey ? `${params.context?.bearerToken || 'loopback'}:${idempotencyKey}` : '';
    const cached = cacheKey && d.completedUploads.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const staged = d._stagedFile(params.filePath);
    if (staged.stat.size > config.maxTorrentUploadBytes) throw controlError('UPLOAD_TOO_LARGE', 'torrent 文件超过大小限制');
    const first = fs.readFileSync(staged.path).subarray(0, 1);
    if (!first.length || first[0] !== 0x64) throw controlError('INVALID_TORRENT', 'torrent bencode 无效');
    const draft = await createDraftService.createTorrentDraftFromFile(staged.path, { originalName: safeFilename(params.originalName, 'upload.torrent') });
    const result = { draft };
    if (cacheKey) {
      d.completedUploads.set(cacheKey, { result, expiresAt: Date.now() + 10 * 60 * 1000 });
      while (d.completedUploads.size > 256) d.completedUploads.delete(d.completedUploads.keys().next().value);
    }
    return result;
  }]);
  methods.push(['daemon.v1.web.torrent.export', async (params, ctx) => {
    const d = ctx.dispatcher;
    d._assertBearer(params.context);
    let task;
    try { task = tasks.require(String(params.taskId || '')); } catch { throw controlError('TASK_NOT_FOUND', '任务不存在'); }
    if (!task.seedRef) throw controlError('SEED_NOT_FOUND', '任务没有可导出的种子');
    let target;
    try { target = seedStore.resolve(task.seedRef); } catch { throw controlError('SEED_NOT_FOUND', '种子不存在'); }
    const stat = fs.statSync(target);
    const leaseId = d._lease(ctx.owner, {});
    return { leaseId, path: target, length: stat.size, filename: safeFilename(task.displayName, 'task').replace(/\.torrent$/i, '') + '.torrent' };
  }]);
  return methods;
}

module.exports = { createTaskControlMethods };
