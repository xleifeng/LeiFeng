<script setup lang="ts">
// 空态：Lucide 图标 + 灰阶文案（旧版迅雷插画已随重设计移除）
import { CircleCheckBig, Inbox, Search, Trash2, WifiOff } from '@lucide/vue'
defineProps<{ kind: 'downloading' | 'completed' | 'trash' | 'search' | 'offline' }>()
const emit = defineEmits<{ create: [] }>()
</script>

<template>
  <div class="task-empty-state" :class="`is-${kind}-empty`" data-testid="task-empty-state">
    <span class="empty-icon">
      <WifiOff v-if="kind === 'offline'" :size="30" :stroke-width="1.6" />
      <Search v-else-if="kind === 'search'" :size="30" :stroke-width="1.6" />
      <Trash2 v-else-if="kind === 'trash'" :size="30" :stroke-width="1.6" />
      <CircleCheckBig v-else-if="kind === 'completed'" :size="30" :stroke-width="1.6" />
      <Inbox v-else :size="30" :stroke-width="1.6" />
    </span>
    <h2>{{ kind === 'offline' ? 'daemon 暂时离线' : kind === 'search' ? '没有匹配的任务' : kind === 'trash' ? '回收站是空的' : kind === 'completed' ? '还没有已完成的任务' : '暂无下载任务' }}</h2>
    <p>{{ kind === 'offline' ? '重连后会自动恢复任务列表。' : kind === 'search' ? '换个关键词试试。' : kind === 'trash' ? '被移除的任务会先来到这里。' : kind === 'completed' ? '完成的下载会出现在这里。' : '新建一个任务开始下载。' }}</p>
    <button v-if="kind === 'downloading'" class="primary-button" data-testid="empty-create" @click="emit('create')">新建任务</button>
  </div>
</template>
