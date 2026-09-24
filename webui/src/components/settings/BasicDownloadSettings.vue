<script setup lang="ts">
import type { DownloadPolicy } from '../../api/contracts/v2/policies'
const props = defineProps<{ modelValue: DownloadPolicy }>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<DownloadPolicy>] }>()
function patch(value: Partial<DownloadPolicy>) { emit('update:modelValue', value) }
</script>
<template>
  <section class="settings-card"><h2>基本下载</h2><label>默认下载目录<input :value="props.modelValue.defaultDownloadPath" @input="patch({ defaultDownloadPath: ($event.target as HTMLInputElement).value })" /></label><label>最大同时下载任务<input type="number" min="1" max="100" :value="props.modelValue.maxConcurrentTasks" @input="patch({ maxConcurrentTasks: Number(($event.target as HTMLInputElement).value) })" /></label><label class="settings-check"><input type="checkbox" :checked="props.modelValue.autoResumeUnfinished" @change="patch({ autoResumeUnfinished: ($event.target as HTMLInputElement).checked })" />启动后继续未完成任务</label><label class="settings-check"><input type="checkbox" :checked="props.modelValue.autoMoveSlowTaskToTail" @change="patch({ autoMoveSlowTaskToTail: ($event.target as HTMLInputElement).checked })" />低速任务自动移到队尾</label></section>
</template>
