<script setup lang="ts">
import type { DownloadPolicy } from '../../api/contracts/v2/policies'
const props = defineProps<{ modelValue: DownloadPolicy; fullSpeed?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<DownloadPolicy>]; 'full-speed': []; restore: [] }>()
const numberOrNull = (event: Event) => { const value = Number((event.target as HTMLInputElement).value); return Number.isFinite(value) && value >= 0 ? value : null }
</script>
<template>
  <section class="settings-card"><div class="settings-card-heading"><h2>速度</h2><div class="settings-inline-actions"><button v-if="!props.fullSpeed" class="secondary-button" @click="emit('full-speed')">全速下载</button><button v-else class="secondary-button" @click="emit('restore')">恢复限速</button></div></div><label>全局下载限速（B/s）<input type="number" min="0" :value="props.modelValue.globalDownloadLimit ?? ''" placeholder="不限速" @input="emit('update:modelValue', { globalDownloadLimit: numberOrNull($event) })" /></label><label>全局上传限速（B/s）<input type="number" min="0" :value="props.modelValue.globalUploadLimit ?? ''" placeholder="不限速" @input="emit('update:modelValue', { globalUploadLimit: numberOrNull($event) })" /></label><label>最大连接数<input type="number" min="1" :value="props.modelValue.globalConnectionLimit ?? ''" placeholder="默认" @input="emit('update:modelValue', { globalConnectionLimit: numberOrNull($event) })" /></label></section>
</template>
