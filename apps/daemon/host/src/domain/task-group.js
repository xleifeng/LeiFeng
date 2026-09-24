'use strict';

const ACTIVE = new Set(['preparing', 'metadata', 'queued', 'downloading', 'paused']);
const TERMINAL = new Set(['completed', 'failed', 'recycled', 'missing']);

function aggregate(children = []) {
  const items = Array.isArray(children) ? children : [];
  const totalBytes = items.reduce((sum, task) => sum + Math.max(0, Number(task.totalBytes) || 0), 0);
  const completedBytes = items.reduce((sum, task) => sum + Math.min(Math.max(0, Number(task.completedBytes) || 0), Math.max(0, Number(task.totalBytes) || 0)), 0);
  const downloadBytesPerSecond = items.reduce((sum, task) => sum + Math.max(0, Number(task.downloadBytesPerSecond) || 0), 0);
  const failed = items.filter((task) => task.lifecycle === 'failed');
  const completed = items.filter((task) => task.lifecycle === 'completed');
  const active = items.filter((task) => ACTIVE.has(task.lifecycle));
  const allPaused = items.length > 0 && items.every((task) => task.lifecycle === 'paused');
  let lifecycle = 'queued';
  let groupResult = null;
  if (!items.length) lifecycle = 'queued';
  else if (completed.length === items.length) lifecycle = 'completed';
  else if (failed.length === items.length) { lifecycle = 'failed'; groupResult = 'failed'; }
  else if (failed.length && completed.length + failed.length === items.length) { lifecycle = 'failed'; groupResult = 'partial-failed'; }
  else if (allPaused) lifecycle = 'paused';
  else if (active.some((task) => task.lifecycle === 'downloading')) lifecycle = 'downloading';
  else if (active.length) lifecycle = 'queued';
  else lifecycle = 'queued';
  return { totalBytes, completedBytes, downloadBytesPerSecond, progress: totalBytes > 0 ? Math.min(1, completedBytes / totalBytes) : 0, lifecycle, groupResult, childCount: items.length };
}

module.exports = { aggregate, ACTIVE, TERMINAL };
