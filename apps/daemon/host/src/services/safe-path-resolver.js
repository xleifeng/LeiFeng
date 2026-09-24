'use strict';

const fs = require('fs');
const path = require('path');

function pathError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

class SafePathResolver {
  constructor({ allowedRoots = [], fsImpl = fs } = {}) { this.fs = fsImpl; this.allowedRoots = [...new Set(allowedRoots.map((root) => path.resolve(root)))]; if (!this.allowedRoots.length) throw new Error('SafePathResolver requires allowedRoots'); }
  _inside(target) { const resolved = path.resolve(target); return this.allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)); }
  assertInsideAllowedRoots(target) { if (!this._inside(target)) throw pathError('UNSAFE_PATH', '目标路径不在允许的下载目录内'); return path.resolve(target); }
  _assertNoSymlink(target) { let current = path.resolve(target); const missing = []; while (!this.fs.existsSync(current)) { missing.push(current); const parent = path.dirname(current); if (parent === current) break; current = parent; } while (current) { const stat = this.fs.lstatSync(current); if (stat.isSymbolicLink()) throw pathError('SYMLINK_PATH', '目标路径包含符号链接'); const parent = path.dirname(current); if (parent === current) break; current = parent; } return missing; }
  resolveTaskRoot(task) { if (!task || typeof task.savePath !== 'string' || !task.savePath || typeof task.displayName !== 'string' || !task.displayName) throw pathError('UNSAFE_PATH', '任务保存位置无效'); const base = this.assertInsideAllowedRoots(task.savePath); const target = this.assertInsideAllowedRoots(path.join(base, task.displayName)); this._assertNoSymlink(base); this._assertNoSymlink(target); return target; }
  resolveTaskFile(task, fileIndex) {
    const root = this.resolveTaskRoot(task);
    if (fileIndex === undefined || fileIndex === null) return root;
    const index = Number(fileIndex);
    if (!Number.isSafeInteger(index) || index < 0) throw pathError('INVALID_FILE_INDEX', '文件索引无效');
    const file = Array.isArray(task.files) ? task.files.find((item) => Number(item.index) === index) : null;
    // 单文件任务没有 TaskDb file list 时，fileIndex=0 仍指向任务根文件。
    if (!file && index === 0 && (!Array.isArray(task.files) || task.files.length === 0)) return root;
    if (!file) throw pathError('FILE_NOT_FOUND', '任务文件不存在');
    const relative = String(file.path || file.name || '').replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw pathError('UNSAFE_PATH', '任务文件路径无效');
    const target = this.assertInsideAllowedRoots(path.join(root, relative));
    this._assertNoSymlink(root); this._assertNoSymlink(target);
    return target;
  }
  resolveDirectory(input) { const target = this.assertInsideAllowedRoots(input); this._assertNoSymlink(target); return target; }
  snapshot(target) { const resolved = path.resolve(target); let stat = null; try { stat = this.fs.lstatSync(resolved); } catch (error) { if (error.code !== 'ENOENT') throw error; } return { path: resolved, exists: !!stat, dev: stat ? Number(stat.dev) : null, ino: stat ? Number(stat.ino) : null, size: stat ? Number(stat.size) : null, mtimeMs: stat ? Number(stat.mtimeMs) : null, mode: stat ? Number(stat.mode) : null }; }
  assertUnchanged(before, target) { const after = this.snapshot(target); if (before.exists !== after.exists || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw pathError('FILE_CHANGED_DURING_OPERATION', '文件在操作期间发生变化', { before, after }); return after; }
}

module.exports = { SafePathResolver, pathError };
