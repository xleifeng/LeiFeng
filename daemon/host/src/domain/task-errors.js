'use strict';

const ACTIONS = new Set(['retry', 'change-source', 'change-path', 'login', 'diagnose']);

const ERROR_RULES = [
  { test: /disk|space|quota|no space|enospc/i, code: 'DISK_FULL', category: 'filesystem', message: '磁盘空间不足', retryable: false, actions: ['change-path', 'diagnose'] },
  { test: /path.*long|name.*too long|enametoolong/i, code: 'PATH_TOO_LONG', category: 'filesystem', message: '保存路径或文件名过长', retryable: false, actions: ['change-path', 'diagnose'] },
  { test: /permission|access denied|eacces|eperm/i, code: 'PERMISSION_DENIED', category: 'permission', message: '没有访问保存目录的权限', retryable: false, actions: ['change-path', 'diagnose'] },
  { test: /occup|busy|sharing violation|ebusy/i, code: 'FILE_BUSY', category: 'filesystem', message: '文件正在被其他程序占用', retryable: true, actions: ['retry', 'diagnose'] },
  { test: /invalid.*(url|uri)|bad.*(link|url)|not found|404|410|expired|link.*invalid/i, code: 'SOURCE_INVALID', category: 'source', message: '下载来源无效或已失效', retryable: false, actions: ['change-source', 'diagnose'] },
  { test: /copyright|forbidden|legal|blocked|版权|法规/i, code: 'SOURCE_RESTRICTED', category: 'source', message: '下载来源受到版权或法规限制', retryable: false, actions: ['change-source', 'diagnose'] },
  { test: /login|auth|token|credential|account/i, code: 'ACCOUNT_REQUIRED', category: 'account', message: '需要登录或刷新账号授权', retryable: true, actions: ['login', 'retry', 'diagnose'] },
  { test: /timeout|timed out|etimedout|network|socket|connection|dns|econn/i, code: 'NETWORK_ERROR', category: 'network', message: '网络连接失败或超时', retryable: true, actions: ['retry', 'change-source', 'diagnose'] },
  { test: /engine|sdk|native|wine|not started|unavailable/i, code: 'ENGINE_UNAVAILABLE', category: 'engine', message: '下载引擎暂不可用', retryable: true, actions: ['retry', 'diagnose'] },
];

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return [...new Set(actions.filter((action) => ACTIONS.has(action)))];
}

function makeTaskError(input = {}) {
  const nativeCode = Number.isFinite(Number(input.nativeCode)) ? Number(input.nativeCode) : undefined;
  const category = typeof input.category === 'string' ? input.category : 'unknown';
  const message = typeof input.message === 'string' && input.message ? input.message : '任务失败';
  return Object.freeze({
    code: String(input.code || 'TASK_FAILED'),
    ...(nativeCode === undefined ? {} : { nativeCode }),
    category,
    message,
    retryable: input.retryable === true,
    actions: normalizeActions(input.actions),
  });
}

function mapNativeError(errorLike, fallback = {}) {
  if (errorLike && typeof errorLike === 'object' && errorLike.code && errorLike.category && errorLike.actions) {
    return makeTaskError(errorLike);
  }
  const raw = errorLike === undefined || errorLike === null ? '' : String(errorLike);
  const numericCode = Number.isFinite(Number(errorLike)) ? Number(errorLike) : Number.isFinite(Number(fallback.nativeCode)) ? Number(fallback.nativeCode) : undefined;
  const rule = ERROR_RULES.find((item) => item.test.test(raw)) || null;
  if (rule) return makeTaskError({
    ...rule,
    ...fallback,
    code: fallback.code || rule.code,
    category: fallback.category || rule.category,
    message: fallback.message || rule.message,
    retryable: fallback.retryable === undefined ? rule.retryable : fallback.retryable,
    actions: fallback.actions || rule.actions,
    nativeCode: numericCode,
  });
  return makeTaskError({
    code: fallback.code || 'TASK_FAILED',
    nativeCode: numericCode,
    category: fallback.category || 'unknown',
    message: fallback.message || (raw ? '下载任务失败' : '任务失败'),
    retryable: fallback.retryable === true,
    actions: fallback.actions || (fallback.retryable ? ['retry', 'diagnose'] : ['diagnose']),
  });
}

function sanitizeTaskError(value) {
  if (!value) return null;
  const error = makeTaskError(value);
  return error;
}

module.exports = { makeTaskError, mapNativeError, sanitizeTaskError, normalizeActions };
