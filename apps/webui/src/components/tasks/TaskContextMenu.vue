<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed } from 'vue'
import { Pause, Play, Trash2, RotateCcw, Info, X } from '@lucide/vue'
import type { TaskCommand, TaskListItemV2 } from '../../api/contracts/v2/tasks'
import { TASK_COMMAND_DEFINITIONS } from '../../domain/task-command-definitions'

const props = defineProps<{ task: TaskListItemV2; x: number; y: number }>()
const emit = defineEmits<{ command: [command: TaskCommand]; details: []; close: [] }>()
const items = computed(() => TASK_COMMAND_DEFINITIONS.filter((definition) => props.task.capabilities.includes(definition.capability as never)))
const icon = (command: TaskCommand) => command === 'pause' ? Pause : command === 'start' ? Play : command === 'remove-record' ? Trash2 : RotateCcw
function onWindowClick(event: MouseEvent) { if (!(event.target as HTMLElement)?.closest('.task-context-menu')) emit('close') }
onMounted(() => window.addEventListener('mousedown', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowClick))
</script>

<template>
  <div class="task-context-menu" :style="{ left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px` }" role="menu">
    <button v-for="item in items" :key="item.command" class="context-item" :class="{ danger: item.danger }" role="menuitem" @click="emit('command', item.command)"><component :is="icon(item.command)" :size="16" /><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></button>
    <button class="context-item" role="menuitem" @click="emit('details')"><Info :size="16" /><span>查看详情</span><kbd>Ctrl+I</kbd></button>
    <button class="context-close" aria-label="关闭菜单" @click="emit('close')"><X :size="14" /></button>
  </div>
</template>
