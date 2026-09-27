'use strict';

const path = require('node:path');

// opener 默认平台分流：Linux 桌面 xdg-open；Windows 用 explorer.exe（open 与 showInFolder
// 都接受文件/目录参数，showInFolder 用 /select 定位到具体文件）。显式传入 opener 优先。
function defaultOpener() { return process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'; }

class FileManagerAdapter {
  constructor({ processRunner, opener, dbusCommand = 'dbus-send' } = {}) { if (!processRunner) throw new Error('FileManagerAdapter processRunner is required'); this.processRunner = processRunner; this.opener = opener || defaultOpener(); this.dbusCommand = dbusCommand; }
  open(target) { return this.processRunner.run(this.opener, [target]); }
  showInFolder(target) {
    const directory = path.dirname(target);
    if (process.platform === 'win32') {
      // explorer /select,<path>（带逗号）：打开父目录并选中该文件。explorer 对不存在的
      // 路径静默成功，语义上无回退必要；出错时退回打开目录。
      return this.processRunner.run(this.opener, [`/select,${target}`]).catch(() => this.processRunner.run(this.opener, [directory]));
    }
    if (process.env.DBUS_SESSION_BUS_ADDRESS && process.env.THUNDERD_USE_FILE_MANAGER_DBUS === '1') {
      return this.processRunner.run(this.dbusCommand, ['--session', '--dest=org.freedesktop.FileManager1', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems', `array:string:file://${encodeURI(target)}`, 'string:']).catch(() => this.processRunner.run(this.opener, [directory]));
    }
    return this.processRunner.run(this.opener, [directory]);
  }
}

module.exports = { FileManagerAdapter, defaultOpener };
