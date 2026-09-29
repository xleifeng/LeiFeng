<script setup lang="ts">
import { FileUp } from '@lucide/vue'
defineProps<{ modelValue: string; busy?: boolean; uploadProgress?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; preflight: []; file: [file: File] }>()
function dropFile(event: DragEvent) { const file = event.dataTransfer?.files?.[0]; if (file && (file.name.toLowerCase().endsWith('.torrent') || file.type === 'application/x-bittorrent')) emit('file', file) }
function chooseFile(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (file) emit('file', file) }
</script>
<template>
  <div class="create-step" @dragover.prevent @drop.prevent="dropFile">
    <label class="sr-only" for="create-links">粘贴下载链接</label>
    <mdui-text-field id="create-links" variant="outlined" :rows="7" :value="modelValue" placeholder="粘贴下载链接，每行一个；支持 HTTP / FTP / 磁力 / 种子拖拽" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"></mdui-text-field>
    <div class="create-input-actions">
      <label class="create-upload-button" aria-label="上传 BT 种子"><FileUp :size="15" :stroke-width="1.8" />BT 文件<input type="file" accept=".torrent,application/x-bittorrent" hidden @change="chooseFile" /></label>
      <mdui-button variant="filled" class="create-download-button" :disabled="busy || !modelValue.trim()" @click="emit('preflight')">{{ busy ? '正在解析…' : '立即下载' }}</mdui-button>
    </div>
    <mdui-linear-progress v-if="busy" class="upload-progress" :max="1" :value="uploadProgress || 0"></mdui-linear-progress>
  </div>
</template>
