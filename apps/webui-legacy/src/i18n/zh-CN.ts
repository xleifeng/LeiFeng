export const zhCN: Record<string, string> = {
  TASK_NOT_FOUND: '任务不存在或已被删除',
  REVISION_CONFLICT: '任务状态已变化，请刷新后重试',
  ENGINE_UNAVAILABLE: '下载引擎暂不可用',
  PRIVATE_SPACE_LOCKED: '私人空间已锁定',
  REMOTE_NODE_OFFLINE: '远程节点当前离线',
  CSRF_INVALID: '页面安全会话已过期，请刷新页面',
  MEDIA_TOKEN_EXPIRED: '播放地址已过期，请重新打开预览',
  UNKNOWN_ERROR: '请求失败，请稍后重试',
}

export function messageFor(code: string, fallback = '请求失败，请稍后重试'): string { return zhCN[code] || fallback }
