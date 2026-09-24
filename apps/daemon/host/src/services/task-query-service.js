'use strict';

const { presentTask, presentTaskListItem } = require('../rpc/presenters/task-presenter');

function queryError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function lower(value) { return String(value || '').trim().toLocaleLowerCase('zh-CN'); }

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-CN', { sensitivity: 'base', numeric: true });
}

function normalizeView(options = {}) {
  const value = String(options.view || options.scope || '').toLowerCase();
  if (value === 'downloading' || value === 'active') return 'downloading';
  if (value === 'completed') return 'completed';
  if (value === 'search') return 'search';
  if (value === 'trash') return 'trash';
  if (value === 'private') return 'private';
  return 'all';
}

function normalizeSort(options = {}) {
  const value = String(options.sort || options.order || '').toLowerCase();
  if (value === 'created-desc' || value === 'updated-desc') return 'created-desc';
  if (value === 'completed-desc') return 'completed-desc';
  if (value === 'name-asc') return 'name-asc';
  if (value === 'size-desc') return 'size-desc';
  if (value === 'speed-desc') return 'speed-desc';
  if (value === 'progress-desc') return 'progress-desc';
  if (value === 'created-asc') return 'created-asc';
  return 'created-desc';
}

function normalizeLimit(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(200, Math.max(1, number));
}

function sortPrimary(task, sort) {
  switch (sort) {
    case 'completed-desc': return Number(task.completedAt || 0);
    case 'name-asc': return lower(task.displayName);
    case 'size-desc': return Number(task.totalBytes || 0);
    case 'speed-desc': return Number(task.downloadBytesPerSecond || 0);
    case 'progress-desc': {
      const total = Number(task.totalBytes || 0);
      return total > 0 ? Number(task.completedBytes || 0) / total : 0;
    }
    case 'created-asc': return Number(task.createdAt || 0);
    case 'created-desc':
    default: return Number(task.createdAt || task.updatedAt || 0);
  }
}

function compareTask(a, b, sort) {
  const ap = sortPrimary(a, sort); const bp = sortPrimary(b, sort);
  let result;
  if (typeof ap === 'string' || typeof bp === 'string') result = compareText(ap, bp);
  else result = Number(ap) - Number(bp);
  const descending = ['created-desc', 'completed-desc', 'size-desc', 'speed-desc', 'progress-desc'].includes(sort);
  if (descending) result *= -1;
  return result || String(a.id).localeCompare(String(b.id));
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed || parsed.version !== 1 || !Number.isSafeInteger(parsed.snapshotRevision) || !parsed.taskId || !parsed.sort) throw new Error('invalid');
    return parsed;
  } catch {
    throw queryError('INVALID_CURSOR', '任务列表游标无效');
  }
}

class TaskQueryService {
  constructor({ tasks, taskDbReader = null, runtimeCapabilities = {} } = {}) {
    if (!tasks) throw new Error('TaskQueryService tasks is required');
    this.tasks = tasks;
    this.taskDbReader = taskDbReader;
    this.runtimeCapabilities = runtimeCapabilities;
    this.snapshotCache = new Map();
    this.maxSnapshots = 5;
    this.snapshotTtlMs = 30 * 1000;
  }

  _runtime() {
    return typeof this.runtimeCapabilities === 'function' ? this.runtimeCapabilities() || {} : this.runtimeCapabilities || {};
  }

