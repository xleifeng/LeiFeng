'use strict';

const { isTaskCommand } = require('../domain/task-commands');

function invalid(message, details) { const error = new Error(message); error.code = 'INVALID_ARGUMENT'; error.details = details; return error; }

function object(value, name = '参数') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${name}必须是对象`);
  return value;
}

function taskIds(value) {
  if (!Array.isArray(value) || value.length === 0) throw invalid('taskIds 不能为空');
  const ids = [...new Set(value.map((item) => typeof item === 'string' ? item : String(item || '')))].filter(Boolean);
  if (!ids.length || ids.length > 200) throw invalid('taskIds 数量必须在 1 到 200 之间');
  return ids;
}

function mutation(value, { requireTaskIds = true } = {}) {
  const input = object(value);
  const result = { ...input };
  if (requireTaskIds) result.taskIds = taskIds(input.taskIds);
  if (!isTaskCommand(input.command)) throw invalid('command 不受支持');
  if (input.expectedRevisions !== undefined && (!input.expectedRevisions || typeof input.expectedRevisions !== 'object' || Array.isArray(input.expectedRevisions))) throw invalid('expectedRevisions 必须是对象');
  if (input.options !== undefined && (!input.options || typeof input.options !== 'object' || Array.isArray(input.options))) throw invalid('options 必须是对象');
  if (requireTaskIds && typeof input.idempotencyKey !== 'string' && input.idempotencyKey !== undefined) throw invalid('idempotencyKey 必须是字符串');
  return result;
}

function query(value) {
  const input = value === undefined ? {} : object(value);
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw invalid('limit 必须在 1 到 200 之间');
  if (input.view !== undefined && !['all', 'downloading', 'completed', 'search', 'trash', 'private'].includes(String(input.view))) throw invalid('view 不受支持');
  if (input.sort !== undefined && !['created-desc', 'completed-desc', 'name-asc', 'size-desc', 'speed-desc', 'progress-desc', 'created-asc'].includes(String(input.sort))) throw invalid('sort 不受支持');
  if (input.groupBy !== undefined && !['none', 'date', 'task-group'].includes(String(input.groupBy))) throw invalid('groupBy 不受支持');
  if (input.cursor !== undefined && input.cursor !== null && typeof input.cursor !== 'string' && !(Number.isSafeInteger(Number(input.cursor)) && Number(input.cursor) >= 0)) throw invalid('cursor 无效');
  return { ...input, limit };
}

function taskGet(value) {
  const input = object(value);
  if (typeof input.taskId !== 'string' || !input.taskId) throw invalid('taskId 必填');
  return input;
}

function settingsUpdate(value) {
  const input = object(value);
  const patch = input.patch && typeof input.patch === 'object' ? input.patch : input;
  const expectedRevision = input.expectedRevision === undefined ? undefined : Number(input.expectedRevision);
  if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) throw invalid('expectedRevision 必须是整数');
  return { patch, expectedRevision };
}

function createPreflight(value) {
  const input = object(value);
  if (!Array.isArray(input.inputs) || input.inputs.length < 1 || input.inputs.length > 100) throw invalid('inputs 必须在 1 到 100 项之间');
  return input;
}

function draftGet(value) { const input = object(value); if (typeof input.draftId !== 'string' || !input.draftId) throw invalid('draftId 必填'); return input; }
function draftUpdate(value) { const input = draftGet(value); if (input.expectedRevision !== undefined && !Number.isSafeInteger(Number(input.expectedRevision))) throw invalid('expectedRevision 必须是整数'); if (input.selectedFileIndices !== undefined && !Array.isArray(input.selectedFileIndices)) throw invalid('selectedFileIndices 必须是数组'); return input; }
function draftCommit(value) { const input = object(value); if (!Array.isArray(input.draftIds) || !input.draftIds.length || input.draftIds.length > 100) throw invalid('draftIds 数量无效'); if (input.expectedRevisions !== undefined && (!input.expectedRevisions || typeof input.expectedRevisions !== 'object' || Array.isArray(input.expectedRevisions))) throw invalid('expectedRevisions 必须是对象'); return input; }
function draftCancel(value) { const input = object(value); if (!Array.isArray(input.draftIds) || !input.draftIds.length || input.draftIds.length > 100) throw invalid('draftIds 数量无效'); return input; }
function pathValidate(value) { return object(value); }
function recentPath(value) { const input = object(value); if (typeof input.path !== 'string' || !input.path.trim()) throw invalid('path 必填'); return input; }
function groupCommand(value) { const input = object(value); if (typeof input.parentTaskId !== 'string' || !input.parentTaskId) throw invalid('parentTaskId 必填'); if (!isTaskCommand(input.command)) throw invalid('任务组命令不受支持'); if (input.options !== undefined && (!input.options || typeof input.options !== 'object' || Array.isArray(input.options))) throw invalid('options 必须是对象'); return input; }
function operationGet(value) { const input = object(value); if (typeof input.operationId !== 'string' || !input.operationId) throw invalid('operationId 必填'); return input; }
function trashEmpty(value) { const input = value === undefined ? {} : object(value); if (input.taskIds !== undefined) input.taskIds = taskIds(input.taskIds); if (input.idempotencyKey !== undefined && typeof input.idempotencyKey !== 'string') throw invalid('idempotencyKey 必须是字符串'); return input; }

function policyUpdate(value) { const input = object(value); const expectedRevision = input.expectedRevision === undefined ? undefined : Number(input.expectedRevision); if (expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) throw invalid('expectedRevision 必须是整数'); if (input.patch !== undefined && (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch))) throw invalid('patch 必须是对象'); if (input.proxySecret !== undefined && (!input.proxySecret || typeof input.proxySecret !== 'object' || Array.isArray(input.proxySecret))) throw invalid('proxySecret 必须是对象'); return { ...input, expectedRevision, patch: input.patch || {} }; }
function queueMove(value) { const input = object(value); input.taskIds = taskIds(input.taskIds); if (!['top', 'up', 'down', 'bottom'].includes(String(input.target)) && !Number.isSafeInteger(Number(input.target))) throw invalid('queue target 无效'); return input; }
function scheduleSave(value) { const input = object(value); if (!input.schedule || typeof input.schedule !== 'object' || Array.isArray(input.schedule)) throw invalid('schedule 必须是对象'); return input; }
function scheduleDelete(value) { const input = object(value); if (typeof input.scheduleId !== 'string' || !input.scheduleId) throw invalid('scheduleId 必填'); return input; }
function downloadLimitWindow(value) {
  const input = object(value);
  if (typeof input.enabled !== 'boolean') throw invalid('enabled 必须是布尔值');
  if (input.startLocalTime !== undefined && typeof input.startLocalTime !== 'string') throw invalid('startLocalTime 必须是字符串');
  if (input.endLocalTime !== undefined && typeof input.endLocalTime !== 'string') throw invalid('endLocalTime 必须是字符串');
  if (input.timezone !== undefined && typeof input.timezone !== 'string') throw invalid('timezone 必须是字符串');
  return input;
}
function completionCancel(value) { const input = object(value); if (typeof input.operationId !== 'string' || !input.operationId) throw invalid('operationId 必填'); return input; }
function proxyTest(value) { return object(value); }

function password(value, name = 'password') { if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 1024) throw invalid(`${name} 无效`); return value; }
function accountStart(value) { return value === undefined || value === null ? {} : object(value); }
function privateSetup(value) { const input = object(value); password(input.password); if (input.directory !== undefined && (typeof input.directory !== 'string' || !input.directory.trim())) throw invalid('directory 无效'); return input; }
function privateUnlock(value) { const input = object(value); password(input.password); return input; }
function privateLock(value) { return value === undefined || value === null ? {} : object(value); }
function privateQuery(value) { return query(value === undefined ? {} : value); }
function privateMove(value, { out = false } = {}) { const input = object(value); if (typeof input.taskId !== 'string' || !input.taskId) throw invalid('taskId 必填'); if (out && (typeof input.targetDirectory !== 'string' || !input.targetDirectory.trim())) throw invalid('targetDirectory 必填'); if (input.expectedRevision !== undefined && !Number.isSafeInteger(Number(input.expectedRevision))) throw invalid('expectedRevision 必须是整数'); return input; }
function privatePasswordChange(value) { const input = object(value); password(input.oldPassword, 'oldPassword'); password(input.newPassword, 'newPassword'); return input; }
function historyQuery(value) { const input = value === undefined ? {} : object(value); if (input.result !== undefined && !['completed', 'failed', 'removed', 'active'].includes(String(input.result))) throw invalid('result 不受支持'); return { ...input, limit: input.limit === undefined ? 100 : Math.min(200, Math.max(1, Number(input.limit) || 0)) }; }
function historyId(value) { const input = object(value); if (typeof input.historyId !== 'string' || !input.historyId) throw invalid('historyId 必填'); return input; }
function historyIds(value) { const input = object(value); input.historyIds = taskIds(input.historyIds); return input; }
function linksQuery(value) { const input = value === undefined ? {} : object(value); if (input.favorite !== undefined && typeof input.favorite !== 'boolean') throw invalid('favorite 必须是布尔值'); return { ...input, limit: input.limit === undefined ? 100 : Math.min(200, Math.max(1, Number(input.limit) || 0)) }; }
function linkId(value) { const input = object(value); if (typeof input.linkId !== 'string' || !input.linkId) throw invalid('linkId 必填'); return input; }
function linkSave(value) { return object(value); }
function linkTags(value) { const input = object(value); if (typeof input.linkId !== 'string' || !input.linkId) throw invalid('linkId 必填'); if (!Array.isArray(input.tags) || input.tags.length > 50 || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 64)) throw invalid('tags 无效'); if (input.expectedRevision !== undefined && !Number.isSafeInteger(Number(input.expectedRevision))) throw invalid('expectedRevision 必须是整数'); return input; }
function linkIds(value) { const input = object(value); input.linkIds = taskIds(input.linkIds); return input; }

function capturePairingStart(value) { const input = value === undefined || value === null ? {} : object(value); if (input.permissions !== undefined && (!Array.isArray(input.permissions) || input.permissions.some((item) => !['submit', 'view', 'control', 'stream'].includes(item)))) throw invalid('permissions 无效'); return input; }
function captureClientRevoke(value) { const input = object(value); if (typeof input.clientId !== 'string' || !input.clientId) throw invalid('clientId 必填'); return input; }
function remotePairingStart(value) { return value === undefined || value === null ? {} : object(value); }
function remotePairingStop(value) { const input = object(value); if (typeof input.pairingId !== 'string' || !input.pairingId) throw invalid('pairingId 必填'); return input; }
function remoteNodeAccept(value) { const input = object(value); if (typeof input.endpoint !== 'string' || !/^https:\/\//i.test(input.endpoint)) throw invalid('endpoint 必须是 HTTPS'); if (typeof input.serverFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(input.serverFingerprint)) throw invalid('serverFingerprint 无效'); if (typeof input.pairingId !== 'string' || !input.pairingId) throw invalid('pairingId 必填'); if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw invalid('code 必须是六位数字'); if (input.requestedPermissions !== undefined && (!Array.isArray(input.requestedPermissions) || input.requestedPermissions.some((item) => !['submit', 'view', 'control', 'stream'].includes(item)))) throw invalid('requestedPermissions 无效'); return input; }
function remoteNodeRemove(value) { const input = object(value); if (typeof input.nodeId !== 'string' || !input.nodeId) throw invalid('nodeId 必填'); return input; }
function remoteTaskQuery(value) { const input = object(value); if (typeof input.nodeId !== 'string' || !input.nodeId) throw invalid('nodeId 必填'); return input; }
function remoteTaskCommand(value) { const input = object(value); input.compositeTaskIds = taskIds(input.compositeTaskIds); if (!input.compositeTaskIds.length) throw invalid('compositeTaskIds 不能为空'); if (typeof input.command !== 'string' || !input.command) throw invalid('command 必填'); return input; }
function diagnosticSystemGet(value) { return value === undefined || value === null ? {} : object(value); }
function diagnosticTaskGet(value) { const input = object(value); if (typeof input.taskId !== 'string' || !input.taskId) throw invalid('taskId 必填'); return input; }
function diagnosticEventsQuery(value) { const input = value === undefined || value === null ? {} : object(value); if (input.limit !== undefined && (!Number.isSafeInteger(Number(input.limit)) || Number(input.limit) < 1 || Number(input.limit) > 1000)) throw invalid('limit 无效'); return input; }
function diagnosticCheckRun(value) { const input = object(value); if (typeof input.checkId !== 'string' || !input.checkId) throw invalid('checkId 必填'); if (input.taskId !== undefined && typeof input.taskId !== 'string') throw invalid('taskId 无效'); return input; }
function diagnosticExportPrepare(value) { const input = value === undefined || value === null ? {} : object(value); if (input.taskIds !== undefined && (!Array.isArray(input.taskIds) || input.taskIds.length > 100 || input.taskIds.some((id) => typeof id !== 'string' || !id))) throw invalid('taskIds 无效'); return input; }
function diagnosticExportGet(value) { const input = object(value); if (typeof input.exportId !== 'string' || !input.exportId) throw invalid('exportId 必填'); return input; }
function diagnosticExportCancel(value) { return diagnosticExportGet(value); }
function systemRestart(value) { const input = value === undefined || value === null ? {} : object(value); if (input.force !== undefined && typeof input.force !== 'boolean') throw invalid('force 必须是布尔值'); return input; }

module.exports = { invalid, object, taskIds, mutation, query, taskGet, settingsUpdate, createPreflight, draftGet, draftUpdate, draftCommit, draftCancel, pathValidate, recentPath, groupCommand, operationGet, trashEmpty, policyUpdate, queueMove, scheduleSave, scheduleDelete, downloadLimitWindow, completionCancel, proxyTest, password, accountStart, privateSetup, privateUnlock, privateLock, privateQuery, privateMove, privatePasswordChange, historyQuery, historyId, historyIds, linksQuery, linkId, linkSave, linkTags, linkIds, capturePairingStart, captureClientRevoke, remotePairingStart, remotePairingStop, remoteNodeAccept, remoteNodeRemove, remoteTaskQuery, remoteTaskCommand, diagnosticSystemGet, diagnosticTaskGet, diagnosticEventsQuery, diagnosticCheckRun, diagnosticExportPrepare, diagnosticExportGet, diagnosticExportCancel, systemRestart };
