<script setup lang="ts">
import { Clock3 } from '@lucide/vue'
defineProps<{ modelValue: string; busy?: boolean; uploadProgress?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; preflight: []; file: [file: File] }>()
function dropFile(event: DragEvent) { const file = event.dataTransfer?.files?.[0]; if (file && (file.name.toLowerCase().endsWith('.torrent') || file.type === 'application/x-bittorrent')) emit('file', file) }
function chooseFile(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (file) emit('file', file) }
</script>
<template>
  <div class="create-step" @dragover.prevent @drop.prevent="dropFile">
    <label class="sr-only" for="create-links">粘贴下载链接</label>
    <textarea id="create-links" :value="modelValue" rows="7" placeholder="添加多个下载链接时，请确保每行只有一个链接，输入回车键分行" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <div class="create-input-actions">
      <button class="create-download-button" aria-label="解析链接" :disabled="busy || !modelValue.trim()" @click="emit('preflight')">{{ busy ? '正在解析' : '立即下载' }}</button>
      <span class="create-action-divider" />
      <label class="create-history-button" aria-label="上传 BT 种子"><Clock3 :size="17" :stroke-width="1.5" /><input type="file" accept=".torrent,application/x-bittorrent" hidden @change="chooseFile" /></label>
    </div>
    <div v-if="busy" class="upload-progress" role="progressbar" :aria-valuenow="Math.round((uploadProgress || 0) * 100)"><span :style="{ width: `${Math.round((uploadProgress || 0) * 100)}%` }" /></div>
  </div>
</template>
