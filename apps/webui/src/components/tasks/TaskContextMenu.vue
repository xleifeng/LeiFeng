<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, nextTick, ref } from 'vue'
import { Pause, Play, Trash2, RotateCcw, Info, X } from '@lucide/vue'
import type { TaskCommand, TaskListItemV2 } from '../../api/contracts/v2/tasks'
import { TASK_COMMAND_DEFINITIONS } from '../../domain/task-command-definitions'

const props = defineProps<{ task: TaskListItemV2; x: number; y: number }>()
const emit = defineEmits<{ command: [command: TaskCommand]; details: []; close: [] }>()
const items = computed(() => TASK_COMMAND_DEFINITIONS.filter((definition) => props.task.capabilities.includes(definition.capability as never)))
const icon = (command: TaskCommand) => command === 'pause' ? Pause : command === 'start' ? Play : command === 'remove-record' ? Trash2 : RotateCcw
const menuRef = ref<HTMLElement | null>(null)
// x/y 是锚点（鼠标点或按钮右下角）；先按锚点左上展开，渲染后量自身尺寸，视口右/下溢出则翻到锚点左/上侧
const pos = ref({ left: Math.max(8, props.x), top: Math.max(8, props.y) })
function onWindowClick(event: MouseEvent) { if (!(event.target as HTMLElement)?.closest('.task-context-menu')) emit('close') }
onMounted(async () => {
  window.addEventListener('mousedown', onWindowClick)
  await nextTick()
  const rect = menuRef.value?.getBoundingClientRect()
  if (!rect) return
  let { left, top } = pos.value
  if (left + rect.width > window.innerWidth - 8) left = Math.max(8, props.x - rect.width)
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, props.y - rect.height)
  pos.value = { left, top }
})
onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowClick))
</script>

<template>
  <div ref="menuRef" class="task-context-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" role="menu">
    <button v-for="item in items" :key="item.command" class="context-item" :class="{ danger: item.danger }" role="menuitem" @click="emit('command', item.command)"><component :is="icon(item.command)" :size="16" /><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></button>
    <button class="context-item" role="menuitem" @click="emit('details')"><Info :size="16" /><span>查看详情</span><kbd>Ctrl+I</kbd></button>
    <button class="context-close" aria-label="关闭菜单" @click="emit('close')"><X :size="14" /></button>
  </div>
</template>
