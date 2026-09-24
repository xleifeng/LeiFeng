'use strict';

const fs = require('node:fs');
const path = require('node:path');

function nodeError(code, message) { const error = new Error(message); error.code = code; return error; }
function validateEndpoint(value) { let url; try { url = new URL(String(value)); } catch { throw nodeError('REMOTE_ENDPOINT_INVALID', '远程节点地址无效'); } if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw nodeError('REMOTE_ENDPOINT_INVALID', '远程节点必须使用不带路径的 HTTPS 地址'); return url.origin; }

class RemoteNodeRepository {
  constructor({ filePath, clock = Date } = {}) { if (!filePath) throw new Error('RemoteNodeRepository filePath is required'); this.filePath = filePath; this.clock = clock; this.state = { nodes: [] }; }
  _now() { return Number(this.clock.now ? this.clock.now() : Date.now()); }
  load() { try { const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); if (value && Array.isArray(value.nodes)) this.state = { nodes: value.nodes }; } catch {} return this; }
  _save() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.filePath); }
  list() { return this.state.nodes.map((item) => JSON.parse(JSON.stringify(item))); }
  get(nodeId) { return this.list().find((item) => item.id === String(nodeId)) || null; }
  addPaired(input = {}) { const endpoint = validateEndpoint(input.endpoint); const id = String(input.id || require('node:crypto').randomBytes(8).toString('hex')); const node = { id, name: String(input.name || id).slice(0, 100), endpoint, certificateFingerprint: String(input.certificateFingerprint || '').toLowerCase(), permissions: [...new Set((input.permissions || ['view', 'submit', 'control']).filter((item) => ['submit', 'view', 'control', 'stream'].includes(item)))], state: 'offline', capabilities: input.capabilities && typeof input.capabilities === 'object' ? { ...input.capabilities } : {}, version: input.version ? String(input.version) : null, lastSeenAt: null, fetchedAt: null, remoteRevision: null }; const current = this.state.nodes.findIndex((item) => item.id === id); if (current >= 0) this.state.nodes[current] = { ...this.state.nodes[current], ...node }; else this.state.nodes.push(node); this._save(); return this.get(id); }
  updateSnapshot(nodeId, snapshot = {}) { const node = this.state.nodes.find((item) => item.id === String(nodeId)); if (!node) throw nodeError('REMOTE_NODE_NOT_FOUND', '远程节点不存在'); node.state = snapshot.state || 'online'; node.capabilities = snapshot.capabilities && typeof snapshot.capabilities === 'object' ? { ...snapshot.capabilities } : node.capabilities; node.version = snapshot.version ? String(snapshot.version) : node.version; node.lastSeenAt = this._now(); node.fetchedAt = node.lastSeenAt; node.remoteRevision = snapshot.remoteRevision ?? node.remoteRevision; this._save(); return this.get(node.id); }
  setState(nodeId, state, problem = null) { const node = this.state.nodes.find((item) => item.id === String(nodeId)); if (!node) return null; node.state = ['online', 'offline', 'untrusted', 'incompatible'].includes(state) ? state : 'offline'; node.problem = problem ? String(problem).slice(0, 300) : null; this._save(); return this.get(node.id); }
  remove(nodeId) { const before = this.state.nodes.length; this.state.nodes = this.state.nodes.filter((item) => item.id !== String(nodeId)); if (this.state.nodes.length !== before) this._save(); return before !== this.state.nodes.length; }
  assertPermission(nodeId, permission) { const node = this.get(nodeId); if (!node) throw nodeError('REMOTE_NODE_NOT_FOUND', '远程节点不存在'); if (node.state !== 'online') throw nodeError('REMOTE_NODE_OFFLINE', '远程节点当前离线'); if (!node.permissions.includes(permission)) throw nodeError('REMOTE_PERMISSION_DENIED', '远程节点权限不足'); return node; }
}

module.exports = { RemoteNodeRepository, validateEndpoint, nodeError };
