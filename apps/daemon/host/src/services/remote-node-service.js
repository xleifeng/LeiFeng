'use strict';

const { validateEndpoint } = require('../repositories/remote-node-repository');

class RemoteNodeService {
  constructor({ repository, transport = null, clock = Date } = {}) { if (!repository) throw new Error('RemoteNodeService repository is required'); this.repository = repository; this.transport = transport; this.clock = clock; this.timer = null; }
  query() { return { items: this.repository.list() }; }
  acceptPairing(input = {}) {
    const endpoint = validateEndpoint(input.endpoint);
    if (!/^[a-f0-9]{64}$/i.test(String(input.serverFingerprint || ''))) { const error = new Error('远程证书指纹无效'); error.code = 'REMOTE_FINGERPRINT_INVALID'; throw error; }
    if (!this.transport?.pair) {
      if (input.pairingId || input.code) { const error = new Error('本机远程 mTLS 客户端证书尚未配置'); error.code = 'REMOTE_UNAVAILABLE'; throw error; }
      return this.repository.addPaired({ ...input, endpoint, certificateFingerprint: input.serverFingerprint, permissions: input.permissions || input.requestedPermissions });
    }
    return this._acceptPairing({ ...input, endpoint });
  }
  async _acceptPairing(input) {
    const accepted = await this.transport.pair(input);
    const node = this.repository.addPaired({ ...input, endpoint: input.endpoint, certificateFingerprint: input.serverFingerprint, permissions: accepted.permissions || input.requestedPermissions });
    try { return await this.refreshNode(node.id); } catch { return this.repository.get(node.id); }
  }
  remove({ nodeId } = {}) { return { removed: this.repository.remove(nodeId) }; }
  async refreshNode(nodeId) { const node = this.repository.get(nodeId); if (!node) throw Object.assign(new Error('远程节点不存在'), { code: 'REMOTE_NODE_NOT_FOUND' }); if (!this.transport) return this.repository.setState(node.id, 'offline', '未配置 mTLS transport'); try { const snapshot = await this.transport.hello(node); return this.repository.updateSnapshot(node.id, { ...snapshot, state: 'online' }); } catch (error) { this.repository.setState(node.id, 'offline', error.message); throw error; } }
  startHealthPolling(intervalMs = 15000) { this.stop(); this.timer = setInterval(() => { for (const node of this.repository.list()) this.refreshNode(node.id).catch(() => {}); }, intervalMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { RemoteNodeService };
