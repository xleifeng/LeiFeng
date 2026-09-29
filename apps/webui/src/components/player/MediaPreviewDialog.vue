<script setup lang="ts">
import { computed } from 'vue'
import { useOverlayStore } from '../../stores/overlay'
import ModalShell from '../ModalShell.vue'
import LocalMediaPlayer from './LocalMediaPlayer.vue'

const props = defineProps<{ taskId: string, fileIndex?: number, displayName: string, kind: 'video' | 'audio' | 'image' | 'text' | 'download-only' }>()
const overlay = useOverlayStore()
const playerKind = computed(() => props.kind === 'download-only' ? 'text' : props.kind)
</script>

<template>
  <ModalShell :title="displayName" @close="overlay.close">
    <LocalMediaPlayer :task-id="taskId" :file-index="fileIndex" :display-name="displayName" :kind="playerKind" />
  </ModalShell>
</template>
