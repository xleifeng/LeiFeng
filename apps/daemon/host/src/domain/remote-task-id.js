'use strict';

function invalid(message) { const error = new Error(message); error.code = 'INVALID_REMOTE_TASK_ID'; return error; }
function encodeRemoteTaskId(nodeId, taskId) { if (!nodeId || !taskId) throw invalid('远程任务标识缺少 nodeId/taskId'); return `r2.${Buffer.from(JSON.stringify({ v: 1, nodeId: String(nodeId), taskId: String(taskId) }), 'utf8').toString('base64url')}`; }
function decodeRemoteTaskId(value) { const text = String(value || ''); if (!text.startsWith('r2.')) throw invalid('远程任务标识无效'); let parsed; try { parsed = JSON.parse(Buffer.from(text.slice(3), 'base64url').toString('utf8')); } catch { throw invalid('远程任务标识无效'); } if (!parsed || parsed.v !== 1 || !parsed.nodeId || !parsed.taskId) throw invalid('远程任务标识无效'); return { nodeId: String(parsed.nodeId), taskId: String(parsed.taskId) }; }

module.exports = { encodeRemoteTaskId, decodeRemoteTaskId };
