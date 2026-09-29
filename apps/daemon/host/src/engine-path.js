'use strict';

// 引擎落盘路径（Wine Z: 盘形态 / Windows 盘符形态）与宿主 Linux 路径的等价性归一：
// 只做分隔符与大小写归一，跨模式（wine/native）比较都经这里。
function normalizeComparableEnginePath(value) {
  let normalized = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  normalized = normalized.replace(/^z:/, '');
  return normalized || '/';
}

module.exports = { normalizeComparableEnginePath };
