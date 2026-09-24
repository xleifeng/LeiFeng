'use strict';

function rangeError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }

function parseSingleRange(header, availableBytes) {
  const available = Number(availableBytes);
  if (!Number.isSafeInteger(available) || available < 0) throw rangeError('INVALID_RANGE', '可读取范围无效');
  if (header === undefined || header === null || String(header).trim() === '') return null;
  const value = String(header).trim();
  if (!/^bytes=/i.test(value)) throw rangeError('INVALID_RANGE', '只支持 bytes 范围');
  const spec = value.slice(value.indexOf('=') + 1).trim();
  if (!spec || spec.includes(',')) throw rangeError('MULTI_RANGE_UNSUPPORTED', '暂不支持多段范围');
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) throw rangeError('INVALID_RANGE', '范围格式无效');
  if (available === 0) throw rangeError('RANGE_NOT_AVAILABLE_YET', '文件尚未下载到可读取范围');
  let start; let end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw rangeError('INVALID_RANGE', '范围格式无效'); start = Math.max(0, available - suffix); end = available - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : available - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0) throw rangeError('INVALID_RANGE', '范围格式无效'); if (start >= available) throw rangeError('RANGE_NOT_AVAILABLE_YET', '尚未下载到该位置', { availableBytes: available }); if (end < start) throw rangeError('INVALID_RANGE', '范围格式无效'); end = Math.min(end, available - 1); }
  return { start, end, length: end - start + 1 };
}

function formatContentRange(start, end, totalKnownBytes = '*') { return `bytes ${start}-${end}/${totalKnownBytes}`; }
function matchesIfRange(value, etag, mtimeMs) { if (!value) return true; const candidate = String(value).trim(); if (candidate === String(etag)) return true; const date = Date.parse(candidate); return Number.isFinite(date) && Number.isFinite(Number(mtimeMs)) && Number(mtimeMs) <= date + 999; }

module.exports = { parseSingleRange, formatContentRange, matchesIfRange, rangeError };
