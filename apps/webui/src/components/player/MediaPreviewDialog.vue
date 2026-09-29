<script setup lang="ts">
import { computed } from 'vue'
import { X } from '@lucide/vue'
import { useOverlayStore } from '../../stores/overlay'
import LocalMediaPlayer from './LocalMediaPlayer.vue'

const props = defineProps<{ taskId: string, fileIndex?: number, displayName: string, kind: 'video' | 'audio' | 'image' | 'text' | 'download-only' }>()
const overlay = useOverlayStore()
const playerKind = computed(() => props.kind === 'download-only' ? 'text' : props.kind)
</script>

<template>
  <div class="modal-layer" @mousedown.self="overlay.close">
    <section class="modal-card media-preview-dialog" role="dialog" aria-modal="true" :aria-label="displayName">
      <header class="modal-header"><h2>{{ displayName }}</h2><button class="icon-button" aria-label="关闭" @click="overlay.close"><X :size="18" /></button></header>
      <div class="modal-body" style="padding: 0 16px 16px"><LocalMediaPlayer :task-id="taskId" :file-index="fileIndex" :display-name="displayName" :kind="playerKind" /></div>
    </section>
  </div>
</template>
