'use strict';

const { encodeRemoteTaskId, decodeRemoteTaskId } = require('../domain/remote-task-id');

class RemoteTaskService {
  constructor({ nodes, clientFactory } = {}) { if (!nodes) throw new Error('RemoteTaskService nodes is required'); this.nodes = nodes; this.clientFactory = clientFactory; }
  _client(node) { if (!this.clientFactory) { const error = new Error('远程 mTLS client 未配置'); error.code = 'REMOTE_UNAVAILABLE'; throw error; } return this.clientFactory(node); }
  async query({ nodeId, taskQuery = {} } = {}) { const node = this.nodes.repository.assertPermission(nodeId, 'view'); const result = await this._client(node).request('POST', '/remote/v1/tasks/query', taskQuery); return { ...result, items: (result.items || []).map((item) => ({ ...item, id: encodeRemoteTaskId(node.id, item.id), remoteNodeId: node.id, badges: [...new Set([...(item.badges || []), 'remote'])] })) }; }
  async command({ compositeTaskIds, command, options = {}, idempotencyKey } = {}) { const grouped = new Map(); for (const composite of compositeTaskIds || []) { const value = decodeRemoteTaskId(composite); if (!grouped.has(value.nodeId)) grouped.set(value.nodeId, []); grouped.get(value.nodeId).push(value.taskId); } const results = []; for (const [nodeId, taskIds] of grouped) { const node = this.nodes.repository.assertPermission(nodeId, 'control'); const result = await this._client(node).request('POST', '/remote/v1/tasks/command', { taskIds, command, options, idempotencyKey }); for (const item of result.results || []) results.push({ ...item, taskId: encodeRemoteTaskId(nodeId, item.taskId) }); } return { operationId: `remote-${Date.now().toString(36)}`, results }; }
}

module.exports = { RemoteTaskService };
