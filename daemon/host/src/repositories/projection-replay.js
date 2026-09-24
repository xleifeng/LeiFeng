'use strict';

// 投影回放：从 TaskRepository outbox 事件序列重建任务快照，并与持久化现状对比。
// 用途（spec §7）：UI 任务状态以 repository/outbox 可重建为验收目标；
// compaction 会丢弃已确认事件，所以回放只覆盖“未确认窗口”内的任务终态，
// 其余任务以 repository 现状为准 —— 断言的是两者无矛盾，不是全量重建。

const TERMINAL = new Set(['completed', 'failed', 'recycled', 'missing']);
// 快照里参与对比的稳定投影字段；观察字段（速度等）每次 poll 都变，不参与一致性。
const PROJECTION_FIELDS = Object.freeze(['id', 'lifecycle', 'kind', 'displayName', 'savePath', 'sourceFingerprint', 'totalBytes', 'completedBytes', 'error', 'revision', 'privateSpace']);

function pickProjection(task) {
  if (!task || typeof task !== 'object') return null;
  const result = {};
  for (const field of PROJECTION_FIELDS) {
    if (task[field] === undefined) continue;
    result[field] = field === 'error' ? (task[field] ? { code: task[field].code || null, category: task[field].category || null } : null) : task[field];
  }
  return result;
}

/** 按事件序列重建 {taskId -> 终态投影}。只重放 payload 带快照的事件；
 *  旧格式（仅 reason）在窗口内会被记为 unsupported，由调用方决定是否告警。 */
function replayProjection(events = []) {
  const replayed = new Map();
  const unsupported = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const taskId = String(event.taskId || '');
    if (!taskId) continue;
    const task = event.payload?.task;
    if (!task || typeof task !== 'object' || task.id !== undefined && String(task.id) !== taskId) {
      if (['task.created', 'task.deleted', 'task.updated', 'task.lifecycle.changed'].includes(event.type)) unsupported.push({ sequence: event.sequence, type: event.type, taskId });
      continue;
    }
    if (event.type === 'task.deleted') { replayed.delete(taskId); continue; }
    // 同任务多事件时取 revision 最新者
    const existing = replayed.get(taskId);
    if (existing && Number(existing.revision) > Number(task.revision || 0)) continue;
    replayed.set(taskId, pickProjection(task));
  }
  return { replayed, unsupported };
}

/** 对比回放投影与 repository 任务表。只断言“未确认窗口内的任务在 repository 中
 *  仍存在且关键投影字段一致”；已不在 repository 的任务只允许出现在 deleted 之后。 */
function compareWithRepository({ replayed, tasks = [] }) {
  const byId = new Map(tasks.map((task) => [String(task.id), task]));
  const inconsistencies = [];
  for (const [taskId, projection] of replayed) {
    const current = byId.get(taskId);
    if (!current) { inconsistencies.push({ taskId, field: 'existence', expected: 'present', actual: 'absent' }); continue; }
    const currentProjection = pickProjection(current);
    for (const field of PROJECTION_FIELDS) {
      if (!(field in projection)) continue;
      if (field === 'completedBytes') {
        // 进度单调递增：repository 落后于事件快照不算矛盾（观察尚未追上）
        if (Number(currentProjection.completedBytes) >= Number(projection.completedBytes)) continue;
      }
      if (JSON.stringify(currentProjection[field]) !== JSON.stringify(projection[field])) {
        inconsistencies.push({ taskId, field, expected: projection[field], actual: currentProjection[field] });
      }
    }
  }
  return { inconsistencies };
}

module.exports = { replayProjection, compareWithRepository, pickProjection, PROJECTION_FIELDS, TERMINAL };
