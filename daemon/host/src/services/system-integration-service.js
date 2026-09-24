'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProcessRunner } = require('../adapters/process-runner');
const { FileManagerAdapter } = require('../adapters/file-manager-adapter');

class SystemIntegrationService {
  constructor({ resolver, tasks = null, processRunner = new ProcessRunner(), fileManager = null, opener = 'xdg-open' } = {}) { if (!resolver) throw new Error('SystemIntegrationService resolver is required'); this.resolver = resolver; this.tasks = tasks; this.processRunner = processRunner; this.fileManager = fileManager || new FileManagerAdapter({ processRunner, opener }); }

  getCapabilities() { const desktop = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && Boolean(process.env.DBUS_SESSION_BUS_ADDRESS); return { openOnHost: desktop, showInFolder: desktop, headless: !desktop }; }

  _requireTask(taskId) { if (!this.tasks) { const error = new Error('任务服务不可用'); error.code = 'SYSTEM_INTEGRATION_UNAVAILABLE'; throw error; } return this.tasks.require(taskId); }

  _target(task, fileIndex) {
    const target = this.resolver.resolveTaskFile(task, fileIndex);
    if (!fs.existsSync(target)) { const error = new Error('任务文件不存在'); error.code = 'FILE_NOT_FOUND'; throw error; }
    return target;
  }

  async open(task, { fileIndex } = {}) {
    const target = this._target(task, fileIndex);
    await this.fileManager.open(target);
    return { target };
  }

  async showInFolder(task, { fileIndex } = {}) {
    const target = this._target(task, fileIndex);
    const directory = fs.statSync(target).isDirectory() ? target : path.dirname(target);
    if (typeof this.fileManager.showInFolder === 'function') await this.fileManager.showInFolder(target);
    else await this.fileManager.open(directory);
    return { target, directory };
  }

  async openFile({ taskId, fileIndex } = {}) { return this.open(this._requireTask(taskId), { fileIndex }); }
  async showTaskInFolder({ taskId, fileIndex } = {}) { return this.showInFolder(this._requireTask(taskId), { fileIndex }); }
  async openFolder({ taskId } = {}) { const task = this._requireTask(taskId); const directory = this.resolver.resolveDirectory(task.savePath); await this.fileManager.open(directory); return { directory }; }
}

module.exports = { SystemIntegrationService };
