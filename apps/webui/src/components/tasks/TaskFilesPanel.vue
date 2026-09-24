<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TaskDetailV2 } from '../../api/contracts/v2/tasks'
import { mediaKind, type PreviewKind } from '../../domain/media-kind'
const props = defineProps<{ detail: TaskDetailV2; pending?: boolean }>()
const emit = defineEmits<{
  update: [indices: number[]]
  scheduler: [value: 'normal' | 'sequential']
  open: [fileIndex: number]
  show: [fileIndex: number]
  preview: [payload: { fileIndex: number; displayName: string; kind: PreviewKind }]
}>()
const selected = ref<number[]>(props.detail.files.filter((file) => file.selected).map((file) => file.index))
const selectedSet = computed(() => new Set(selected.value))
watch(() => props.detail.files, (files) => { selected.value = files.filter((file) => file.selected).map((file) => file.index) }, { deep: true })
function toggle(index: number) { selected.value = selectedSet.value.has(index) ? selected.value.filter((item) => item !== index) : [...selected.value, index].sort((a, b) => a - b) }
</script>
<template><section class="detail-files details-panel-section"><div class="detail-section-head"><h3>BT 文件列表</h3><div class="detail-file-actions"><select v-if="detail.capabilities.btSequential" :value="detail.btScheduler" :disabled="pending" aria-label="BT 下载顺序" @change="emit('scheduler', ($event.target as HTMLSelectElement).value as 'normal' | 'sequential')"><option value="normal">普通调度</option><option value="sequential">顺序下载</option></select><button v-if="detail.files.length && (detail.kind === 'bt' || detail.kind === 'magnet') && detail.capabilities.btSelection" class="secondary-button" :disabled="pending" @click="emit('update', selected)">保存选择</button></div></div><p v-if="detail.capabilities.btSelection || detail.capabilities.btSequential" class="details-capability-note">当前引擎不支持在线修改时，会停止原任务并复用已有文件重建；原记录保留在回收站。</p><div v-if="!detail.files.length" class="details-empty">该任务没有可展开的文件列表。</div><div v-for="file in detail.files" :key="file.index" class="detail-file detail-file-select"><label class="detail-file-check"><input :disabled="!detail.capabilities.btSelection" :checked="selectedSet.has(file.index)" type="checkbox" @change="toggle(file.index)" /><span>{{ file.name }}</span></label><span>{{ file.size }} B</span><span class="detail-file-buttons"><button v-if="mediaKind(file.name) !== 'download-only'" type="button" :disabled="pending" @click="emit('preview', { fileIndex: file.index, displayName: file.name, kind: mediaKind(file.name) })">预览</button><button v-if="detail.capabilities.open" type="button" :disabled="pending" @click="emit('open', file.index)">打开</button><button v-if="detail.capabilities.showInFolder" type="button" :disabled="pending" @click="emit('show', file.index)">定位</button></span></div></section></template>
