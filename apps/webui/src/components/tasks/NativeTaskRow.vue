<script setup lang="ts">
import { Check, CirclePause, Ellipsis, FolderOpen, MoreHorizontal, Pause, Play, RotateCcw, AlertCircle, FileArchive } from '@lucide/vue'
import type { TaskCommand, TaskListItemV2 } from '../../api/contracts/v2/tasks'

const props = defineProps<{ task: TaskListItemV2; selected: boolean; focused: boolean; pending?: boolean; density?: 'comfortable' | 'compact' }>()
const emit = defineEmits<{
  select: [payload: { taskId: string; mode: 'toggle' | 'range' | 'only' }]
  open: [taskId: string]
  command: [payload: { taskId: string; command: TaskCommand }]
  contextmenu: [payload: { taskId: string; x: number; y: number }]
}>()

const statusText: Record<TaskListItemV2['lifecycle'], string> = {
  preparing: '正在准备', metadata: '资源连接中', queued: '等待下载', downloading: '下载中', paused: '已暂停', completed: '下载完成', failed: '下载失败', recycled: '回收站', missing: '文件已丢失',
}

function bytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}
function speed(value: number) { return value > 0 ? `${bytes(value)}/s` : '—' }
function percent(value: number) { return `${Math.round(value * 100)}%` }
function time(value: number | null) {
  if (value === null || !Number.isFinite(value)) return ''
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}分`
  return `${Math.floor(value / 3600)}小时`
}
function iconFor(task: TaskListItemV2) { return task.kind === 'bt' || task.kind === 'magnet' ? FileArchive : task.lifecycle === 'failed' || task.lifecycle === 'missing' ? AlertCircle : task.lifecycle === 'paused' ? CirclePause : FolderOpen }
function has(command: string) { return props.task.capabilities.includes(command as never) }
function send(command: TaskCommand) { emit('command', { taskId: props.task.taskId, command }) }
function onSelect(event: Event) {
  const mouse = event as MouseEvent
  const mode = mouse.shiftKey ? 'range' : mouse.metaKey || mouse.ctrlKey ? 'toggle' : 'only'
  emit('select', { taskId: props.task.taskId, mode })
}
function onContext(event: MouseEvent) { event.preventDefault(); emit('contextmenu', { taskId: props.task.taskId, x: event.clientX, y: event.clientY }) }
</script>

<template>
  <article class="native-task-row" :class="[{ selected, focused, pending }, `density-${density || 'comfortable'}`]" tabindex="0" @click="onSelect" @dblclick="emit('open', task.taskId)" @contextmenu="onContext">
    <label class="task-check" @click.stop><input type="checkbox" :checked="selected" :aria-label="`选择 ${task.displayName}`" @change="onSelect" /><span class="checkmark"><Check v-if="selected" :size="13" /></span></label>
    <div class="task-type-icon" :class="`type-${task.kind}`"><component :is="iconFor(task)" :size="21" stroke-width="1.8" /></div>
    <div class="task-main">
      <div class="task-name-line"><span class="task-name" :title="task.displayName">{{ task.displayName }}</span><span v-for="badge in task.badges" :key="badge" class="task-badge" :class="`badge-${badge}`">{{ badge === 'vip' ? 'VIP' : badge === 'private' ? '私人' : badge === 'remote' ? '远程' : 'BT' }}</span></div>
      <div class="task-subline"><span :class="`task-status status-${task.lifecycle}`">{{ statusText[task.lifecycle] }}</span><span v-if="task.lifecycle === 'failed' && task.error">{{ task.error.message }}</span><span v-else-if="task.lifecycle === 'downloading' && task.etaSeconds !== null">剩余 {{ time(task.etaSeconds) }}</span><span v-else-if="task.lifecycle === 'missing'">请检查本地文件</span><span v-else>{{ task.completedBytes ? `${bytes(task.completedBytes)} / ${bytes(task.totalBytes)}` : bytes(task.totalBytes) }}</span></div>
      <div class="task-progress-line"><div class="task-progress"><span :style="{ width: `${Math.min(100, task.progress * 100)}%` }" :class="`progress-${task.lifecycle}`" /></div><span class="task-percent">{{ percent(task.progress) }}</span></div>
    </div>
    <div class="task-speed">{{ speed(task.downloadBytesPerSecond) }}</div>
    <div class="task-row-actions" @click.stop>
      <button v-if="has('pause')" class="row-action" aria-label="暂停" @click="send('pause')"><Pause :size="16" /></button>
      <button v-else-if="has('start')" class="row-action" aria-label="开始" @click="send('start')"><Play :size="16" /></button>
      <button v-else-if="task.lifecycle === 'failed' && has('retry')" class="row-action" aria-label="重试" @click="send('redownload')"><RotateCcw :size="16" /></button>
      <button class="row-action" aria-label="更多操作" @click="emit('contextmenu', { taskId: task.taskId, x: 0, y: 0 })"><MoreHorizontal :size="18" /></button>
    </div>
    <span v-if="pending" class="task-pending" aria-label="操作处理中"><Ellipsis :size="17" /></span>
  </article>
</template>
