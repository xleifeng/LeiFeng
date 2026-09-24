'use strict';

const fs = require('node:fs'); const path = require('node:path');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeSchedule(input = {}) {
  const days = Array.isArray(input.daysOfWeek) ? [...new Set(input.daysOfWeek.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b) : [];
  const action = ['start-all', 'pause-all', 'enable-full-speed', 'restore-limits'].includes(String(input.action)) ? String(input.action) : 'start-all';
  const localTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.localTime)) ? String(input.localTime) : '00:00';
  return { id: String(input.id || `schedule-${Date.now().toString(36)}`), name: String(input.name || '计划任务').slice(0, 80), enabled: input.enabled !== false, action, daysOfWeek: days, localTime, timezone: String(input.timezone || 'UTC'), nextRunAt: input.nextRunAt == null ? null : Number(input.nextRunAt), lastRunAt: input.lastRunAt == null ? null : Number(input.lastRunAt), lastResult: input.lastResult == null ? null : String(input.lastResult).slice(0, 240), executionKey: input.executionKey ? String(input.executionKey) : null, revision: Math.max(1, Number(input.revision) || 1) };
}

class ScheduleRepository {
  constructor({ filePath, clock = Date } = {}) { if (!filePath) throw new Error('ScheduleRepository filePath is required'); this.filePath = filePath; this.clock = clock; this.state = { schemaVersion: 1, revision: 0, schedules: [] }; this.loaded = false; this.readOnly = false; }
  load() { if (this.loaded) return this; this.loaded = true; if (!fs.existsSync(this.filePath)) return this; try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); if (!value || value.schemaVersion !== 1 || !Array.isArray(value.schedules)) throw new Error('invalid schedule schema'); this.state = { schemaVersion: 1, revision: Number(value.revision) || 0, schedules: value.schedules.map(normalizeSchedule) }; } catch { this.readOnly = true; } return this; }
  _ensure() { if (!this.loaded) this.load(); if (this.readOnly) throw Object.assign(new Error('schedule repository is read-only'), { code: 'REPOSITORY_READ_ONLY' }); }
  _write() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; const fd = fs.openSync(tmp, 'w', 0o600); try { fs.writeSync(fd, JSON.stringify(this.state, null, 2), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, this.filePath); }
  query() { this.load(); return { revision: this.state.revision, schedules: this.state.schedules.map(clone) }; }
  get(id) { this.load(); const value = this.state.schedules.find((item) => item.id === String(id)); return value ? clone(value) : null; }
  save(schedule, { expectedRevision } = {}) { this._ensure(); const value = normalizeSchedule(schedule); const index = this.state.schedules.findIndex((item) => item.id === value.id); if (index >= 0) { const current = this.state.schedules[index]; if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) throw Object.assign(new Error('计划任务已变化，请刷新后重试'), { code: 'REVISION_CONFLICT' }); value.revision = current.revision + 1; this.state.schedules[index] = value; } else { if (expectedRevision !== undefined && Number(expectedRevision) !== this.state.revision) throw Object.assign(new Error('计划任务列表已变化，请刷新后重试'), { code: 'REVISION_CONFLICT' }); this.state.schedules.push(value); } this.state.revision += 1; this._write(); return clone(value); }
  delete(id, { expectedRevision } = {}) { this._ensure(); const index = this.state.schedules.findIndex((item) => item.id === String(id)); if (index < 0) return false; if (expectedRevision !== undefined && Number(expectedRevision) !== this.state.schedules[index].revision) throw Object.assign(new Error('计划任务已变化，请刷新后重试'), { code: 'REVISION_CONFLICT' }); this.state.schedules.splice(index, 1); this.state.revision += 1; this._write(); return true; }
  markExecution(id, executionKey, { lastRunAt, nextRunAt, lastResult } = {}) { this._ensure(); const value = this.state.schedules.find((item) => item.id === String(id)); if (!value) return null; value.executionKey = String(executionKey); value.lastRunAt = lastRunAt == null ? value.lastRunAt : Number(lastRunAt); value.nextRunAt = nextRunAt == null ? value.nextRunAt : Number(nextRunAt); value.lastResult = lastResult == null ? value.lastResult : String(lastResult); value.revision += 1; this.state.revision += 1; this._write(); return clone(value); }
  close() { if (this.loaded && !this.readOnly) this._write(); }
}

module.exports = { ScheduleRepository, normalizeSchedule };
