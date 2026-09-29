<script setup lang="ts">
import ModalShell from '../ModalShell.vue'
defineProps<{ url: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <ModalShell title="导出已准备" @close="$emit('close')">
    <p>导出包只包含诊断 JSON，不包含 token、密码、证书、下载文件或私人明文。</p>
    <template #footer><mdui-button variant="filled" class="primary-button" :href="url" download>下载 ZIP</mdui-button></template>
  </ModalShell>
</template>
