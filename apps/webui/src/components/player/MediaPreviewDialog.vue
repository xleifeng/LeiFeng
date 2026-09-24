<script setup lang="ts">
import { computed } from 'vue'
import { useOverlayStore } from '../../stores/overlay'
import LocalMediaPlayer from './LocalMediaPlayer.vue'

const props = defineProps<{ taskId: string, fileIndex?: number, displayName: string, kind: 'video' | 'audio' | 'image' | 'text' | 'download-only' }>()
const overlay = useOverlayStore()
const playerKind = computed(() => props.kind === 'download-only' ? 'text' : props.kind)
</script>

<template>
  <div class="overlay-backdrop" @click.self="overlay.close">
    <section class="modal-shell media-preview-dialog" role="dialog" aria-modal="true" :aria-label="displayName">
      <header class="modal-header"><strong>{{ displayName }}</strong><button class="icon-button" aria-label="关闭" @click="overlay.close">×</button></header>
      <LocalMediaPlayer :task-id="taskId" :file-index="fileIndex" :display-name="displayName" :kind="playerKind" />
    </section>
  </div>
</template>
