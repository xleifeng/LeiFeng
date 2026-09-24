'use strict';

const fs = require('fs');
const path = require('path');

function pathProblem(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

class PathService {
  constructor({ defaultPath, recentPaths = null } = {}) { this.defaultPath = path.resolve(defaultPath || process.cwd()); this.recentPaths = recentPaths; }

  normalizeDownloadPath(input) {
    const value = String(input || this.defaultPath).trim();
    if (!value) throw pathProblem('INVALID_PATH', '保存目录不能为空');
    return path.resolve(value);
  }

  validateDisplayName(name) {
    const value = String(name || '').trim();
    if (!value || value.includes('\0') || value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.includes('..') || RESERVED_WINDOWS.test(value)) throw pathProblem('INVALID_NAME', '文件名无效');
    if (value.length > 255) throw pathProblem('INVALID_NAME', '文件名过长');
    return value;
  }

  validateDownloadTarget({ path: input, estimatedBytes = 0 } = {}) {
    const normalizedPath = this.normalizeDownloadPath(input);
    let exists = false; let creatable = true; let writable = false; let availableBytes = null;
    try { exists = fs.existsSync(normalizedPath); if (!exists) fs.mkdirSync(normalizedPath, { recursive: true }); } catch { creatable = false; }
    try { writable = exists || creatable ? (fs.accessSync(normalizedPath, fs.constants.W_OK), true) : false; } catch { writable = false; }
    try { if (typeof fs.statfsSync === 'function') { const stat = fs.statfsSync(normalizedPath); availableBytes = Number(stat.bavail) * Number(stat.bsize); } } catch {}
    const warnings = [];
    if (!creatable) warnings.push('目录无法创建');
    if (!writable) warnings.push('目录不可写');
    if (availableBytes !== null && Number(estimatedBytes) > availableBytes) warnings.push('磁盘空间不足');
    return { normalizedPath, exists, creatable, writable, availableBytes, maxFileBytes: Number.MAX_SAFE_INTEGER, warnings };
  }

  resolveCollision({ directory, displayName, policy = 'ask' } = {}) {
    const name = this.validateDisplayName(displayName);
    const targetDir = this.normalizeDownloadPath(directory);
    const target = path.join(targetDir, name);
    if (!fs.existsSync(target)) return { displayName: name, collision: false };
    if (policy === 'auto-rename') {
      const dot = name.lastIndexOf('.'); const stem = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : '';
      for (let index = 1; index < 10000; index += 1) { const candidate = `${stem} (${index})${ext}`; if (!fs.existsSync(path.join(targetDir, candidate))) return { displayName: candidate, collision: true }; }
    }
    return { displayName: name, collision: true };
  }

  listRecentPaths() { return this.recentPaths && this.recentPaths.list ? this.recentPaths.list() : [this.defaultPath]; }
  rememberPath(value) { return this.recentPaths && this.recentPaths.remember ? this.recentPaths.remember(this.normalizeDownloadPath(value)) : undefined; }
}

module.exports = { PathService, pathProblem, RESERVED_WINDOWS };
