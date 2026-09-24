import type { TaskCommand } from '../api/contracts/v2/tasks'

export type TaskCapability = 'start' | 'pause' | 'removeRecord' | 'retry' | 'rename' | 'move' | 'recycle' | 'recover' | 'redownload' | 'deletePermanently' | 'setSpeedLimit' | 'updateBtSelection' | 'setBtScheduler' | 'open' | 'showInFolder' | 'copyInfo' | 'perTaskRateLimit' | 'btSelection' | 'btSequential'

export interface TaskCommandDefinition {
  command: TaskCommand
  capability: TaskCapability
  label: string
  shortcut?: string
  danger?: boolean
}

export const TASK_COMMAND_DEFINITIONS: readonly TaskCommandDefinition[] = Object.freeze([
  { command: 'start', capability: 'start', label: '开始下载', shortcut: 'Space' },
  { command: 'pause', capability: 'pause', label: '暂停下载', shortcut: 'Space' },
  { command: 'recycle', capability: 'recycle', label: '移入回收站', shortcut: 'Delete', danger: true },
  { command: 'recover', capability: 'recover', label: '恢复任务' },
  { command: 'redownload', capability: 'redownload', label: '重新下载', danger: true },
  { command: 'rename', capability: 'rename', label: '重命名' },
  { command: 'move', capability: 'move', label: '移动到' },
  { command: 'delete-permanently', capability: 'deletePermanently', label: '彻底删除', danger: true },
  { command: 'open', capability: 'open', label: '打开文件' },
  { command: 'show-in-folder', capability: 'showInFolder', label: '定位文件' },
])

export function commandDefinition(command: TaskCommand): TaskCommandDefinition | undefined {
  return TASK_COMMAND_DEFINITIONS.find((item) => item.command === command)
}
