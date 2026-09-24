<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TaskDetailV2 } from '../../api/contracts/v2/tasks'
import { useOverlayStore } from '../../stores/overlay'
import QueuePositionMenu from './QueuePositionMenu.vue'
import SpeedLimitPopover from './SpeedLimitPopover.vue'
import { mediaKind } from '../../domain/media-kind'
const props = defineProps<{ detail: TaskDetailV2 }>()
const emit = defineEmits<{
  command: [command: 'open' | 'show-in-folder' | 'copy-info']
  speedLimit: [value: number | null]
  queueMove: [target: 'top' | 'up' | 'down' | 'bottom']
  exportTorrent: []
}>()
const overlay = useOverlayStore()
const speedMenu = ref(false)
const queueMenu = ref(false)
const canMoveQueue = computed(() => ['preparing', 'metadata', 'queued', 'downloading', 'paused'].includes(props.detail.lifecycle))
function setSpeed(value: number | null) { speedMenu.value = false; emit('speedLimit', value) }
function moveQueue(target: 'top' | 'up' | 'down' | 'bottom') { queueMenu.value = false; emit('queueMove', target) }
</script>
<template>
  <section class="details-panel-section">
    <div class="detail-progress"><div class="detail-progress-head"><strong>{{ Math.round(detail.progress * 100) }}%</strong><span>{{ detail.completedBytes }} / {{ detail.totalBytes }}</span></div><div class="task-progress large"><span :style="{ width: `${detail.progress * 100}%` }" /></div></div>
    <dl class="detail-grid"><div><dt>状态</dt><dd>{{ detail.lifecycle }}</dd></div><div><dt>下载速度</dt><dd>{{ detail.downloadBytesPerSecond }} B/s</dd></div><div><dt>保存位置</dt><dd :title="detail.savePath">{{ detail.savePath }}</dd></div><div><dt>来源</dt><dd :title="detail.source || ''">{{ detail.source || '—' }}</dd></div><div><dt>队列位置</dt><dd>{{ detail.queuePosition }}</dd></div><div><dt>单任务限速</dt><dd>{{ detail.taskSpeedLimit ? `${detail.taskSpeedLimit} B/s` : '跟随全局' }}</dd></div></dl>
    <div class="detail-action-row">
      <button v-if="detail.capabilities.open" class="secondary-button" @click="emit('command', 'open')">打开文件</button>
      <button v-if="mediaKind(detail.displayName) !== 'download-only'" class="secondary-button" @click="overlay.open({ type: 'media-preview', taskId: detail.taskId, fileIndex: 0, displayName: detail.displayName, kind: mediaKind(detail.displayName) })">浏览器预览</button>
      <button v-if="detail.capabilities.showInFolder" class="secondary-button" @click="emit('command', 'show-in-folder')">定位文件</button>
      <button v-if="detail.seedAvailable" class="secondary-button" @click="emit('exportTorrent')">导出种子</button>
      <button v-if="canMoveQueue" class="secondary-button" @click="queueMenu = !queueMenu">调整队列</button>
      <button v-if="detail.capabilities.perTaskRateLimit" class="secondary-button" @click="speedMenu = !speedMenu">单任务限速</button>
      <button v-if="detail.capabilities.copyInfo" class="secondary-button" @click="emit('command', 'copy-info')">复制信息</button>
    </div>
    <QueuePositionMenu v-if="queueMenu" @move="moveQueue" />
    <SpeedLimitPopover v-if="speedMenu" :value="detail.taskSpeedLimit" @apply="setSpeed" />
  </section>
</template>
