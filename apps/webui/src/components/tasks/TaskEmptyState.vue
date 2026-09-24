<script setup lang="ts">
import { Search, WifiOff } from '@lucide/vue'
import downloadEmpty from '@orig/img/download-default.png'
import trashEmpty from '@orig/img/trash-empty.png'
defineProps<{ kind: 'downloading' | 'completed' | 'trash' | 'search' | 'offline' }>()
const emit = defineEmits<{ create: [] }>()
</script>

<template>
  <div class="task-empty-state" :class="[`is-${kind}-empty`, { 'is-standard-empty': kind === 'offline' || kind === 'search' }]">
    <img v-if="kind === 'trash'" class="empty-art empty-art-trash" :src="trashEmpty" alt="暂无下载任务" />
    <img v-else-if="kind === 'downloading' || kind === 'completed'" class="empty-art empty-art-download" :src="downloadEmpty" alt="暂无内容" />
    <span v-else class="empty-icon"><WifiOff v-if="kind === 'offline'" :size="32" /><Search v-else :size="32" /></span>
    <h2>{{ kind === 'offline' ? 'daemon 暂时离线' : kind === 'search' ? '没有匹配的任务' : kind === 'trash' ? '暂无下载任务' : '暂无内容' }}</h2>
    <p v-if="kind === 'offline' || kind === 'search'">{{ kind === 'offline' ? '重连后会自动恢复任务列表。' : '换个关键词试试。' }}</p>
    <button v-if="kind === 'downloading'" class="primary-button" @click="emit('create')">新建任务</button>
  </div>
</template>