  _scope(task, view) {
    // 私人任务只能由 PrivateSpaceService 在有效 session 下解密；普通任务
    // query（包括传入 view=private 的旧调用）永远不穿透安全域。
    if (task.privateSpace === true) return false;
    if (view === 'trash') return task.lifecycle === 'recycled';
    if (view === 'downloading') return ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle);
    if (view === 'completed') return ['completed', 'failed', 'missing'].includes(task.lifecycle);
    if (view === 'private') return task.privateSpace === true;
    return task.lifecycle !== 'recycled';
  }

  _filterTasks(view, search) {
    const query = lower(search);
    return this.tasks.list().filter((task) => {
      if (!this._scope(task, view === 'search' ? 'all' : view)) return false;
      if (!query) return true;
      return [task.displayName, task.source, task.savePath, task.groupLabel]
        .some((value) => lower(value).includes(query));
    });
  }

  _cacheKey({ view, search, sort, groupBy, revision }) {
    return `${revision}:${view}:${lower(search)}:${sort}:${groupBy}`;
  }

  _pruneSnapshots(now = Date.now()) {
    for (const [key, snapshot] of this.snapshotCache) {
      if (snapshot.expiresAt <= now) this.snapshotCache.delete(key);
    }
    while (this.snapshotCache.size > this.maxSnapshots) this.snapshotCache.delete(this.snapshotCache.keys().next().value);
  }

  _snapshot({ view, search, sort, groupBy }) {
    const revision = Number(this.tasks.repositoryRevision) || 0;
    const key = this._cacheKey({ view, search, sort, groupBy, revision });
    const now = Date.now();
    this._pruneSnapshots(now);
    const cached = this.snapshotCache.get(key);
    if (cached && cached.expiresAt > now) return cached;
    const items = this._filterTasks(view, search).sort((a, b) => {
      if (groupBy === 'task-group') {
        const groupA = a.kind === 'group' ? a.id : a.parentId || '';
        const groupB = b.kind === 'group' ? b.id : b.parentId || '';
        const grouped = String(groupA).localeCompare(String(groupB));
        if (grouped) return grouped;
        if (a.kind === 'group' && b.kind !== 'group') return -1;
        if (a.kind !== 'group' && b.kind === 'group') return 1;
      }
      return compareTask(a, b, sort);
    });
    const snapshot = { key, revision, view, search: lower(search), sort, groupBy, items, createdAt: now, expiresAt: now + this.snapshotTtlMs };
    this.snapshotCache.set(key, snapshot);
    this._pruneSnapshots(now);
    return snapshot;
  }

  _snapshotForCursor(cursor, expected) {
    this._pruneSnapshots();
    const snapshot = [...this.snapshotCache.values()].find((item) => item.revision === cursor.snapshotRevision && item.sort === cursor.sort && item.view === expected.view && item.search === lower(expected.search) && item.groupBy === expected.groupBy);
    if (!snapshot) throw queryError('CURSOR_EXPIRED', '任务列表已更新，请从首屏重新加载', { snapshotRevision: cursor.snapshotRevision });
    return snapshot;
  }

  _startIndex(snapshot, cursor) {
    if (!cursor) return 0;
    const index = snapshot.items.findIndex((task) => String(task.id) === String(cursor.taskId));
    if (index < 0) throw queryError('CURSOR_EXPIRED', '任务列表游标对应的任务已不存在');
    return index + 1;
  }

  async query(options = {}) {
    const view = normalizeView(options);
    const search = String(options.search === undefined ? options.query || '' : options.search);
    const sort = normalizeSort(options);
    const groupBy = ['none', 'date', 'task-group'].includes(options.groupBy) ? options.groupBy : 'date';
    const limit = normalizeLimit(options.limit);
    let cursor = null;
    let snapshot;
    const rawCursor = options.cursor;
    if (rawCursor !== undefined && rawCursor !== null && rawCursor !== '') {
      if (/^\d+$/.test(String(rawCursor))) {
        snapshot = this._snapshot({ view, search, sort, groupBy });
        cursor = { legacyOffset: Math.max(0, Number(rawCursor)) };
      } else {
        cursor = decodeCursor(rawCursor);
        if (cursor.sort !== sort || (cursor.view && cursor.view !== view) || (cursor.search && cursor.search !== lower(search))) throw queryError('INVALID_CURSOR', '任务列表游标与当前查询不匹配');
        snapshot = this._snapshotForCursor(cursor, { view, search, sort, groupBy });
      }
    } else snapshot = this._snapshot({ view, search, sort, groupBy });

    const start = cursor && cursor.legacyOffset !== undefined ? cursor.legacyOffset : this._startIndex(snapshot, cursor);
    const page = snapshot.items.slice(start, start + limit);
    const nextCursor = start + page.length < snapshot.items.length && page.length
      ? encodeCursor({ version: 1, sort, view, search: lower(search), groupBy, primary: sortPrimary(page[page.length - 1], sort), taskId: page[page.length - 1].id, snapshotRevision: snapshot.revision })
      : null;
    const counts = await this.counts();
    return {
      items: page.map((task) => presentTaskListItem(task, { runtime: this._runtime() })),
      total: snapshot.items.length,
      nextCursor,
      snapshotRevision: snapshot.revision,
      repositoryRevision: snapshot.revision,
      counts,
    };
  }

  async get({ taskId, includeFiles = true } = {}) {
    const task = this.tasks.require(taskId);
    if (task.privateSpace === true) throw queryError('PRIVATE_SPACE_LOCKED', '私人空间已锁定');
    return presentTask(task, { includeFiles, runtime: this._runtime() });
  }

  async counts() {
    const counts = { all: 0, active: 0, completed: 0, trash: 0, private: 0 };
    for (const task of this.tasks.list()) {
      if (task.lifecycle === 'recycled') counts.trash += 1;
      else {
        counts.all += 1;
        if (['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle)) counts.active += 1;
        if (['completed', 'failed', 'missing'].includes(task.lifecycle)) counts.completed += 1;
      }
      // 锁定状态不得暴露精确私人任务数量；私人页面通过独立 RPC 查询。
    }
    return { ...counts, repositoryRevision: this.tasks.repositoryRevision };
  }
}

module.exports = { TaskQueryService, normalizeView, normalizeSort, encodeCursor, decodeCursor };
