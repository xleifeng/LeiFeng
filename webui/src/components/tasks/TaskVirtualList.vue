<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { TaskCommand, TaskListItemV2 } from '../../api/contracts/v2/tasks'
import TaskGroupHeader from './TaskGroupHeader.vue'
import NativeTaskRow from './NativeTaskRow.vue'

export interface TaskGroupHeaderModel { type: 'group'; groupId: string; label: string; count: number }
export type TaskListRow = TaskListItemV2 | TaskGroupHeaderModel

const props = defineProps<{ rows: TaskListRow[]; selectedIds: Set<string>; focusedId?: string | null; pendingIds?: Set<string>; density?: 'comfortable' | 'compact'; hasNextPage?: boolean; loadingMore?: boolean }>()
const emit = defineEmits<{
  select: [payload: { taskId: string; mode: 'toggle' | 'range' | 'only' }]
  open: [taskId: string]
  command: [payload: { taskId: string; command: TaskCommand }]
  contextmenu: [payload: { taskId: string; x: number; y: number }]
  loadMore: []
}>()

const scrollElement = ref<HTMLDivElement | null>(null)
const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>(computed(() => ({
  count: props.rows.length,
  getScrollElement: () => scrollElement.value,
  estimateSize: (index: number) => props.rows[index] && 'type' in props.rows[index] ? 36 : props.density === 'compact' ? 56 : 72,
  overscan: 8,
  getItemKey: (index: number) => {
    const row = props.rows[index]
    return row && 'type' in row ? `group:${row.groupId}` : `task:${row && row.taskId}`
  },
})))

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

function isTask(row: TaskListRow): row is TaskListItemV2 { return !('type' in row) }
function checkNearEnd() {
  const last = virtualRows.value[virtualRows.value.length - 1]
  if (last && props.hasNextPage && !props.loadingMore && last.index >= props.rows.length - 10) emit('loadMore')
}
</script>

<template>
  <div ref="scrollElement" class="task-virtual-scroll" @scroll="checkNearEnd">
    <div class="task-virtual-spacer" :style="{ height: `${totalSize}px` }">
      <div v-for="row in virtualRows" :key="String(row.key)" class="task-virtual-item" :data-index="row.index" :style="{ transform: `translateY(${row.start}px)` }">
        <TaskGroupHeader v-if="!isTask(rows[row.index])" :label="(rows[row.index] as TaskGroupHeaderModel).label" :count="(rows[row.index] as TaskGroupHeaderModel).count" />
        <NativeTaskRow v-else :task="rows[row.index] as TaskListItemV2" :selected="selectedIds.has((rows[row.index] as TaskListItemV2).taskId)" :focused="focusedId === (rows[row.index] as TaskListItemV2).taskId" :pending="pendingIds?.has((rows[row.index] as TaskListItemV2).taskId)" :density="density" @select="emit('select', $event)" @open="emit('open', $event)" @command="emit('command', $event)" @contextmenu="emit('contextmenu', $event)" />
      </div>
    </div>
    <div v-if="loadingMore" class="load-more-hint">正在加载更多任务…</div>
  </div>
</template>
