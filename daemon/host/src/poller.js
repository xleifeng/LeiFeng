'use strict';
const fs = require('fs');
const path = require('path');
const { readTasks, hasSqlite } = require('./taskdb-reader');
const { reduceObservation } = require('./domain/task-status');

// TaskDb 已验证状态：8=complete、9=error，下载中和暂停都可能表现为 5。
// ⚠ 关键：paused 与 downloading 共享整数 5，TaskDb Status 无法区分两者；daemon 必须依靠 registry 自身
// status 字段（active vs paused）区分，poller 对 paused 不自动迁移状态（仅刷新进度）。
// Status=7 为初始/已停止未下载态，不在 MAP 中。
// 官方全枚举见 domain/task-status.js NATIVE_STATUS 注释（0-12）；
// 4=StartPending/10=Seeding 由 V2 reducer（_tickV2 → reduceObservation）处理。
// 未知 Status 走增长启发式（active/waiting 迁移），仅 8/9/FailureErrorCode 走终态分支；未知值触发 console.warn。
// 8/9 语义恒定。
const STATUS_MAP = { complete: 8, error: 9, downloading: 5, paused: 5 };

class ProgressPoller {
  constructor(registry, opts = {}) {
    this.registry = registry;
    this.repository = registry && typeof registry.patchObservation === 'function' && typeof registry.repositoryRevision === 'number' ? registry : null;
    this.eventBus = opts.eventBus || null;
    this.dbPath = opts.dbPath || null;
    this.intervalMs = opts.intervalMs || 1000;
    this.stallMs = opts.stallMs || 10000;
    this.readTasksFn = opts.readTasksFn || (this.dbPath && hasSqlite ? ((ids) => readTasks(this.dbPath, ids)) : null);
    this.statFn = opts.statFn || ((p) => fs.statSync(p).size);
    this._timer = null;
    this._prev = new Map(); // gid -> {size, at, lastGrowthAt}
    this._warnedUnknown = new Set(); // 未知 Status 每个 gid 只告警一次。
    this._ticking = false;
  }
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => { this._tick().catch((e) => console.error('[poller]', e.message)); }, this.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  async _tick() {
    if (this._ticking) return; // 防重入
    this._ticking = true;
    try { await this._tickInner(); } finally { this._ticking = false; }
  }

  async _tickInner() {
    if (this.repository) return this._tickV2();
    const now = Date.now();
    const tracked = this.registry.list().filter((r) => r.status === 'active' || r.status === 'waiting' || r.status === 'paused');
    // 清理已离开 tracked 的任务残留。必须在下方早退之前执行，否则 tracked 为空时无法回收。
    const trackedGids = new Set(tracked.map((r) => r.gid));
    for (const g of this._prev.keys()) if (!trackedGids.has(g)) this._prev.delete(g);
    for (const g of this._warnedUnknown) if (!trackedGids.has(g)) this._warnedUnknown.delete(g);
    if (!tracked.length) return;
    // 主通道：TaskDb 批量读
    let rows = new Map();
    if (this.readTasksFn) {
      try { rows = await this.readTasksFn(tracked.map((r) => r.engineId).filter((x) => Number.isInteger(x))); }
      catch (e) { console.error('[poller] taskdb read failed (fallback to FS):', e.message); }
    }
    for (const r of tracked) {
      const row = rows.get(r.engineId);
      // 磁力 metadata-fetching：TaskDb 无行（engineId=magId 不对应 TaskBase 行）→ 保持 waiting 不迁态
      const isMagnetFetching = r.taskType === 'magnet' && r.metadataPhase === 'fetching' && !row;
      const prev = this._prev.get(r.gid) || { size: 0, at: r.createdAt, lastGrowthAt: r.createdAt };
      let size;
      if (row) size = row.totalReceiveSize;
      else if (isMagnetFetching) size = 0;   // 不走 FS 兜底（磁力 metadata 阶段无落盘数据文件）
      else { try { size = this.statFn(path.join(r.savePath, r.taskName)); } catch { size = 0; } }
      const dt = Math.max((now - prev.at) / 1000, 0.001);
      const speed = Math.max(0, Math.round((size - prev.size) / dt));
      const grew = size > prev.size;
      const lastGrowthAt = grew ? now : prev.lastGrowthAt;
      this._prev.set(r.gid, { size, at: now, lastGrowthAt });
      const patch = { completedLength: size };
      if (row && row.resourceSize > 0 && r.totalLength === 0) patch.totalLength = row.resourceSize;
      // 回读 TaskDb Name（引擎真实落盘名）以对齐 registry.taskName。
      // 每 tick 重读，对 createTask 写入延迟 / TaskDb flush 滞后全免疫。
      // patch 在状态迁移分支前构造 → complete/error 迁移与 taskName 修正同 tick 原子落。
      if (row && row.name && row.name !== r.taskName) {
        const san = path.basename(row.name); // 防 .. 路径逃逸（methods.js:59/91 均 join 用法）
        if (san && san !== '.' && san !== '..') patch.taskName = san;
      }
      // 磁力 metadata-fetching 早退：metadata 拉取中不迁 complete/error，不报 waiting→stall，
      // 保持 waiting + speed 0（row 必缺，上面 totalLength/name 回读分支均为 no-op）。
      if (isMagnetFetching) {
        patch.downloadSpeed = 0;
        this.registry.update(r.gid, patch);
        continue;
      }
      // 状态迁移：TaskDb 优先；paused 不自动迁移（但进度照更）；FS 兜底
      if (row) {
        // 未知 Status（不在 {5,8,9}）只记录日志，不改变任务状态；每个 gid 只告警一次。
        if (!Object.values(STATUS_MAP).includes(row.status) && !this._warnedUnknown.has(r.gid)) {
          this._warnedUnknown.add(r.gid);
          console.warn('[poller] unknown TaskDb Status:', row.status, 'for gid', r.gid);
        }
        // paused 不自动迁移（即使 TaskDb Status=8：引擎后台完成不应绕过 pause 状态——
        // 设计原则："poller 对 paused 不自动迁移状态（仅刷新进度）"；unpause 才离开 paused）
        if (r.status === 'paused') {
          patch.downloadSpeed = 0;
        } else if (row.failureErrorCode) {
          Object.assign(patch, { status: 'error', errorCode: String(row.failureErrorCode), errorMessage: 'engine reported failure', downloadSpeed: 0 });
          this._prev.delete(r.gid);
        } else if (row.status === STATUS_MAP.complete) {
          Object.assign(patch, { status: 'complete', downloadSpeed: 0 });
          this._prev.delete(r.gid);
        } else if (row.status === STATUS_MAP.error) {
          Object.assign(patch, { status: 'error', errorCode: 'engine-error', errorMessage: 'TaskDb error status', downloadSpeed: 0 });
          this._prev.delete(r.gid);
        } else {
          if (grew) Object.assign(patch, { status: 'active', downloadSpeed: speed });
          else if (r.status === 'active' && now - lastGrowthAt > this.stallMs) Object.assign(patch, { status: 'waiting', downloadSpeed: 0 });
          else patch.downloadSpeed = grew ? speed : 0;
        }
      } else {
        // FS 兜底（paused 也不自动迁移到 complete）
        if (r.status === 'paused') {
          patch.downloadSpeed = 0;
        } else if (r.totalLength > 0 && size >= r.totalLength) {
          Object.assign(patch, { status: 'complete', downloadSpeed: 0 });
          this._prev.delete(r.gid);
        } else {
          if (grew) Object.assign(patch, { status: 'active', downloadSpeed: speed });
          else if (r.status === 'active' && now - lastGrowthAt > this.stallMs) Object.assign(patch, { status: 'waiting', downloadSpeed: 0 });
          else patch.downloadSpeed = 0;
        }
      }
      this.registry.update(r.gid, patch);
    }
  }

