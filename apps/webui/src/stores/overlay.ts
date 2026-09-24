import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TaskCommand, TaskListItemV2 } from '../api/contracts/v2/tasks'

export type OverlayState =
  | { type: 'new-task' }
  | { type: 'settings' }
  | { type: 'limit-speed-settings' }
  | { type: 'proxy-settings' }
  | { type: 'about' }
  | { type: 'schedule-manager' }
  | { type: 'vip-overview' }
  | { type: 'task-details'; taskId: string }
  | { type: 'confirm-command'; command: TaskCommand; tasks: TaskListItemV2[] }
  | { type: 'empty-trash'; total: number }
  | { type: 'rename-task'; task: TaskListItemV2 }
  | { type: 'move-task'; task: TaskListItemV2 }
  | { type: 'redownload-task'; task: TaskListItemV2 }
  | { type: 'recover-task'; task: TaskListItemV2 }
  | { type: 'feature'; title: string; description: string }
  | { type: 'account' }
  | { type: 'media-preview'; taskId: string; fileIndex?: number; displayName: string; kind: 'video' | 'audio' | 'image' | 'text' | 'download-only' }
  | null

export const useOverlayStore = defineStore('overlay', () => {
  const active = ref<OverlayState>(null)
  const returnFocus = ref<HTMLElement | null>(null)
  function open(next: Exclude<OverlayState, null>, trigger?: HTMLElement | null) { active.value = next; returnFocus.value = trigger || null }
  function close() {
    active.value = null
    const target = returnFocus.value
    returnFocus.value = null
    queueMicrotask(() => target?.focus())
  }
  return { active, open, close }
})
