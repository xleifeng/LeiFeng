'use strict';

class DesktopNotificationAdapter {
  constructor({ processRunner } = {}) { this.processRunner = processRunner; }
  isAvailable() { return Boolean(this.processRunner && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.DBUS_SESSION_BUS_ADDRESS)); }
  async show({ title = '迅雷下载', body = '', private: isPrivate = false } = {}) { if (!this.processRunner || !this.isAvailable()) return { delivered: false }; const safeTitle = String(title).replace(/[\r\n]/g, ' ').slice(0, 120); const safeBody = String(isPrivate ? '私人空间任务已完成' : body).replace(/[\r\n]/g, ' ').slice(0, 500); try { await this.processRunner.run('notify-send', [safeTitle, safeBody]); return { delivered: true }; } catch { return { delivered: false }; } }
  notify(input) { return this.show(input); }
  close() { return Promise.resolve({ closed: true }); }
}

module.exports = { DesktopNotificationAdapter };
