<script setup lang="ts">
import { ChevronRight, Filter, ListFilter, Pause, Play, Trash2 } from '@lucide/vue'
import type { TaskCommand } from '../../api/contracts/v2/tasks'

defineProps<{ view: 'downloading' | 'completed' | 'trash'; selectedCount: number; total: number; sort: string; groupBy: 'none' | 'date' | 'task-group'; busy?: boolean; canStart?: boolean; canPause?: boolean; canRecycle?: boolean; canDeletePermanently?: boolean }>()
const emit = defineEmits<{ 'update:sort': [value: string]; 'update:group-by': [value: 'none' | 'date' | 'task-group']; selectAll: []; command: [command: TaskCommand]; emptyTrash: []; refresh: []; more: []; vip: [] }>()
</script>

<template>
  <div class="task-toolbar">
    <div v-if="view === 'trash'" class="trash-file-tabs" aria-label="回收站分类">
      <button class="trash-file-tab active" type="button">下载 · <span>{{ total }}</span></button>
    </div>
    <button v-else class="vip-download-prompt" type="button" @click="emit('vip')"><span>会员下载加速</span>、查看实时状态<ChevronRight :size="13" :stroke-width="1.8" /></button>
    <div class="toolbar-actions">
      <button v-if="selectedCount && view === 'downloading' && canStart" class="toolbar-button" :disabled="busy" @click="emit('command', 'start')"><Play :size="15" />开始</button>
      <button v-if="selectedCount && view === 'downloading' && canPause" class="toolbar-button" :disabled="busy" @click="emit('command', 'pause')"><Pause :size="15" />暂停</button>
      <button v-if="selectedCount && view !== 'trash' && canRecycle" class="toolbar-button danger-text" :disabled="busy" @click="emit('command', 'recycle')"><Trash2 :size="15" />移入回收站</button>
      <button v-if="selectedCount && view === 'trash' && canDeletePermanently" class="toolbar-button danger-text" :disabled="busy" @click="emit('command', 'delete-permanently')"><Trash2 :size="15" />彻底删除</button>
      <button v-if="view === 'trash' && total" class="toolbar-button danger-text" :disabled="busy" @click="emit('emptyTrash')"><Trash2 :size="15" />清空回收站</button>
      <label v-if="view !== 'trash'" class="replica-select-control" title="排序"><ListFilter :size="16" :stroke-width="1.6" /><select :value="sort" aria-label="任务排序" @change="emit('update:sort', ($event.target as HTMLSelectElement).value)"><option value="created-desc">最近创建</option><option value="completed-desc">完成时间</option><option value="name-asc">文件名</option><option value="size-desc">文件大小</option><option value="speed-desc">下载速度</option></select></label>
      <label v-if="view !== 'trash'" class="replica-select-control" title="筛选与分组"><Filter :size="16" :stroke-width="1.6" /><select :value="groupBy" aria-label="任务分组" @change="emit('update:group-by', ($event.target as HTMLSelectElement).value as 'none' | 'date' | 'task-group')"><option value="date">按日期</option><option value="task-group">按任务组</option><option value="none">不分组</option></select></label>
    </div>
  </div>
</template>
