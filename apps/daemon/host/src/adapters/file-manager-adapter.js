'use strict';

const path = require('node:path');

class FileManagerAdapter {
  constructor({ processRunner, opener = 'xdg-open', dbusCommand = 'dbus-send' } = {}) { if (!processRunner) throw new Error('FileManagerAdapter processRunner is required'); this.processRunner = processRunner; this.opener = opener; this.dbusCommand = dbusCommand; }
  open(target) { return this.processRunner.run(this.opener, [target]); }
  showInFolder(target) {
    const directory = path.dirname(target);
    if (process.env.DBUS_SESSION_BUS_ADDRESS && process.env.THUNDERD_USE_FILE_MANAGER_DBUS === '1') {
      return this.processRunner.run(this.dbusCommand, ['--session', '--dest=org.freedesktop.FileManager1', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems', `array:string:file://${encodeURI(target)}`, 'string:']).catch(() => this.processRunner.run(this.opener, [directory]));
    }
    return this.processRunner.run(this.opener, [directory]);
  }
}

module.exports = { FileManagerAdapter };
