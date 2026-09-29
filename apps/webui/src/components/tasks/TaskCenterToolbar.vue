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
    <button v-else class="vip-download-prompt" type="button" @click="emit('vip')"><span>会员下载加速</span> · 查看实时状态<ChevronRight :size="13" :stroke-width="1.8" /></button>
    <div class="toolbar-actions">
      <mdui-button v-if="selectedCount && view === 'downloading' && canStart" variant="text" class="toolbar-button" :disabled="busy" @click="emit('command', 'start')"><Play slot="icon" :size="15" />开始</mdui-button>
      <mdui-button v-if="selectedCount && view === 'downloading' && canPause" variant="text" class="toolbar-button" :disabled="busy" @click="emit('command', 'pause')"><Pause slot="icon" :size="15" />暂停</mdui-button>
      <mdui-button v-if="selectedCount && view !== 'trash' && canRecycle" variant="text" class="toolbar-button danger-text" :disabled="busy" @click="emit('command', 'recycle')"><Trash2 slot="icon" :size="15" />移入回收站</mdui-button>
      <mdui-button v-if="selectedCount && view === 'trash' && canDeletePermanently" variant="text" class="toolbar-button danger-text" :disabled="busy" @click="emit('command', 'delete-permanently')"><Trash2 slot="icon" :size="15" />彻底删除</mdui-button>
      <mdui-button v-if="view === 'trash' && total" variant="text" class="toolbar-button danger-text" :disabled="busy" @click="emit('emptyTrash')"><Trash2 slot="icon" :size="15" />清空回收站</mdui-button>
      <mdui-select v-if="view !== 'trash'" variant="outlined" class="select-control" :value="sort" aria-label="任务排序" @change="emit('update:sort', ($event.target as HTMLInputElement).value)"><ListFilter slot="icon" :size="16" :stroke-width="1.6" /><mdui-menu-item value="created-desc">最近创建</mdui-menu-item><mdui-menu-item value="completed-desc">完成时间</mdui-menu-item><mdui-menu-item value="name-asc">文件名</mdui-menu-item><mdui-menu-item value="size-desc">文件大小</mdui-menu-item><mdui-menu-item value="speed-desc">下载速度</mdui-menu-item></mdui-select>
      <mdui-select v-if="view !== 'trash'" variant="outlined" class="select-control" :value="groupBy" aria-label="任务分组" @change="emit('update:group-by', ($event.target as HTMLInputElement).value as 'none' | 'date' | 'task-group')"><Filter slot="icon" :size="16" :stroke-width="1.6" /><mdui-menu-item value="date">按日期</mdui-menu-item><mdui-menu-item value="task-group">按任务组</mdui-menu-item><mdui-menu-item value="none">不分组</mdui-menu-item></mdui-select>
    </div>
  </div>
</template>
