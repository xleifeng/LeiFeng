'use strict';

class LinkSyncAdapter {
  constructor({ enabled = false } = {}) { this.enabled = enabled === true; }
  capability() { return this.enabled ? 'unverified' : 'local-only'; }
  async pull() { throw Object.assign(new Error('链接库同步协议尚未通过探针验证'), { code: 'LINK_SYNC_UNAVAILABLE' }); }
  async push() { throw Object.assign(new Error('链接库同步协议尚未通过探针验证'), { code: 'LINK_SYNC_UNAVAILABLE' }); }
  async deleteRemote() { throw Object.assign(new Error('链接库同步协议尚未通过探针验证'), { code: 'LINK_SYNC_UNAVAILABLE' }); }
}

module.exports = { LinkSyncAdapter };
