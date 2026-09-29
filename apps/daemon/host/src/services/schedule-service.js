'use strict';

const { normalizeSchedule } = require('../repositories/schedule-repository');

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const DOWNLOAD_LIMIT_WINDOW_IDS = Object.freeze({
  start: 'download-limit-window-start',
  end: 'download-limit-window-end',
});

function scheduleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function partsAt(value, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour) % 24, minute: Number(map.minute), weekday: WEEKDAYS[map.weekday] };
  } catch { return partsAt(value, 'UTC'); }
}
function localKey(value, timezone) { const p = partsAt(value, timezone); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}:${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
function validLocalTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)); }
function normalizeTimezone(value) {
  const timezone = String(value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0); }
  catch { throw scheduleError('INVALID_TIMEZONE', '时区无效'); }
  return timezone;
}
function minutesFromTime(value) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)); }
function isInsideDownloadLimitWindow({ startLocalTime, endLocalTime, timezone }, now = Date.now()) {
  if (!validLocalTime(startLocalTime) || !validLocalTime(endLocalTime) || startLocalTime === endLocalTime) return false;
  const current = partsAt(now, timezone);
  const minute = current.hour * 60 + current.minute;
  const start = minutesFromTime(startLocalTime);
  const end = minutesFromTime(endLocalTime);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
function runtimeProblem(error) {
  return {
    code: String(error && error.code || 'LIMIT_WINDOW_RUNTIME_FAILED'),
    message: String(error && error.message || error || '限速时间段运行时应用失败').slice(0, 180),
  };
}

class ScheduleService {
  constructor({ repository, taskService, policyService, clock = Date, tickMs = 30 * 1000 } = {}) { if (!repository) throw new Error('ScheduleService repository is required'); this.repository = repository; this.taskService = taskService; this.policyService = policyService; this.clock = clock; this.tickMs = tickMs; this.timer = null; }
  query() {
    const snapshot = this.repository.query();
    const managed = new Set(Object.values(DOWNLOAD_LIMIT_WINDOW_IDS));
    return { ...snapshot, schedules: snapshot.schedules.filter((schedule) => !managed.has(schedule.id)) };
  }
  save({ schedule, expectedRevision } = {}) { const value = normalizeSchedule(schedule); value.nextRunAt = this.computeNextRun(value, this._now()); return { schedule: this.repository.save(value, { expectedRevision }), revision: this.repository.query().revision }; }
  delete({ scheduleId, expectedRevision } = {}) { const deleted = this.repository.delete(scheduleId, { expectedRevision }); return { deleted, revision: this.repository.query().revision }; }
  setEnabled({ scheduleId, enabled, expectedRevision } = {}) { const current = this.repository.get(scheduleId); if (!current) throw Object.assign(new Error('计划任务不存在'), { code: 'SCHEDULE_NOT_FOUND' }); return this.save({ schedule: { ...current, enabled: enabled === true }, expectedRevision }); }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  getDownloadLimitWindow() {
    const start = this.repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.start);
    const end = this.repository.get(DOWNLOAD_LIMIT_WINDOW_IDS.end);
    const configured = !!(start || end);
    const coherent = !!(start && end && start.action === 'restore-limits' && end.action === 'enable-full-speed');
    const timezone = String(start?.timezone || end?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const value = {
      configured,
      enabled: coherent && start.enabled && end.enabled,
      startLocalTime: validLocalTime(start?.localTime) ? start.localTime : '00:00',
      endLocalTime: validLocalTime(end?.localTime) ? end.localTime : '23:59',
      timezone,
      scheduleIds: [start?.id, end?.id].filter(Boolean),
      problemCode: configured && !coherent ? 'LIMIT_WINDOW_INCOMPLETE' : null,
    };
    return { ...value, activeNow: value.enabled && isInsideDownloadLimitWindow(value, this._now()) };
  }
  _saveDownloadLimitSchedule(id, value) {
    const current = this.repository.get(id);
    return this.save({ schedule: { ...(current || {}), ...value, id }, expectedRevision: current?.revision }).schedule;
  }
  _refreshDownloadLimitNextRuns() {
    const now = this._now();
    for (const id of Object.values(DOWNLOAD_LIMIT_WINDOW_IDS)) {
      const current = this.repository.get(id);
      if (!current || !current.enabled || (current.nextRunAt !== null && Number(current.nextRunAt) > now)) continue;
      const nextRunAt = this.computeNextRun(current, now);
      this.repository.save({ ...current, nextRunAt }, { expectedRevision: current.revision });
    }
  }
  async setDownloadLimitWindow({ enabled, startLocalTime = '00:00', endLocalTime = '23:59', timezone } = {}) {
    if (enabled !== true && enabled !== false) throw scheduleError('INVALID_ARGUMENT', 'enabled 必须是布尔值');
    const zone = normalizeTimezone(timezone);
    if (!validLocalTime(startLocalTime) || !validLocalTime(endLocalTime)) throw scheduleError('INVALID_LOCAL_TIME', '限速时间必须为 HH:mm');
    if (enabled && startLocalTime === endLocalTime) throw scheduleError('INVALID_LIMIT_WINDOW', '开始和结束时间不能相同');
    if (enabled) {
      const policy = this.policyService?.get?.()?.policy;
      if (policy && policy.globalDownloadLimit === null && policy.globalUploadLimit === null) throw scheduleError('LIMIT_WINDOW_REQUIRES_LIMIT', '至少启用一项下载或上传限速');
      this._saveDownloadLimitSchedule(DOWNLOAD_LIMIT_WINDOW_IDS.start, { name: '开始限速下载', enabled: true, action: 'restore-limits', daysOfWeek: ALL_DAYS, localTime: startLocalTime, timezone: zone });
      this._saveDownloadLimitSchedule(DOWNLOAD_LIMIT_WINDOW_IDS.end, { name: '结束限速下载', enabled: true, action: 'enable-full-speed', daysOfWeek: ALL_DAYS, localTime: endLocalTime, timezone: zone });
    } else {
      for (const id of Object.values(DOWNLOAD_LIMIT_WINDOW_IDS)) {
        const current = this.repository.get(id);
        if (current) this.repository.delete(id, { expectedRevision: current.revision });
      }
    }
    const runtime = await this.syncDownloadLimitWindowRuntime({ reason: 'user-update' });
    return { ...this.getDownloadLimitWindow(), revision: this.repository.query().revision, runtime };
  }
  async syncDownloadLimitWindowRuntime({ reason = 'reconcile' } = {}) {
    this._refreshDownloadLimitNextRuns();
    const window = this.getDownloadLimitWindow();
    if (!this.policyService) return { applied: false, reason, problem: { code: 'POLICY_SERVICE_UNAVAILABLE', message: '下载策略服务不可用' } };
    try {
      const response = window.enabled && window.activeNow
        ? await this.policyService.restoreLimits()
        : window.enabled
          ? await this.policyService.enableFullSpeed()
          : await this.policyService.restoreLimits();
      return { applied: true, reason, mode: window.enabled && !window.activeNow ? 'full-speed' : 'limited', response };
    } catch (error) {
      return { applied: false, reason, problem: runtimeProblem(error) };
    }
  }
  computeNextRun(schedule, from = this._now()) {
    const value = normalizeSchedule(schedule); if (!value.enabled || !value.daysOfWeek.length) return null;
    const start = Math.floor(Number(from) / 60000) * 60000 + 60000;
    for (let offset = 0; offset <= 8 * 24 * 60; offset++) { const candidate = start + offset * 60000; const p = partsAt(candidate, value.timezone); if (value.daysOfWeek.includes(p.weekday) && p.hour === Number(value.localTime.slice(0, 2)) && p.minute === Number(value.localTime.slice(3))) return candidate; }
    return null;
  }
  async _run(schedule) {
    const now = this._now(); const key = `${schedule.id}:${localKey(now, schedule.timezone)}`; if (schedule.executionKey === key) return { skipped: true, executionKey: key };
    const nextRunAt = this.computeNextRun(schedule, now); this.repository.markExecution(schedule.id, key, { lastRunAt: now, nextRunAt, lastResult: 'running' });
    try {
      if (schedule.action === 'enable-full-speed') await this.policyService?.enableFullSpeed?.();
      else if (schedule.action === 'restore-limits') await this.policyService?.restoreLimits?.();
      else {
        const tasks = this.taskService?.tasks?.list?.() || [];
        const ids = tasks.filter((task) => task.lifecycle !== 'recycled' && (schedule.action === 'start-all' ? ['queued', 'paused', 'failed'].includes(task.lifecycle) : ['downloading', 'queued'].includes(task.lifecycle))).map((task) => task.id);
        if (ids.length) await this.taskService.command({ taskIds: ids, command: schedule.action === 'start-all' ? 'start' : 'pause', options: {}, idempotencyKey: key });
      }
      this.repository.markExecution(schedule.id, key, { lastResult: 'ok' }); return { ok: true, executionKey: key };
    } catch (error) { this.repository.markExecution(schedule.id, key, { lastResult: `${error.code || 'FAILED'}:${String(error.message || error).slice(0, 120)}` }); return { ok: false, executionKey: key }; }
  }
  async tick(now = this._now()) { const due = this.repository.query().schedules.filter((schedule) => schedule.enabled && schedule.nextRunAt !== null && Number(schedule.nextRunAt) <= Number(now)); const results = []; for (const schedule of due) results.push(await this._run(schedule)); return results; }
  start() { if (this.timer) return; this.syncDownloadLimitWindowRuntime({ reason: 'startup' }).catch(() => {}); this.timer = setInterval(() => this.tick().catch(() => {}), this.tickMs); if (this.timer.unref) this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { ScheduleService, partsAt, localKey, validLocalTime, isInsideDownloadLimitWindow, DOWNLOAD_LIMIT_WINDOW_IDS };
