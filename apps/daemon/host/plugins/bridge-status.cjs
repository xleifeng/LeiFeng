'use strict';
// bridge-status（kernel-detail-panels）：webseed 桥会话实时快照的内存库。
// 桥（hybrid 模式）在自身轮询周期经 leifeng.ui.v2.bridge.report 上报；
// 任务详情富化（task-shell enrichDetail）经 forTask 按 infoHash 关联读取。
// 纯内存：daemon 重启即清（桥下个上报周期重建），不落库、无持久化语义；
// 桥失联不删条目——靠 stale 标志诚实呈现「最后上报时间」。
const { plugin } = require('./shared.cjs');

const STALE_MS = 90 * 1000; // 上报周期 20s 的 4 倍余量，超期视为失联
const INFOHASH_RE = /^[a-f0-9]{40}$/;

function normalizeSnapshot(input) {
  const infohash = String(input && input.infohash || '').toLowerCase();
  if (!INFOHASH_RE.test(infohash)) {
    const error = new Error('bridge.report: infohash must be 40-char hex (btih v1)');
    error.code = 'INVALID_PARAMS';
    throw error;
  }
  return {
    infohash,
    taskId: input.taskId ? String(input.taskId) : null,
    verifiedPieces: Math.max(0, Number(input.verifiedPieces) || 0),
    totalPieces: Math.max(0, Number(input.totalPieces) || 0),
    verifiedBytes: Math.max(0, Number(input.verifiedBytes) || 0),
    serveBytesTotal: Math.max(0, Number(input.serveBytesTotal) || 0),
    serveRateBps: Math.max(0, Number(input.serveRateBps) || 0),
    lifecycle: String(input.lifecycle || 'active'),
    updatedAt: Date.now(),
  };
}

const bridgeStatus = plugin('leifeng-bridge-status', ['leifengRpc'], (ctx) => {
  const sessions = new Map(); // infohash → snapshot
  const withStaleness = (snapshot) => ({ ...snapshot, stale: Date.now() - snapshot.updatedAt > STALE_MS });

  ctx.provide('leifengBridgeStatus', {
    forTask(task) {
      const infohash = String(task && task.infoHash || '').toLowerCase();
      if (!INFOHASH_RE.test(infohash)) return null;
      const hit = sessions.get(infohash);
      return hit ? withStaleness(hit) : null;
    },
  });
  const withdraw = ctx.leifengRpc.registry.register('bridge-status', [
    ['leifeng.ui.v2.bridge.report', (params) => {
      const snapshot = normalizeSnapshot(params && params[0]);
      sessions.set(snapshot.infohash, snapshot);
      return { accepted: true };
    }],
    ['leifeng.ui.v2.bridge.sessions', () => ({ sessions: [...sessions.values()].map(withStaleness) })],
  ]);
  return () => { withdraw(); sessions.clear(); };
});

module.exports = { bridgeStatus };