  async _tickV2() {
    const now = Date.now();
    const tracked = this.repository.list().filter((task) => ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(task.lifecycle));
    const trackedIds = new Set(tracked.map((task) => task.id));
    for (const id of this._prev.keys()) if (!trackedIds.has(id)) this._prev.delete(id);
    for (const id of this._warnedUnknown) if (!trackedIds.has(id)) this._warnedUnknown.delete(id);
    if (!tracked.length) return;
    let rows = new Map();
    if (this.readTasksFn) {
      try { rows = await this.readTasksFn(tracked.map((task) => task.engineId).filter((id) => Number.isInteger(id))); }
      catch (e) { console.error('[poller] taskdb read failed (fallback to FS):', e.message); }
    }
    for (const task of tracked) {
      const row = rows.get(task.engineId);
      const metadataPending = task.lifecycle === 'metadata' && !row;
      const previous = this._prev.get(task.id) || { size: task.completedBytes || 0, at: task.createdAt || now, lastGrowthAt: task.createdAt || now };
      let size = row ? Math.max(0, Number(row.totalReceiveSize) || 0) : 0;
      if (!row && !metadataPending) {
        try {
          const target = path.join(task.savePath, task.displayName);
          const stat = fs.statSync(target);
          size = stat.isFile() ? stat.size : task.completedBytes || 0;
        } catch { size = task.completedBytes || 0; }
      }
      const dt = Math.max((now - previous.at) / 1000, 0.001);
      const grew = size > previous.size;
      const measured = grew ? Math.max(0, Math.round((size - previous.size) / dt)) : 0;
      const lastGrowthAt = grew ? now : previous.lastGrowthAt;
      this._prev.set(task.id, { size, at: now, lastGrowthAt });
      const observation = {
        engineGeneration: task.engineGeneration,
        taskDbFound: !!row,
        nativeStatus: row && row.status,
        failureErrorCode: row && row.failureErrorCode,
        resourceSize: row && row.resourceSize,
        receivedSize: size,
        // 引擎实时报速（快照内存态，TaskDb TotalReceiveSize 冻结时的速度兜底，reduceObservation 消费）
        engineDownloadBps: row && Math.max(0, Number(row.downloadSpeed) || 0),
        measuredDownloadBps: metadataPending ? 0 : measured,
        receivedGrew: grew,
        realTaskName: row && row.name,
        fileExists: metadataPending ? true : undefined,
        metadataFileReady: !metadataPending,
        stalled: task.lifecycle === 'downloading' && !grew && now - lastGrowthAt > this.stallMs,
      };
      const reduced = reduceObservation(task, observation, now);
      const patch = { ...reduced.patch };
      if (reduced.lifecycle !== task.lifecycle) patch.lifecycle = reduced.lifecycle;
      if (reduced.warnings.length) {
        for (const warning of reduced.warnings) {
          if (!this._warnedUnknown.has(task.id)) {
            this._warnedUnknown.add(task.id);
            console.warn('[poller] unknown TaskDb Status:', warning.nativeStatus, 'for task', task.id);
          }
        }
      }
      const updated = await Promise.resolve(this.repository.patchObservation(task.id, patch));
      if (this.eventBus && reduced.lifecycle !== task.lifecycle) this.eventBus.emit('task.transition', { taskId: task.id, from: task.lifecycle, to: reduced.lifecycle, revision: updated && updated.revision, at: now });
      if (this.eventBus) this.eventBus.emit('task.observation', { taskId: task.id, bytesPerSecond: measured, receivedBytes: size, at: now, lifecycle: reduced.lifecycle });
    }
  }
}

module.exports = { ProgressPoller, STATUS_MAP };
