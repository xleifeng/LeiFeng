'use strict';

// 桌面通知：Linux 走 notify-send（DBUS 会话）；Windows 宿主服务进程无 GUI 框架，
// 用 PowerShell 的 Windows.UI.Notifications Toast（Win10+ 内置，无需额外依赖）。
function windowsToastScript() {
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml(@"',
    '<toast><visual><binding template="ToastGeneric"><text>__TITLE__</text><text>__BODY__</text></binding></visual></toast>',
    '"@)',
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("__APPID__").Show($toast)',
  ].join('\n');
}

const PS_ESCAPE = { "'": "''", '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' };
function xmlEscape(value) { return String(value).replace(/["'<>&]/g, (ch) => PS_ESCAPE[ch]); }

class DesktopNotificationAdapter {
  constructor({ processRunner, powershellExe = process.env.THUNDERD_POWERSHELL || 'powershell.exe' } = {}) { this.processRunner = processRunner; this.powershellExe = powershellExe; }
  isAvailable() {
    if (process.platform === 'win32') return Boolean(this.processRunner);
    return Boolean(this.processRunner && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.DBUS_SESSION_BUS_ADDRESS));
  }
  async show({ title = '迅雷下载', body = '', private: isPrivate = false } = {}) {
    if (!this.processRunner || !this.isAvailable()) return { delivered: false };
    const safeTitle = String(title).replace(/[\r\n]/g, ' ').slice(0, 120);
    const safeBody = String(isPrivate ? '私人空间任务已完成' : body).replace(/[\r\n]/g, ' ').slice(0, 500);
    try {
      if (process.platform === 'win32') {
        // 参数化注入 Toast XML：标题/正文做 XML+PowerShell 双层转义，模板占位后整体作 -EncodedCommand
        //（Base64 UTF-16LE），避免引号层级与 PowerShell 注入。
        const script = windowsToastScript().replace('__TITLE__', xmlEscape(safeTitle)).replace('__BODY__', xmlEscape(safeBody)).replace('__APPID__', 'Thunder.Xunlei.Download');
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        await this.processRunner.run(this.powershellExe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
        return { delivered: true };
      }
      await this.processRunner.run('notify-send', [safeTitle, safeBody]);
      return { delivered: true };
    } catch { return { delivered: false }; }
  }
  notify(input) { return this.show(input); }
  close() { return Promise.resolve({ closed: true }); }
}

module.exports = { DesktopNotificationAdapter };
