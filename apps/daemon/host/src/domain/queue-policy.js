'use strict';

function active(task) { return ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle); }
function eligible(task) { return active(task) && task.lifecycle !== 'paused' && task.userPaused !== true && task.schedulerPaused !== true && task.lifecycle !== 'downloading'; }
function sortQueue(tasks) {
  return [...tasks].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.queuePosition || 0) - Number(b.queuePosition || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
}
function shouldMoveSlowTask(task, { threshold = 0, now = Date.now(), queuedCount = 0, windowMs = 60 * 1000, cooldownMs = 30 * 60 * 1000 } = {}) {
  if (!task || task.lifecycle !== 'downloading' || queuedCount <= 0 || task.totalBytes <= 0 || task.completedBytes >= task.totalBytes * 0.98) return false;
  if (task.kind === 'ed2k' || task.lifecycle === 'metadata' || (task.taskSpeedLimit !== null && task.taskSpeedLimit > 0 && task.taskSpeedLimit < threshold)) return false;
  if (Number(task.downloadBytesPerSecond || 0) >= threshold) return false;
  if (task.lastSlowMoveAt && now - Number(task.lastSlowMoveAt) < cooldownMs) return false;
  const belowSince = Number(task.slowBelowSince || 0);
  return belowSince > 0 && now - belowSince >= windowMs;
}
function compactPositions(tasks, spacing = 1024) { return [...tasks].map((task, index) => ({ taskId: task.id, queuePosition: (index + 1) * spacing })); }
module.exports = { active, eligible, sortQueue, shouldMoveSlowTask, compactPositions };
