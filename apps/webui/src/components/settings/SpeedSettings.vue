<script setup lang="ts">
import type { DownloadPolicy } from '../../api/contracts/v2/policies'
const props = defineProps<{ modelValue: DownloadPolicy; fullSpeed?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<DownloadPolicy>]; 'full-speed': []; restore: [] }>()
const numberOrNull = (event: Event) => { const value = Number((event.target as HTMLInputElement).value); return Number.isFinite(value) && value >= 0 ? value : null }
</script>
<template>
  <section class="settings-card"><div class="settings-card-heading"><h2>速度</h2><div class="settings-inline-actions"><mdui-button variant="tonal" class="secondary-button" v-if="!props.fullSpeed"  @click="emit('full-speed')">全速下载</mdui-button><mdui-button variant="tonal" class="secondary-button" v-else  @click="emit('restore')">恢复限速</mdui-button></div></div><label>全局下载限速（B/s）<mdui-text-field variant="outlined" type="number" min="0" :value="props.modelValue.globalDownloadLimit === null ? '' : String(props.modelValue.globalDownloadLimit)" placeholder="不限速" @input="emit('update:modelValue', { globalDownloadLimit: numberOrNull($event) })"></mdui-text-field></label><label>全局上传限速（B/s）<mdui-text-field variant="outlined" type="number" min="0" :value="props.modelValue.globalUploadLimit === null ? '' : String(props.modelValue.globalUploadLimit)" placeholder="不限速" @input="emit('update:modelValue', { globalUploadLimit: numberOrNull($event) })"></mdui-text-field></label><label>最大连接数<mdui-text-field variant="outlined" type="number" min="1" :value="props.modelValue.globalConnectionLimit === null ? '' : String(props.modelValue.globalConnectionLimit)" placeholder="默认" @input="emit('update:modelValue', { globalConnectionLimit: numberOrNull($event) })"></mdui-text-field></label></section>
</template>
