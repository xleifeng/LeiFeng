'use strict';

const fs = require('fs');
const path = require('path');

class FileOperationService {
  constructor({ resolver } = {}) { if (!resolver) throw new Error('FileOperationService resolver is required'); this.resolver = resolver; }
  _remove(target) { if (!fs.existsSync(target)) return false; const stat = fs.lstatSync(target); if (stat.isSymbolicLink()) { const error = new Error('拒绝删除符号链接'); error.code = 'SYMLINK_PATH'; throw error; } if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: false }); else fs.unlinkSync(target); return true; }
  deleteTaskFiles(task, { before } = {}) { const target = this.resolver.resolveTaskRoot(task); if (before) this.resolver.assertUnchanged(before, target); return { deleted: this._remove(target), target }; }
  snapshotTaskFiles(task) { const target = this.resolver.resolveTaskRoot(task); return this.resolver.snapshot(target); }
  moveTaskFiles(task, targetDirectory, { before } = {}) { const source = this.resolver.resolveTaskRoot(task); if (before) this.resolver.assertUnchanged(before, source); const directory = this.resolver.resolveDirectory(targetDirectory); fs.mkdirSync(directory, { recursive: true }); const target = path.join(directory, path.basename(source)); this.resolver.assertInsideAllowedRoots(target); if (fs.existsSync(target)) { const error = new Error('目标位置已存在同名文件'); error.code = 'NAME_COLLISION'; throw error; } if (!fs.existsSync(source)) { const error = new Error('任务文件不存在'); error.code = 'FILE_NOT_FOUND'; throw error; } try { fs.renameSync(source, target); } catch (error) { if (!['EXDEV', 'EACCES', 'EPERM'].includes(error.code)) throw error; const temporary = path.join(directory, `.thunder-moving-${process.pid}-${Date.now()}`); try { fs.cpSync(source, temporary, { recursive: true, errorOnExist: true }); fs.renameSync(temporary, target); this._remove(source); } catch (cause) { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch {} throw cause; } } return { source, target }; }
  renameTaskFile(task, displayName, { before } = {}) { const source = this.resolver.resolveTaskRoot(task); if (before) this.resolver.assertUnchanged(before, source); const directory = path.dirname(source); const target = this.resolver.assertInsideAllowedRoots(path.join(directory, displayName)); if (path.resolve(source) === path.resolve(target)) return { source, target }; if (fs.existsSync(target)) { const error = new Error('目标位置已存在同名文件'); error.code = 'NAME_COLLISION'; throw error; } if (!fs.existsSync(source)) { const error = new Error('任务文件不存在'); error.code = 'FILE_NOT_FOUND'; throw error; } fs.renameSync(source, target); return { source, target }; }
}

module.exports = { FileOperationService };
