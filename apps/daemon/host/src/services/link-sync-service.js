'use strict';

class LinkSyncService {
  constructor({ adapter = null } = {}) { this.adapter = adapter; this.enabled = false; }
  capability() { return this.adapter?.capability?.() || 'local-only'; }
  async stopAndClearSession() { this.enabled = false; return { stopped: true }; }
  start() { return false; }
}

module.exports = { LinkSyncService };
